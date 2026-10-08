---
'@livekit/track-processors': patch
---

Reduce GPU work per frame in the background processor: merge Gaussian blur taps for bilinear fetches, feather the segmentation mask at reduced resolution, enable blending only for the composite pass, disable multisampling, and stop re-uploading a static background image every frame
