# LiveKit track processors

## Install

```
yarn add @livekit/track-processors
```

## Usage of prebuilt processors

This package exposes `BackgroundBlur` and `VirtualBackground` as pre-prepared processor pipelines.

```ts
import { BackgroundBlur } from '@livekit/track-processors';

const videoTrack = await createLocalVideoTrack();
await videoTrack.setProcessor(BackgroundBlur(10));
room.localParticipant.publishTrack(videoTrack);

async function disableBackgroundBlur() {
  await videoTrack.stopProcessor();
}
```

## Building your own processors

A track processor consists of one or multiple transformers.

```ts
// src/index.ts
export const VirtualBackground = (imagePath: string) => {
  const pipeline = new ProcessorPipeline([new BackgroundTransformer({ imagePath })]);
  return pipeline;
};
```

### Available base transformers

- BackgroundTransformer (can blur background or use a virtual background);
