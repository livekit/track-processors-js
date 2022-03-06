import { SelfieSegmentation, Results } from '@mediapipe/selfie_segmentation';

export default class BackgroundProcessor {
  transformer?: TransformStream;

  selfieSegmentation?: SelfieSegmentation;

  constructor() {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
  }
}
