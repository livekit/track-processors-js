---
'@livekit/track-processors': patch
---

Fix the processed track freezing for remote participants when the sender minimises or occludes the window in browsers without Insertable Streams (Firefox, Safari): the fallback pipeline's render loop is now driven by a worker timer, which keeps ticking while the document is hidden, instead of requestAnimationFrame, which does not.

Also fix the fallback pipeline running below its configured `maxFps`: the frame gate compared the elapsed time against a fixed interval, which quantised the output rate against any periodic clock (`maxFps: 30` measured 20.8 to 23.0 fps), and is now a drift-free deadline.
