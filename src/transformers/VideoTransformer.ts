import { StreamTransformer, StreamTransformerInitOptions } from "./types";

export default abstract class VideoTransformer implements StreamTransformer {
  transformer: TransformStream;

  canvas: OffscreenCanvas | null = null;
  ctx: OffscreenCanvasRenderingContext2D | null = null;

  inputVideo?: HTMLVideoElement;

  protected isDisabled = false;

  constructor() {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.isDisabled = false;
  }

  init({ outputCanvas, inputVideo }: StreamTransformerInitOptions): void {
    this.canvas = outputCanvas || null;
    if (outputCanvas) {
      this.ctx = this.canvas?.getContext("2d") || null;
    }
    this.inputVideo = inputVideo;
  }

  getInputVideo(): HTMLVideoElement {
    if (!this.inputVideo)
      throw new Error(
        "inputVideo is not defined, did you forget to call init()?"
      );
    return this.inputVideo;
  }

  async destroy(): Promise<void> {
    this.isDisabled = true;
    this.canvas = null;
    this.ctx = null;
  }

  abstract transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>
  ): Promise<void>;
}
