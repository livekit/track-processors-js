export type TrackTransformerInitOptions = {
  inputElement: HTMLMediaElement;
};

export interface VideoTransformerInitOptions extends TrackTransformerInitOptions {
  outputCanvas: OffscreenCanvas;
  inputElement: HTMLVideoElement;
}

export interface VideoTrackTransformer<
  T extends TrackTransformerInitOptions = VideoTransformerInitOptions,
> {
  init: (options: T) => void;
  destroy: () => void;
  restart: (options: T) => void;
  transform: (frame: VideoFrame, controller: TransformStreamDefaultController) => void;
  transformer?: TransformStream;
}
