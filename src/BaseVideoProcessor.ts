import { SelfieSegmentation, Results } from '@mediapipe/selfie_segmentation';
import type { ProcessorOptions, VideoProcessor } from 'livekit-client';

export type VirtualBackgroundOptions = ProcessorOptions & {
  backgroundUrl: string;
};

export class VirtualBackgroundProcessor implements VideoProcessor<VirtualBackgroundOptions> {
  source?: MediaStreamVideoTrack;

  sourceSettings?: MediaTrackSettings;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas;

  ctx?: OffscreenCanvasRenderingContext2D;

  sourceDummy?: HTMLVideoElement;

  transformer?: TransformStream;

  selfieSegmentation?: SelfieSegmentation;

  backgroundImagePattern: CanvasPattern | null = null;

  processedTrack?: MediaStreamTrack;

  init(opts: VirtualBackgroundOptions) {
    this.source = opts.track as MediaStreamVideoTrack;
    this.sourceSettings = this.source.getSettings();
    this.sourceDummy = opts.element;
    // TODO explore if we can do all the processing work in a webworker
    this.processor = new MediaStreamTrackProcessor({ track: this.source });
    this.trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' });
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });

    this.processor.readable.pipeThrough(this.transformer).pipeTo(this.trackGenerator.writable);
    this.processedTrack = this.trackGenerator as MediaStreamVideoTrack;

    this.canvas = new OffscreenCanvas(this.sourceSettings.width!, this.sourceSettings.height!);
    this.ctx = this.canvas.getContext('2d')!;

    this.selfieSegmentation = new SelfieSegmentation({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
    this.selfieSegmentation.setOptions({
      modelSelection: 1,
      selfieMode: false,
    });
    this.selfieSegmentation.onResults((results) => { this.segmentationResults = results; });

    this.loadBackground(opts.backgroundUrl).catch((e) => console.error(e));
    this.sendFramesContinuouslyForSegmentation(this.sourceDummy!);
  }

  destroy() {
    // TODO
  }

  sendFramesContinuouslyForSegmentation(videoEl: HTMLVideoElement) {
    // @ts-ignore
    videoEl.requestVideoFrameCallback(() => this.sendFramesContinuouslyForSegmentation(videoEl));
    this.selfieSegmentation?.send({ image: videoEl });
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
    this.backgroundImagePattern = this.ctx?.createPattern(imageData, 'repeat') ?? null;
  }

  segmentationResults: Results | undefined;

  drawResults(frame: VideoFrame) {
    if (!this.canvas || !this.ctx) return;
    // this.ctx.save();
    // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.segmentationResults) {
      this.ctx.filter = 'blur(3px)';
      this.ctx.globalCompositeOperation = 'copy';
      this.ctx.drawImage(this.segmentationResults.segmentationMask, 0, 0);
      this.ctx.filter = 'none';
      this.ctx.globalCompositeOperation = 'source-out';

      this.ctx.fillStyle = this.backgroundImagePattern ?? '#00FF00';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
    this.ctx.filter = 'blur(3px)';
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
    this.ctx.filter = 'blur(10px)';
    this.ctx.drawImage(frame, 0, 0);
    this.ctx.restore();
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    this.drawResults(frame);
    // this.blurBackground(frame);
    // @ts-ignore
    const newFrame = new VideoFrame(this.canvas, { timestamp: performance.now() });
    frame.close();
    controller.enqueue(newFrame);
  }
}
