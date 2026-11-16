---
'@livekit/track-processors': minor
---

Add an `edgeRefinement` option to `BackgroundProcessor` that refines the mask against the camera frame, so its edge follows the outline in the picture rather than the model's coarse guess. `edgeRefinementRadius` (default 4) sets how far it looks: a smaller radius costs less per frame but corrects an edge less far off
