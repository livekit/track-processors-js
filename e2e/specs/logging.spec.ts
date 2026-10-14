import type { LibraryLogRecord, LogLevelName } from '../../examples/e2e/types';
import { type App, expect, test } from '../fixtures';
import { startCamera } from '../helpers';
import { LOGGING } from '../thresholds';

/**
 * M1 — the log level an integration sets is respected. Guards #106 and #109.
 *
 * Two things make this awkward to assert, and both are solved the same way.
 *
 * The first is telling library output from everyone else's. loglevel binds `console.error` and
 * friends directly, so a library line carries no logger name and reads exactly like one
 * livekit-client or the harness wrote. The library's own `setLogExtension` hook does not have
 * that problem: it only ever receives the library's records. The harness installs it alongside
 * `?loglevel=`, and `harness.libraryLogs()` is what the hook collected.
 *
 * The second is proving there was anything to suppress. "No output" is trivially true on a run
 * that had nothing to say, so each case forces the same failure — the background image 404s —
 * and checks the 404 was really served before judging what was logged. The three cases are then
 * each other's controls: the same provocation is silent at `silent`, produces the error record
 * and nothing else at `error`, and produces that record plus the below-error ones at `debug`.
 *
 * Observed 0 / 1 / 4 records across the three. The level is respected today — #106 and #109 are
 * what this stops from coming back, not what it reproduces. Dropping the `setLogLevel` call from
 * `examples/e2e/logCapture.ts` so the library stays at its default level fails M1 (the image
 * error reaches the hook and the console at `silent`) and M1c (`Init called` never appears at
 * `debug`), while M1b still passes — which is the point of running all three.
 */

/**
 * Attaching builds a segmenter, which can take a while on a contended GPU — longer than the
 * suite-wide 10s expect timeout, as one run against a busy machine showed. Matched to the
 * `waitForFrames` budget the other specs use rather than left at the default.
 */
const ATTACH_WAIT = { timeout: 25_000 };

/** Attaches through the real control, and waits for the state the panel mirrors. */
async function attachByClick(app: App) {
  await app.page.click('[data-testid="attach-processor"]');
  await expect(app.page.locator('body')).toHaveAttribute(
    'data-video-processor',
    'true',
    ATTACH_WAIT,
  );
}

interface Run {
  /** What the library emitted through its own hook, from the forced failure onwards. */
  records: LibraryLogRecord[];
  /** Console lines written from the forced failure onwards, library or not. */
  consoleLines: string[];
  /** Console lines that carry a string only the library writes. */
  libraryConsoleLines: string[];
  /** How many times the 404 was actually served. Zero means the case proved nothing. */
  failedRequests: number;
}

/**
 * Boots at `level`, then forces `BackgroundTransformer.init()` to fail loading its image.
 *
 * The detach in the middle is what arms the failure: the transformer caches exactly one decoded
 * image and `destroy()` drops it, so the next `init()` refetches. Going through `init()` rather
 * than `switchTo()` is deliberate — `update()` rejects into the caller and logs nothing, so it
 * would give this case no record to look at.
 *
 * Setup (camera, level, image) goes through the harness and the URL; the attach and detach that
 * the assertions hang on are real clicks on the real controls.
 */
async function runWithForcedImageFailure(app: App, level: LogLevelName): Promise<Run> {
  const { page } = app;

  const consoleLog: string[] = [];
  page.on('console', (message) => consoleLog.push(`${message.type()} ${message.text()}`));

  let failing = false;
  let failedRequests = 0;
  await page.route('**/bg-solid.png', async (route) => {
    if (failing) {
      failedRequests += 1;
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' });
    }
    // Served no-store, so the reattach below genuinely refetches instead of reading the memory
    // cache — a cache hit would quietly turn the forced failure into a run with nothing wrong.
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: { ...response.headers(), 'cache-control': 'no-store' },
    });
  });

  await app.goto({ mode: 'virtual-background', loglevel: level });
  await startCamera(page);

  await attachByClick(app);
  await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

  await page.click('[data-testid="detach-processor"]');
  await expect(page.locator('body')).toHaveAttribute('data-video-processor', 'false', ATTACH_WAIT);

  // Everything from here on is the run under test.
  failing = true;
  const consoleFrom = consoleLog.length;
  await page.evaluate(() => window.harness.clearLibraryLogs());

  await attachByClick(app);
  await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

  const records = await page.evaluate(() => window.harness.libraryLogs());
  const consoleLines = consoleLog.slice(consoleFrom);

  return {
    records,
    consoleLines,
    libraryConsoleLines: consoleLines.filter((line) =>
      LOGGING.LIBRARY_CONSOLE_TEXT.some((text) => line.includes(text)),
    ),
    failedRequests,
  };
}

const format = (records: LibraryLogRecord[]) =>
  records.map((r) => `${r.levelName}: ${r.msg}`).join('\n') || '(none)';

test.describe('log level', () => {
  test('M1: at silent the library says nothing, even about a failure', async ({ app }) => {
    const run = await runWithForcedImageFailure(app, 'silent');

    // Without this the rest is vacuous: a run with no failure is silent for the wrong reason.
    expect(run.failedRequests, 'the image failure was never provoked').toBeGreaterThan(0);

    expect(run.records, `library logged at silent:\n${format(run.records)}`).toEqual([]);
    expect(
      run.libraryConsoleLines,
      `library reached the console at silent:\n${run.libraryConsoleLines.join('\n')}`,
    ).toEqual([]);
  });

  test('M1b: at error the error record survives and nothing below it does', async ({ app }) => {
    const run = await runWithForcedImageFailure(app, 'error');

    expect(run.failedRequests, 'the image failure was never provoked').toBeGreaterThan(0);

    // The same failure M1 saw nothing of.
    expect(
      run.records.map((r) => r.msg).join('\n'),
      `no image-load error at error level:\n${format(run.records)}`,
    ).toContain(LOGGING.IMAGE_LOAD_ERROR);

    // Observed exactly one record, the image error at level 4. Asserted as "every record is at
    // error" rather than as a count, so an unrelated second error would not fail the case.
    const belowError = run.records.filter((r) => r.level < LOGGING.ERROR_LEVEL);
    expect(belowError, `records below error survived:\n${format(belowError)}`).toEqual([]);

    // And the record reached the console rather than only the hook, which would mean the level
    // was respected by the extension and by nothing else.
    expect(
      run.consoleLines.filter((line) => line.includes(LOGGING.IMAGE_LOAD_ERROR)).length,
      'the error record never reached the console',
    ).toBeGreaterThan(0);
  });

  test('M1c: at debug the records M1b suppressed do appear', async ({ app }) => {
    const run = await runWithForcedImageFailure(app, 'debug');

    expect(run.failedRequests, 'the image failure was never provoked').toBeGreaterThan(0);

    // This is M1b's control. Without it, "nothing below error" could just mean the library
    // never tried to log below error during the run, and the assertion would have no teeth.
    const belowError = run.records.filter((r) => r.level < LOGGING.ERROR_LEVEL);
    expect(
      belowError.map((r) => r.msg).join('\n'),
      `no below-error records at debug at all:\n${format(run.records)}`,
    ).toContain(LOGGING.INIT_DEBUG);

    // The error is still there too, so lowering the level adds records rather than swapping them.
    expect(run.records.map((r) => r.msg).join('\n')).toContain(LOGGING.IMAGE_LOAD_ERROR);
  });
});
