import { type Page, test as base, expect } from '@playwright/test';
import { FORBIDDEN_CONSOLE } from './thresholds';
// Pulls in the `declare global { interface Window { harness } }` from the harness app, so specs
// can write page.evaluate(() => window.harness.snapshot()) with full typing.
import type {} from '../examples/e2e/types';

/**
 * Console noise that is expected and not a library problem.
 *
 * `/subject.png` is intentionally absent — the compositor draws a procedural figure unless a
 * real cutout is committed — so its 404 is normal.
 */
const ALLOWED_CONSOLE = [/subject\.png/, /Failed to load resource.*404/];

/** Query parameters for the harness app. See examples/e2e/README.md for the full list. */
export type AppParams = Record<string, string | number | boolean>;

export class App {
  readonly consoleErrors: string[] = [];

  readonly pageErrors: string[] = [];

  constructor(readonly page: Page) {
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (ALLOWED_CONSOLE.some((pattern) => pattern.test(text))) return;
      this.consoleErrors.push(text);
    });
    page.on('pageerror', (error) => this.pageErrors.push(error.message));
  }

  async goto(params: AppParams = {}) {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    await this.page.goto(query ? `/?${query}` : '/', { waitUntil: 'domcontentloaded' });

    // Boot failures never produce a harness object, so surface them before the ready wait
    // times out with nothing to say.
    const bootError = await this.page.evaluate(() => document.body.dataset.bootError);
    expect(bootError, 'harness app failed to boot').toBeUndefined();

    await this.page.waitForFunction(() => window.harness?.isReady === true, null, {
      timeout: 30_000,
    });
  }

  /** Every string the harness logged, useful in a failure message. */
  logs() {
    return this.page.evaluate(() => window.harness.logs());
  }

  /**
   * Asserts the run produced no unexpected console output.
   *
   * Applied to every test rather than written per spec, because a large share of the filed
   * issues in this repo *are* a console line.
   */
  async assertConsoleClean() {
    const forbidden = [...this.consoleErrors, ...this.pageErrors].filter((line) =>
      FORBIDDEN_CONSOLE.some((needle) => line.includes(needle)),
    );
    expect(forbidden, 'console contained a known-bad string').toEqual([]);
    expect(this.pageErrors, 'uncaught page errors').toEqual([]);

    const lastError = await this.page.evaluate(() => window.harness?.lastError?.() ?? null);
    expect(lastError, 'harness logged an error').toBeNull();
  }
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use, testInfo) => {
    const app = new App(page);
    await use(app);

    // Only when the test otherwise passed: a failed test has already said what went wrong, and
    // piling a console assertion on top buries it.
    if (testInfo.status === 'passed') {
      await app.assertConsoleClean();
    }
  },
});

export { expect };
