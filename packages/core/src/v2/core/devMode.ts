/**
 * devMode —— 开发期校验开关（RFC §2.1.9）。
 *
 * 设计目标：
 * 1. DEV 下做契约校验（throw / warn），PROD 下静默且可被 bundler 死代码消除。
 * 2. 可被测试运行时强制覆盖（`setDevMode`），便于 vitest 同时覆盖 dev / prod 两条路径。
 *
 * 所有调用点用 `IS_DEV`（v2/core/env.ts，typeof 守卫）而非裸 `__DEV__`，
 * 既能被 bundler DCE，又保证裸 source 消费时不抛 ReferenceError。
 */
import { IS_DEV } from './env';

/** 运行时覆盖；null 表示沿用编译期标志。仅用于测试。 */
let override: boolean | null = null;

/**
 * 强制开/关 devMode（测试用）。传 null 恢复编译期行为。
 * 生产代码不应调用。
 */
export function setDevMode(value: boolean | null): void {
  override = value;
}

/** 恢复编译期 devMode（测试 afterEach 调用）。 */
export function resetDevMode(): void {
  override = null;
}

/** 当前是否处于 devMode。 */
export function isDevMode(): boolean {
  return override !== null ? override : IS_DEV;
}

/**
 * DEV 断言：condition 为假且处于 devMode 时抛错；PROD 静默放行。
 *
 * 注意：`asserts condition` 的类型收窄在 PROD 下是“乐观”的——前提是该错误会在
 * 开发期被 devAssert 暴露并修复，因此 PROD 永远命中不到 false 分支。
 */
export function devAssert(
  condition: unknown,
  message: string,
): asserts condition {
  // `IS_DEV &&` 使函数体在 PROD 构建被 DCE 为空；测试期 IS_DEV=true 时由 isDevMode() 切换。
  if (IS_DEV && isDevMode() && !condition) {
    throw new Error(`[ms-chat/core] ${message}`);
  }
}

/** DEV 警告：condition 为假且处于 devMode 时 console.warn；PROD 静默且函数体被 DCE。 */
export function devWarn(condition: unknown, message: string): void {
  if (IS_DEV && isDevMode() && !condition) {
    console.warn(`[ms-chat/core] ${message}`);
  }
}
