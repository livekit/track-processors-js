import { type Page, test as base, expect } from '@playwright/test';
// Pulls in the `declare global { interface Window { harness } }` from the harness app, so specs
// can write page.evaluate(() => window.harness.snapshot()) with full typing.
import type {} from '../examples/e2e/types';
import { FORBIDDEN_CONSOLE } from './thresholds';

/**
 * One `console.error` the page wrote, with where it came from.
 *
 * `message.text()` alone is not enough to judge a line: every failed subresource produces the
 * same "Failed to load resource: the server responded with a status of 404 (Not Found)",
 * whether the resource was a favicon or the mediapipe model. `message.location().url` is what
 * tells them apart, and is what lets the allowlist below be narrow.
 */
export interface ConsoleLine {
  text: string;
  url: string;
}

/**
 * One console line that is expected, and the reason it is.
 *
 * `url` and `tests` narrow an entry so it cannot quietly cover more than it was written for:
 * `url` must also match `message.location().url`, and `tests` must also match the title of the
 * test that produced the line.
 */
export interface ConsoleAllowance {
  pattern: RegExp;
  /** Also require this to match the originating URL. */
  url?: RegExp;
  /** Also require this to match the test title — for noise one case provokes on purpose. */
  tests?: RegExp;
  /** Why this is not a library problem. */
  why: string;
}

/**
 * Console output that is expected and not a library problem.
 *
 * This is an allowlist, not a denylist: `assertConsoleClean` fails on every `console.error` that
 * no entry here explains. Each entry was read off an actual run of the suite (see `M3` in
 * `specs/console.spec.ts` for the survey), and each is scoped by URL, by test, or by both, so
 * widening one does not widen the others.
 *
 * Adding an entry means claiming a line is benign — say why, and prefer `app.allowConsole()`
 * inside the one spec that provokes it over a global entry here.
 */
export const ALLOWED_CONSOLE: ConsoleAllowance[] = [
  {
    // Observed on every fresh page load:
    //   url=http://127.0.0.1:<port>/favicon.ico :: Failed to load resource: ... 404 (Not Found)
    // Chrome requests a favicon for every document and the harness ships none. URL-scoped on
    // purpose: this entry used to read /Failed to load resource.*404/ with no URL at all, which
    // silenced every other 404 in the suite along with it.
    pattern: /Failed to load resource.*\b404\b/,
    url: /\/favicon\.ico(\?|$)/,
    why: 'Chrome asks every document for a favicon; the harness app ships none.',
  },
  {
    // I4 routes the mediapipe fileset to a 404 to prove the failure surfaces fast. Observed:
    //   url=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/
    //       vision_wasm_internal.js :: Failed to load resource: ... 404 (Not Found)
    // That spec already clears `harness.lastError()` once it has asserted on it; the browser's
    // own network line cannot be cleared from the page, so it is declared here instead.
    pattern: /Failed to load resource.*\b404\b/,
    url: /tasks-vision/,
    tests: /^I4\b/,
    why: 'I4 blocks the fileset on purpose, and asserts on the failure that causes.',
  },
  {
    // M1/M1b/M1c route the background image to a 404 — their whole provocation. Observed:
    //   url=http://127.0.0.1:<port>/bg-solid.png :: Failed to load resource: ... 404
    pattern: /Failed to load resource.*\b404\b/,
    url: /bg-solid\.png/,
    tests: /^M1\b|^M1[a-z]\b/,
    why: 'The log-level cases force the image load to fail, and assert on what was logged.',
  },
  {
    // ...and at `error` and `debug` the library correctly reports that failure. Observed from
    // src/logger.ts in M1b and M1c as "Error while loading processor background image:  Event".
    //
    // Deliberately not a global entry: anywhere but the log-level cases this line means the
    // background image failed to load, which is a real failure the suite should hear about.
    pattern: /Error while loading processor background image/,
    tests: /^M1[a-z]\b/,
    why: 'M1b and M1c assert this exact record is emitted; see specs/logging.spec.ts.',
  },
];

/** Query parameters for the harness app. See examples/e2e/README.md for the full list. */
export type AppParams = Record<string, string | number | boolean>;

/** `url :: text`, the form the console assertions print. Page-evaluated code has no URL. */
const describeLines = (lines: ConsoleLine[]) =>
  lines.map((l) => (l.url ? `${l.url} :: ${l.text}` : l.text));

export class App {
  /** Every `console.error` the page wrote, allowed or not. */
  readonly consoleLines: ConsoleLine[] = [];

  /**
   * Uncaught exceptions *and* unhandled promise rejections.
   *
   * Playwright raises `pageerror` for both — asserted in M3b, which rejects a promise and checks
   * the rejection lands here, so an upgrade that stopped reporting rejections would be caught
   * rather than silently halving this check.
   */
  readonly pageErrors: string[] = [];

