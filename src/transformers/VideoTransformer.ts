import { StreamTransformer } from './types';

export default abstract class VideoTransformer implements StreamTransformer {
  transformer: TransformStream;

  canvas?: OffscreenCanvas;

  ctx?: OffscreenCanvasRenderingContext2D;

  inputVideo?: HTMLVideoElement;

  protected isDisabled?: Boolean = false;

  constructor() {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.isDisabled = false;
  }

  init(outputCanvas: OffscreenCanvas, inputVideo: HTMLVideoElement) {
    this.canvas = outputCanvas;
    this.ctx = this.canvas.getContext('2d')!;
    this.inputVideo = inputVideo;
  }

  async destroy() {
    this.isDisabled = true;
    this.canvas = undefined;
    this.ctx = undefined;
  }

  abstract transform(frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>): Promise<void>;
}
