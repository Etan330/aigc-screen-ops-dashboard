import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * base 使用相对路径 './'：
 * - GitHub Pages 项目站点部署在 https://<user>.github.io/<repo>/ 子路径下也能正确加载资源；
 * - 本地 `npm run preview` 或任意静态服务器根目录同样可用；
 * - 本项目为单页应用、无前端路由，因此相对路径不存在刷新 404 问题。
 * 数据文件通过 `import.meta.env.BASE_URL`（即 './'）拼接后 fetch，部署时路径自动跟随。
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
  },
});