  /**
   * Every console error as plain text.
   *
   * Kept as a derived view over `consoleLines`, which carries the originating URL that the
   * allowlist matches on. Specs that only want to search the text — B5 looking for #50's
   * DataCloneError, B8 for #22's, D2 for a CORS block — read this and do not have to know
   * about allowances.
   */
  get consoleErrors(): string[] {
    return this.consoleLines.map((line) => line.text);
  }

  private readonly declared: ConsoleAllowance[] = [];

  constructor(
    readonly page: Page,
    private readonly testTitle = '',
  ) {
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      this.consoleLines.push({ text: message.text(), url: message.location().url });
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

  // ------------------------------------------------------------------ console

  /**
   * Declares a console line this test provokes on purpose, so it stops counting as unexpected.
   *
   * Preferred over an entry in `ALLOWED_CONSOLE`: the allowance sits beside the provocation, and
   * it cannot excuse the same line anywhere else in the suite.
   */
  allowConsole(pattern: RegExp, why: string) {
    this.declared.push({ pattern, why });
  }

  /** Console errors that no allowance explains. Anything here fails the run. */
  unexpectedConsole(): ConsoleLine[] {
    const allowances = [...ALLOWED_CONSOLE, ...this.declared];
    return this.consoleLines.filter((line) => !allowances.some((a) => this.allows(a, line)));
  }

  private allows(allowance: ConsoleAllowance, line: ConsoleLine) {
    if (!allowance.pattern.test(line.text)) return false;
    if (allowance.url && !allowance.url.test(line.url)) return false;
    if (allowance.tests && !allowance.tests.test(this.testTitle)) return false;
    return true;
  }

  /**
   * Drops everything recorded so far, in the page as well as here.
   *
   * For a case that *wants* an error: M3b emits one of each kind to show this check has teeth,
   * and has to hand back a clean page afterwards, or the end-of-test assertion would fail on
   * M3b's own provocation.
   */
  async forgetConsole() {
    this.consoleLines.length = 0;
    this.pageErrors.length = 0;
    await this.page.evaluate(() => window.harness?.clearLogs?.());
  }

  /**
   * Asserts the run produced no unexpected console output.
   *
   * Applied to every test rather than written per spec, because a large share of the filed
   * issues in this repo *are* a console line.
   *
   * Four questions, in the order that gives the most useful failure message:
   *  1. did a line arrive that names a known bug (`FORBIDDEN_CONSOLE`)?
   *  2. did anything reach `pageerror` — an uncaught throw, or an unhandled rejection?
   *  3. did any `console.error` arrive that no allowance explains?
   *  4. did the harness record one — `window.onerror`, `unhandledrejection`, or a rejection a
   *     UI click handler caught and logged rather than rethrew?
   *
   * (4) is not redundant with (2): `ui.ts` wraps every handler in a try/catch, so an error the
   * application *handles* reaches neither Playwright channel. #22 arrives exactly that way.
   *
   * (3) is the broad one, and the reason this is an allowlist. Before `M3` only (1) applied to
   * console output, so an error nobody had thought to add to `FORBIDDEN_CONSOLE` passed in
   * silence — which is the wrong way round for a repo where most filed issues are a console
   * line nobody predicted.
   */
  async assertConsoleClean() {
    const unexpected = this.unexpectedConsole();

    // Named first: when one of these appears the message should say which bug is back, rather
    // than merely that something was logged.
    const forbidden = [...unexpected.map((l) => l.text), ...this.pageErrors].filter((line) =>
      FORBIDDEN_CONSOLE.some((needle) => line.includes(needle)),
    );
    expect(forbidden, 'console contained a known-bad string').toEqual([]);

    expect(this.pageErrors, 'uncaught page errors or unhandled rejections').toEqual([]);

    expect(
      describeLines(unexpected),
      'console.error output that no allowance in fixtures.ts explains',
    ).toEqual([]);

    const lastError = await this.page.evaluate(() => window.harness?.lastError?.() ?? null);
    expect(lastError, 'harness logged an error').toBeNull();
  }

  /**
   * What `assertConsoleClean` would have complained about, as text.
   *
   * Used on the failure path, where asserting would bury the real failure but saying nothing
   * would mean a failing test's console is never examined at all.
   */
  consoleReport(): string {
    return [
      ...describeLines(this.unexpectedConsole()).map((l) => `console.error  ${l}`),
      ...this.pageErrors.map((e) => `pageerror      ${e}`),
    ].join('\n');
  }
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use, testInfo) => {
    const app = new App(page, testInfo.title);
    await use(app);

    // Only when the test otherwise passed: a failed test has already said what went wrong, and
    // piling a console assertion on top buries it. It is still *recorded* — before M3 a failing
    // test's console output was discarded unexamined, so a console-only regression could hide
    // behind any unrelated failure.
    if (testInfo.status === 'passed') {
      await app.assertConsoleClean();
    } else {
      const report = app.consoleReport();
      if (report) {
        testInfo.annotations.push({ type: 'unexpected-console', description: report });
      }
    }
  },
});

export { expect };
