import * as vision from '@mediapipe/tasks-vision';
import { getLogger, LoggerNames } from '../logger';
import { dependencies } from '../../package.json';
import VideoTransformer from './VideoTransformer';
import { VideoTransformerInitOptions } from './types';

export type SegmenterOptions = Partial<vision.ImageSegmenterOptions['baseOptions']>;

export interface FrameProcessingStats {
  processingTimeMs: number;
  segmentationTimeMs: number;
  filterTimeMs: number;
}

export type BackgroundOptions = {
  blurRadius?: number;
  imagePath?: string;
  backgroundDisabled?: boolean;
  /** cannot be updated through the `update` method, needs a restart */
  segmenterOptions?: SegmenterOptions;
  /** cannot be updated through the `update` method, needs a restart */
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  /** called when a new frame is processed */
  onFrameProcessed?: (stats: FrameProcessingStats) => void;
};

export default class BackgroundProcessor extends VideoTransformer<BackgroundOptions> {
  static get isSupported() {
    return (
      typeof OffscreenCanvas !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof createImageBitmap !== 'undefined' &&
      !!document.createElement('canvas').getContext('webgl2')
    );
  }

  imageSegmenter?: vision.ImageSegmenter;

  segmentationResults: vision.ImageSegmenterResult | undefined;

  backgroundImageAndPath: { imageData: ImageBitmap, path: string } | null = null;

  options: BackgroundOptions;

  segmentationTimeMs: number = 0;

  isFirstFrame = true;

  private log = getLogger(LoggerNames.ProcessorWrapper);

  constructor(opts: BackgroundOptions) {
    super();
    this.options = opts;
    this.update(opts);
  }

  async init({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
    // Initialize WebGL with appropriate options based on our current state

    await super.init({ outputCanvas, inputElement: inputVideo });

    const fileSet = await vision.FilesetResolver.forVisionTasks(
      this.options.assetPaths?.tasksVisionFileSet ??
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${dependencies['@mediapipe/tasks-vision']}/wasm`,
    );

    this.imageSegmenter = await vision.ImageSegmenter.createFromOptions(fileSet, {
      baseOptions: {
        modelAssetPath:
          this.options.assetPaths?.modelAssetPath ??
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
        ...this.options.segmenterOptions,
      },
      canvas: this.canvas,
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    // Skip loading the image here if update already loaded the image below
    if (this.options?.imagePath) {
      await this.loadAndSetBackground(this.options.imagePath).catch((err) =>
        this.log.error('Error while loading processor background image: ', err),
      );
    }
    if (typeof this.options.blurRadius === 'number') {
      this.gl?.setBlurRadius(this.options.blurRadius);
    }
    this.gl?.setBackgroundDisabled(this.options.backgroundDisabled ?? false);
  }

  async destroy() {
    await super.destroy();
    await this.imageSegmenter?.close();
    this.backgroundImageAndPath = null;
    this.isFirstFrame = true;
  }

  async loadAndSetBackground(path: string) {
    if (!this.backgroundImageAndPath || this.backgroundImageAndPath?.path !== path) {
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = path;
      });
      const imageData = await createImageBitmap(img);
      this.backgroundImageAndPath = { imageData, path };
    }
    this.gl?.setBackgroundImage(this.backgroundImageAndPath.imageData);
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    let enqueuedFrame = false;
    try {
      if (!(frame instanceof VideoFrame) || frame.codedWidth === 0 || frame.codedHeight === 0) {
        this.log.debug('empty frame detected, ignoring');
        return;
      }

      let skipProcessingFrame = this.isDisabled ?? this.options.backgroundDisabled ?? false;
      if (typeof this.options.blurRadius !== 'number' && typeof this.options.imagePath !== 'string') {
        skipProcessingFrame = true;
      }

      if (skipProcessingFrame) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        return;
      }

      const frameTimeMs = Date.now();
      if (!this.canvas) {
        throw TypeError('Canvas needs to be initialized first');
      }
      this.canvas.width = frame.displayWidth;
      this.canvas.height = frame.displayHeight;

      // Render a copy of the first frame is rendered to the screen as soon as possible to act
      // as a less jarring initial state than a solid color while the synchronous work below
      // (segmentation + frame rendering) occurs.
      //
      // Ideally, these sync tasks could be offloaded to a webworker, but this is challenging
      // given WebGLTextures cannot be easily passed in a `postMessage`.
      if (this.isFirstFrame) {
        controller.enqueue(frame.clone());

        // Wait for the frame that was enqueued above to render before doing the sync work
        // below - otherwise, the sync work will take over the event loop and prevent the render
        // from occurring
        if (this.inputVideo) {
          await new Promise((resolve) => {
            this.inputVideo!.requestVideoFrameCallback((_now, e) => {
              const durationUntilFrameRenderedInMs = e.expectedDisplayTime - e.presentationTime;
              setTimeout(resolve, durationUntilFrameRenderedInMs);
            });
          });
        }
      }
      this.isFirstFrame = false;

      const filterStartTimeMs = performance.now();

      const segmentationPromise = new Promise<void>((resolve, reject) => {
        try {
          let segmentationStartTimeMs = performance.now();
          // NOTE: this.imageSegmenter?.segmentForVideo is synchronous, and blocks the event loop
          // for tens to ~100 ms! The promise wrapper is just used to flatten out the call hierarchy.
          this.imageSegmenter?.segmentForVideo(frame, segmentationStartTimeMs, (result) => {
            this.segmentationTimeMs = performance.now() - segmentationStartTimeMs;
            this.segmentationResults = result;
            this.updateMask(result.categoryMask);
            result.close();
            resolve();
          });
        } catch (e) {
          reject(e);
        }
      });

      // NOTE: `this.drawFrame` is synchronous, and could take tens of ms to run!
      this.drawFrame(frame);
      if (this.canvas && this.canvas.width > 0 && this.canvas.height > 0) {
        const newFrame = new VideoFrame(this.canvas, {
          timestamp: frame.timestamp || frameTimeMs,
        });
        controller.enqueue(newFrame);
        const filterTimeMs = performance.now() - filterStartTimeMs;
        const stats: FrameProcessingStats = {
          processingTimeMs: this.segmentationTimeMs + filterTimeMs,
          segmentationTimeMs: this.segmentationTimeMs,
          filterTimeMs,
        };
        this.options.onFrameProcessed?.(stats);
      } else {
        controller.enqueue(frame);
      }
      await segmentationPromise;
    } catch (e) {
      this.log.error('Error while processing frame: ', e);
    } finally {
      if (!enqueuedFrame) {
        frame.close();
      }
    }
  }

  async update(opts: BackgroundOptions) {
    this.options = { ...this.options, ...opts };

    this.gl?.setBlurRadius(opts.blurRadius ?? null);
    if (opts.imagePath) {
      await this.loadAndSetBackground(opts.imagePath);
    } else {
      this.gl?.setBackgroundImage(null);
    }
    this.gl?.setBackgroundDisabled(opts.backgroundDisabled ?? false);
  }

  private async drawFrame(frame: VideoFrame) {
    if (!this.gl) return;
    this.gl?.renderFrame(frame);
  }

  private async updateMask(mask: vision.MPMask | undefined) {
    if (!mask) return;
    this.gl?.updateMask(mask.getAsWebGLTexture());
  }
}
