# Audio Processors

This document covers the audio track processors available in `@livekit/track-processors` and how to build your own.

## GainAudioProcessor

The `GainAudioProcessor` is a minimal audio processor that applies a Web Audio [`GainNode`](https://developer.mozilla.org/en-US/docs/Web/API/GainNode) to a local audio track. It serves both as a ready-to-use volume control and as a reference implementation for building custom audio processors.

### Browser support

The Web Audio API used by `GainAudioProcessor` is [widely supported](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API#browser_compatibility) in modern browsers. You can check support before use:

```ts
import { GainAudioProcessor } from '@livekit/track-processors';

if (!GainAudioProcessor.isSupported) {
  console.warn('GainAudioProcessor is not supported in this environment');
}
```

### Basic usage

```ts
import { createLocalAudioTrack } from 'livekit-client';
import { GainAudioProcessor } from '@livekit/track-processors';

const audioTrack = await createLocalAudioTrack();
const processor = new GainAudioProcessor({ gainValue: 1.5 });
await audioTrack.setProcessor(processor);
room.localParticipant.publishTrack(audioTrack);

// Update gain on the fly
processor.setGain(0.5);

// Remove the processor
await audioTrack.stopProcessor();
```

### Constructor options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gainValue` | `number` | `1.0` | Initial gain multiplier, clamped to [0, 10]. `1.0` = unity (no change), `0.0` = silence, `> 1.0` = amplify. |

## The TrackProcessor interface for audio

Audio processors implement the `TrackProcessor` interface from `livekit-client`:

```ts
// Generic signature from livekit-client
interface TrackProcessor<T extends Track.Kind, U extends ProcessorOptions<T>> {
  name: string;
  init(opts: U): Promise<void>;
  restart(opts: U): Promise<void>;
  destroy(): Promise<void>;
  processedTrack?: MediaStreamTrack;
  onPublish?(room: Room): Promise<void>;
  onUnpublish?(): Promise<void>;
}

// For audio processors, T = Track.Kind.Audio and U = AudioProcessorOptions
```

When you call `audioTrack.setProcessor(processor)`, the SDK:

1. Creates an `AudioContext` and passes it to your processor via `AudioProcessorOptions`
2. Calls `processor.init()` with the options
3. Reads `processor.processedTrack` and uses it as the track sent to the SFU
4. Calls `sender.replaceTrack()` to swap the raw track for the processed one

### AudioProcessorOptions

The SDK provides these options when calling `init()` and `restart()`:

```ts
interface AudioProcessorOptions {
  kind: Track.Kind.Audio;
  track: MediaStreamTrack;      // The raw microphone MediaStreamTrack
  audioContext: AudioContext;    // A shared AudioContext managed by the SDK
  element?: HTMLMediaElement;    // The media element, if one exists
}
```

Key points:

- **Use the provided `AudioContext`** rather than creating your own. This avoids hitting browser limits on AudioContext instances and ensures the context is in the correct state.
- **`track`** is the raw `MediaStreamTrack` from the user's microphone. On device switch, the SDK calls `restart()` with a new track.
- **Set `this.processedTrack`** to the output `MediaStreamTrack` from your processing pipeline. The SDK reads this property after `init()` returns.

### Lifecycle methods

| Method | When called | What to do |
|--------|-------------|------------|
| `init(opts)` | `audioTrack.setProcessor(processor)` | Build your Web Audio graph, set `this.processedTrack` |
| `restart(opts)` | Device switch or track change | Tear down old graph, rebuild with the new `opts.track` |
| `destroy()` | `audioTrack.stopProcessor()` | Disconnect all nodes, clean up resources |
| `onPublish(room)` | Track is published to a room | Optional — use if you need room context |
| `onUnpublish()` | Track is unpublished | Optional — use for cleanup tied to room lifecycle |

## Building your own audio processor

The general pattern for a custom audio processor is:

1. Create a `MediaStreamSource` from the input track
2. Connect it through your processing nodes
3. Connect the final node to a `MediaStreamDestination`
4. Expose `destination.stream.getAudioTracks()[0]` as `processedTrack`

Here's a skeleton:

```ts
import { Track } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';

class MyAudioProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'my-audio-processor';
  processedTrack?: MediaStreamTrack;

  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  // ... your processing nodes

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track, audioContext } = opts;

    // Create source from the raw microphone track
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]));

    // Create your processing chain
    // const myNode = audioContext.create...(...);

    // Create destination
    this.destination = audioContext.createMediaStreamDestination();

    // Wire it up: source → [your nodes] → destination
    this.source.connect(/* myNode */);
    // myNode.connect(this.destination);

    // Expose the processed track
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    // Disconnect your other nodes...
    this.destination?.disconnect();
    this.processedTrack = undefined;
  }
}
```

### Things to keep in mind

**Device switching.** When a user switches microphones, the SDK calls `restart()` with a new `MediaStreamTrack`. Your processor must tear down the old Web Audio graph and rebuild with the new track. The simplest approach (shown above) is to call `destroy()` then `init()` inside `restart()`.

**AudioContext lifecycle.** The SDK provides an `AudioContext` via the options. Always use it rather than creating your own — this avoids browser limits on AudioContext instances and ensures the context state is managed correctly.

**Browser compatibility.** The Web Audio API nodes used in this pattern (`MediaStreamSource`, `GainNode`, `MediaStreamDestination`) are well-supported across modern browsers. No special fallbacks are needed, unlike the video processor path which requires `canvas.captureStream()` fallbacks.

**Advanced processing.** Since you receive a full `AudioContext`, you can wire in any Web Audio processing chain — including `AudioWorkletNode` for off-main-thread processing, or WASM-backed worklets for computationally intensive tasks. The pattern is the same: route audio through your nodes and connect the final output to the `MediaStreamDestination`.
