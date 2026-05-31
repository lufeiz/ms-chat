import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // 测试默认在 dev 模式跑 devMode 校验路径；个别用例用 setDevMode(false) 切 prod。
    __DEV__: 'true',
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // 覆盖率只统计 v2（重构在维护的代码）；v1 为 deprecated 遗留，不纳入门槛。
      include: ['src/v2/**/*.ts'],
      exclude: [
        'src/v2/**/index.ts', // barrel 仅 re-export
        'src/v2/global.d.ts', // 纯类型声明
        'src/v2/workers/markdown.worker.ts', // worker 入口，跑在 worker 上下文（解析逻辑由 markdownParser 测试覆盖）
      ],
      // 门槛设在当前水位之下，留余量防抖（现状约 stmts 90 / branches 82 / lines 93）。
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 80,
        lines: 88,
      },
    },
  },
});
