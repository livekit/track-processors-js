import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // E2E_PORT lets a second checkout serve the harness without colliding with this one.
    port: Number(process.env.E2E_PORT) || 8081,
    // The test runner starts this server itself; opening a browser on every run would be
    // noise. `pnpm dev:e2e` passes --open explicitly.
    open: false,
    // Both apps import from ../../src, which is outside the vite root.
    fs: { strict: false },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
