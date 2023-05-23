import type { ProcessorOptions, VideoProcessor } from 'livekit-client';
import { StreamTransformer } from './transformers';

export default class ProcessorPipeline implements VideoProcessor<ProcessorOptions> {
  static get isSupported() {
    return (
      typeof MediaStreamTrackGenerator !== 'undefined' &&
      typeof MediaStreamTrackProcessor !== 'undefined'
    );
  }

  source?: MediaStreamVideoTrack;

  sourceSettings?: MediaTrackSettings;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas;

  sourceDummy?: HTMLVideoElement;

  processedTrack?: MediaStreamTrack;

  transformers: Array<StreamTransformer>;

  constructor(transformers: Array<StreamTransformer>) {
    this.transformers = transformers;
  }

  async init(opts: ProcessorOptions) {
    this.source = opts.track as MediaStreamVideoTrack;
    this.sourceSettings = this.source.getSettings();
    this.sourceDummy = opts.element;
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
        inputVideo: this.sourceDummy!,
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
    await this.processor?.writableControl?.close();
  }
}
