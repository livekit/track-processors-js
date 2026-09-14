import path from 'path';
import { defineConfig, devices } from '@playwright/test';

const ROOT = path.join(__dirname, '..');
const PORT = 8081;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Chrome only, for now. The suite is written against the harness app at examples/e2e, which
 * mocks getUserMedia — so no fake-device launch flags are needed, and nothing here depends on a
 * webcam, a microphone or a LiveKit server.
 *
 * Run modes:
 *   pnpm test:e2e           headless
 *   pnpm test:e2e:headed    a real window, slowed down so it can be watched
 *   pnpm test:e2e:ui        Playwright UI, with time-travel and per-step DOM snapshots
 *   pnpm test:e2e:debug     the inspector
 */
export default defineConfig({
  testDir: path.join(__dirname, 'specs'),
  outputDir: path.join(__dirname, '.results'),
  fullyParallel: true,

  /**
   * One worker on purpose.
   *
   * Every attach/detach cycle leaks a WebGL context — src/webgl/index.ts cleanup() never calls
   * loseContext() — and Chrome caps live contexts per GPU process at around 16, after which it
   * discards the oldest and the renderer can stop responding entirely. Parallel workers share
   * that process, so they would hit the cap several times faster and fail in ways that look
   * like flakiness rather than like the leak they are. Raise this once the leak is fixed.
   */
  workers: 1,

  // A page load fetches the mediapipe wasm fileset and model from a CDN, which dominates the
  // per-test cost. Self-hosting them (?assets=local) is the fix; until then, be patient.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: path.join(__dirname, '.report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: path.join(__dirname, '.report'), open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Slow the headed run down enough to follow along; harmless when headless.
    launchOptions: { slowMo: process.env.PWSLOWMO ? Number(process.env.PWSLOWMO) : 0 },
  },

  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        /**
         * Installed Google Chrome by default.
         *
         * Playwright's bundled chromium-headless-shell falls back to SwiftShader, and this
         * library is GPU-bound: the WebGL filter step measures ~56ms per frame there against
         * ~2ms on a real GPU, which drags the whole suite from 40s to 2.7 minutes and measures
         * a rasterizer no user has. The performance spec detects a software renderer and
         * relaxes accordingly, so `PW_CHANNEL=chromium` still passes — it is just slower and
         * tests less.
         */
        channel: process.env.PW_CHANNEL || 'chrome',
      },
    },
  ],

  webServer: {
    command: 'pnpm exec vite examples/e2e --host 127.0.0.1',
    cwd: ROOT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
