import { expect, test } from '../fixtures';
import { attachProcessor, sampleSource, sampleStable, startCamera } from '../helpers';

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
