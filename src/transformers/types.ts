export interface StreamTransformer {
  init: (outputCanvas: OffscreenCanvas, inputVideo: HTMLVideoElement) => void;
  transform: (frame: VideoFrame, controller: TransformStreamDefaultController) => void;
  transformer: TransformStream;
}
