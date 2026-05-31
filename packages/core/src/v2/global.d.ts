/**
 * 全局编译期常量，由 bundler 的 define 注入（vite.config.ts / vitest.config.ts）：
 * - 生产构建替换为 `false`，使 `if (__DEV__) { ... }` 分支被静态消除（DCE）。
 * - 测试 / 开发构建替换为 `true`。
 *
 * 约定：调用点**不要直接用裸 `__DEV__`**（裸 source 消费时会抛 ReferenceError），
 * 统一用 `v2/core/env.ts` 的 `IS_DEV`（已 typeof 守卫，仍可 DCE）；
 * 配合 `isDevMode()` 可在测试期运行时切换 dev/prod 两条路径（见 v2/core/devMode.ts）。
 *
 * 本声明仅供 env.ts 的 `typeof __DEV__` 读取，TS 层用。
 */
declare const __DEV__: boolean;
