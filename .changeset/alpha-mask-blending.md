---
'@livekit/track-processors': minor
---

Add a `maskBlending` option to `BackgroundProcessor`. With `maskBlending: 'alpha'`, the segmenter's confidence that a pixel is the person is used as that pixel's opacity, which keeps soft edges such as hair, instead of cutting a feathered binary mask at 0.5. The default, `'binary'`, is unchanged.
