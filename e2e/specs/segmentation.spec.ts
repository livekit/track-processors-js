import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import type { MaskSnapshot, TemporalStability } from '../../examples/e2e/types';
import { type App, expect, test } from '../fixtures';
import { attachProcessor, sampleStable, startCamera } from '../helpers';
import { GOLDEN_MASK, SEGMENTATION, VIRTUAL_BACKGROUND } from '../thresholds';

/**
 * The committed golden, and everything needed to reproduce it.
 *
 * Stored as text rather than a PNG so the diff is readable: at 160x90 the file *is* the
 * silhouette, and a reviewer looking at a failing golden sees which part of it moved rather
 * than two images that differ somehow.
 */
const GOLDEN_PATH = path.join(__dirname, '..', 'golden', 'h1-virtual-background-mask.txt');

/**
 * The pinned compositor frame index the golden was captured from, and the one the negative
 * control uses.
 *
 * `motion=pan` offsets the subject by `0.08 * sin(2*PI*n/120)` of the frame width, so frame 30
 * sits at the right extreme and frame 90 at the left — the same subject, the same backdrop, the
 * same plate, 0.16 of the frame width apart.
 */
const GOLDEN_FRAME = 30;
const CONTROL_FRAME = 90;

interface Golden {
  width: number;
  height: number;
  rows: string[];
}

/**
 * Pins the compositor to one frame index and keeps it there.
 *
 * `freeze()` alone is not enough, and not for the obvious reason: it stops the clock, so the
 * frame index stops advancing — but it also stops the *redraw*, and a canvas-captured track only
 * emits when something draws into the canvas. Dropping the interval below was measured: the
 * track stops producing frames altogether and the case times out at 60s inside the first
 * `waitForFrames`. The interval takes the clock's place, repainting the *same* index, which is
 * what `motion=static` does implicitly and what this does at a chosen index.
 */
async function pinFrame(page: Page, frame: number) {
  await page.evaluate((n) => {
    const pinned = window as unknown as { __h1Pin?: number };
    if (pinned.__h1Pin !== undefined) window.clearInterval(pinned.__h1Pin);
    window.harness.camera.freeze();
    window.harness.camera.setFrame(n);
    pinned.__h1Pin = window.setInterval(() => window.harness.camera.setFrame(n), 16);
  }, frame);
}

/** Classified against the plate colour, exactly as H2 classifies each of its frames. */
async function captureMask(page: Page): Promise<MaskSnapshot> {
  return page.evaluate((background) => window.harness.probe.captureMask({ background }), {
    ...VIRTUAL_BACKGROUND.COLOR,
    tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
  });
}

function parseGolden(text: string): Golden {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
  const header = lines.shift() ?? '';
  const width = Number(/width=(\d+)/.exec(header)?.[1]);
  const height = Number(/height=(\d+)/.exec(header)?.[1]);
  if (!width || !height) throw new Error(`Golden at ${GOLDEN_PATH} has no width/height header`);
  if (lines.length !== height) {
    throw new Error(`Golden declares ${height} rows but carries ${lines.length}`);
  }
  return { width, height, rows: lines };
}

function serialiseGolden(mask: MaskSnapshot, provenance: string[]): string {
  const header = provenance.map((line) => `// ${line}`).join('\n');
  return `${header}\nwidth=${mask.width} height=${mask.height}\n${mask.rows.join('\n')}\n`;
}

