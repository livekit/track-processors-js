import { expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';
import { PERFORMANCE, SUSTAINED_FPS } from '../thresholds';

/**
 * G1 — the timings reported through `onFrameProcessed`.
 *
 * Four assertions, over 60 frames with the warm-up discarded:
 *
 * - every reported p50 is finite and positive
 * - `processingMs` still equals `segmentationMs + filterMs`, so the stat has not changed meaning
 * - segmentation clears its ceiling, which holds on hardware and software renderers alike
 * - the pipeline clears a frame-rate floor, and its frame time clears a ceiling
 *
 * The frame-time ceiling is asserted only on a hardware renderer: the filter step is WebGL, and
 * on a software rasterizer the figure describes the rasterizer rather than this library.
 */
test.describe('frame processing stats', () => {
  test('G1: onFrameProcessed reports coherent timings at a usable frame rate', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'pan' });

    await startCamera(page);
    await attachProcessor(page);

    // Discard the warm-up: the first frame is deliberately a passthrough clone, and the
    // segmenter's first inference is far slower than its steady state.
    await page.evaluate(() => window.harness.resetStats());
    await page.evaluate(
      (frames) => window.harness.probe.waitForFrames(frames, 40_000),
      PERFORMANCE.SAMPLE_FRAMES,
    );

    const stats = await page.evaluate(() => window.harness.stats());
    const env = await page.evaluate(() => window.harness.env());
    const report = `${JSON.stringify(stats)} renderer=${env.renderer}`;

    expect(stats.frames, `too few frames recorded: ${report}`).toBeGreaterThanOrEqual(
      PERFORMANCE.SAMPLE_FRAMES / 2,
    );
    expect(stats.fps, `frame rate below floor: ${report}`).toBeGreaterThan(PERFORMANCE.MIN_FPS);

    for (const key of ['processingMs', 'segmentationMs', 'filterMs'] as const) {
      expect(Number.isFinite(stats[key].p50), `${key} is not finite: ${report}`).toBe(true);
      expect(stats[key].p50, `${key} should be positive: ${report}`).toBeGreaterThan(0);
    }

    // processingTimeMs is reported as segmentation + filter; if that stops holding, the stat
    // has silently changed meaning.
    expect(stats.processingMs.p50).toBeCloseTo(stats.segmentationMs.p50 + stats.filterMs.p50, 0);

    // Segmentation runs on the mediapipe delegate, not our WebGL path, and holds near 3ms on
    // both hardware and software renderers.
    expect(stats.segmentationMs.p50, `segmentation slower than expected: ${report}`).toBeLessThan(
      PERFORMANCE.MAX_P50_SEGMENTATION_MS,
    );

    // The filter step is WebGL and is meaningless to time on a software rasterizer: the same
    // work measures ~2ms on a GPU and ~58ms on SwiftShader. Assert it only where the number
    // says something about the library.
    if (env.softwareRenderer) {
      test.info().annotations.push({
        type: 'notice',
        description: `software renderer (${env.renderer}) — skipped the frame-time assertion; observed p50 ${stats.processingMs.p50.toFixed(1)}ms`,
      });
      return;
    }

    expect(
      stats.processingMs.p50,
      `median processing time too high to sustain 30fps: ${report}`,
    ).toBeLessThan(PERFORMANCE.MAX_P50_PROCESSING_MS);
  });
});

/**
 * Nearest-rank percentile over an unsorted sample. `p` is a fraction.
 *
 * Nearest-rank rather than interpolating: these are decoded-frame counts, and a p5 that sits on
 * a bucket the run actually produced is easier to reconcile with the recorded distribution than
 * one that lands between two of them.
 */
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index];
}

/**
 * G2 — the frame rate a remote peer actually receives from 720p blur, sustained.
 *
 * G1 asks how long one frame took to process; this asks whether frames keep arriving at the far
 * end for as long as a call lasts. The two can disagree: a per-frame cost of 2 ms says nothing
 * about a pipeline that stops producing after ten seconds, which is the shape of
 * [#77](https://github.com/livekit/track-processors-js/issues/77) and
 * [#79](https://github.com/livekit/track-processors-js/issues/79).
 *
 * Measured through the in-page loopback rather than the probe, because the canvas and the
 * encoder can disagree — a canvas keeps painting while nothing is published (#127) — and because
 * decoded frames at the receiving end are what a remote participant sees.
 *
 * Counted, not reported: each bucket is a `framesDecoded` delta over a wall-clock interval.
 * `framesPerSecond` from `getStats()` is a short rolling average that lags a stall, so a freeze
 * of a second or two is visible in these buckets before it is visible there.
 */
