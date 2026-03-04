import type { Track, Room } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';

/** Gain is clamped to this range to avoid accidental silence or extreme amplification. */
const MIN_GAIN = 0;
const MAX_GAIN = 10;

export interface GainAudioProcessorOptions {
  /**
   * Initial gain value. Defaults to 1.0 (unity gain).
   * Clamped to [0, 10]. Values outside this range are clamped.
   * - 0.0 = silence
   * - 1.0 = no change
   * - > 1.0 = amplify
   */
  gainValue?: number;
}

/**
 * A minimal audio track processor that applies a Web Audio GainNode to the audio pipeline.
 *
 * Serves as both a ready-to-use gain control and a reference implementation for building
 * custom audio processors using the TrackProcessor interface.
 *
 * @example
 * ```ts
 * const processor = new GainAudioProcessor({ gainValue: 1.5 });
 * await audioTrack.setProcessor(processor);
 *
 * // Update gain on the fly
 * processor.setGain(0.5);
 *
 * // Remove the processor
 * await audioTrack.stopProcessor();
 * ```
 */
export class GainAudioProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = 'gain-audio-processor';

  processedTrack?: MediaStreamTrack;

  private gainValue: number;

  /**
   * Whether the current environment supports GainAudioProcessor (Web Audio API).
   * Use this for consistency with video processors before attaching the processor.
   */
  static get isSupported(): boolean {
    return (
      typeof AudioContext !== 'undefined' &&
      typeof GainNode !== 'undefined' &&
      typeof MediaStreamAudioSourceNode !== 'undefined' &&
      typeof MediaStreamAudioDestinationNode !== 'undefined'
    );
  }

  private sourceNode?: MediaStreamAudioSourceNode;

  private gainNode?: GainNode;

  private destinationNode?: MediaStreamAudioDestinationNode;

  constructor(options: GainAudioProcessorOptions = {}) {
    const raw = options.gainValue ?? 1.0;
    this.gainValue = Math.max(MIN_GAIN, Math.min(MAX_GAIN, raw));
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track, audioContext } = opts;

    // Create source from the raw microphone track
    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));

    // Create gain node
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = this.gainValue;

    // Create destination
    this.destinationNode = audioContext.createMediaStreamDestination();

    // Wire up: source → gain → destination
    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.destinationNode);

    // Expose the processed track for the SDK
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    // Tear down old graph and rebuild with the new track
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    this.sourceNode?.disconnect();
    this.gainNode?.disconnect();
    this.destinationNode?.disconnect();
    this.processedTrack?.stop();
    this.sourceNode = undefined;
    this.gainNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
  }

  /**
   * Update the gain value. Can be called while the processor is active.
   * Value is clamped to [0, 10].
   * @param value - Gain multiplier (0.0 = silence, 1.0 = unity, > 1.0 = amplify)
   */
  setGain(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.gainValue = Math.max(MIN_GAIN, Math.min(MAX_GAIN, value));
    if (this.gainNode) {
      this.gainNode.gain.value = this.gainValue;
    }
  }

  /**
   * Get the current gain value.
   */
  getGain(): number {
    return this.gainValue;
  }

  // Optional lifecycle hooks — included for completeness as a reference implementation
  async onPublish(room: Room): Promise<void> {
    // No-op: override in subclasses if you need room context
  }

  async onUnpublish(): Promise<void> {
    // No-op: override in subclasses for room lifecycle cleanup
  }
}
