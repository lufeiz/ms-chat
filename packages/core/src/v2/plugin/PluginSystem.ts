import type { Disposer } from '../core/EventEmitter';
import { devAssert } from '../core/devMode';

export type HookType = 'before' | 'after' | 'error' | 'transform';

export interface PluginContext<TArgs extends any[] = any[], TResult = any> {
  functionName: string;
  args: TArgs;
  result?: TResult;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/** transform 钩子的返回：替换下游 args，和/或用 result 短路原函数。 */
export interface TransformOutcome<TArgs extends any[] = any[], TResult = any> {
  args?: TArgs;
  result?: TResult;
}

export type HookResult<TArgs extends any[] = any[], TResult = any> =
  | void
  | false
  | TransformOutcome<TArgs, TResult>;

export type HookHandler<TArgs extends any[] = any[], TResult = any> = (
  ctx: PluginContext<TArgs, TResult>,
) => HookResult<TArgs, TResult> | Promise<HookResult<TArgs, TResult>>;

export interface PluginRegistration<TArgs extends any[] = any[], TResult = any> {
  /** 不传则自动生成；用于 unregister。 */
  id?: string;
  targetFunction: string;
  hookType: HookType;
  handler: HookHandler<TArgs, TResult>;
  /** 越大越先执行，默认 0。 */
  priority?: number;
}

interface InternalHook {
  id: string;
  hookType: HookType;
  handler: HookHandler;
  priority: number;
}

const HOOK_TYPES: ReadonlySet<HookType> = new Set([
  'before',
  'after',
  'error',
  'transform',
]);

/**
 * 插件系统 v2（RFC §2.1.4）。相比 v1：
 * - **可卸载**：register 返回 disposer；新增 unregister(id) / unregisterAll（修 H8）。
 * - **transform 钩子**：改写下游 args，或返回 result 短路原函数。
 * - **before 短路**：before 返回 false 则不执行原函数（wrapped 调用 resolve 为 false）。
 * - **devMode 校验**：注册时校验 hookType 拼写与 handler 类型。
 *
 * 单次调用流水线：**before → transform → 原函数 → after**；任一阶段抛错跳到 **error** 并 rethrow。
 */
export class PluginSystem {
  private hooks = new Map<string, InternalHook[]>();
  private seq = 0;

  register(reg: PluginRegistration): Disposer {
    devAssert(
      HOOK_TYPES.has(reg.hookType),
      `invalid hookType "${reg.hookType}"; expected before|after|error|transform`,
    );
    devAssert(
      typeof reg.handler === 'function',
      `plugin handler for "${reg.targetFunction}" must be a function`,
    );

    const id = reg.id ?? `plugin_${(this.seq += 1)}`;
    const hook: InternalHook = {
      id,
      hookType: reg.hookType,
      handler: reg.handler,
      priority: reg.priority ?? 0,
    };

    const list = this.hooks.get(reg.targetFunction) ?? [];
    list.push(hook);
    // 稳定排序：优先级高在前，同优先级保持注册顺序。
    list.sort((a, b) => b.priority - a.priority);
    this.hooks.set(reg.targetFunction, list);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.unregister(id);
    };
  }

  unregister(id: string): boolean {
    for (const [fn, list] of this.hooks) {
      const idx = list.findIndex((h) => h.id === id);
      if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) this.hooks.delete(fn);
        return true;
      }
    }
    return false;
  }

  unregisterAll(targetFunction?: string): void {
    if (targetFunction === undefined) {
      this.hooks.clear();
    } else {
      this.hooks.delete(targetFunction);
    }
  }

  list(targetFunction?: string): PluginRegistration[] {
    const toReg = (fn: string, h: InternalHook): PluginRegistration => ({
      id: h.id,
      targetFunction: fn,
      hookType: h.hookType,
      handler: h.handler,
      priority: h.priority,
    });
    if (targetFunction !== undefined) {
      return (this.hooks.get(targetFunction) ?? []).map((h) =>
        toReg(targetFunction, h),
      );
    }
    const out: PluginRegistration[] = [];
    for (const [fn, list] of this.hooks) {
      for (const h of list) out.push(toReg(fn, h));
    }
    return out;
  }

  /**
   * 执行一次带插件流水线的调用。被 createWrappedFunction 使用，也可直接调用。
   * @returns 原函数（或 transform 短路）的结果；若 before 返回 false 则为 `false`。
   */
  async run<TArgs extends any[], TResult>(
    functionName: string,
    originalFn: (...args: TArgs) => TResult | Promise<TResult>,
    args: TArgs,
    metadata?: Record<string, unknown>,
  ): Promise<TResult | false> {
    const ctx: PluginContext<TArgs, TResult> = {
      functionName,
      args: args.slice() as TArgs,
      metadata,
    };

    try {
      // before：任一返回 false 即短路
      for (const h of this.getHooks(functionName, 'before')) {
        const r = await h.handler(ctx);
        if (r === false) return false;
      }

      // transform：改写 args 或用 result 短路
      let shortCircuited = false;
      for (const h of this.getHooks(functionName, 'transform')) {
        const r = await h.handler(ctx);
        if (r && typeof r === 'object') {
          if (Array.isArray(r.args)) {
            ctx.args = r.args as TArgs;
          }
          if (r.result !== undefined) {
            ctx.result = r.result as TResult;
            shortCircuited = true;
          }
        }
      }

      if (!shortCircuited) {
        ctx.result = await originalFn(...ctx.args);
      }

      // after：观察最终 {args, result}
      for (const h of this.getHooks(functionName, 'after')) {
        await h.handler(ctx);
      }

      return ctx.result as TResult;
    } catch (err) {
      ctx.error = err instanceof Error ? err : new Error(String(err));
      for (const h of this.getHooks(functionName, 'error')) {
        await h.handler(ctx);
      }
      throw ctx.error;
    }
  }

  private getHooks(functionName: string, type: HookType): InternalHook[] {
    const list = this.hooks.get(functionName);
    if (!list) return [];
    return list.filter((h) => h.hookType === type);
  }
}

/**
 * 把一个函数包成带插件流水线的异步函数（语义见 PluginSystem.run）。
 * before 短路时返回 `false`。
 */
export function createWrappedFunction<T extends (...args: any[]) => any>(
  originalFn: T,
  functionName: string,
  pluginSystem: PluginSystem,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | false> {
  return (...args: Parameters<T>) =>
    pluginSystem.run(
      functionName,
      originalFn as (...a: Parameters<T>) => ReturnType<T>,
      args,
    ) as Promise<Awaited<ReturnType<T>> | false>;
}
