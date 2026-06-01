import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // React 16 不把 'react/jsx-runtime' 暴露为无扩展名 bare specifier，
      // 而 react-markdown@9 以该形式 import。显式指到真实文件，修复测试解析。
      'react/jsx-runtime': require.resolve('react/jsx-runtime'),
      'react/jsx-dev-runtime': require.resolve('react/jsx-dev-runtime'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        // inline 这些 ESM 包，让 vite 解析器处理 react/jsx-runtime 等无扩展名 import，
        // 否则被 Node ESM externalize 后无法解析（react-markdown@9 → react 16 的已知坑）。
        inline: [/@uiw\/react-markdown-preview/, /react-markdown/, /rehype.*/, /remark.*/],
      },
    },
  },
});
