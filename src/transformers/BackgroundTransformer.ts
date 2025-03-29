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
    if (!this.canvas || !this.ctx || !this.segmentationResults || !this.inputVideo) return;
    // this.ctx.save();
    // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.segmentationResults?.categoryMask) {
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
    // this.ctx.restore();
  }

  async blurBackground(frame: VideoFrame) {
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
}

function maskToBitmap(
  mask: vision.MPMask,
  videoWidth: number,
  videoHeight: number,
): Promise<ImageBitmap> {
  const dataArray = new Uint8ClampedArray(videoWidth * videoHeight * 4);
  const result = mask.getAsUint8Array();

  const index = (x: number, y: number) => y * videoWidth + x;

  for (let y = 1; y < videoHeight - 1; y++) {
    for (let x = 1; x < videoWidth - 1; x++) {
      const i = index(x, y);
      let alpha = result[i];

      // **Effiziente Ausreißer-Erkennung**
      const neighbors = [
        result[index(x - 1, y)], result[index(x + 1, y)], // Links, Rechts
        result[index(x, y - 1)], result[index(x, y + 1)], // Oben, Unten
      ];
      const avg = (neighbors[0] + neighbors[1] + neighbors[2] + neighbors[3]) / 4;

      if (Math.abs(alpha - avg) > 50) {
        alpha = avg; // Pixel angleichen, falls es stark abweicht
      }

      // **Scharfer Rand mit leichtem Übergang**
      if (alpha < 120) {
        alpha = 0;
      } else if (alpha > 140) {
        alpha = 255;
      } else {
        alpha = ((alpha - 120) / 20) * 255;
      }

      const pixelOffset = i * 4;
      dataArray[pixelOffset] = 255;
      dataArray[pixelOffset + 1] = 255;
      dataArray[pixelOffset + 2] = 255;
      dataArray[pixelOffset + 3] = alpha;
    }
  }

  return createImageBitmap(new ImageData(dataArray, videoWidth, videoHeight));
}