import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative asset paths so dist/ works from any directory.
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: 'public',
  worker: { format: 'es' },
  build: {
    outDir: resolve(__dirname, '../dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200, // MapLibre alone is about 1 MB
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        methodology: resolve(__dirname, 'methodology.html'),
      },
    },
  },
});
