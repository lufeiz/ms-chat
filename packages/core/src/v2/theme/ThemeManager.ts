import type { ThemeConfig } from '../../model';
import { EventEmitter } from '../core/EventEmitter';
import { isDevMode } from '../core/devMode';
import { IS_DEV } from '../core/env';

/** 深度可选：递归把每层属性变可选，用于 setThemeConfig 的局部更新。 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/** 一条主题变更（扁平化到 CSS 变量）。 */
export interface ThemeChange {
  /** 逻辑路径，`.` 连接，如 `conversation.c-s-width`。 */
  path: string;
  /** 对应 CSS 变量名，如 `--mschat--conversation--c-s-width`。 */
  cssVar: string;
  oldValue: string | undefined;
  newValue: string | undefined;
}

export type ThemeEvents<T> = {
  'theme:change': [theme: Readonly<T>, changes: ReadonlyArray<ThemeChange>];
};

export interface ThemeManagerOptions {
  /** CSS 变量前缀，默认 `mschat` → `--mschat--a--b`。 */
  cssVarPrefix?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 收集 updates 相对 base 的变更（只遍历 updates 出现的键）。任意嵌套层级递归到叶子，
 * 修复 v1 仅递归 1 层导致深层改动静默失效的问题（H10）。叶子值为 `undefined` 视为删除。
 */
function leafChange(
  path: string[],
  oldValue: unknown,
  newValue: unknown,
  prefix: string,
): ThemeChange {
  return {
    path: path.join('.'),
    cssVar: `--${prefix}--${path.join('--')}`,
    oldValue: oldValue as string | undefined,
    newValue: newValue as string | undefined,
  };
}

/** 枚举一个子树的全部叶子，生成移除变更（newValue=undefined）。 */
function removeSubtree(
  subtree: Record<string, unknown>,
  path: string[],
  prefix: string,
): ThemeChange[] {
  const changes: ThemeChange[] = [];
  for (const key of Object.keys(subtree)) {
    const val = subtree[key];
    const nextPath = [...path, key];
    if (isPlainObject(val)) {
      changes.push(...removeSubtree(val, nextPath, prefix));
    } else if (val !== undefined) {
      changes.push(leafChange(nextPath, val, undefined, prefix));
    }
  }
  return changes;
}

function collectChanges(
  base: Record<string, unknown> | undefined,
  updates: Record<string, unknown>,
  path: string[],
  prefix: string,
): ThemeChange[] {
  const changes: ThemeChange[] = [];
  for (const key of Object.keys(updates)) {
    const next = updates[key];
    const prev = base?.[key];
    const nextPath = [...path, key];
    if (isPlainObject(next)) {
      changes.push(
        ...collectChanges(
          isPlainObject(prev) ? prev : undefined,
          next,
          nextPath,
          prefix,
        ),
      );
    } else if (isPlainObject(prev)) {
      // 用叶子 / undefined 覆盖一个子树：移除旧子树的**全部后代** CSS 变量，
      // 否则像 setThemeConfig({ header: undefined }) 会残留 --mschat--header--bg 等。
      changes.push(...removeSubtree(prev, nextPath, prefix));
      if (next !== undefined) {
        changes.push(leafChange(nextPath, undefined, next, prefix));
      }
    } else if (prev !== next) {
      changes.push(leafChange(nextPath, prev, next, prefix));
    }
  }
  return changes;
}

/**
 * 结构化共享合并：未被 updates 触及的子树**保持原引用**，替代 v1 的
 * `JSON.parse(JSON.stringify())` 全量深克隆（修 P3）。
 */
function structuralMerge<T extends Record<string, any>>(
  base: T,
  updates: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(updates)) {
    const u = updates[key];
    if (u === undefined) {
      // 清除该分支：删除键，使 getThemeConfig 不再包含它（CSS 变量由 collectChanges 移除）
      delete result[key];
    } else if (isPlainObject(u)) {
      const b = (base as Record<string, unknown>)[key];
      result[key] = structuralMerge(
        (isPlainObject(b) ? b : {}) as Record<string, any>,
        u,
      );
    } else {
      result[key] = u;
    }
  }
  return result as T;
}

/**
 * DEV 下深冻结，捕获绕过 setThemeConfig 的原地修改；PROD 不冻结（省开销）。
 * 用迭代而非自递归——避免自引用让 bundler 在调用点被 DCE 后仍无法 tree-shake 本函数。
 */
function deepFreeze<T>(obj: T): T {
  const stack: unknown[] = [obj];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (isPlainObject(cur) && !Object.isFrozen(cur)) {
      Object.freeze(cur);
      for (const key of Object.keys(cur)) {
        stack.push(cur[key]);
      }
    }
  }
  return obj;
}

/**
 * 主题管理器 v2（RFC §2.1.7）。
 *
 * 相比 v1：
 * - **继承 EventEmitter**：`on('theme:change', (theme, changes) => ...)`，去掉独立订阅模型。
 * - **深度递归 diff**：任意嵌套层级的改动都会落到对应 CSS 变量（修 H10）。
 * - **结构化共享 + 引用稳定**：`getThemeConfig()` 返回 frozen 且引用稳定的对象，
 *   仅在真正发生变更的 `setThemeConfig` 后才换新引用（修 P3）。
 * - **SSR 守卫**：无 `document` 时跳过 CSS 应用，仍维护状态并 emit。
 *
 * @typeParam T 主题树类型，默认 `ThemeConfig`；可传更深的自定义类型。
 */
export class ThemeManager<
  T extends Record<string, any> = ThemeConfig,
> extends EventEmitter<ThemeEvents<T>> {
  private theme: Readonly<T>;
  private readonly prefix: string;

  constructor(initial?: DeepPartial<T>, options: ThemeManagerOptions = {}) {
    super();
    this.prefix = options.cssVarPrefix ?? 'mschat';
    // 初始空主题：dev 冻结以配合 mutate-guard，prod 不冻结（与 BaseListStore 一致，可 DCE）
    const empty = {} as T;
    this.theme =
      IS_DEV && isDevMode() ? (Object.freeze(empty) as Readonly<T>) : empty;
    if (initial) {
      this.setThemeConfig(initial);
    }
  }

  /** 引用稳定的主题快照：两次变更之间多次调用返回同一对象。 */
  getThemeConfig(): Readonly<T> {
    return this.theme;
  }

  /** 局部更新主题：深度 diff → 结构化合并 → 应用变更的 CSS 变量 → emit。无变更则 no-op。 */
  setThemeConfig(updates: DeepPartial<T>): void {
    const changes = collectChanges(
      this.theme as Record<string, unknown>,
      updates as Record<string, unknown>,
      [],
      this.prefix,
    );
    if (changes.length === 0) return; // 无实际变更：不换引用、不 emit、不触 DOM

    const next = structuralMerge(
      this.theme as T,
      updates as Record<string, unknown>,
    );
    this.theme = IS_DEV && isDevMode() ? deepFreeze(next) : next;
    this.applyCssVars(changes);
    this.emit('theme:change', this.theme, changes);
  }

  private applyCssVars(changes: ReadonlyArray<ThemeChange>): void {
    if (typeof document === 'undefined') return; // SSR：跳过 DOM
    const root = document.documentElement;
    for (const c of changes) {
      if (c.newValue === undefined || c.newValue === null) {
        root.style.removeProperty(c.cssVar);
      } else {
        root.style.setProperty(c.cssVar, c.newValue);
      }
    }
  }
}
