---
'@livekit/track-processors': minor
---

Add a `segmentationMask` option to `BackgroundProcessor`: `'confidence'` composites with the segmenter's per-pixel probability, so the edge moves smoothly instead of jumping, and supports multiclass models such as `selfie_multiclass_256x256`
