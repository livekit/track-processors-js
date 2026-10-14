import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { attachProcessor, sampleSource, sampleStable, startCamera } from '../helpers';
import { GEOMETRY, RESOLUTION_CHANGE } from '../thresholds';

/**
 * E1 — output dimensions follow the source.
 *
 * The mask and blur buffers are sized once at setup from getSettings() while every frame is
 * rendered at the frame's own size; when the two disagree the output comes out clipped, offset
 * or stretched. That is the whole subject of #128 and #112. This covers the static case across
 * several resolutions and orientations; rotation needs a real device.
 *
 * Measured from the decoded frame rather than from processedSettings, which on the
 * insertable-streams path is a MediaStreamTrackGenerator track and reports no dimensions at all.
 */
const RESOLUTIONS = [
  { width: 640, height: 480, label: '640x480 4:3' },
  { width: 1280, height: 720, label: '1280x720 16:9' },
  { width: 480, height: 640, label: '480x640 portrait' },
];

test.describe('geometry', () => {
  for (const { width, height, label } of RESOLUTIONS) {
    test(`E1: ${label} passes through the processor unchanged`, async ({ app }) => {
      const { page } = app;
      await app.goto({ backdrop: 'checker', motion: 'static' });

      await startCamera(page, { width, height });
      const source = await sampleSource(page);
      expect(
        { width: source.width, height: source.height },
        'the fake camera did not honour the requested resolution',
      ).toEqual({ width, height });

      await attachProcessor(page);
      const processed = await sampleStable(page);

      expect({ width: processed.width, height: processed.height }).toEqual({ width, height });
      expect(
        processed.width / processed.height,
        'aspect ratio changed across the processor',
      ).toBeCloseTo(width / height, 2);
    });
  }
});

/**
 * E3 — a mid-call resolution change resizes the buffers.
 *
 * The non-mobile half of #128, and the case #112 described. E1 above covers the static shape of
 * it: each resolution gets a fresh page, so every buffer is allocated once, at setup, from a
 * source that never changes afterwards. The path that actually broke is the other one — the
 * frame size changing *underneath a running processor* — and two things have to follow it. The
 * mask and blur textures, through `ensureBuffersMatchCanvas()` in src/webgl/index.ts; and, on
 * the canvas fallback, the `displayCanvas` the published track is captured from, which is sized
 * at setup from `waitForTrackResolution` and has to be re-sized per frame in
 * ProcessorWrapper's render loop. Both are "keep mask buffers and canvas fallback output in sync
 * with the frame size", and both run here.
 *
 * Run on both pipelines because they fail differently, and at a constant aspect ratio only one
 * of them fails loudly. The negative control for each is recorded beside RESOLUTION_CHANGE in
 * thresholds.ts.
 *
 * Driven by resizing the fake camera rather than by `restartVideo`. That is not a shortcut; it
 * is the only driver that tests anything:
 *
 *   - `restartVideo` routes through `LocalVideoTrack.restartTrack`, which stops the track,
 *     re-acquires through getUserMedia and then *rebuilds the processor* against the new source.
 *     Every buffer is simply allocated at the new size and the resize path never runs at all —
 *     counting reallocations inside `ensureBuffersMatchCanvas()` across a restart gives zero.
 *   - `applyConstraints` cannot reach the source either. Once a processor is attached,
 *     `LocalTrack.mediaStreamTrack` returns the processor's *output* track, so constraints land
 *     on a MediaStreamTrackGenerator and the camera never hears about them.
 *
 * Resizing the compositor canvas is what a mid-call downscale looks like from the library's
 * side: the same track keeps delivering, at a new frame size.
 */

/**
 * Strips of the frame that are pure backdrop in the compositor's output.
 *
 * The subject is drawn across x 0.19-0.81 (0.2-0.8 plus the shoulder overhang) and from y 0.08
 * down to the bottom edge, so these three never contain it. There is deliberately no bottom
 * strip: the subject reaches the bottom of the frame by design.
 */
