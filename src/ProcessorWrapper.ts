import type { ProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { TrackTransformer } from './transformers';
import { waitForTrackResolution } from './utils';

export default class ProcessorWrapper<TransformerOptions extends Record<string, unknown>>
  implements TrackProcessor<Track.Kind>
{
  static get isSupported() {
    return (
      typeof MediaStreamTrackGenerator !== 'undefined' &&
      typeof MediaStreamTrackProcessor !== 'undefined'
    );
  }

  name: string;

  source?: MediaStreamVideoTrack;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas;

  sourceDummy?: HTMLMediaElement;

  processedTrack?: MediaStreamTrack;

  transformer: TrackTransformer<TransformerOptions>;

  constructor(transformer: TrackTransformer<TransformerOptions>, name: string) {
    this.name = name;
    this.transformer = transformer;
  }

  private async setup(opts: ProcessorOptions<Track.Kind>) {
    this.source = opts.track as MediaStreamVideoTrack;

    const { width, height } = await waitForTrackResolution(this.source);
    this.sourceDummy = opts.element;

    if (!(this.sourceDummy instanceof HTMLVideoElement)) {
      throw TypeError('Currently only video transformers are supported');
    }

    if (this.sourceDummy instanceof HTMLVideoElement) {
      this.sourceDummy.height = height ?? 300;
      this.sourceDummy.width = width ?? 300;
    }

    // TODO explore if we can do all the processing work in a webworker
    this.processor = new MediaStreamTrackProcessor({ track: this.source });

    this.trackGenerator = new MediaStreamTrackGenerator({
      kind: 'video',
      signalTarget: this.source,
    });

    this.canvas = new OffscreenCanvas(width ?? 300, height ?? 300);
  }

  async init(opts: ProcessorOptions<Track.Kind>) {
    await this.setup(opts);
    if (!this.canvas || !this.processor || !this.trackGenerator) {
      throw new TypeError('Expected both canvas and processor to be defined after setup');
    }

    const readableStream = this.processor.readable;

    await this.transformer.init({
      outputCanvas: this.canvas,
      inputElement: this.sourceDummy as HTMLVideoElement,
    });

    const pipedStream = readableStream.pipeThrough(this.transformer!.transformer!);

    pipedStream
      .pipeTo(this.trackGenerator.writable)
      .catch((e) => console.error('error when trying to pipe', e))
      .finally(() => this.destroy());

    this.processedTrack = this.trackGenerator as MediaStreamVideoTrack;
  }

  async restart(opts: ProcessorOptions<Track.Kind>) {
    await this.destroy();
    return this.init(opts);
  }

  async restartTransformer(...options: Parameters<(typeof this.transformer)['restart']>) {
    // @ts-ignore unclear why the restart method only accepts VideoTransformerInitOptions instead of either those or AudioTransformerInitOptions
    this.transformer.restart(options[0]);
  }

  async updateTransformerOptions(...options: Parameters<(typeof this.transformer)['update']>) {
    this.transformer.update(options[0]);
  }

  async destroy() {
    await this.processor?.writableControl?.close();
    this.trackGenerator?.stop();
    await this.transformer.destroy();
  }
}
