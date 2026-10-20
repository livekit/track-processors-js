import { type App, expect, test } from '../fixtures';
import { startCamera } from '../helpers';
import { FORBIDDEN_CONSOLE } from '../thresholds';

/**
 * M3 — the happy path produces a clean console, and the check that says so has teeth.
 *
 * Guards [#47](https://github.com/livekit/track-processors-js/issues/47),
 * [#84](https://github.com/livekit/track-processors-js/issues/84) and
 * [#89](https://github.com/livekit/track-processors-js/issues/89) — each of which reached users
 * as a console line and nothing else. Most filed issues in this repo *are* a console line, which
 * is why the assertion is a fixture that runs after every test rather than a case of its own.
 *
 * So this spec is not that assertion; it is the two things the assertion needs to be worth
 * having.
 *
 * `M3` is the only case that drives a full attach / switch / switch / detach by hand and then
 * states, in the spec, that nothing was logged. Every other spec gets the same check for free at
 * teardown, but none of them *means* it: they would fail on their own subject first. Here the
 * console is the subject, and the run is built to provoke the three guarded issues — #47 is
 * logged when the blur effect is stopped, which a mode switch and a detach both do, and #84 is
 * the WebGL context leak becoming visible under repeated attachment.
 *
 * `M3b` is the negative control, and the more important half. A clean-console assertion that
 * cannot fail is worse than no assertion at all, because it buys false confidence in every one
 * of the other thirty-odd tests that leans on it. So M3b emits each kind of failure the check
 * claims to catch and runs the real `assertConsoleClean()` against it, expecting a rejection:
 *
 *   - a `console.error` from page code       -> "no allowance in fixtures.ts explains"
 *   - a thrown exception                     -> "uncaught page errors"
 *   - an unhandled promise rejection         -> "uncaught page errors" (via `pageerror`)
 *   - an error the app caught and logged     -> "harness logged an error"
 *   - a string from `FORBIDDEN_CONSOLE`      -> "console contained a known-bad string"
 *
 * and then shows the check is not merely failing on everything, by declaring a line through
 * `app.allowConsole()` and watching it pass.
 *
 * The fourth is the one worth noticing. `console.error` and `pageerror` are the two channels
 * anyone would reach for, and between them they miss every error the application handles — which
 * in this harness is every rejection out of a UI click, because `ui.ts` wraps each handler in a
 * try/catch that logs instead of rethrowing. #22 arrives that way, so a check watching only
 * those two channels would report a clean console on a run that attached a processor to an ended
 * track and logged the failure.
 *
 * ## What the allowlist flip found
 *
 * Before M3 the console half of the check compared against `FORBIDDEN_CONSOLE` — a list of four
 * strings, each a known bug. Anything unlisted passed in silence, which is exactly backwards for
 * catching the *next* console-only regression. It is now an allowlist: every `console.error` is
 * a failure unless `ALLOWED_CONSOLE` (or `app.allowConsole()`) explains it.
 *
 * Surveying all 36 tests with the filter removed turned up four distinct lines, and no more:
 *
 *   - `/favicon.ico` 404, on every fresh page load. Chrome asks; the harness ships none.
 *   - the mediapipe fileset 404 that `I4` injects on purpose.
 *   - the `/bg-solid.png` 404 that `M1`, `M1b` and `M1c` inject on purpose.
 *   - "Error while loading processor background image:  Event", the library reporting that
 *     404 — which is the record `M1b` and `M1c` exist to assert on.
 *
 * Every one is either the browser or a spec's own provocation; none is library noise. The old
 * filter let all four through under one bare `/Failed to load resource.*404/`, which also would
 * have hidden any *unplanned* 404 — a missing model, a mistyped asset path, a CDN outage.
 * `ALLOWED_CONSOLE` now scopes each by originating URL and, where it belongs to one case, by
 * test title.
 *
 * The fifth entry, `/subject.png`, is the one the original comment described and the one the
 * survey never saw: vite answers unknown paths with `index.html`, so the fetch succeeds and only
 * the decode fails. It is kept for a statically served harness, with that noted beside it.
 */

