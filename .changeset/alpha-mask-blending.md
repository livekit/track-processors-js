---
'@livekit/track-processors': minor
---

Blend the background by the segmenter's confidence. The confidence that a pixel is the person is now used as that pixel's opacity, which keeps soft edges such as hair, instead of cutting a feathered binary mask at 0.5. A new `maskBlending` option on `BackgroundProcessor` selects this (`'alpha'`, the default) or the previous behavior (`'binary'`).

`BackgroundTransformer.update()` and `updateTransformerOptions()` now take `UpdatableBackgroundOptions`, the subset of `BackgroundOptions` that applies to a running transformer. Passing `segmenterOptions`, `assetPaths` or `maskBlending` to them is a type error; these are read when the processor is created.

A new `alphaRange: [low, high]` option remaps the confidence before it is used as opacity: at or below `low` a pixel is fully background, at or above `high` fully the person, with a smooth ramp between. It hides partly confident regions that otherwise show through faintly, defaults to `[0, 1]` (the confidence as it is), and can be updated on a running processor.
