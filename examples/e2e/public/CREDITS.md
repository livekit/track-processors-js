# Harness fixtures

## `bg-solid.png`, `bg-alt.png`

Flat 64×64 PNGs, generated — magenta `#FF00FF` and cyan `#00FFFF`. Both colours appear nowhere
in the subject or in any compositor backdrop, so "did the virtual background get applied" is an
exact colour-match ratio rather than a heuristic. `bg-solid.png` is the default `?bg=`;
`bg-alt.png` is what the "Swap bg image" control switches to, which is how the image-swap and
image-caching cases get two distinguishable targets.

## `subject.png` — not committed

The compositor draws a procedural head-and-shoulders figure by default, so the harness needs no
photo of a person and nothing has to be licensed or committed. That figure is sufficient for
geometry, liveness, pipeline-path and resource-leak assertions, which is most of the suite.

It is *not* ideal for segmentation-quality assertions: mediapipe's selfie segmenter is trained
on real photographs, and mask quality against a drawn figure is lower and differently
distributed than against a real subject.

To use a real subject, drop a cutout at `examples/e2e/public/subject.png` and it is picked up
automatically — no code change. Requirements:

- PNG with an alpha channel, background fully removed
- head-and-shoulders framing, subject roughly filling the frame
- soft natural edges rather than a hard cutout, which segments closer to a real camera
- portrait aspect, around 640×853

Record the licence and attribution here when you add one. `?subject=<url>` overrides it per
test run without committing anything.