/**
 * Attaching builds a segmenter, which can take a while on a contended GPU — longer than the
 * suite-wide 10s expect timeout. Matched to the `waitForFrames` budget the other specs use.
 */
const ATTACH_WAIT = { timeout: 25_000 };

/** Clicks a control and waits for the state the panel mirrors onto `document.body`. */
async function clickAndSettle(app: App, testId: string, attribute: string, value: string) {
  await app.page.click(`[data-testid="${testId}"]`);
  await expect(app.page.locator('body')).toHaveAttribute(attribute, value, ATTACH_WAIT);
  await app.page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
}

test.describe('clean console', () => {
  test('M3: a full attach, switch and detach logs nothing unexpected', async ({ app }) => {
    const { page } = app;

    await app.goto({ mode: 'background-blur', backdrop: 'checker', motion: 'static' });
    await startCamera(page);

    // One attach/detach cycle, kept to one deliberately: each leaks a WebGL context the library
    // never releases (#136), and Chrome drops the oldest past ~16 live contexts per GPU process.
    await clickAndSettle(app, 'attach-processor', 'data-video-processor', 'true');

    // Each switch stops the running effect and starts another. #47's "Empty video frame" is
    // logged on exactly that stop, so going out of blur and back into it provokes it twice.
    await clickAndSettle(app, 'switch-virtual', 'data-mode', 'virtual-background');
    await clickAndSettle(app, 'switch-blur', 'data-mode', 'background-blur');

    // And the teardown, the third stop.
    await page.click('[data-testid="detach-processor"]');
    await expect(page.locator('body')).toHaveAttribute(
      'data-video-processor',
      'false',
      ATTACH_WAIT,
    );

    // Without this the case is vacuous: a run that processed nothing has nothing to log. The
    // frame counter is fed by `onFrameProcessed`, so it only moves when the pipeline really ran.
    const stats = await page.evaluate(() => window.harness.stats());
    expect(stats.frames, 'the pipeline never processed a frame').toBeGreaterThan(0);

    // The assertions themselves. The fixture repeats these at teardown for every test in the
    // suite; spelling them out here is what makes this a case rather than a side effect, and
    // what names the three issues a failure would most likely mean.
    const unexpected = app.unexpectedConsole();
    expect(
      unexpected.map((l) => `${l.url} :: ${l.text}`),
      'the happy path wrote to console.error',
    ).toEqual([]);

    expect(app.pageErrors, 'the happy path threw or rejected').toEqual([]);

    const harnessError = await page.evaluate(() => window.harness.lastError());
    expect(harnessError, `harness recorded an error:\n${(await app.logs()).join('\n')}`).toBeNull();
  });

  test('M3b: the clean-console check catches what it claims to', async ({ app }) => {
    const { page } = app;
    await app.goto({});

    // Precondition. If the page were not clean to begin with, every "it failed" below would be
    // failing for the wrong reason.
    await app.assertConsoleClean();

    // ----------------------------------------------------------------- a console.error

    await page.evaluate(() => console.error('M3b negative control: plain console.error'));
    await expect
      .poll(() => app.unexpectedConsole().length, { message: 'console.error was never recorded' })
      .toBeGreaterThan(0);
    await expect(
      app.assertConsoleClean(),
      'an unlisted console.error passed the check',
    ).rejects.toThrow(/no allowance in fixtures\.ts explains/);
    await app.forgetConsole();
    await app.assertConsoleClean();

    // ----------------------------------------------------------------- a thrown error

    // Thrown from a timer rather than from the evaluated expression itself, so it reaches
    // `window.onerror` as an uncaught exception instead of being returned to Playwright.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('M3b negative control: uncaught throw');
      }, 0);
    });
    await expect
      .poll(() => app.pageErrors.length, { message: 'the throw never reached pageerror' })
      .toBeGreaterThan(0);
    await expect(app.assertConsoleClean(), 'an uncaught throw passed the check').rejects.toThrow(
      /uncaught page errors/,
    );
    await app.forgetConsole();
    await app.assertConsoleClean();

    // ----------------------------------------------------------------- an unhandled rejection

    // Playwright reports unhandled rejections through `pageerror` alongside uncaught throws —
    // observed on Playwright 1.63 with the installed Chrome channel, where the rejection arrives
    // as "pageerror M3b negative control: unhandled rejection". Asserted rather than assumed: it
    // is not documented behaviour, and a version that stopped doing it would cost this check a
    // whole class of failure in silence. The harness's own `unhandledrejection` listener is the
    // backstop either way, which is what the `lastError()` assertion just below reads.
    await page.evaluate(() => {
      void Promise.reject(new Error('M3b negative control: unhandled rejection'));
    });
    await expect
      .poll(() => app.pageErrors.join('\n'), { message: 'the rejection never reached pageerror' })
      .toContain('unhandled rejection');
    await expect(
      app.assertConsoleClean(),
      'an unhandled rejection passed the check',
    ).rejects.toThrow(/uncaught page errors/);

    const harnessError = await page.evaluate(() => window.harness.lastError());
    expect(harnessError, 'the harness did not record the rejection either').toContain(
      'unhandled rejection',
    );
    await app.forgetConsole();
    await app.assertConsoleClean();

    // ----------------------------------------------------------------- caught and logged

    /**
     * The fourth channel, and the one a clean-console check is most likely to miss.
     *
     * Every click handler in `examples/e2e/ui.ts` wraps its work in a try/catch that routes the
     * rejection to `harness.log('ERROR ...')`. An error that the application *handles* therefore
     * reaches neither `console.error` nor `pageerror`: both of Playwright's channels stay empty
     * while something has plainly gone wrong.
     *
     * This is not hypothetical. #22 — constructing a `MediaStreamTrackProcessor` on an ended
     * track, reached by ending the source and attaching again — rejects out of `setProcessor()`,
     * and that rejection is caught by exactly this wrapper. `FORBIDDEN_CONSOLE` has carried
     * `'Input track cannot be ended'` all along and would still not have seen it; only the
     * `lastError()` question in `assertConsoleClean` does.
     *
     * Provoked by attaching with no camera running rather than by reproducing #22 — the handler
     * and the catch block are the same ones, but `Media.setVideoProcessorEnabled` rejects there
     * by design rather than because of a bug, so this control stays valid once #22 is fixed. It
     * is the channel, not the bug, that is under test here.
     */
    await page.click('[data-testid="attach-processor"]');
    await expect
      .poll(() => page.evaluate(() => window.harness.lastError()), {
        message: 'attaching with no camera logged nothing',
      })
      .not.toBeNull();
    expect(app.pageErrors, 'a caught error should not reach pageerror').toEqual([]);
    expect(app.unexpectedConsole(), 'a caught error should not reach console.error').toEqual([]);
    await expect(
      app.assertConsoleClean(),
      'an error the app caught and logged passed the check',
    ).rejects.toThrow(/harness logged an error/);
    await app.forgetConsole();
    await app.assertConsoleClean();

    // ----------------------------------------------------------------- a known-bad string

    // The older half of the check, kept because it names the bug instead of merely reporting a
    // line. #47's string stands in for the list.
    await page.evaluate((needle) => console.error(needle), FORBIDDEN_CONSOLE[0]);
    await expect
      .poll(() => app.unexpectedConsole().length, { message: 'the known-bad line never arrived' })
      .toBeGreaterThan(0);
    await expect(
      app.assertConsoleClean(),
      'a FORBIDDEN_CONSOLE string passed the check',
    ).rejects.toThrow(/known-bad string/);
    await app.forgetConsole();
    await app.assertConsoleClean();

    // ----------------------------------------------------------------- and it is not failing
    //                                                                    on everything

    // The control for the controls: a declared line has to pass, or the five rejections above
    // would be consistent with a check that simply always fails.
    app.allowConsole(/M3b declared line/, 'Emitted by M3b to show allowances are honoured.');
    await page.evaluate(() => console.error('M3b declared line'));
    await expect
      .poll(() => app.consoleLines.length, { message: 'the declared line was never recorded' })
      .toBeGreaterThan(0);
    expect(app.unexpectedConsole(), 'a declared line still counted as unexpected').toEqual([]);
    await app.assertConsoleClean();

    // Leaves the page as it was found, so the fixture's own check at teardown is meaningful
    // here too rather than tripping over this test's provocations.
    await app.forgetConsole();
  });
});
