import { noteTrackCreated } from './counters';
import type { FakeMicControl } from './types';

/**
 * A synthetic microphone: a sine oscillator at a known frequency and amplitude, so audio
 * assertions compare measured level against an exact expected value rather than against
 * whatever a real room sounds like.
 *
 * WebKit and iOS start an AudioContext suspended until a user gesture. A silent `level()` is
 * usually that, not a gain bug — `assertRunning()` says so explicitly.
 */

const DEFAULT_FREQUENCY = 440;
const DEFAULT_AMPLITUDE = 0.25;

export class FakeMic implements FakeMicControl {
  readonly installed = true;

  private ctx?: AudioContext;

  private oscillator?: OscillatorNode;

  private amplitudeNode?: GainNode;

  private destination?: MediaStreamAudioDestinationNode;

  private frequency = DEFAULT_FREQUENCY;

  private amplitude = DEFAULT_AMPLITUDE;

  /** Set by the harness so `level()` measures whatever is currently being published. */
  private measurementSource: () => MediaStreamTrack | undefined = () => undefined;

  setMeasurementSource(fn: () => MediaStreamTrack | undefined) {
    this.measurementSource = fn;
  }

  private ensureGraph(): MediaStreamAudioDestinationNode {
    if (this.destination) return this.destination;

    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const amplitudeNode = ctx.createGain();
    const destination = ctx.createMediaStreamDestination();

    oscillator.type = 'sine';
    oscillator.frequency.value = this.frequency;
    amplitudeNode.gain.value = this.amplitude;

    oscillator.connect(amplitudeNode);
    amplitudeNode.connect(destination);
    oscillator.start();

    this.ctx = ctx;
    this.oscillator = oscillator;
    this.amplitudeNode = amplitudeNode;
    this.destination = destination;

    void ctx.resume().catch(() => undefined);
    return destination;
  }

  createTrack(): MediaStreamTrack {
    const destination = this.ensureGraph();
    const track = destination.stream.getAudioTracks()[0].clone();
    Object.defineProperty(track, 'label', { value: 'Fake Microphone (tone)', configurable: true });
    Object.defineProperty(track, 'getSettings', {
      value: (): MediaTrackSettings => ({
        deviceId: 'fake-mic',
        groupId: 'fake-audio',
        sampleRate: this.ctx?.sampleRate,
        channelCount: 1,
      }),
      configurable: true,
      writable: true,
    });
    noteTrackCreated(track);
    return track;
  }

  setFrequency(hz: number) {
    this.frequency = hz;
    if (this.oscillator) this.oscillator.frequency.value = hz;
  }

  setAmplitude(a: number) {
    this.amplitude = a;
    if (this.amplitudeNode) this.amplitudeNode.gain.value = a;
  }

  /** Throws with a clear message when the context is suspended by autoplay policy. */
  async assertRunning() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    if (this.ctx.state !== 'running') {
      throw new Error(
        `Fake mic AudioContext is "${this.ctx.state}". WebKit and iOS suspend until a user gesture — ` +
          'click any control before measuring audio.',
      );
    }
  }

  async level(windowMs = 300) {
    const track = this.measurementSource();
    if (!track || track.readyState !== 'live') {
      return { rms: 0, peak: 0, dominantHz: 0 };
    }

    const ctx = new AudioContext();
    try {
      await ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const time = new Float32Array(analyser.fftSize);
      const freq = new Float32Array(analyser.frequencyBinCount);

      let sumSquares = 0;
      let samples = 0;
      let peak = 0;
      // Per-bin maximum rather than a running sum: getFloatFrequencyData reports dB, and a
      // single silent read (common on the first tick, before the graph has spun up) writes
      // -Infinity, which would poison that bin's sum for the rest of the window.
      const freqPeaks = new Float32Array(analyser.frequencyBinCount).fill(-Infinity);

      const deadline = performance.now() + windowMs;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(time);
        for (let i = 0; i < time.length; i += 1) {
          const v = time[i];
          sumSquares += v * v;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        samples += time.length;

        analyser.getFloatFrequencyData(freq);
        for (let i = 0; i < freq.length; i += 1) {
          if (Number.isFinite(freq[i]) && freq[i] > freqPeaks[i]) freqPeaks[i] = freq[i];
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // Skip the DC and near-DC bins: getFloatFrequencyData returns dB, and bin 0 carries any
      // offset, which otherwise wins the argmax and reports 0 Hz for a perfectly good tone.
      const firstBin = Math.max(1, Math.ceil((40 * analyser.fftSize) / ctx.sampleRate));
      let loudestBin = firstBin;
      for (let i = firstBin + 1; i < freqPeaks.length; i += 1) {
        if (freqPeaks[i] > freqPeaks[loudestBin]) loudestBin = i;
      }
      const dominantHz = Number.isFinite(freqPeaks[loudestBin])
        ? (loudestBin * ctx.sampleRate) / analyser.fftSize
        : 0;

      return {
        rms: samples ? Math.sqrt(sumSquares / samples) : 0,
        peak,
        dominantHz,
      };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }
}

export const fakeMic = new FakeMic();
