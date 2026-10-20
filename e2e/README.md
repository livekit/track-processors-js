# End-to-end tests

Playwright specs driving the harness app at [`examples/e2e`](../examples/e2e/README.md). No
LiveKit server, no webcam, no fake-device launch flags — `getUserMedia` is mocked in the page.

```
pnpm test:e2e           # headless
pnpm test:e2e:headed    # a real window; PWSLOWMO=250 to slow it down enough to follow
pnpm test:e2e:ui        # Playwright UI: time-travel, per-step DOM snapshots
pnpm test:e2e:debug     # the inspector, with breakpoints
pnpm test:e2e:report    # open the HTML report from the last run
```

Filter with `--grep`, passed straight through (no `--` separator, pnpm forwards it):

```
pnpm test:e2e --grep "C1b"
pnpm test:e2e --grep "mode switching"
```

The runner starts the vite dev server itself on port 8081 and reuses one that is already
running, so `pnpm dev:e2e` can stay open while you iterate.

## Browser

Installed **Google Chrome** by default. `PW_CHANNEL=chromium` uses Playwright's bundled build
instead, which needs `npx playwright install chromium` and passes, but is slower and tests less:
its headless shell falls back to SwiftShader, where the WebGL filter step measures ~56 ms per
frame against ~2 ms on a real GPU. The suite takes 38 s on Chrome and 47 s on SwiftShader, and
the performance spec detects a software renderer and skips its frame-time assertion there.

Chrome only for now. Firefox, WebKit and BrowserStack devices need their own calibration pass.

## What's covered

Forty-three cases across twenty spec files; fifty-five tests at runtime, since several are
parameterised over primitives, pipelines, resolutions or transitions.

| Spec | IDs | Concern |
| --- | --- | --- |
| `capability.spec.ts` | A1, A1b, A2, A2b, A3, A4 | Support predicates, both pipelines, and degrading to a disabled control |
| `lifecycle.spec.ts` | B1, B2, B6 | Attach, detach, and mute/unmute with a virtual background |
| `prepublish.spec.ts` | B4 | A processor attached before publishing still publishes an aligned mask |
| `capture-time.spec.ts` | B5 | A processor handed to `createLocalTracks` at capture time |
| `restart.spec.ts` | B7 | `restartTrack()` publishes no black or grey frame |
| `track-ending.spec.ts` | B8 | A source track ending leaves the processor stoppable |
| `modes.spec.ts` | C1, C1b, C2, C3, C7, C7b | Switching publishes no intermediate frame; `disabled` is passthrough; falsy options clear the effect; the image texture is released |
| `background.spec.ts` | D1, D4, D5 | Composited behind the subject, swapped without a blank frame, fetched once |
| `cors.spec.ts` | D2 | A cross-origin image loads with CORS and degrades without |
| `geometry.spec.ts` | E1, E3 | Output dimensions follow the source, and a mid-call change resizes the buffers |
| `peer-geometry.spec.ts` | E2 | A remote peer decodes the source's aspect ratio |
| `performance.spec.ts` | G1, G2 | `onFrameProcessed` timings, and a sustained frame rate at the far end |
| `segmentation.spec.ts` | H1, H2 | The mask matches a committed golden, and does not flicker on a static subject |
| `assets.spec.ts` | I4 | A 404 fileset fails fast, and a retry recovers |
| `assets-cdn.spec.ts` | I1a, I1b | The default asset URLs resolve, and the fileset carries the pinned version |
| `assets-selfhosted.spec.ts` | I2 | Self-hosted assets segment with both CDNs blocked |
| `audio.spec.ts` | J1, J2 | Gain at unity preserves the tone; gain values map to measured level |
| `devices.spec.ts` | K1 | A camera switch keeps the processor attached at the new resolution |
| `logging.spec.ts` | M1, M1b, M1c | The library's log level is respected |
| `console.spec.ts` | M3, M3b | The happy path logs nothing, and that check has teeth |

Two tests are not ordinary cases. `C7` and `C2` are `test.fail()` — they document live library
bugs and will report as unexpectedly passing when those are fixed. `H1-regen` is skipped unless
`E2E_UPDATE_GOLDEN` is set, and rewrites the golden mask.

IDs come from the coverage plan linked in the pull request.

[`AGENTS.md`](./AGENTS.md) covers the rest: the conventions these specs follow, how the
mode-switch artifact test works, what adding a browser involves, why the suite runs on one
worker, and what is not covered yet.
