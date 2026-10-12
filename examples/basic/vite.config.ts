import { defineConfig } from 'vite';

// The map data is bundled into the app chunk (as in the infographic), hence the raised warning limit.
export default defineConfig({
  base: './',
  server: { port: 5174, host: '127.0.0.1' },
  build: { chunkSizeWarningLimit: 1200 },
});
