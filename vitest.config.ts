import { playwright } from '@vitest/browser-playwright';
import { join } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      // SwiftShader renders WebGL on the CPU, so output is identical on every machine.
      provider: playwright({
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 720 },
      expect: {
        toMatchScreenshot: {
          // A near-exact diff. SwiftShader's output differs slightly between CPU architectures
          // (the references are recorded on arm64 macOS, CI runs on x86-64 Linux), so allow small
          // per-pixel color differences and a few stray pixels, but not a visible change.
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            threshold: 0.05,
            includeAA: true,
            allowedMismatchedPixelRatio: 0.005,
          },
          // One reference per screenshot, shared by every platform.
          resolveScreenshotPath: ({ arg, ext, root, testFileDirectory, screenshotDirectory }) =>
            join(root, testFileDirectory, screenshotDirectory, `${arg}${ext}`),
        },
      },
    },
  },
});
