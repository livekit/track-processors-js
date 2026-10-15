import { type App, expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';
import { FORBIDDEN_CONSOLE, TRACK_ENDING } from '../thresholds';

/**
 * B8 — the camera being unplugged out from under a running processor.
 *
 * Driven as the real thing is: `.stop()` on the source `MediaStreamTrack` itself, through the
 * harness's `end-source` control, with no warning to the library. The wrapper is left holding a
 * `MediaStreamTrackProcessor` whose input has gone away, which is the condition behind
 * [#22](https://github.com/livekit/track-processors-js/issues/22).
 *
 * Three separate properties, in the order they matter to an integration:
 *
 *  1. the wrapper notices — it reaches `media-exhausted` and releases its pipeline, rather than
 *     sitting on a dead stream;
 *  2. nothing escapes — no `Failed to construct 'MediaStreamTrackProcessor': Input track cannot
 *     be ended`, no uncaught rejection, no console error;
 *  3. it can still be torn down afterwards, which is what people actually hit: a wrapper that
 *     cannot be stopped once its source has died leaks its canvas, its segmenter and its WebGL
 *     context (#136).
 *
 * The `app` fixture's clean-console check covers part of (2) on its own, but only part, and only
 * on a test that otherwise passed — so the error channels are asserted here explicitly. That is
 * not belt-and-braces: the negative control recorded in `TRACK_ENDING` shows #22's message
 * reaching `harness.lastError()` without ever reaching the console, so `FORBIDDEN_CONSOLE` alone
 * would not have caught it on this path.
 *
 * `?loglevel=debug` installs the library's own `setLogExtension` sink, which is how the state
 * transition is observed without reading a private field across the process boundary — see
 * `TRACK_ENDING.EXHAUSTED_LOG`.
 */
test.describe('source track ending', () => {
  test('B8: a source track ending is handled, and the processor can still be stopped', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static', loglevel: 'debug' });

    // Setup through the harness; the unplug and the teardown below are real clicks.
    await startCamera(page);
    await attachProcessor(page);

    // Without this the rest proves nothing: "no frames after the source ended" is trivially
    // true of a pipeline that never produced any.
    const before = await page.evaluate(() => ({
      state: window.harness.media.processorState(),
      frames: window.harness.probe.presentedFrames(),
    }));
    expect(before.state, 'the processor was not running before the source was ended').toEqual({
      lifecycle: TRACK_ENDING.RUNNING,
      source: 'live',
      processed: 'live',
    });
    expect(
      before.frames,
      'no frames had been produced before the source was ended',
    ).toBeGreaterThan(0);

    await page.evaluate(() => window.harness.clearLibraryLogs());

    // ------------------------------------------------------------------ the unplug

    const endedAt = Date.now();
    await page.click('[data-testid="end-source"]');
    await page.waitForFunction(
      (running) => window.harness.media.processorState().lifecycle !== running,
      TRACK_ENDING.RUNNING,
      { timeout: TRACK_ENDING.MAX_EXHAUSTED_MS, polling: 10 },
    );
    const exhaustedMs = Date.now() - endedAt;

    const exhausted = await page.evaluate(() => window.harness.media.processorState());
    expect(
      exhausted,
      `the wrapper did not reach ${TRACK_ENDING.EXHAUSTED} after ${exhaustedMs}ms`,
    ).toEqual({
      lifecycle: TRACK_ENDING.EXHAUSTED,
      source: 'ended',
      processed: 'ended',
    });

    // The same transition as the library itself reports it, so the case does not rest entirely
    // on the private field `processorState()` reaches for.
    const afterEnd = await page.evaluate(() => window.harness.libraryLogs());
    expect(
      afterEnd.map((record) => record.msg),
      'the library never reported the source as exhausted',
    ).toContain(TRACK_ENDING.EXHAUSTED_LOG);

    // The pipeline is released, not merely relabelled: nothing is still being published.
    //
    // The window opens after a settle rather than at the transition, because one frame can
    // already be in flight when the source goes — see TRACK_ENDING.SETTLE_MS.
    const quiet = await page.evaluate(
      async ([settleMs, ms]) => {
        await new Promise((resolve) => setTimeout(resolve, settleMs));
        const start = window.harness.probe.presentedFrames();
        await new Promise((resolve) => setTimeout(resolve, ms));
        return window.harness.probe.presentedFrames() - start;
      },
      [TRACK_ENDING.SETTLE_MS, TRACK_ENDING.QUIET_MS] as const,
    );
    expect(
      quiet,
      `frames were still presented ${TRACK_ENDING.QUIET_MS}ms after the source ended`,
    ).toBeLessThanOrEqual(TRACK_ENDING.MAX_FRAMES_AFTER_END);

    await expectNothingEscaped(app, 'after the source ended');

    // ------------------------------------------------------------------ teardown afterwards

    const detachedAt = Date.now();
    await page.click('[data-testid="detach-processor"]');
    await expect(
      page.locator('body'),
      'stopProcessor() never completed on a processor whose source had ended',
    ).toHaveAttribute('data-video-processor', 'false', {
      timeout: TRACK_ENDING.MAX_TEARDOWN_MS,
    });
    const teardownMs = Date.now() - detachedAt;

    const destroyed = await page.evaluate(() => ({
      state: window.harness.media.processorState(),
      snapshot: window.harness.snapshot(),
      libraryLogs: window.harness.libraryLogs(),
    }));
    expect(
      destroyed.state.lifecycle,
      `the wrapper did not finish destroying after ${teardownMs}ms`,
    ).toBe(TRACK_ENDING.DESTROYED);
    expect(destroyed.snapshot.videoProcessorEnabled).toBe(false);
    expect(destroyed.snapshot.mode).toBe('off');

    // `destroy()` logs the state it was entered from, which says the teardown that just
    // succeeded was the media-exhausted one rather than an ordinary detach of a live pipeline.
    const destroyLog = destroyed.libraryLogs.find((record) =>
      record.msg.startsWith(TRACK_ENDING.DESTROY_LOG_PREFIX),
    );
    expect(
      destroyLog?.msg,
      `teardown did not start from ${TRACK_ENDING.EXHAUSTED}; library said: ` +
        destroyed.libraryLogs.map((record) => record.msg).join(' | '),
    ).toBeDefined();

    await expectNothingEscaped(app, 'after the processor was stopped');
  });
});

/**
 * No error reached the page, the console, or the harness's own sink.
 *
 * All three are checked because they are three different channels and #22 only uses one of
 * them: the construction failure arrives as a rejected promise from `setProcessor()`, which the
 * UI catches and records, so it shows up in `lastError()` with the console clean. Asserted
 * twice — once after the unplug and once after the teardown — so a failure names which half
 * produced it.
 */
async function expectNothingEscaped(app: App, when: string) {
  expect(app.pageErrors, `uncaught page errors ${when}`).toEqual([]);
  expect(
    app.consoleErrors.filter((line) => FORBIDDEN_CONSOLE.some((needle) => line.includes(needle))),
    `the console carried a known-bad string ${when}`,
  ).toEqual([]);

  const lastError = await app.page.evaluate(() => window.harness.lastError());
  expect(lastError, `the harness recorded an error ${when}`).toBeNull();
}
