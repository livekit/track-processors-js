import * as vision from '@mediapipe/tasks-vision';
import VideoTransformer from './VideoTransformer';
import { VideoTransformerInitOptions } from './types';

export type BackgroundOptions = {
  blurRadius?: number;
  imagePath?: string;
};

export default class BackgroundProcessor extends VideoTransformer {
  static get isSupported() {
    return typeof OffscreenCanvas !== 'undefined';
  }

  imageSegmenter?: vision.ImageSegmenter;

  segmentationResults: vision.ImageSegmenterResult | undefined;

  backgroundImage: ImageBitmap | null = null;

  blurRadius?: number;

  constructor(opts: BackgroundOptions) {
    super();
    if (opts.blurRadius) {
      this.blurRadius = opts.blurRadius;
    } else if (opts.imagePath) {
      this.loadBackground(opts.imagePath);
    }
  }

  async init({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
    super.init({ outputCanvas, inputElement: inputVideo });

    const fileSet = await vision.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm',
    );

    this.imageSegmenter = await vision.ImageSegmenter.createFromOptions(fileSet, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    // this.loadBackground(opts.backgroundUrl).catch((e) => console.error(e));
    this.sendFramesContinuouslyForSegmentation(this.inputVideo!);
  }

  async destroy() {
    await super.destroy();
    await this.imageSegmenter?.close();
    this.backgroundImage = null;
  }

  async sendFramesContinuouslyForSegmentation(videoEl: HTMLVideoElement) {
    if (!this.isDisabled) {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        let startTimeMs = performance.now();
        this.imageSegmenter?.segmentForVideo(
          videoEl,
          startTimeMs,
          (result) => (this.segmentationResults = result),
        );
      }
      videoEl.requestVideoFrameCallback(() => {
        this.sendFramesContinuouslyForSegmentation(videoEl);
      });
    }
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
    if (this.isDisabled) {
      controller.enqueue(frame);
      return;
    }
    if (!this.canvas) {
      throw TypeError('Canvas needs to be initialized first');
    }
    if (this.blurRadius) {
      await this.blurBackground(frame);
    } else {
      await this.drawVirtualBackground(frame);
    }
    const newFrame = new VideoFrame(this.canvas, {
      timestamp: frame.timestamp || Date.now(),
    });
    frame.close();
    controller.enqueue(newFrame);
  }

  async drawVirtualBackground(frame: VideoFrame) {
    if (!this.canvas || !this.ctx || !this.segmentationResults || !this.inputVideo) return;
    // this.ctx.save();
    // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.segmentationResults?.categoryMask) {
      this.ctx.filter = 'blur(3px)';
      this.ctx.globalCompositeOperation = 'copy';
      const bitmap = await maskToBitmap(
        this.segmentationResults.categoryMask,
        this.inputVideo.videoWidth,
        this.inputVideo.videoHeight,
      );
      this.ctx.drawImage(bitmap, 0, 0);
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
    const start = performance.now();
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
      this.inputVideo.videoWidth,
      this.inputVideo.videoHeight,
    );
    this.ctx.filter = 'blur(3px)';
    this.ctx.globalCompositeOperation = 'copy';
    this.ctx.drawImage(bitmap, 0, 0);
    this.ctx.filter = 'none';
    this.ctx.globalCompositeOperation = 'source-out';
    this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalCompositeOperation = 'destination-over';
    this.ctx.filter = `blur(${this.blurRadius}px)`;
    this.ctx.drawImage(frame, 0, 0);
    this.ctx.restore();
    console.log('draw time', performance.now() - start);
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
