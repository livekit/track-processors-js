import { expect, test } from '../fixtures';
import { decibels, measureLevel, monitorLevel, startMic } from '../helpers';
import { AUDIO } from '../thresholds';

/**
 * J1 — GainAudioProcessor, added in #124.
 *
 * The fake microphone publishes a 440 Hz sine at amplitude 0.25, so these assert measured level
 * against an exact expected value rather than against whatever a real room sounds like. Level is
 * read off `media.processedAudioTrack()` — the track a remote peer would receive — which is the
 * processor's output while one is attached and the raw mic otherwise, so the same measurement
 * serves as both baseline and result.
 */
test.describe('audio processor', () => {
  test('J1: attaching the gain processor preserves the tone at unity', async ({ app }) => {
    const { page } = app;
    await app.goto();

    await startMic(page);
    const baseline = await measureLevel(page);
    expect(
      baseline.rms,
      'the fake mic should be publishing a tone before anything is attached',
    ).toBeGreaterThan(AUDIO.TONE_RMS_MIN);

    // Sampled across the attach, not before and after it: a processor that dropped audio for a
    // moment while swapping tracks would leave both of those intact. This stands in for the
    // peer-connection `totalSamplesReceived` continuity check, which needs a publishing path
    // this suite does not have.
    const monitor = monitorLevel(page, AUDIO.CONTINUITY_WINDOW_MS);
    await page.click('[data-testid="attach-gain"]');
    await page.waitForFunction(() => window.harness.snapshot().audioProcessorEnabled === true);
    const during = await monitor;

    const quietest = Math.min(...during);
    expect(
      quietest,
      `level while attaching, ${during.length} windows: ${during.map((r) => r.toFixed(3)).join(' ')}`,
    ).toBeGreaterThan(AUDIO.CONTINUITY_RMS_MIN);

    const processed = await measureLevel(page);
    const delta = decibels(processed.rms, baseline.rms);
    expect(
      Math.abs(delta),
      `rms ${baseline.rms.toFixed(4)} -> ${processed.rms.toFixed(4)} (${delta.toFixed(2)} dB)`,
    ).toBeLessThan(AUDIO.UNITY_TOLERANCE_DB);

    // A gain stage that shifted or distorted the tone would be broken even at the right level.
    expect(
      Math.abs(processed.dominantHz - AUDIO.TONE_HZ),
      `dominant frequency through the processor: ${Math.round(processed.dominantHz)} Hz`,
    ).toBeLessThan(AUDIO.TONE_HZ_TOLERANCE);

    // And the published track really is the processor's, not the mic showing through.
    const info = await page.evaluate(() => window.harness.snapshot().audio);
    expect(info?.processorName).toBe('gain-audio-processor');
    expect(info?.processedTrackId).not.toBeNull();
  });
});
