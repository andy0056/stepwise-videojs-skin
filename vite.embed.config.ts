import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// One script and one stylesheet that carry the whole skin, for sites without a build step for it.
export default defineConfig({
  resolve: { alias: { '@': path('./src') } },
  publicDir: false,
  build: {
    outDir: path('./dist-embed'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path('./embed/stepwise-player.ts'),
      formats: ['es'],
      fileName: () => 'stepwise-player.js',
      cssFileName: 'stepwise-player',
    },
    // Translations and other on-demand parts stay separate files beside the entry, loaded when needed.
    rolldownOptions: { output: { chunkFileNames: 'stepwise-[name]-[hash].js' } },
  },
});
