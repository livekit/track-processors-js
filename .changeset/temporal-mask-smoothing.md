---
'@livekit/track-processors': minor
---

Add a `temporalSmoothing` option to `BackgroundProcessor` that blends each mask with the previous one, more where the picture is still, so the edge holds still between frames without trailing behind movement
