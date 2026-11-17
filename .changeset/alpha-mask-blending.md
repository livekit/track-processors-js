---
'@livekit/track-processors': minor
---

Blend the background by the segmenter's confidence. The confidence that a pixel is the person is now used as that pixel's opacity, which keeps soft edges such as hair, instead of cutting a feathered binary mask at 0.5. A new `maskBlending` option on `BackgroundProcessor` selects this (`'alpha'`, the default) or the previous behavior (`'binary'`).
