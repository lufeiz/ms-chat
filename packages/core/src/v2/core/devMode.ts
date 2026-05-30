/**
 * devMode —— 开发期校验开关（RFC §2.1.9）。
 *
 * 设计目标：
 * 1. DEV 下做契约校验（throw / warn），PROD 下静默且可被 bundler 死代码消除。
 * 2. 可被测试运行时强制覆盖（`setDevMode`），便于 vitest 同时覆盖 dev / prod 两条路径。
 *
 * `__DEV__` 由 bundler 的 `define` 注入（见 vite.config.ts / vitest.config.ts），
 * 全局类型声明在 v2/global.d.ts。用 `typeof __DEV__ !== 'undefined'` 守卫，
 * 保证未注入时（如 ts-node 裸跑）不抛 ReferenceError。
 */

/**
 * 编译期 dev 标志。bundler（vite/vitest 的 define）把 `__DEV__` 替换为字面量后，
 * 本常量可被静态折叠用于 DCE。未注入时默认 dev=true（校验开启，安全侧）——
 * 我们自己的发布产物已在构建期注入 `__DEV__`，消费方用 dist 时无需关心。
 */
const COMPILE_DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

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
  return override !== null ? override : COMPILE_DEV;
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
  // `__DEV__ &&` 使函数体在 PROD 构建被 DCE 为空；测试期 __DEV__=true 时由 isDevMode() 切换。
  if (__DEV__ && isDevMode() && !condition) {
    throw new Error(`[ms-chat/core] ${message}`);
  }
}

/** DEV 警告：condition 为假且处于 devMode 时 console.warn；PROD 静默且函数体被 DCE。 */
export function devWarn(condition: unknown, message: string): void {
  if (__DEV__ && isDevMode() && !condition) {
    console.warn(`[ms-chat/core] ${message}`);
  }
}
