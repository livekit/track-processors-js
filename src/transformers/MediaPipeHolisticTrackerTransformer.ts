import { Holistic, Results, Options } from "@mediapipe/holistic";
import VideoTransformer from "./VideoTransformer";
import { StreamTransformerInitOptions } from "./types";

export type MediaPipeHolisticTrackerTransformerOptions = {
  holisticOptions?: Options;
  overlayResults?: boolean;
  callback?: (results: Results) => void;
};

export default class MediaPipeHolisticTrackerTransformer extends VideoTransformer {
  holistic?: Holistic;
  holisticOptions: Options;
  holisticResults: Results | undefined;
  callback: (results: Results) => void;

  public static get isSupported(): boolean {
    return typeof OffscreenCanvas !== "undefined";
  }

  //   backgroundImagePattern: CanvasPattern | null = null;
  backgroundImage: ImageBitmap | null = null;

  overlayResults = false;

  constructor({
    overlayResults,
    holisticOptions,
    callback,
  }: MediaPipeHolisticTrackerTransformerOptions) {
    super();
    this.callback = callback || (() => null);
    this.overlayResults = overlayResults || false;
    this.holisticOptions = holisticOptions || {};
  }

  init({ inputVideo, outputCanvas }: StreamTransformerInitOptions): void {
    super.init({ outputCanvas, inputVideo });

    this.holistic = new Holistic({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
    });
    this.holistic.setOptions(this.holisticOptions);
    this.holistic.onResults(this.callback);

    this.sendFramesContinuouslyForTracking(this.getInputVideo());
  }

  async destroy(): Promise<void> {
    await super.destroy();
    await this.holistic?.close();
    this.backgroundImage = null;
  }

  async sendFramesContinuouslyForTracking(
    videoEl: HTMLVideoElement
  ): Promise<void> {
    if (!this.isDisabled) {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        await this.holistic?.send({ image: videoEl });
      }

      // @ts-ignore
      videoEl.requestVideoFrameCallback(() => {
        this.sendFramesContinuouslyForTracking(videoEl);
      });
    }
  }

  async transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>
  ): Promise<void> {
    // TODO
    if (this.canvas) {
      const newFrame = new VideoFrame(this.canvas, {
        timestamp: performance.now(),
      });
      frame.close();
      controller.enqueue(newFrame);
    }
  }

  drawOverlays(frame: VideoFrame): void {
    if (!this.canvas || !this.ctx) return;
  }
}
