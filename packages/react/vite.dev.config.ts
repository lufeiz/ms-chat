import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 网关地址改用环境变量，勿把内网域名写死进仓库。例：VITE_PROXY_OPENAPI=https://your-gateway pnpm dev
      '/openapi': {
        target: process.env.VITE_PROXY_OPENAPI || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
