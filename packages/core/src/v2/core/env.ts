/**
 * 内部环境常量（**不经 barrel 对外导出**，以保持 bundler 可静态折叠用于 DCE）。
 *
 * `__DEV__` 由 bundler 的 define 注入（vite/vitest），全局类型声明在 v2/global.d.ts。
 * 这里用 `typeof __DEV__ !== 'undefined'` 守卫：
 * - 生产构建：`__DEV__` 被替换为字面量 → 整个三元静态折叠 → `if (IS_DEV && ...)` 分支被 DCE。
 * - 裸 source 消费（如 `@ms-chat/core/src/v2`，bundler 未注入 `__DEV__`）：typeof 守卫短路，
 *   **不会抛 ReferenceError**，并默认 dev=true（校验开启，安全侧）。
 *
 * 因此所有调用点统一用 `IS_DEV` 而非裸 `__DEV__`，兼顾 DCE 与裸 source 安全。
 */
export const IS_DEV: boolean =
  typeof __DEV__ !== 'undefined' ? __DEV__ : true;
