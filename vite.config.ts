import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        testModes: path.resolve(__dirname, 'test-modes.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
