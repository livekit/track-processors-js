import { expect, test } from '../fixtures';
import {
  attachProcessor,
  sampleProcessed,
  sampleStable,
  startCamera,
  switchMode,
} from '../helpers';
import { GEOMETRY, VIRTUAL_BACKGROUND } from '../thresholds';

/**
 * D1, D5 — the virtual background image.
 */
test.describe('virtual background', () => {
  test('D1: the image is composited behind the subject, not over it', async ({ app }) => {
    const { page } = app;
    // A flat backdrop makes the foreground box exact: every pixel is either the known plate
    // colour or the subject. On the checker backdrop, downscaling blends adjacent cells into
    // colours matching neither and the box degrades to the whole frame.
    await app.goto({ backdrop: 'flat', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);
    await switchMode(page, 'virtual-background');
    await sampleStable(page);

    const sample = await sampleProcessed(page, {
      ...VIRTUAL_BACKGROUND.COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    });

    expect(
      sample.backgroundMatchRatio,
      'background should be replaced by the magenta plate',
    ).not.toBeNull();
    expect(sample.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    // The subject must survive. Compared against where the compositor actually drew it, so this
    // is measured against ground truth rather than a golden image.
    const truth = await page.evaluate(() => window.harness.camera.subjectRect());
    expect(sample.foregroundBox, 'no subject found in front of the background').not.toBeNull();

    const box = sample.foregroundBox!;
    const report =
      `box ${box.x.toFixed(2)},${box.y.toFixed(2)} ${box.w.toFixed(2)}x${box.h.toFixed(2)} ` +
      `cov ${box.coverage.toFixed(3)} ` +
      `vs drawn ${truth.x.toFixed(2)},${truth.y.toFixed(2)} ${truth.w.toFixed(2)}x${truth.h.toFixed(2)}`;

    // Centre, not edges: the mask covers the head and upper torso rather than the whole layout
    // rect, so comparing edges would measure the fixture, not the library. A rotated, mirrored
    // or offset mask — which is what #8, #112 and #128 all produce — moves the centre.
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const truthCentre = { x: truth.x + truth.w / 2, y: truth.y + truth.h / 2 };
    expect(Math.abs(centre.x - truthCentre.x), `subject centre drifted in x: ${report}`).toBeLessThan(
      GEOMETRY.CENTRE_TOLERANCE,
    );
    expect(Math.abs(centre.y - truthCentre.y), `subject centre drifted in y: ${report}`).toBeLessThan(
      GEOMETRY.CENTRE_TOLERANCE,
    );

    // And it stays within the region the subject was drawn into.
    const m = GEOMETRY.CONTAINMENT_MARGIN;
    expect(box.x, `mask extends left of the subject: ${report}`).toBeGreaterThan(truth.x - m);
    expect(box.y, `mask extends above the subject: ${report}`).toBeGreaterThan(truth.y - m);
    expect(box.x + box.w, `mask extends right of the subject: ${report}`).toBeLessThan(
      truth.x + truth.w + m,
    );
    expect(box.y + box.h, `mask extends below the subject: ${report}`).toBeLessThan(
      truth.y + truth.h + m,
    );

    expect(box.coverage, `implausible subject coverage: ${report}`).toBeGreaterThan(
      GEOMETRY.COVERAGE_MIN,
    );
    expect(box.coverage, `implausible subject coverage: ${report}`).toBeLessThan(
      GEOMETRY.COVERAGE_MAX,
    );
  });

  test('D5: the image is fetched once, however often the mode is re-entered', async ({ app }) => {
    const { page } = app;

    // Counting has to be in place before the page loads.
    let requests = 0;
    await page.route('**/bg-solid.png', (route) => {
      requests += 1;
      return route.continue();
    });

    await app.goto({ backdrop: 'flat', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);

    // Enter, leave and re-enter virtual-background three times with the same image path.
    for (let i = 0; i < 3; i += 1) {
      await switchMode(page, 'virtual-background');
      await switchMode(page, 'background-blur');
    }
    await switchMode(page, 'virtual-background');
    await sampleStable(page);

    // The effect must still be applied, or "no refetch" would be trivially true.
    const sample = await sampleProcessed(page, {
      ...VIRTUAL_BACKGROUND.COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    });
    expect(sample.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    // Regression guard for #91, where backgroundImageAndPath was never assigned and every
    // re-entry hit the network. Note the cache holds one entry and is cleared by destroy(), so
    // this asserts only about repeated switches within a single processor session.
    expect(requests, `bg-solid.png was fetched ${requests} times`).toBe(1);
  });
});
