export interface StreamTransformer {
  init: (outputCanvas: OffscreenCanvas, inputVideo: HTMLVideoElement) => void;
  destroy: () => void;
  transform: (frame: VideoFrame, controller: TransformStreamDefaultController) => void;
  transformer: TransformStream;
}