const EDGE_STRIPS = {
  top: { x: 0, y: 0, w: 1, h: 0.06 },
  left: { x: 0, y: 0, w: 0.06, h: 1 },
  right: { x: 0.94, y: 0, w: 0.06, h: 1 },
};

const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Polls the decoded output until it carries `width`x`height` and the mask is back over the
 * subject, reporting how long each of those took.
 *
 * Two clocks, because two different things are worth timing. `resizeMs` runs from the click to
 * the first frame at the new size, which is capture latency. `realignMs` runs from there to the
 * first frame whose mask agrees with ground truth, and is the buffer-resize latency #128 is
 * about; keeping them apart makes the 500ms window a statement about the library rather than
 * about how fast a canvas captureStream picks up a resize.
 *
 * The loop runs inside the page so the figures are not inflated by a round trip per sample.
 * `trail` is kept for the failure message: a stale buffer shows up there as a size that never
 * changes, or a centre that never converges.
 */
async function waitForRealignment(
  page: Page,
  target: { width: number; height: number },
  limits: {
    centreTolerance: number;
    containmentMargin: number;
    coverageMin: number;
    coverageMax: number;
    timeoutMs: number;
  },
) {
  return page.evaluate(
    async (o) => {
      const startedAt = performance.now();
      const trail: {
        t: number;
        size: string;
        dx: number;
        dy: number;
        coverage: number;
        contained: boolean;
      }[] = [];
      let resizedAt: number | null = null;
      let last: (typeof trail)[number] | null = null;

      while (performance.now() - startedAt < o.timeoutMs) {
        let observation: (typeof trail)[number] | null = null;
        try {
          const sample = await window.harness.probe.sample();
          const truth = window.harness.probe.expectedForegroundBox();
          const box = sample.foregroundBox;
          if (sample.width === o.width && sample.height === o.height && resizedAt === null) {
            resizedAt = performance.now();
          }
          if (truth && box) {
            // Centre and containment rather than edges: the mask legitimately covers less than
            // the rect the compositor drew into. GEOMETRY in thresholds.ts explains why.
            observation = {
              t: Math.round(performance.now() - startedAt),
              size: `${sample.width}x${sample.height}`,
              dx: Math.abs(box.x + box.w / 2 - (truth.x + truth.w / 2)),
              dy: Math.abs(box.y + box.h / 2 - (truth.y + truth.h / 2)),
              coverage: box.coverage,
              contained:
                box.x >= truth.x - o.containmentMargin &&
                box.y >= truth.y - o.containmentMargin &&
                box.x + box.w <= truth.x + truth.w + o.containmentMargin &&
                box.y + box.h <= truth.y + truth.h + o.containmentMargin,
            };
          }
        } catch {
          // Nothing decodable yet. Retried rather than treated as a failure, so the loop can
          // start before the first frame at the new size has been presented.
        }

        if (observation) {
          last = observation;
          if (trail.length < 40) trail.push(observation);
          if (
            observation.size === `${o.width}x${o.height}` &&
            observation.contained &&
            observation.dx <= o.centreTolerance &&
            observation.dy <= o.centreTolerance &&
            observation.coverage >= o.coverageMin &&
            observation.coverage <= o.coverageMax
          ) {
            return {
              aligned: true,
              resizeMs: Math.round((resizedAt ?? performance.now()) - startedAt),
              realignMs: Math.round(performance.now() - (resizedAt ?? startedAt)),
              ...observation,
              trail,
            };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return {
        aligned: false,
        resizeMs: resizedAt === null ? -1 : Math.round(resizedAt - startedAt),
        realignMs: -1,
        ...(last ?? { t: -1, size: 'none', dx: -1, dy: -1, coverage: -1, contained: false }),
        trail,
      };
    },
    { ...target, ...limits },
  );
}

/**
 * How much of each pure-backdrop edge strip still carries the backdrop colour.
 *
 * This is the letterbox check. A letterboxed output pads the frame with bars that are not the
 * backdrop, so the ratio collapses on whichever edges were padded. A correctly sized output
 * keeps every strip at the backdrop colour, which survives the blur because `backdrop=flat` has
 * no detail to lose.
 */
async function edgeBackdropRatios(page: Page) {
  const ratios: Record<string, number> = {};
  for (const [name, strip] of Object.entries(EDGE_STRIPS)) {
    ratios[name] = await page.evaluate(
      async ({ s, full }) => {
        const sample = await window.harness.probe.sample({
          regions: { fg: full, bg: s },
          expectBackground: window.harness.camera.backdropColor(),
        });
        return sample.backgroundMatchRatio ?? 0;
      },
      { s: strip, full: FULL_FRAME },
    );
  }
  return ratios;
}

const PIPELINES = [
  { label: 'insertable streams', fallback: 0 },
  { label: 'the canvas fallback', fallback: 1 },
];

test.describe('geometry', () => {
  for (const { label: pipeline, fallback } of PIPELINES) {
    test(`E3: a mid-call resolution change resizes the buffers on ${pipeline}`, async ({
      app,
    }) => {
      const { page } = app;
      // flat, because foregroundBox learns the background from a border ring and needs a
      // low-frequency one; static, so ground truth stays one rect for the whole run.
      await app.goto({ backdrop: 'flat', motion: 'static', fallback });

      await startCamera(page, { width: 1280, height: 720 });
      await attachProcessor(page);
      expect(
        await page.evaluate(() => document.body.dataset.pipeline),
        'the run is not on the pipeline it claims to be testing',
      ).toBe(fallback ? 'canvas-fallback' : 'insertable-streams');

      const baseline = await sampleStable(page);
      expect({ width: baseline.width, height: baseline.height }).toEqual({
        width: 1280,
        height: 720,
      });
      const baselineCoverage = baseline.foregroundBox!.coverage;

      // 720p -> 360p -> 720p, both ways through the same running processor. Two resizes plus
      // the attach is three processor builds for the page, inside the budget #136 imposes.
      for (const { width, height } of [
        { width: 640, height: 360 },
        { width: 1280, height: 720 },
      ]) {
        const size = `${width}x${height}`;
        await page.selectOption('[data-testid="video-resolution"]', size);
        await page.click('[data-testid="resize-source"]');

        const settled = await waitForRealignment(
          page,
          { width, height },
          {
            centreTolerance: GEOMETRY.CENTRE_TOLERANCE,
            containmentMargin: GEOMETRY.CONTAINMENT_MARGIN,
            coverageMin: GEOMETRY.COVERAGE_MIN,
            coverageMax: GEOMETRY.COVERAGE_MAX,
            timeoutMs: 10_000,
          },
        );

        // Both halves of the fix in one assertion: the output has to carry the new frame size,
        // and the mask has to be back over the subject. The canvas-fallback negative control
        // fails here, with `size` stuck at the previous resolution.
        expect(
          settled.aligned,
          `output never realigned at ${size}; trail: ${JSON.stringify(settled.trail)}`,
        ).toBe(true);
        expect(
          settled.resizeMs,
          `the new frame size took too long to reach the output at ${size}`,
        ).toBeLessThanOrEqual(RESOLUTION_CHANGE.MAX_RESIZE_MS);
        expect(settled.realignMs, `the mask lagged the frame size at ${size}`).toBeLessThanOrEqual(
          RESOLUTION_CHANGE.MAX_REALIGN_MS,
        );

        // Not letterboxed: every edge that should be backdrop still is.
        const edges = await edgeBackdropRatios(page);
        for (const [edge, ratio] of Object.entries(edges)) {
          expect(ratio, `${edge} edge is not backdrop at ${size} — letterboxed?`).toBeGreaterThan(
            RESOLUTION_CHANGE.EDGE_BACKDROP_RATIO_MIN,
          );
        }

        // Not clipped: the subject still takes the same share of the frame it took at 720p.
        const drift = Math.abs(settled.coverage - baselineCoverage) / baselineCoverage;
        expect(
          drift,
          `subject coverage moved from ${baselineCoverage.toFixed(4)} to ${settled.coverage.toFixed(4)} at ${size}`,
        ).toBeLessThan(RESOLUTION_CHANGE.MAX_COVERAGE_DRIFT);
      }
    });
  }
});
