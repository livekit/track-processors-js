# LiveKit track processors

## Install

```
npm add @livekit/track-processors
```

## Usage of prebuilt processors

### Available processors

This package exposes `BackgroundBlur` and `VirtualBackground` as pre-prepared processor pipelines.

- `BackgroundBlur(blurRadius)`
- `VirtualBackground(imagePath)`

### Usage example

```ts
import { BackgroundBlur } from '@livekit/track-processors';

const videoTrack = await createLocalVideoTrack();
const blur = BackgroundBlur(10);
await videoTrack.setProcessor(blur);
room.localParticipant.publishTrack(videoTrack);

async function disableBackgroundBlur() {
  await videoTrack.stopProcessor();
}

async updateBlurRadius(radius) {
  return blur.updateTransformerOptions({blurRadius: blur})
}


```

## Developing your own processors

A track processor is instantiated with a Transformer.

```ts
// src/index.ts
export const VirtualBackground = (imagePath: string) => {
  const pipeline = new ProcessorWrapper(new BackgroundTransformer({ imagePath }));
  return pipeline;
};
```

### Available base transformers

- BackgroundTransformer (can blur background or use a virtual background);
