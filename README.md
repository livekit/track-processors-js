# LiveKit track processors

## Install

```
npm add @livekit/track-processors
```

## Usage of prebuilt processors

### Available processors

This package exposes the `BackgroundProcessor` pre-prepared processor pipeline, which can be used in a few ways:

- `BackgroundProcessor({ mode: 'background-blur', blurRadius: 10 /* (optional) */ })`
- `BackgroundProcessor({ mode: 'virtual-background', imagePath: "http://path.to/image.png" })`
- `BackgroundProcessor({ mode: 'disabled' })`

### Usage example

```ts
import { BackgroundProcessor, supportsBackgroundProcessors, supportsModernBackgroundProcessors } from '@livekit/track-processors';

if(!supportsBackgroundProcessors()) {
  throw new Error("this browser does not support background processors")
}

if(supportsModernBackgroundProcessors()) {
  console.log("this browser supports modern APIs that are more performant");
}

const videoTrack = await createLocalVideoTrack();
const processor = BackgroundProcessor({ mode: 'background-blur' });
await videoTrack.setProcessor(processor);
room.localParticipant.publishTrack(videoTrack);

async function disableBackgroundBlur() {
  await videoTrack.stopProcessor();
}

async function updateBlurRadius(radius) {
  return processor.switchTo({ mode: 'background-blur', blurRadius: radius });
}
```

In a real application, it's likely you will want to only sometimes apply background effects. You
could accomplish this by calling `videoTrack.setProcessor(...)` / `videoTrack.stopProcessor(...)` on
demand, but these functions can sometimes result in output visual artifacts as part of the switching
process, which can result in a poor user experience.

A better option which won't result in any visual artifacts while switching is to initialize the
`BackgroundProcessor` in its "disabled" mode, and then later on switch to the desired mode. For
example:
```ts
const videoTrack = await createLocalVideoTrack();
const processor = BackgroundProcessor({ mode: 'disabled' });
await videoTrack.setProcessor(processor);
room.localParticipant.publishTrack(videoTrack);

async function enableBlur(radius) {
  await processor.switchTo({ mode: 'background-blur', blurRadius: radius });
}

async function disableBlur() {
  await videoTrack.switchTo({ mode: 'disabled' });
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

- BackgroundTransformer (can blur background, use a virtual background, or be put into a disabled state);


## Running the sample app

This repository includes a small example app built on [Vite](https://vitejs.dev/). Run it with:

```
# install pnpm: https://pnpm.io/installation
pnpm install
pnpm sample
```
