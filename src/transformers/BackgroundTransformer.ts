import { SelfieSegmentation, Results } from '@mediapipe/selfie_segmentation';
import VideoTransformer from './VideoTransformer';

export type BackgroundOptions = {
  blurRadius?: number,
  imagePath?: string,
};

export default class BackgroundProcessor extends VideoTransformer {
  selfieSegmentation?: SelfieSegmentation;

  segmentationResults: Results | undefined;

  //   backgroundImagePattern: CanvasPattern | null = null;
  backgroundImage: ImageBitmap | null = null;

  blurRadius?: number;

  constructor(opts: BackgroundOptions) {
    super();
    if (opts.blurRadius) {
      this.blurRadius = opts.blurRadius;
    } else if (opts.imagePath) { this.loadBackground(opts.imagePath); }
  }

  init(outputCanvas: OffscreenCanvas, inputVideo: HTMLVideoElement) {
    super.init(outputCanvas, inputVideo);

    this.selfieSegmentation = new SelfieSegmentation({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
    this.selfieSegmentation.setOptions({
      modelSelection: 1,
      selfieMode: false,
    });
    this.selfieSegmentation.onResults((results) => { this.segmentationResults = results; });

    // this.loadBackground(opts.backgroundUrl).catch((e) => console.error(e));
    this.sendFramesContinuouslyForSegmentation(this.inputVideo!);
  }

  async destroy() {
    await super.destroy();
    await this.selfieSegmentation?.close();
    this.backgroundImage = null;
  }

  async sendFramesContinuouslyForSegmentation(videoEl: HTMLVideoElement) {
    console.log('sending frames');
    if (!this.isDisabled) {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        await this.selfieSegmentation?.send({ image: videoEl });
      }
      // @ts-ignore
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
    if (this.blurRadius) { this.blurBackground(frame); } else { this.drawVirtualBackground(frame); }
    // @ts-ignore
    const newFrame = new VideoFrame(this.canvas, { timestamp: performance.now() });
    frame.close();
    controller.enqueue(newFrame);
  }

  drawVirtualBackground(frame: VideoFrame) {
    if (!this.canvas || !this.ctx) return;
    // this.ctx.save();
    // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.segmentationResults) {
      this.ctx.filter = 'blur(3px)';
      this.ctx.globalCompositeOperation = 'copy';
      this.ctx.drawImage(this.segmentationResults.segmentationMask, 0, 0);
      this.ctx.filter = 'none';
      this.ctx.globalCompositeOperation = 'source-out';
      if (this.backgroundImage) {
        this.ctx.drawImage(this.backgroundImage,
          0, 0, this.backgroundImage.width, this.backgroundImage.height,
          0, 0, this.canvas.width, this.canvas.height);
      } else {
        this.ctx.fillStyle = '#00FF00';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }

      this.ctx.globalCompositeOperation = 'destination-over';
    }
    this.ctx.drawImage(
      frame, 0, 0, this.canvas.width, this.canvas.height,
    );
    // this.ctx.restore();
  }

  blurBackground(frame: VideoFrame) {
    if (!this.ctx || !this.canvas || !this.segmentationResults) return;
    this.ctx.save();
    this.ctx.filter = `blur(${3}px)`;
    this.ctx.globalCompositeOperation = 'copy';
    this.ctx.drawImage(
      this.segmentationResults.segmentationMask,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.ctx.filter = 'none';
    this.ctx.globalCompositeOperation = 'source-in';
    this.ctx.drawImage(frame,
      0,
      0,
      this.canvas.width,
      this.canvas.height);
    this.ctx.globalCompositeOperation = 'destination-over';
    this.ctx.filter = `blur(${this.blurRadius}px)`;
    this.ctx.drawImage(frame, 0, 0);
    this.ctx.restore();
  }
}
