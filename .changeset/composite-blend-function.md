---
'@livekit/track-processors': patch
---

Set the composite's blend function on every frame, instead of once at setup, so a segmentation model that changes it (MediaPipe's multiclass segmenter with confidence masks) no longer turns the output white
