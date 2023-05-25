import type { ProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { VideoTrackTransformer } from './transformers';

export default class ProcessorPipeline implements TrackProcessor<Track.Kind> {
  static get isSupported() {
    return (
      typeof MediaStreamTrackGenerator !== 'undefined' &&
      typeof MediaStreamTrackProcessor !== 'undefined'
    );
  }

  name: string;

  source?: MediaStreamVideoTrack;

  sourceSettings?: MediaTrackSettings;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas;

  sourceDummy?: HTMLMediaElement;

  processedTrack?: MediaStreamTrack;

  transformers: Array<VideoTrackTransformer>;

  constructor(transformers: Array<VideoTrackTransformer>, name: string) {
    this.name = name;
    this.transformers = transformers;
  }

  async init(opts: ProcessorOptions<Track.Kind>) {
    this.source = opts.track as MediaStreamVideoTrack;
    this.sourceSettings = this.source.getSettings();
    this.sourceDummy = opts.element;
    if (!(this.sourceDummy instanceof HTMLVideoElement)) {
      throw TypeError('Currently only video transformers are supported');
    }
    // TODO explore if we can do all the processing work in a webworker
    this.processor = new MediaStreamTrackProcessor({ track: this.source });
    this.trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' });

    this.canvas = new OffscreenCanvas(
      this.sourceSettings.width ?? 300,
      this.sourceSettings.height ?? 300,
    );

    let readableStream = this.processor.readable;
    for (const transformer of this.transformers) {
      transformer.init({
        outputCanvas: this.canvas,
        inputElement: this.sourceDummy!,
      });
      readableStream = readableStream.pipeThrough(transformer!.transformer!);
    }
    console.log('before pipe to');

    readableStream.pipeTo(this.trackGenerator.writable);
    this.processedTrack = this.trackGenerator as MediaStreamVideoTrack;
    console.log(
      'processed internal',
      this.source,
      this.processedTrack,
      this.processor,
      this.trackGenerator,
    );
  }

  async destroy() {
    for (const transformer of this.transformers) {
      await transformer.destroy();
    }
    this.trackGenerator?.stop();
  }
}
