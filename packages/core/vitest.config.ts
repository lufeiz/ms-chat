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
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/model/**', 'src/ui-interface/**'],
    },
  },
});
