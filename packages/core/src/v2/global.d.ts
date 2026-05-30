/**
 * 全局编译期常量，由 bundler 的 define 注入（vite.config.ts / vitest.config.ts）：
 * - 生产构建替换为 `false`，使 `if (__DEV__) { ... }` 分支被静态消除（DCE）。
 * - 测试 / 开发构建替换为 `true`。
 *
 * 约定：bundle 体积敏感或字符串较多的 dev-only 分支，在调用点用 `__DEV__` 守卫以获得 DCE；
 * 配合 `isDevMode()` 可在测试期运行时切换 dev/prod 两条路径（见 v2/core/devMode.ts）。
 */
declare const __DEV__: boolean;
