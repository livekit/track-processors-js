import { StreamTransformer } from './types';

export default abstract class VideoTransformer implements StreamTransformer {
  transformer: TransformStream;

  canvas?: OffscreenCanvas;

  ctx?: OffscreenCanvasRenderingContext2D;

  inputVideo?: HTMLVideoElement;

  constructor() {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
  }

  init(outputCanvas: OffscreenCanvas, inputVideo: HTMLVideoElement) {
    this.canvas = outputCanvas;
    this.ctx = this.canvas.getContext('2d')!;
    this.inputVideo = inputVideo;
  }

  abstract transform(frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>): Promise<void>;
}
