# @livekit/track-processors

## 0.6.0

### Minor Changes

- Reduce the intensity of the gray "flash" when enabling the BackgroundProcessor - [#96](https://github.com/livekit/track-processors-js/pull/96) ([@1egoman](https://github.com/1egoman))

## 0.5.8

### Patch Changes

- Only destroy if no newer init method has been invoked - [#90](https://github.com/livekit/track-processors-js/pull/90) ([@lukasIO](https://github.com/lukasIO))

## 0.5.7

### Patch Changes

- fix(deps): include dom-mediacapture-transform types as a dependency - [#86](https://github.com/livekit/track-processors-js/pull/86) ([@CSantosM](https://github.com/CSantosM))

## 0.5.6

### Patch Changes

- Create empty ImageData helper lazily to avoid ssr build time errors - [#80](https://github.com/livekit/track-processors-js/pull/80) ([@lukasIO](https://github.com/lukasIO))

- Add HTMLCanvas fallback if OffscreenCanvas is not available - [#81](https://github.com/livekit/track-processors-js/pull/81) ([@lukasIO](https://github.com/lukasIO))

## 0.5.5

### Patch Changes

- Downsample background before applying blur - [#77](https://github.com/livekit/track-processors-js/pull/77) ([@lukasIO](https://github.com/lukasIO))

- Update mask when ready - [#76](https://github.com/livekit/track-processors-js/pull/76) ([@lukasIO](https://github.com/lukasIO))

## 0.5.4

### Patch Changes

- Smoothen mask edges - [#74](https://github.com/livekit/track-processors-js/pull/74) ([@lukasIO](https://github.com/lukasIO))

## 0.5.3

### Patch Changes

- Dowgrade mediapipe to 0.10.14 - [#72](https://github.com/livekit/track-processors-js/pull/72) ([@lukasIO](https://github.com/lukasIO))

## 0.5.2

### Patch Changes

- Fix device switching on Safari - [#70](https://github.com/livekit/track-processors-js/pull/70) ([@lukasIO](https://github.com/lukasIO))

## 0.5.1

### Patch Changes

- Adds missing object variable "assetPaths" for configurable asset paths in BackgroundProcessor. - [#68](https://github.com/livekit/track-processors-js/pull/68) ([@jonkad](https://github.com/jonkad))

## 0.5.0

### Minor Changes

- Add captureStream fallback for other browsers - [#65](https://github.com/livekit/track-processors-js/pull/65) ([@lukasIO](https://github.com/lukasIO))

- Use webGL for video processors - [#64](https://github.com/livekit/track-processors-js/pull/64) ([@lukasIO](https://github.com/lukasIO))

### Patch Changes

- Expose frame processing stats via optional callback - [#63](https://github.com/livekit/track-processors-js/pull/63) ([@lukasIO](https://github.com/lukasIO))

## 0.4.1

### Patch Changes

- Use putImageData instead of creating new bitmap - [#61](https://github.com/livekit/track-processors-js/pull/61) ([@lukasIO](https://github.com/lukasIO))

## 0.4.0

### Minor Changes

- Update tasks-vision dependency and remove blurred outlines - [#59](https://github.com/livekit/track-processors-js/pull/59) ([@lukasIO](https://github.com/lukasIO))

## 0.3.3

### Patch Changes

- Ignore empty video frames - [#52](https://github.com/livekit/track-processors-js/pull/52) ([@lukasIO](https://github.com/lukasIO))

## 0.3.2

### Patch Changes

- Reload the background image when needed during processor initialization - [#42](https://github.com/livekit/track-processors-js/pull/42) ([@kyleparrott](https://github.com/kyleparrott))

## 0.3.1

### Patch Changes

- Allow configurable asset paths for task vision assets - [#35](https://github.com/livekit/track-processors-js/pull/35) ([@lukasIO](https://github.com/lukasIO))

## 0.3.0

### Minor Changes

- Replace ProcessorPipeline with ProcessorWrapper, allowing for direct transformer updates - [#32](https://github.com/livekit/track-processors-js/pull/32) ([@lukasIO](https://github.com/lukasIO))

## 0.2.8

### Patch Changes

- Update @mediapipe/tasks-vision - [`5be167d`](https://github.com/livekit/track-processors-js/commit/5be167d2f7b0aaf99d691009306691cfe7fa9d77) ([@lukasIO](https://github.com/lukasIO))

## 0.2.7

### Patch Changes

- Expose ProcessorPipeline and VideoTransformer - [#15](https://github.com/livekit/track-processors-js/pull/15) ([@lukasIO](https://github.com/lukasIO))
  Update media vision SDK

## 0.2.6

### Patch Changes

- Publish workflow release - [#12](https://github.com/livekit/track-processors-js/pull/12) ([@lukasIO](https://github.com/lukasIO))
