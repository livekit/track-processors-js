import { expect, test } from '../fixtures';
import { decibels, measureLevel, monitorLevel, startMic } from '../helpers';
import { AUDIO } from '../thresholds';

/**
 * J1, J2 — GainAudioProcessor, added in #124.
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

  test('J2: gain values map to measured level', async ({ app }) => {
    const { page } = app;
    await app.goto();

    await startMic(page);
    await page.click('[data-testid="attach-gain"]');
    await page.waitForFunction(() => window.harness.snapshot().audioProcessorEnabled === true);

    const slider = page.locator('[data-testid="gain"]');
    const levels = new Map<number, { rms: number; peak: number }>();
    for (const gain of [0, 0.5, 1.0, 2.0]) {
      await slider.fill(String(gain));
      await page.waitForFunction((g) => window.harness.snapshot().gain === g, gain);
      levels.set(gain, await measureLevel(page));
    }

    const report = [...levels]
      .map(([gain, level]) => `${gain}x -> rms ${level.rms.toFixed(4)}`)
      .join(', ');

    // Gain 0 is the built-in negative control: if the slider were not reaching the GainNode at
    // all, this is the assertion that would say so.
    expect(levels.get(0)!.rms, `silence at gain 0 (${report})`).toBeLessThan(AUDIO.SILENCE_RMS_MAX);

    const unity = levels.get(1.0)!.rms;
    expect(unity, `unity level (${report})`).toBeGreaterThan(AUDIO.TONE_RMS_MIN);

    for (const [gain, expected] of [
      [0.5, AUDIO.HALF_GAIN_DB],
      [2.0, AUDIO.DOUBLE_GAIN_DB],
    ] as const) {
      const measured = decibels(levels.get(gain)!.rms, unity);
      expect(
        Math.abs(measured - expected),
        `gain ${gain}x measured ${measured.toFixed(2)} dB against ${expected} expected (${report})`,
      ).toBeLessThan(AUDIO.GAIN_TOLERANCE_DB);
    }

    // The source tone peaks at 0.25, so doubling it has headroom. Worth asserting rather than
    // assuming: a clipped 2x would still measure close to +6 dB on rms alone.
    expect(levels.get(2.0)!.peak, `peak at gain 2x (${report})`).toBeLessThan(AUDIO.PEAK_MAX);
  });
});
