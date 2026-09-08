import { fileURLToPath } from 'node:url';
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 8000,
    proxy: {
      // 后台 API 是独立进程、独立端口。开发时由 Vite 代理转发，
      // 这样浏览器看到的是同源请求，Cookie 与 Origin 校验才能正常工作。
      '/admin/v1': {
        target: 'http://localhost:8788',
        changeOrigin: false,
      },
    },
  },
});
