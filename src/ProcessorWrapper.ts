import type { ProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { TrackTransformer } from './transformers';
import { createCanvas, waitForTrackResolution } from './utils';

export interface ProcessorWrapperOptions {
  /**
   * Maximum frame rate for fallback canvas.captureStream implementation
   * Default: 30
   */
  maxFps?: number;
}

export default class ProcessorWrapper<TransformerOptions extends Record<string, unknown>>
  implements TrackProcessor<Track.Kind>
{
  /**
   * Determines if the Processor is supported on the current browser
   */
  static get isSupported() {
    // Check for primary implementation support
    const hasStreamProcessor =
      typeof MediaStreamTrackGenerator !== 'undefined' &&
      typeof MediaStreamTrackProcessor !== 'undefined';

    // Check for fallback implementation support
    const hasFallbackSupport =
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      'captureStream' in HTMLCanvasElement.prototype;

    // We can work if either implementation is available
    return hasStreamProcessor || hasFallbackSupport;
  }

  /**
   * Determines if modern browser APIs are supported, which yield better performance
   */
  static get hasModernApiSupport() {
    return (
      typeof MediaStreamTrackGenerator !== 'undefined' &&
      typeof MediaStreamTrackProcessor !== 'undefined'
    );
  }

  name: string;

  source?: MediaStreamVideoTrack;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas | HTMLCanvasElement;

  displayCanvas?: HTMLCanvasElement;

  sourceDummy?: HTMLMediaElement;

  processedTrack?: MediaStreamTrack;

  transformer: TrackTransformer<TransformerOptions>;

  // For tracking whether we're using the stream API fallback
  private useStreamFallback = false;

  // For fallback rendering with canvas.captureStream()
  private capturedStream?: MediaStream;

  private animationFrameId?: number;

  private renderContext?: CanvasRenderingContext2D;

  private frameCallback?: (frame: VideoFrame) => void;

  private processingEnabled = false;

  // FPS control for fallback implementation
  private maxFps: number;

  constructor(
    transformer: TrackTransformer<TransformerOptions>,
    name: string,
    options: ProcessorWrapperOptions = {},
  ) {
    this.name = name;
    this.transformer = transformer;
    this.maxFps = options.maxFps ?? 30;
  }

  private async setup(opts: ProcessorOptions<Track.Kind>) {
    this.source = opts.track as MediaStreamVideoTrack;

    const { width, height } = await waitForTrackResolution(this.source);
    this.sourceDummy = opts.element;

    if (!(this.sourceDummy instanceof HTMLVideoElement)) {
      throw TypeError('Currently only video transformers are supported');
    }

    if (this.sourceDummy instanceof HTMLVideoElement) {
      this.sourceDummy.height = height ?? 300;
      this.sourceDummy.width = width ?? 300;
    }

    this.useStreamFallback = !ProcessorWrapper.hasModernApiSupport;

    if (this.useStreamFallback) {
      // Create a visible canvas for the fallback implementation or use an existing one if provided
      const existingCanvas = document.querySelector(
        'canvas[data-livekit-processor="' + this.name + '"]',
      ) as HTMLCanvasElement;

      if (existingCanvas) {
        this.displayCanvas = existingCanvas;
        this.displayCanvas.width = width ?? 300;
        this.displayCanvas.height = height ?? 300;
      } else {
        this.displayCanvas = document.createElement('canvas');
        this.displayCanvas.width = width ?? 300;
        this.displayCanvas.height = height ?? 300;
        this.displayCanvas.style.display = 'none';
        this.displayCanvas.dataset.livekitProcessor = this.name;
        document.body.appendChild(this.displayCanvas);
      }

      this.renderContext = this.displayCanvas.getContext('2d')!;
      this.capturedStream = this.displayCanvas.captureStream();
      this.canvas = createCanvas(width ?? 300, height ?? 300);
    } else {
      // Use MediaStreamTrackProcessor API
      this.processor = new MediaStreamTrackProcessor({ track: this.source });
      this.trackGenerator = new MediaStreamTrackGenerator({
        kind: 'video',
        signalTarget: this.source,
      });
      this.canvas = createCanvas(width ?? 300, height ?? 300);
    }
  }

  async init(opts: ProcessorOptions<Track.Kind>): Promise<void> {
    await this.setup(opts);

    if (!this.canvas) {
      throw new TypeError('Expected canvas to be defined after setup');
    }

    await this.transformer.init({
      outputCanvas: this.canvas,
      inputElement: this.sourceDummy as HTMLVideoElement,
    });

    if (this.useStreamFallback) {
      this.initFallbackPath();
    } else {
      this.initStreamProcessorPath();
    }
  }

  private initStreamProcessorPath() {
    if (!this.processor || !this.trackGenerator) {
      throw new TypeError(
        'Expected processor and trackGenerator to be defined for stream processor path',
      );
    }

    const readableStream = this.processor.readable;
    const pipedStream = readableStream.pipeThrough(this.transformer!.transformer!);

    pipedStream
      .pipeTo(this.trackGenerator.writable)
      .catch((e) => console.error('error when trying to pipe', e))
      .finally(() => this.destroy());

    this.processedTrack = this.trackGenerator as MediaStreamVideoTrack;
  }

  private initFallbackPath() {
    if (!this.capturedStream || !this.source || !this.canvas || !this.renderContext) {
      throw new TypeError('Missing required components for fallback implementation');
    }

    this.processedTrack = this.capturedStream.getVideoTracks()[0];
    this.processingEnabled = true;

    // Set up the frame callback for the transformer
    this.frameCallback = (frame: VideoFrame) => {
      if (!this.processingEnabled || !frame) {
        frame.close();
        return;
      }

      const controller = {
        enqueue: (processedFrame: VideoFrame) => {
          if (this.renderContext && this.displayCanvas) {
            // Draw the processed frame to the visible canvas
            this.renderContext.drawImage(
              processedFrame,
              0,
              0,
              this.displayCanvas.width,
              this.displayCanvas.height,
            );
            processedFrame.close();
          }
        },
      } as TransformStreamDefaultController<VideoFrame>;

      try {
        // Pass the frame through our transformer
        // @ts-ignore - The controller expects both VideoFrame & AudioData but we're only using VideoFrame
        this.transformer.transform(frame, controller);
      } catch (e) {
        console.error('Error in transform:', e);
        frame.close();
      }
    };

    // Start the rendering loop
    this.startRenderLoop();
  }

  private startRenderLoop() {
    if (!this.sourceDummy || !(this.sourceDummy instanceof HTMLVideoElement)) {
      return;
    }

    // Store the last processed timestamp to avoid duplicate processing
    let lastVideoTimestamp = -1;
    let lastFrameTime = 0;
    const videoElement = this.sourceDummy as HTMLVideoElement;
    const minFrameInterval = 1000 / this.maxFps; // Minimum time between frames

    // Estimate the video's native frame rate
    let estimatedVideoFps = this.maxFps;
    let frameTimeHistory: number[] = [];
    let lastVideoTimeChange = 0;
    let frameCount = 0;
    let lastFpsLog = 0;

    const renderLoop = () => {
      if (
        !this.processingEnabled ||
        !this.sourceDummy ||
        !(this.sourceDummy instanceof HTMLVideoElement)
      ) {
        return;
      }

      if (this.sourceDummy.paused) {
        console.warn('Video is paused, trying to play');
        this.sourceDummy.play();
        return;
      }

      // Only process a new frame if the video has actually updated
      const videoTime = videoElement.currentTime;
      const now = performance.now();
      const timeSinceLastFrame = now - lastFrameTime;

      // Detect if video has a new frame
      const hasNewFrame = videoTime !== lastVideoTimestamp;

      // Update frame rate estimation if we have a new frame
      if (hasNewFrame) {
        if (lastVideoTimeChange > 0) {
          const timeBetweenFrames = now - lastVideoTimeChange;
          frameTimeHistory.push(timeBetweenFrames);

          // Keep a rolling window of the last 10 frame times
          if (frameTimeHistory.length > 10) {
            frameTimeHistory.shift();
          }

          // Calculate average frame interval
          if (frameTimeHistory.length > 2) {
            const avgFrameTime =
              frameTimeHistory.reduce((sum, time) => sum + time, 0) / frameTimeHistory.length;
            estimatedVideoFps = 1000 / avgFrameTime;

            // Log estimated FPS every 5 seconds in development environments
            // Use a simpler check that works in browsers without process.env
            const isDevelopment =
              (typeof window !== 'undefined' && window.location.hostname === 'localhost') ||
              window.location.hostname === '127.0.0.1';

            if (isDevelopment && now - lastFpsLog > 5000) {
              console.debug(
                `[${this.name}] Estimated video FPS: ${estimatedVideoFps.toFixed(
                  1,
                )}, Processing at: ${(frameCount / 5).toFixed(1)} FPS`,
              );
              frameCount = 0;
              lastFpsLog = now;
            }
          }
        }
        lastVideoTimeChange = now;
      }

      // Determine if we should process this frame
      // We'll process if:
      // 1. The video has a new frame
      // 2. Enough time has passed since last frame (respecting maxFps)
      const timeThresholdMet = timeSinceLastFrame >= minFrameInterval;

      if (hasNewFrame && timeThresholdMet) {
        lastVideoTimestamp = videoTime;
        lastFrameTime = now;
        frameCount++;

        try {
          // Create a VideoFrame from the video element
          if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const frame = new VideoFrame(videoElement);
            if (this.frameCallback) {
              this.frameCallback(frame);
            } else {
              frame.close();
            }
          }
        } catch (e) {
          console.error('Error in render loop:', e);
        }
      }
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    this.animationFrameId = requestAnimationFrame(renderLoop);
  }

  async restart(opts: ProcessorOptions<Track.Kind>): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async restartTransformer(...options: Parameters<(typeof this.transformer)['restart']>) {
    // @ts-ignore unclear why the restart method only accepts VideoTransformerInitOptions instead of either those or AudioTransformerInitOptions
    await this.transformer.restart(options[0]);
  }

  async updateTransformerOptions(...options: Parameters<(typeof this.transformer)['update']>) {
    await this.transformer.update(options[0]);
  }

  async destroy() {
    if (this.useStreamFallback) {
      this.processingEnabled = false;
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = undefined;
      }
      if (this.displayCanvas && this.displayCanvas.parentNode) {
        this.displayCanvas.parentNode.removeChild(this.displayCanvas);
      }
      this.capturedStream?.getTracks().forEach((track) => track.stop());
    } else {
      await this.processor?.writableControl?.close();
      this.trackGenerator?.stop();
    }
    await this.transformer.destroy();
  }
}
