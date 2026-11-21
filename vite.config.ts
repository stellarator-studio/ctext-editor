import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base so the build works under https://<owner>.github.io/ctext-editor/
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        imageTest: resolve(import.meta.dirname, 'image-test.html'),
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
