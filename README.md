# LiveKit track processors

## Install

```
npm install @livekit/track-processors
```

## Usage of prebuilt processor

### Available processors

This package exposes the `BackgroundProcessorManager` pre-prepared processor pipeline. This single
processor pipeline supports both background blur and substituting a user's background for a virtual
image:

```typescript
// Background Blur
BackgroundProcessorManager.withBackgroundBlur(/* optional blurRadius */)

// Virtual Background
BackgroundProcessorManager.withVirtualBackground(imagePath)
```

### Usage example

```ts
import { BackgroundProcessorManager, supportsBackgroundProcessors, supportsModernBackgroundProcessors } from '@livekit/track-processors';

if(!supportsBackgroundProcessors()) {
  throw new Error("this browser does not support background processors")
}

if(supportsModernBackgroundProcessors()) {
  console.log("this browser supports modern APIs that are more performant");
}

const videoTrack = await createLocalVideoTrack();
const processor = BackgroundProcessorManager.withBackgroundBlur(10);
await videoTrack.setProcessor(processor);
room.localParticipant.publishTrack(videoTrack);

async function disableBackgroundBlur() {
  await videoTrack.stopProcessor();
}

async updateBlurRadius(radius) {
  return processor.switchToBackgroundBlur(radius);
}

async liveUpdateToBackgroundImage(image) {
  return processor.switchToVirtualBackground(image);
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
# install pnpm: https://pnpm.io/installation
pnpm install
pnpm sample
```
