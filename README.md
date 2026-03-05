# LiveKit track processors

Prebuilt audio and video track processors for [LiveKit](https://livekit.io), implementing the [`TrackProcessor`](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackProcessor.html) interface from `livekit-client`.

## Install

```
npm add @livekit/track-processors
```

## Video processors

Video track processors intercept a local video track's frames and transform them before they are sent to other participants. This package provides a prebuilt `BackgroundProcessor` that supports background blur and virtual backgrounds:

```ts
import { BackgroundProcessor } from '@livekit/track-processors';

const processor = BackgroundProcessor({ mode: 'background-blur', blurRadius: 10 });
await videoTrack.setProcessor(processor);
```

Available modes: `background-blur`, `virtual-background`, and `disabled` (passthrough).

See [processor-docs/video-processors.md](processor-docs/video-processors.md) for full usage, browser support checks, and how to avoid visual artifacts when switching modes.

## Audio processors

Audio track processors work similarly — they intercept the local audio track and pipe it through a Web Audio API processing graph before publishing. The included `GainAudioProcessor` provides gain control and serves as a reference implementation for building custom audio processors:

```ts
import { GainAudioProcessor } from '@livekit/track-processors';

const processor = new GainAudioProcessor({ gainValue: 1.5 });
await audioTrack.setProcessor(processor);
```

See [processor-docs/audio-processors.md](processor-docs/audio-processors.md) for full usage, the `TrackProcessor` interface for audio, and a guide to building your own audio processor with the Web Audio API.

## Developing your own processors

This package implements the `TrackProcessor` interface from `livekit-client`. Video and audio processors take different approaches:

- **Video processors** use `ProcessorWrapper` with a transformer pipeline — see [processor-docs/video-processors.md](processor-docs/video-processors.md#developing-your-own-video-processor)
- **Audio processors** implement `TrackProcessor` directly using the Web Audio API — see [processor-docs/audio-processors.md](processor-docs/audio-processors.md#building-your-own-audio-processor)

## Running the sample app

This repository includes a small example app built on [Vite](https://vitejs.dev/) that demonstrates both video and audio processors. Run it with:

```
# install pnpm: https://pnpm.io/installation
pnpm install
pnpm sample
```
