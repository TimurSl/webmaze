import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      // same layout as production (Caddy strips /api and forwards to the game server)
      '/api': { target: 'http://127.0.0.1:2567', ws: true, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
});
