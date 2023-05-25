<<<<<<< HEAD
import { StreamTransformer, StreamTransformerInitOptions } from "./types";
=======
import { VideoTrackTransformer, VideoTransformerInitOptions } from './types';
>>>>>>> main

export default abstract class VideoTransformer implements VideoTrackTransformer {
  transformer?: TransformStream;

  canvas: OffscreenCanvas | null = null;
  ctx: OffscreenCanvasRenderingContext2D | null = null;

  inputVideo?: HTMLVideoElement;

  protected isDisabled = false;

  init({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions): void {
    if (!(inputVideo instanceof HTMLVideoElement)) {
      throw TypeError('Video transformer needs a HTMLVideoElement as input');
    }
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
<<<<<<< HEAD
    this.isDisabled = false;
  }

  init({ outputCanvas, inputVideo }: StreamTransformerInitOptions): void {
    this.canvas = outputCanvas || null;
    if (outputCanvas) {
      this.ctx = this.canvas?.getContext("2d") || null;
=======
    this.canvas = outputCanvas || null;
    if (outputCanvas) {
      this.ctx = this.canvas?.getContext('2d', { readFrequently: true }) || undefined;
>>>>>>> main
    }
    this.inputVideo = inputVideo;
    this.isDisabled = false;
  }

  getInputVideo(): HTMLVideoElement {
    if (!this.inputVideo)
      throw new Error(
        "inputVideo is not defined, did you forget to call init()?"
      );
    return this.inputVideo;
  }

<<<<<<< HEAD
  async destroy(): Promise<void> {
    this.isDisabled = true;
    this.canvas = null;
    this.ctx = null;
  }

  abstract transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>
  ): Promise<void>;
=======
  abstract transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ): void;
>>>>>>> main
}