test.describe('sustained frame rate', () => {
  test('G2: 720p blur sustains the frame rate a remote peer receives', async ({
    app,
  }, testInfo) => {
    // The measurement window alone is most of the 60s default, before the mediapipe CDN fetch,
    // the attach and the encoder ramp are paid for. Raised rather than shortened: see
    // SUSTAINED_FPS.WINDOW_MS for why the window is the length it is.
    test.setTimeout(120_000);

    const { page } = app;
    const floors = SUSTAINED_FPS.FLOORS[testInfo.project.name];
    expect(
      floors,
      `no frame-rate floor for project "${testInfo.project.name}". Add one observed from a real run on that browser rather than inheriting Chrome's — the floors are a hardware tier, not a library property.`,
    ).toBeDefined();

    await app.goto({ backdrop: 'checker', motion: 'pan' });
    // Motion, not a static frame: a still scene compresses to almost nothing and would let a
    // pipeline that had stopped doing real work still clear the floor.
    await startCamera(page, { width: 1280, height: 720 });

    // Setup is through the harness; the behaviour under test — blur running — is attached with
    // the real control, as the suite's conventions require.
    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => document.body.dataset.videoProcessor === 'true');
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

    await page.evaluate(async () => {
      const track = window.harness.media.processedVideoTrack();
      if (!track) throw new Error('no published video track to loop back');
      await window.harness.loopback.start(track);
    });

    const result = await page.evaluate(
      async ({ windowMs, intervalMs, rampTimeoutMs, sourceWidth }) => {
        // The encoder starts small and scales up over the first seconds, so a window that
        // started immediately would open on the smallest decoded size there is. Bounded, and
        // the bound is usually what ends it — WebRTC's ramp outlasts it, and waiting the ramp
        // out would cost another ten seconds for a resolution this case does not assert on.
        // The sizes at both ends of the window are reported instead.
        const rampDeadline = performance.now() + rampTimeoutMs;
        while (performance.now() < rampDeadline) {
          const sample = await window.harness.loopback.stats();
          if ((sample?.frameWidth ?? 0) >= sourceWidth) break;
          await new Promise((r) => setTimeout(r, 250));
        }

        const buckets: number[] = [];
        const sizes: string[] = [];
        let prev = await window.harness.loopback.stats();
        let prevAt = performance.now();
        const startedAt = prevAt;
        const firstDecoded = prev?.framesDecoded ?? 0;
        const deadline = startedAt + windowMs;
        while (performance.now() < deadline) {
          await new Promise((r) => setTimeout(r, intervalMs));
          const now = await window.harness.loopback.stats();
          const at = performance.now();
          if (prev && now) {
            buckets.push(((now.framesDecoded - prev.framesDecoded) * 1000) / (at - prevAt));
            if (now.frameWidth) sizes.push(`${now.frameWidth}x${now.frameHeight}`);
          }
          prev = now;
          prevAt = at;
        }
        const elapsedMs = performance.now() - startedAt;
        const framesDecoded = (prev?.framesDecoded ?? 0) - firstDecoded;
        return {
          buckets,
          elapsedMs,
          framesDecoded,
          meanFps: (framesDecoded * 1000) / elapsedMs,
          firstSize: sizes[0] ?? 'unknown',
          lastSize: sizes[sizes.length - 1] ?? 'unknown',
        };
      },
      {
        windowMs: SUSTAINED_FPS.WINDOW_MS,
        intervalMs: SUSTAINED_FPS.SAMPLE_INTERVAL_MS,
        rampTimeoutMs: SUSTAINED_FPS.RAMP_TIMEOUT_MS,
        sourceWidth: 1280,
      },
    );

    const env = await page.evaluate(() => window.harness.env());
    const median = percentile(result.buckets, 0.5);
    const p5 = percentile(result.buckets, 0.05);
    const min = Math.min(...result.buckets);
    const report =
      `median ${median.toFixed(1)} p5 ${p5.toFixed(1)} min ${min.toFixed(1)} mean ` +
      `${result.meanFps.toFixed(1)} over ${result.buckets.length} buckets / ` +
      `${(result.elapsedMs / 1000).toFixed(1)}s, ${result.framesDecoded} frames decoded, ` +
      `${result.firstSize}->${result.lastSize}, renderer=${env.renderer}`;

    // A short window would make a median look fine while hiding a stall, so the distribution is
    // only worth reading once it has the buckets it was calibrated with.
    expect(result.buckets.length, `too few samples: ${report}`).toBeGreaterThanOrEqual(
      SUSTAINED_FPS.MIN_SAMPLES,
    );

    // The fps floors are a GPU figure. On SwiftShader the WebGL filter step costs ~56ms per
    // frame against ~2ms on a real GPU, which caps the whole pipeline well under any floor worth
    // asserting — the same reason G1 skips its frame-time assertion there. Recorded rather than
    // asserted, so `PW_CHANNEL=chromium` stays a supported way to run the suite.
    if (env.softwareRenderer) {
      testInfo.annotations.push({
        type: 'notice',
        description: `software renderer (${env.renderer}) — skipped the frame-rate floor; observed ${report}`,
      });
      return;
    }

    testInfo.annotations.push({ type: 'fps', description: report });

    expect(median, `median frame rate below the tier floor: ${report}`).toBeGreaterThanOrEqual(
      floors.MEDIAN_MIN,
    );
    // And the tail: a run that spends a second frozen and makes it up afterwards has a healthy
    // median and an unusable call.
    expect(p5, `5th-percentile frame rate below its bound: ${report}`).toBeGreaterThanOrEqual(
      floors.P5_MIN,
    );
  });
});
