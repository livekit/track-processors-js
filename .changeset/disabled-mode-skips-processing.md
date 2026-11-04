---
'@livekit/track-processors': patch
---

Skip segmentation and rendering in `disabled` mode, instead of processing every frame and only hiding the result. `onFrameProcessed` no longer fires while the processor is disabled.
