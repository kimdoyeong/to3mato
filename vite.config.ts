import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', tray: 'tray.html' } },
  },
});
