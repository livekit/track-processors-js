---
'@livekit/track-processors': patch
---

Fix the background mask coming out clipped and offset when the frame size differs from the track settings (device rotation, iPhone portrait), size the canvas fallback output to the source video's size, and keep the fallback render loop alive when `play()` is rejected.
