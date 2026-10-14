import {
  type AudioCaptureOptions,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type VideoCaptureOptions,
  createLocalAudioTrack,
  createLocalVideoTrack,
} from 'livekit-client';
import type { BackgroundProcessorWrapper, GainAudioProcessor } from '../../src';
import { createBackgroundProcessor, createGainProcessor, processorSupport } from './processors';
import type {
  Config,
  MediaControl,
  PipelinePath,
  ProcessorMode,
  ProcessorSupport,
  ReportedMode,
  StartVideoOptions,
  TrackInfo,
} from './types';

/**
 * Standalone track lifecycle — no Room required.
 *
 * `LocalTrack.setProcessor` needs no room: it creates its own <video>, attaches the raw
 * MediaStreamTrack, calls `processor.init()`, and only touches `sender?.replaceTrack()`,
 * which no-ops while unpublished. `VideoCaptureOptions.processor` is honoured inside
 * `createLocalTracks`, so capture-time attachment works here too.
 */
export class Media implements MediaControl {
  videoTrack?: LocalVideoTrack;

  audioTrack?: LocalAudioTrack;

  /**
   * Undefined when the environment cannot support one — see `support`.
   *
   * Optional rather than built-and-hoped-for: #10 and #38 are both an app constructing a
   * processor in an environment that cannot have one, and the throw reaching the user.
   */
  processor?: BackgroundProcessorWrapper;

  readonly support: ProcessorSupport;

  gainProcessor: GainAudioProcessor;

  videoProcessorEnabled = false;

  audioProcessorEnabled = false;

  /** `enabled === false` on the source track. See setVideoMuted. */
  videoMuted = false;

  gain = 1.0;

  /** Created here because a Room normally supplies it; see startAudio. */
  private audioContext?: AudioContext;

  private listeners = new Set<() => void>();

