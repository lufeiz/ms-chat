import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  // 相对 base，使 worker / 动态 chunk 的资源 URL 为包内相对路径（如 ./assets/xxx），
  // 否则 lib 默认 base '/' 会生成绝对路径，消费方运行时解析到站点根而非包目录。
  base: './',
  resolve: {
    alias: {
      '@': '/src/',
    },
  },
  define: {
    // DEV 校验层开关；PROD 构建折叠为 false 以便消费方 DCE（RFC §2.1.9）。
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
  // MarkdownWorker 用 `new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' })`，
  // 以 ES 格式产出 worker chunk（marked 打入其中，不污染主 bundle）。
  worker: {
    format: 'es',
  },
  build: {
    commonjsOptions: {
      esmExternals: true,
    },
    lib: {
      // 多入口：主入口（v1）+ v2 子路径，使 `@ms-chat/core/v2` 可作为发布产物按需引入。
      entry: {
        'ms-chat-core': resolve(__dirname, 'src/index.ts'),
        v2: resolve(__dirname, 'src/v2/index.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format: string, entryName: string) =>
        `${entryName}.${format}.js`,
    },
    rollupOptions: {
      // 运行时依赖外置，避免打进 bundle / 重复打包（消费方经 dependencies 自动安装）。
      external: ['lodash-es', '@microsoft/fetch-event-source'],
      output: {
        exports: 'named',
      },
    },
  },
  plugins: [dts()],
});
