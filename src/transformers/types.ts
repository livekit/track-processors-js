export type TrackTransformerInitOptions = {
  inputElement: HTMLMediaElement;
};

export interface VideoTransformerInitOptions extends TrackTransformerInitOptions {
  outputCanvas: OffscreenCanvas | HTMLCanvasElement;
  inputElement: HTMLVideoElement;
}

export interface AudioTransformerInitOptions extends TrackTransformerInitOptions {}

export interface VideoTrackTransformer<Options extends Record<string, unknown>>
  extends BaseTrackTransformer<VideoTransformerInitOptions, VideoFrame, TrackTransformerDestroyOptions> {
  init: (options: VideoTransformerInitOptions) => void;
  destroy: (options?: TrackTransformerDestroyOptions) => void;
  restart: (options: VideoTransformerInitOptions) => void;
  transform: (frame: VideoFrame, controller: TransformStreamDefaultController) => void;
  transformer?: TransformStream;
  update: (options: Options) => void;
}

export interface AudioTrackTransformer<Options extends Record<string, unknown>>
  extends BaseTrackTransformer<AudioTransformerInitOptions, AudioData, TrackTransformerDestroyOptions> {
  init: (options: AudioTransformerInitOptions) => void;
  destroy: (options: TrackTransformerDestroyOptions) => void;
  restart: (options: AudioTransformerInitOptions) => void;
  transform: (frame: AudioData, controller: TransformStreamDefaultController) => void;
  transformer?: TransformStream;
  update: (options: Options) => void;
}

export type TrackTransformerDestroyOptions = { willProcessorRestart: boolean };

export type TrackTransformer<Options extends Record<string, unknown>> =
  | VideoTrackTransformer<Options>
  | AudioTrackTransformer<Options>;

export interface BaseTrackTransformer<
  InitOpts extends TrackTransformerInitOptions,
  DataType extends VideoFrame | AudioData,
  DestroyOpts extends TrackTransformerDestroyOptions = TrackTransformerDestroyOptions,
> {
  init: (options: InitOpts) => void;
  destroy: (options: DestroyOpts) => void;
  restart: (options: InitOpts) => void;
  transform: (frame: DataType, controller: TransformStreamDefaultController) => void;
  transformer?: TransformStream;
}
