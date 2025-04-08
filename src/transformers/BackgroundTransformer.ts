import * as vision from '@mediapipe/tasks-vision';
import { dependencies } from '../../package.json';
import VideoTransformer from './VideoTransformer';
import { VideoTransformerInitOptions } from './types';

export type SegmenterOptions = Partial<vision.ImageSegmenterOptions['baseOptions']>;

export type BackgroundOptions = {
  blurRadius?: number;
  imagePath?: string;
  /** cannot be updated through the `update` method, needs a restart */
  segmenterOptions?: SegmenterOptions;
  /** cannot be updated through the `update` method, needs a restart */
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
};

const blurBackgroundTimes: number[] = [];
const drawVirtualBackgroundTimes: number[] = [];

export default class BackgroundProcessor extends VideoTransformer<BackgroundOptions> {
  static get isSupported() {
    return typeof OffscreenCanvas !== 'undefined';
  }

  imageSegmenter?: vision.ImageSegmenter;

  segmentationResults: vision.ImageSegmenterResult | undefined;

  backgroundImage: ImageBitmap | null = null;

  blurRadius?: number;

  options: BackgroundOptions;

  constructor(opts: BackgroundOptions) {
    super();
    this.options = opts;
    this.update(opts);
  }

  async init({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
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
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    // Skip loading the image here if update already loaded the image below
    if (this.options?.imagePath && !this.backgroundImage) {
      await this.loadBackground(this.options.imagePath).catch((err) =>
        console.error('Error while loading processor background image: ', err),
      );
    }
  }

  async destroy() {
    await super.destroy();
    await this.imageSegmenter?.close();
    this.backgroundImage = null;
  }

  async loadBackground(path: string) {
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.crossOrigin = 'Anonymous';
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = path;
    });
    const imageData = await createImageBitmap(img);
    this.backgroundImage = imageData;
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    try {
      if (!(frame instanceof VideoFrame)) {
        console.debug('empty frame detected, ignoring');
        return;
      }
      if (this.isDisabled) {
        controller.enqueue(frame);
        return;
      }
      if (!this.canvas) {
        throw TypeError('Canvas needs to be initialized first');
      }
      let startTimeMs = performance.now();
      this.imageSegmenter?.segmentForVideo(
        this.inputVideo!,
        startTimeMs,
        (result) => (this.segmentationResults = result),
      );

      if (this.blurRadius) {
        await this.blurBackground(frame);
      } else {
        await this.drawVirtualBackground(frame);
      }
      const newFrame = new VideoFrame(this.canvas, {
        timestamp: frame.timestamp || Date.now(),
      });
      controller.enqueue(newFrame);
    } finally {
      frame?.close();
    }
  }

  async update(opts: BackgroundOptions) {
    this.options = opts;
    if (opts.blurRadius) {
      this.blurRadius = opts.blurRadius;
    } else if (opts.imagePath) {
      await this.loadBackground(opts.imagePath);
    }
  }

  async drawVirtualBackground(frame: VideoFrame) {
    const startTime = performance.now();
    if (!this.canvas || !this.ctx || !this.segmentationResults || !this.inputVideo) return;
    // this.ctx.save();
    // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.segmentationResults?.categoryMask && this.segmentationResults.categoryMask.width > 0) {
      this.ctx.globalCompositeOperation = 'copy';
      const bitmap = await maskToBitmap(
        this.segmentationResults.categoryMask,
        this.segmentationResults.categoryMask.width,
        this.segmentationResults.categoryMask.height,
      );
      this.ctx.drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.filter = 'none';
      this.ctx.globalCompositeOperation = 'source-in';
      if (this.backgroundImage) {
        this.ctx.drawImage(
          this.backgroundImage,
          0,
          0,
          this.backgroundImage.width,
          this.backgroundImage.height,
          0,
          0,
          this.canvas.width,
          this.canvas.height,
        );
      } else {
        this.ctx.fillStyle = '#00FF00';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }

      this.ctx.globalCompositeOperation = 'destination-over';
    }
    this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    const endTime = performance.now();
    drawVirtualBackgroundTimes.push(endTime - startTime);
    if (drawVirtualBackgroundTimes.length % 100 === 0) {
      console.log(
        `Draw virtual background time: ${
          drawVirtualBackgroundTimes.reduce((a, b) => a + b, 0) / drawVirtualBackgroundTimes.length
        }ms`,
      );
      drawVirtualBackgroundTimes.length = 0;
    }
  }

  async blurBackground(frame: VideoFrame) {
    const startTime = performance.now();
    if (
      !this.ctx ||
      !this.canvas ||
      !this.segmentationResults?.categoryMask?.canvas ||
      !this.inputVideo
    ) {
      return;
    }

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'copy';

    if (this.segmentationResults?.categoryMask && this.segmentationResults.categoryMask.width > 0) {
      const bitmap = await maskToBitmap(
        this.segmentationResults.categoryMask,
        this.segmentationResults.categoryMask.width,
        this.segmentationResults.categoryMask.height,
      );

      this.ctx.globalCompositeOperation = 'copy';
      this.ctx.drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.filter = 'none';
      this.ctx.globalCompositeOperation = 'source-out';
      this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.globalCompositeOperation = 'destination-over';
      this.ctx.filter = `blur(${this.blurRadius}px)`;
      this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }
    const endTime = performance.now();
    blurBackgroundTimes.push(endTime - startTime);
    if (blurBackgroundTimes.length % 100 === 0) {
      console.log(
        `Blur background time: ${
          blurBackgroundTimes.reduce((a, b) => a + b, 0) / blurBackgroundTimes.length
        }ms`,
      );
      blurBackgroundTimes.length = 0;
    }
  }
}

function maskToBitmap(
  mask: vision.MPMask,
  videoWidth: number,
  videoHeight: number,
): Promise<ImageBitmap> {
  const dataArray: Uint8ClampedArray = new Uint8ClampedArray(videoWidth * videoHeight * 4);
  const result = mask.getAsUint8Array();
  for (let i = 0; i < result.length; i += 1) {
    dataArray[i * 4] = result[i];
    dataArray[i * 4 + 1] = result[i];
    dataArray[i * 4 + 2] = result[i];
    dataArray[i * 4 + 3] = result[i];
  }
  const dataNew = new ImageData(dataArray, videoWidth, videoHeight);

  return createImageBitmap(dataNew);
}
