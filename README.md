# LiveKit track processors

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

## Available processors

- Backgroundprocessor (can blur background or use a virtual background);

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

## Notes

`BackgroundProcessor` relies on google mediapipe's selfie segmentation. Only one instance of mediapipe's selfie segmentation can be active at a time, so the current design forbids to have multiple Backgroundprocessors chained together. It would however be no problem to chain `BackgroundProcessor` together with another processor that doesn't rely on google mediapipe's selfie segmentation.