  constructor(
    private config: Config,
    onFrameProcessed: Parameters<typeof createBackgroundProcessor>[1],
  ) {
    this.support = processorSupport();
    // Ask before building. Constructing unconditionally here is exactly what turns a missing
    // primitive into a blank page (#10), because this runs during boot.
    if (this.support.supported) {
      this.processor = createBackgroundProcessor(config, onFrameProcessed);
    }
    this.gainProcessor = createGainProcessor(this.gain);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------------------ video

  async startVideo(opts: StartVideoOptions = {}): Promise<TrackInfo> {
    await this.stopVideo();

    const atCapture = opts.processorAtCapture ?? this.config.attach === 'capture';
    const captureOptions: VideoCaptureOptions = {
      deviceId: opts.deviceId,
      resolution:
        opts.width && opts.height
          ? { width: opts.width, height: opts.height }
          : undefined,
      ...(atCapture ? { processor: this.requireProcessor() } : {}),
    };

    this.videoTrack = await createLocalVideoTrack(captureOptions);
    this.videoProcessorEnabled = atCapture;
    this.videoMuted = false;
    this.emit();
    return this.info('video')!;
  }

  async stopVideo() {
    if (!this.videoTrack) return;
    if (this.videoProcessorEnabled) {
      await this.videoTrack.stopProcessor().catch(() => undefined);
    }
    this.videoTrack.stop();
    this.videoTrack = undefined;
    this.videoProcessorEnabled = false;
    this.videoMuted = false;
    this.emit();
  }

  async restartVideo(opts: { deviceId?: string; width?: number; height?: number } = {}) {
    if (!this.videoTrack) throw new Error('No video track. Call startVideo first.');
    await this.videoTrack.restartTrack({
      deviceId: opts.deviceId,
      resolution: opts.width && opts.height ? { width: opts.width, height: opts.height } : undefined,
    });
    this.emit();
    return this.info('video')!;
  }

  async setVideoProcessorEnabled(enabled: boolean): Promise<TrackInfo | null> {
    if (!this.videoTrack) throw new Error('No video track. Call startVideo first.');
    if (enabled === this.videoProcessorEnabled) return this.info('video');

    if (enabled) {
      await this.videoTrack.setProcessor(this.requireProcessor());
    } else {
      await this.videoTrack.stopProcessor();
    }
    this.videoProcessorEnabled = enabled;
    this.emit();
    return this.info('video');
  }

  async switchMode(mode: ProcessorMode): Promise<TrackInfo | null> {
    switch (mode) {
      case 'background-blur':
        await this.requireProcessor().switchTo({ mode: 'background-blur', blurRadius: this.config.blurRadius });
        break;
      case 'virtual-background':
        await this.requireProcessor().switchTo({ mode: 'virtual-background', imagePath: this.config.backgroundImage });
        break;
      case 'disabled':
        await this.requireProcessor().switchTo({ mode: 'disabled' });
        break;
    }
    if (!this.videoProcessorEnabled) await this.setVideoProcessorEnabled(true);
    this.emit();
    return this.info('video');
  }

  async setBackgroundImage(url: string): Promise<TrackInfo | null> {
    this.config = { ...this.config, backgroundImage: url };
    await this.requireProcessor().switchTo({ mode: 'virtual-background', imagePath: url });
    if (!this.videoProcessorEnabled) await this.setVideoProcessorEnabled(true);
    this.emit();
    return this.info('video');
  }

  /**
   * Mute or unmute the camera, as `enabled = false` on the source MediaStreamTrack.
   *
   * Deliberately not `LocalVideoTrack.mute()`: for a camera source that stops the underlying
   * track outright so the capture indicator goes out, which is `stopVideo()` by another name
   * and rebuilds the whole pipeline on the way back. The mute an application actually performs
   * on a published track leaves the track live and the processor attached, still pulling
   * frames — only black ones. That is the path #41 broke, so that is the path to drive.
   */
  async setVideoMuted(muted: boolean): Promise<TrackInfo | null> {
    if (!this.videoTrack) throw new Error('No video track. Call startVideo first.');
    this.videoTrack.mediaStreamTrack.enabled = !muted;
    this.videoMuted = muted;
    this.emit();
    return this.info('video');
  }

  async setBlurRadius(radius: number): Promise<TrackInfo | null> {
    this.config = { ...this.config, blurRadius: radius };
    await this.requireProcessor().switchTo({ mode: 'background-blur', blurRadius: radius });
    if (!this.videoProcessorEnabled) await this.setVideoProcessorEnabled(true);
    this.emit();
    return this.info('video');
  }

  // ------------------------------------------------------------------ audio

  async startAudio(opts: { gain?: number } = {}): Promise<TrackInfo> {
    await this.stopAudio();

    const captureOptions: AudioCaptureOptions = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    this.audioTrack = await createLocalAudioTrack(captureOptions);

    // A Room injects the AudioContext that setProcessor hands to the processor. On a
    // standalone track it is undefined, and GainAudioProcessor.init would throw on
    // createMediaStreamSource. Supply one here.
    this.audioContext ??= new AudioContext();
    await this.audioContext.resume().catch(() => undefined);
    this.audioTrack.setAudioContext(this.audioContext);

    if (opts.gain !== undefined) this.setGain(opts.gain);
    this.emit();
    return this.info('audio')!;
  }

  async stopAudio() {
    if (!this.audioTrack) return;
    if (this.audioProcessorEnabled) {
      await this.audioTrack.stopProcessor().catch(() => undefined);
    }
    this.audioTrack.stop();
    this.audioTrack = undefined;
    this.audioProcessorEnabled = false;
    this.emit();
  }

  async setAudioProcessorEnabled(enabled: boolean): Promise<TrackInfo | null> {
    if (!this.audioTrack) throw new Error('No audio track. Call startAudio first.');
    if (enabled === this.audioProcessorEnabled) return this.info('audio');

    if (enabled) {
      await this.audioTrack.setProcessor(this.gainProcessor);
    } else {
      await this.audioTrack.stopProcessor();
    }
    this.audioProcessorEnabled = enabled;
    this.emit();
    return this.info('audio');
  }

  setGain(value: number) {
    this.gain = value;
    this.gainProcessor.setGain(value);
    this.emit();
  }

  // ------------------------------------------------------------------ devices

  async switchDevice(kind: MediaDeviceKind, deviceId: string) {
    if (kind === 'videoinput' && this.videoTrack) {
      await this.videoTrack.restartTrack({ deviceId });
    } else if (kind === 'audioinput' && this.audioTrack) {
      await this.audioTrack.restartTrack({ deviceId });
    }
    this.emit();
  }

  // ------------------------------------------------------------------ introspection

  /** The track a remote peer would receive. Falls back to the raw track when unprocessed. */
  processedVideoTrack(): MediaStreamTrack | undefined {
    if (this.videoProcessorEnabled && this.processor?.processedTrack) {
      return this.processor.processedTrack;
    }
    return this.videoTrack?.mediaStreamTrack;
  }

  sourceVideoTrack(): MediaStreamTrack | undefined {
    return this.videoTrack?.mediaStreamTrack;
  }

  processedAudioTrack(): MediaStreamTrack | undefined {
    if (this.audioProcessorEnabled && this.gainProcessor.processedTrack) {
      return this.gainProcessor.processedTrack;
    }
    return this.audioTrack?.mediaStreamTrack;
  }

  /**
   * `displayCanvas` is only ever assigned on the canvas.captureStream fallback path
   * (src/ProcessorWrapper.ts:125-133), which makes it an exact discriminator without any
   * library change. If that ever becomes true on both paths, this silently lies.
   */
  private pipeline(): PipelinePath {
    if (!this.videoProcessorEnabled || !this.processor) return 'none';
    return this.processor.displayCanvas ? 'canvas-fallback' : 'insertable-streams';
  }

  reportedMode(): ReportedMode {
    return this.videoProcessorEnabled && this.processor ? this.processor.mode : 'off';
  }

  /**
   * The processor, or a throw naming what the browser is missing.
   *
   * Reached only by a caller that ignored `support`: every control that leads here is disabled
   * while `support.supported` is false.
   */
  private requireProcessor(): BackgroundProcessorWrapper {
    if (!this.processor) {
      throw new Error(this.support.reason ?? 'No background processor was constructed');
    }
    return this.processor;
  }

  info(kind: 'video' | 'audio' = 'video'): TrackInfo | null {
    if (kind === 'audio') {
      const source = this.audioTrack?.mediaStreamTrack;
      if (!source) return null;
      const processed = this.audioProcessorEnabled ? this.gainProcessor.processedTrack : null;
      return {
        id: source.id,
        kind: 'audio',
        label: source.label,
        readyState: source.readyState,
        settings: source.getSettings(),
        processorName: this.audioProcessorEnabled ? this.gainProcessor.name : null,
        processedTrackId: processed?.id ?? null,
        processedSettings: processed?.getSettings() ?? null,
        pipeline: 'none',
        mode: 'off',
      };
    }

    const source = this.videoTrack?.mediaStreamTrack;
    if (!source) return null;
    const processed = this.videoProcessorEnabled ? this.processor?.processedTrack ?? null : null;
    return {
      id: source.id,
      kind: 'video',
      label: source.label,
      readyState: source.readyState,
      settings: source.getSettings(),
      processorName: this.videoProcessorEnabled ? this.processor?.name ?? null : null,
      processedTrackId: processed?.id ?? null,
      processedSettings: processed?.getSettings() ?? null,
      pipeline: this.pipeline(),
      mode: this.reportedMode(),
    };
  }
}
