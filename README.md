# LiveKit track processors

## Install
```
yarn add @livekit/track-processors
```

## Usage of prebuilt processors

This package exposes `BlurBackground` and `VirtualBackground` as pre-prepared processor pipelines.
A processor pipeline consists of an array of transformers. In the case of the two aforementioned it is just one processor within the array.

```ts
import 'BlurBackground' from '@livekit/track-processors';


const videoTrack = await createLocalVideoTrack();
await videoTrack.setProcessor(BlurBackground(10));
room.localParticipant.publishTrack(videoTrack);

async function disableBackgroundBlur() {
    await videoTrack.stopProcessor();
}

```

## Available base processors

- BackgroundProcessor (can blur background or use a virtual background);


## Building your own processors
A track processor consists of one or multiple transformers.

```ts
// src/index.ts
export const VirtualBackground = (imagePath: string) => {
  const pipeline = new ProcessorPipeline([
    new BackgroundTransformer({ imagePath }),
    new DummyTransformer(),
  ]);
  return pipeline;
};
```