/** Share of pixels classified the same way in both masks. */
function maskAgreement(a: Golden, b: Golden): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`masks are ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
  let same = 0;
  for (let y = 0; y < a.height; y += 1) {
    const rowA = a.rows[y];
    const rowB = b.rows[y];
    for (let x = 0; x < a.width; x += 1) if (rowA[x] === rowB[x]) same += 1;
  }
  const total = a.width * a.height;
  return total ? same / total : 0;
}

function asGolden(mask: MaskSnapshot): Golden {
  return { width: mask.width, height: mask.height, rows: mask.rows };
}

/**
 * Brings the harness to the state the golden was captured in: a flat backdrop, the subject
 * pinned to one compositor frame, and a flat virtual background composited behind it.
 *
 * Shared by the assertion and the generator on purpose. A golden captured through a different
 * path from the one that checks it would be guarding that path rather than the library.
 */
async function openPinnedVirtualBackground(app: App) {
  const { page } = app;
  await app.goto({ backdrop: 'flat', motion: 'pan' });
  await startCamera(page);
  // Pinned before the processor is attached, so the segmenter never sees the subject move. The
  // golden has to be the mask of one known frame, not of whichever frame it settled on.
  await pinFrame(page, GOLDEN_FRAME);
  await attachProcessor(page);

  // Through the real control: the flat plate is the thing being composited, and it is also what
  // makes foreground and background separable by colour.
  await page.click('[data-testid="switch-virtual"]');
  await page.waitForFunction(() => window.harness.snapshot().mode === 'virtual-background', null, {
    timeout: 25_000,
  });
  await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
  await sampleStable(page);
}

/** Move the pinned frame and wait for the output to settle on it. No attach cycle (#136). */
async function repin(page: Page, frame: number) {
  await pinFrame(page, frame);
  await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
  await sampleStable(page);
}

function describe(label: string, stability: TemporalStability) {
  return [
    `${label}: flipRate=${(stability.flipRate * 100).toFixed(3)}%`,
    `peak=${(stability.maxFlipRate * 100).toFixed(3)}%`,
    `everFlipped=${(stability.unstablePixelRatio * 100).toFixed(3)}%`,
    `fg=${(stability.foregroundRatio * 100).toFixed(1)}%`,
    `over ${stability.transitions} transitions at ${stability.width}x${stability.height}`,
  ].join(' ');
}

test.describe('segmentation quality', () => {
  /**
   * H2 — temporal stability on a static input.
   *
   * The most-upvoted complaint in the tracker is that mask edges shimmer and crawl on a subject
   * that is not moving (#76, #98). This is that complaint as a number, and the metric any future
   * smoothing work would be judged by.
   *
   * `motion=static` redraws byte-identical pixels on every compositor tick, so with a flat
   * virtual background in place every pixel that changes side between two consecutive *output*
   * frames is the segmenter changing its mind — there is no input change left to blame it on.
   * The result is a fraction of the frame rather than a count, so it does not move with
   * resolution.
   *
   * The second measurement is the control. Under `motion=pan` the subject really does move, and
   * the same measurement must report a materially higher rate: one that stayed small whatever
   * the input did would pass the first assertion while proving nothing.
   */
  test('H2: a static subject does not make the mask flicker', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'flat', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);

    // A flat plate behind the subject is what makes foreground and background separable by
    // colour, so what is measured is the mask rather than the backdrop.
    await page.click('[data-testid="switch-virtual"]');
    await page.waitForFunction(
      () => window.harness.snapshot().mode === 'virtual-background',
      null,
      {
        timeout: 25_000,
      },
    );
    await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));

    const measure = () =>
      page.evaluate((opts) => window.harness.probe.measureTemporalStability(opts), {
        frames: SEGMENTATION.SAMPLE_FRAMES,
        background: { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE },
        timeoutMs: 30_000,
      });

    await page.evaluate(() => window.harness.resetStats());
    const still = await measure();
    const stats = await page.evaluate(() => window.harness.stats());

    // The subject moves, and the measurement has to notice. Driven through the harness rather
    // than a reload: re-attaching the processor would leak another WebGL context (#136).
    await page.evaluate(() => window.harness.camera.setMotion('pan'));
    await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    const moving = await measure();

    const diagnostics = [
      describe('static', still),
      describe('pan   ', moving),
      `segmenter: ${stats.frames} frames, segmentationMs p50 ${stats.segmentationMs.p50.toFixed(2)}`,
    ].join('\n');

    // Zero flips is also what a frozen pipeline reports, so first establish there was something
    // to flip: a subject was segmented, and the segmenter ran at least once per frame measured
    // rather than the track repeating one cached result.
    expect(still.foregroundRatio, `no subject segmented\n${diagnostics}`).toBeGreaterThan(
      SEGMENTATION.FOREGROUND_RATIO_MIN,
    );
    expect(still.foregroundRatio, `frame is all foreground\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.FOREGROUND_RATIO_MAX,
    );
    expect(
      still.transitions,
      `too few frames to judge stability\n${diagnostics}`,
    ).toBeGreaterThanOrEqual(SEGMENTATION.MIN_TRANSITIONS);
    expect(stats.frames, `fewer frames segmented than measured\n${diagnostics}`).toBeGreaterThan(
      still.transitions,
    );
    expect(
      stats.segmentationMs.p50,
      `segmentation reported no work\n${diagnostics}`,
    ).toBeGreaterThan(0);

    expect(still.flipRate, `mask flickers on a static input\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.MAX_STATIC_FLIP_RATE,
    );
    expect(still.maxFlipRate, `a single frame flickered badly\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.MAX_STATIC_PEAK_FLIP_RATE,
    );

    expect(
      moving.flipRate,
      `the measurement does not respond to a moving subject, so the static result means nothing\n${diagnostics}`,
    ).toBeGreaterThan(SEGMENTATION.MIN_MOVING_FLIP_RATE);
  });

  /**
   * H1 — the mask against a golden committed to the repository.
   *
   * Everything else in this suite asserts a *property* of the mask: that it is stable (H2), that
   * it sits where the subject was drawn (E/GEOMETRY), that the plate shows through around it
   * (D1). All of those survive the mask changing shape, which is exactly what happens when the
   * mediapipe build or the model asset moves under us — [#59] and the downgrade that shipped in
   * [#72] both changed the silhouette while every property assertion stayed green. This is the
   * canary for that: the whole mask, compared pixel for pixel against a mask captured from a
   * known build and checked in.
   *
   * It is only meaningful because the mask is reproducible. H2 measures exactly zero pixel flips
   * between consecutive frames on a static input, so with the compositor pinned to one frame the
   * mask is a deterministic function of the model — and any disagreement with the golden is the
   * model, not noise.
   *
   * The golden is generated by the `H1-regen` test below, in its own explicit run, and committed.
   * Regenerating it from the same run that asserts against it would prove nothing.
   *
   * [#59]: https://github.com/livekit/track-processors-js/issues/59
   * [#72]: https://github.com/livekit/track-processors-js/issues/72
   */
  test('H1: the segmentation mask matches the committed golden', async ({ app }) => {
    const { page } = app;

    // Read first: a missing or malformed golden should say so before five seconds of setup.
    const golden = parseGolden(fs.readFileSync(GOLDEN_PATH, 'utf8'));

    await openPinnedVirtualBackground(app);
    const observed = await captureMask(page);

    // The negative control, measured in the same page session rather than imagined: the same
    // scene at a different pinned frame, where `motion=pan` has moved the subject 0.16 of the
    // frame width. A comparison that could not tell those apart could not tell a model change
    // apart either. No re-attach — that would leak another WebGL context (#136).
    await repin(page, CONTROL_FRAME);
    const displaced = await captureMask(page);

    const match = maskAgreement(golden, asGolden(observed));
    const control = maskAgreement(golden, asGolden(displaced));

    const diagnostics = [
      `golden ${golden.width}x${golden.height} from frame ${GOLDEN_FRAME}`,
      `observed fg=${(observed.foregroundRatio * 100).toFixed(2)}% agreement=${(match * 100).toFixed(3)}%`,
      `control (frame ${CONTROL_FRAME}) fg=${(displaced.foregroundRatio * 100).toFixed(2)}% agreement=${(control * 100).toFixed(3)}%`,
      `regenerate with: E2E_UPDATE_GOLDEN=1 pnpm test:e2e --grep "H1-regen"`,
    ].join('\n');

    // A frame with no subject in it agrees with nothing, but a golden of an empty frame would
    // agree with it perfectly. Establish there is a silhouette on both sides first.
    expect(observed.foregroundRatio, `no subject segmented\n${diagnostics}`).toBeGreaterThan(
      SEGMENTATION.FOREGROUND_RATIO_MIN,
    );
    expect(observed.foregroundRatio, `frame is all foreground\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.FOREGROUND_RATIO_MAX,
    );

    expect(
      match,
      `the mask has moved away from the committed golden — if mediapipe or the model asset changed on purpose, regenerate it and review the diff\n${diagnostics}`,
    ).toBeGreaterThan(GOLDEN_MASK.MIN_AGREEMENT);

    expect(
      control,
      `the comparison cannot tell two different frames apart, so the agreement above means nothing\n${diagnostics}`,
    ).toBeLessThan(GOLDEN_MASK.MAX_DISPLACED_AGREEMENT);
  });

  /**
   * H1-regen — writes the artifact H1 asserts against. Skipped unless asked for.
   *
   *     E2E_UPDATE_GOLDEN=1 pnpm test:e2e --grep "H1-regen"
   *
   * Run it when the mediapipe dependency or the model asset is deliberately changed, or when the
   * compositor's subject changes, and commit the result with the diff reviewed — at 160x90 the
   * file is legible as a picture, so "the chin moved two pixels" and "the mask collapsed" look
   * nothing alike.
   */
  test('H1-regen: write the golden segmentation mask', async ({ app }) => {
    test.skip(
      !process.env.E2E_UPDATE_GOLDEN,
      'set E2E_UPDATE_GOLDEN=1 to rewrite the committed golden',
    );
    const { page } = app;

    await openPinnedVirtualBackground(app);
    const mask = await captureMask(page);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const env = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      model: window.harness.config.assetPaths?.modelAssetPath ?? 'library default (CDN)',
      fileSet: window.harness.config.assetPaths?.tasksVisionFileSet ?? 'library default (CDN)',
    }));

    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
    fs.writeFileSync(
      GOLDEN_PATH,
      serialiseGolden(mask, [
        'H1 golden: the virtual-background segmentation mask of one known frame.',
        '# foreground, . background. Generated, not hand-edited.',
        '',
        'Regenerate:  E2E_UPDATE_GOLDEN=1 pnpm test:e2e --grep "H1-regen"',
        'Generator:   the "H1-regen" test in e2e/specs/segmentation.spec.ts',
        '',
        `Fixture:     /?backdrop=flat&motion=pan, compositor pinned to frame ${GOLDEN_FRAME},`,
        '             virtual-background mode with the default /bg-solid.png plate.',
        `Classifier:  probe.captureMask() at ${mask.width}x${mask.height}, plate`,
        `             rgb(${VIRTUAL_BACKGROUND.COLOR.r},${VIRTUAL_BACKGROUND.COLOR.g},${VIRTUAL_BACKGROUND.COLOR.b}) +/-${VIRTUAL_BACKGROUND.TOLERANCE} per channel.`,
        `Foreground:  ${(mask.foregroundRatio * 100).toFixed(2)}% of the frame.`,
        '',
        `Captured on: @mediapipe/tasks-vision ${pkg.dependencies['@mediapipe/tasks-vision']}`,
        `             fileset ${env.fileSet}`,
        `             model   ${env.model}`,
        `             ${env.userAgent}`,
        '',
        'A disagreement with this file means the mask moved. That is either a deliberate',
        'model or mediapipe change — regenerate and review the diff — or the regression',
        'H1 exists to catch (#59, #72).',
      ]),
    );
  });
});
