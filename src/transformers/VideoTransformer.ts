import { StreamTransformer, StreamTransformerInitOptions } from './types';

export default abstract class VideoTransformer implements StreamTransformer {
  transformer?: TransformStream;

  canvas?: OffscreenCanvas;

  ctx?: OffscreenCanvasRenderingContext2D;

  inputVideo?: HTMLVideoElement;

  protected isDisabled?: Boolean = false;

  init({ outputCanvas, inputVideo }: StreamTransformerInitOptions): void {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.canvas = outputCanvas || null;
    if (outputCanvas) {
      this.ctx = this.canvas?.getContext('2d') || undefined;
    }
    this.inputVideo = inputVideo;
    this.isDisabled = false;
  }

  async destroy() {
    this.isDisabled = true;
    this.canvas = undefined;
    this.ctx = undefined;
  }

  abstract transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ): Promise<void>;
}
