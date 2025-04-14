# LiveKit track processors

## Install

```
npm add @livekit/track-processors
```

## Usage of prebuilt processors

### Available processors

This package exposes the `BackgroundBlur` and `VirtualBackground` pre-prepared processor pipelines.

- `BackgroundBlur(blurRadius)`
- `VirtualBackground(imagePath)`

### Usage example

```ts
import { BackgroundBlur, supportsBackgroundProcessors, supportsModernBackgroundProcessors } from '@livekit/track-processors';

if(!supportsBackgroundProcessors()) {
  throw new Error("this browser does not support background processors")
}

if(supportsModernBackgroundProcessors()) {
  console.log("this browser supports modern APIs that are more performant");
}

const videoTrack = await createLocalVideoTrack();
const blur = BackgroundBlur(10);
await videoTrack.setProcessor(blur);
room.localParticipant.publishTrack(videoTrack);

async function disableBackgroundBlur() {
  await videoTrack.stopProcessor();
}

async updateBlurRadius(radius) {
  return blur.updateTransformerOptions({blurRadius: radius})
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


## Running the sample app

This repository includes a small example app built on [Vite](https://vitejs.dev/). Run it with:

```
npm install
npm run sample
```
