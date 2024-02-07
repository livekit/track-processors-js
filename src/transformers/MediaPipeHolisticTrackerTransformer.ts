import { Holistic, Options, Results } from '@mediapipe/holistic';
import VideoTransformer from './VideoTransformer';
import { VideoTransformerInitOptions } from './types';

export type MediaPipeHolisticTrackerTransformerOptions = {
  holisticOptions?: Options;
  callback?: (results: Results) => void;
};

export default class MediaPipeHolisticTrackerTransformer extends VideoTransformer<MediaPipeHolisticTrackerTransformerOptions> {
  holistic?: Holistic;
  holisticOptions: Options;
  callback: (results: Results) => void;

  public static get isSupported(): boolean {
    return true;
  }

  constructor({ holisticOptions, callback }: MediaPipeHolisticTrackerTransformerOptions) {
    super();
    this.callback = callback || (() => null);
    this.holisticOptions = holisticOptions || {};
  }

  async init({
    inputElement: inputVideo,
    outputCanvas,
  }: VideoTransformerInitOptions): Promise<void> {
    super.init({ outputCanvas, inputElement: inputVideo });

    this.holistic = new Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
    });
    this.holistic.setOptions(this.holisticOptions);
    this.holistic.onResults((r) => {
      this.callback(r);
    });

    this.sendFramesContinuouslyForTracking(this.inputVideo!);
  }

  async destroy(): Promise<void> {
    this.callback = () => null;
    await super.destroy();
    await this.holistic?.close();
  }

  async update() {}

  async transform(): Promise<void> {
    return;
  }

  async sendFramesContinuouslyForTracking(videoEl: HTMLVideoElement): Promise<void> {
    if (!this.isDisabled) {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        await this.holistic?.send({ image: videoEl });
      }

      videoEl.requestVideoFrameCallback(() => {
        this.sendFramesContinuouslyForTracking(videoEl);
      });
    }
  }
}
