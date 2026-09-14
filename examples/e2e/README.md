# The e2e harness app

`examples/e2e` is the app the end-to-end suite drives. It needs no LiveKit server and no
webcam: `getUserMedia` is replaced with a deterministic canvas compositor, and measurement APIs
hang off `window.harness`.

```
pnpm dev:e2e     # http://localhost:8081
```

It is also the fastest way to reproduce a rendering bug by hand. `?fallback=1` in particular
runs the canvas-captureStream path — normally only reachable on Safari — under Chrome, where
you have DevTools.

## Why it exists separately from `examples/demo`

The demo can't be the test target. Every processor action there begins with
`if (!currentRoom) return;` and pulls the track off `localParticipant`, so nothing works without
a server and a hand-minted token. It also mocks nothing, exposes no processed track, and shows
state only as button label text. Fixing that in place would have meant refactoring a
public-facing sample; a purpose-built app has none of those problems by construction.

## Driving it

Every control is a thin wrapper over the same harness method, so clicking a button and calling
the API take an identical code path. Use real clicks for the behaviour under test and direct
calls for setup that shouldn't race the UI.

```ts
await page.goto('/?backdrop=flat');
await page.waitForFunction(() => window.harness?.isReady === true);

await page.click('[data-testid="start-video"]');       // or harness.media.startVideo()
await page.click('[data-testid="attach-processor"]');
await page.evaluate(() => window.harness.probe.waitForFrames(15, 20000));

const sample = await page.evaluate(() => window.harness.probe.sample());
```

`isReady` is a boolean field, not only a promise, so an Appium session on a BrowserStack device
can poll it synchronously — `addInitScript` and `waitForFunction` aren't available there.

Import the types into specs so they compile against the real surface:

```ts
import type { Harness, FrameSample } from '../examples/e2e/types';
```

### Selectors

Every control carries a `data-testid` equal to its `id`. Never assert on button text. State a
spec is likely to wait on is mirrored onto `document.body.dataset`:

`ready`, `mode`, `pipeline`, `videoProcessor`, `audioProcessor`, `videoTrack`, `resolution`,
plus `bootError` if boot threw.

## The fake camera

Each frame is a pure function of an integer frame index:

```
procedural backdrop (flat | checker | gradient)   ← ?backdrop=
  + a head-and-shoulders figure at a known rect   ← ?motion=, frame index
  → canvas at the requested resolution → captureStream()
```

Three things follow from that, and they are the reason it isn't a video file:

- **A static input is genuinely static.** The stream keeps emitting frames while every frame is
  pixel-identical, which a looping video cannot do. That is what the segmentation-flicker case
  needs.
- **`backdrop=flat`** gives an exact background colour, so background replacement is a
  colour-match ratio and the foreground box is the bbox of non-matching pixels.
- **Ground truth.** `harness.camera.subjectRect()` returns where the compositor actually drew
  the subject, so segmentation scores as IoU against truth rather than a golden image.

A video fixture was rejected because no single codec decodes on all five targets (WebKit
refuses VP8/VP9 WebM; H.264 isn't guaranteed on Playwright's Chromium or Firefox CI builds),
and because `HTMLMediaElement.captureStream()` doesn't exist on WebKit at all — the canvas
compositor is mandatory regardless. `?camsrc=<url>` remains as an escape hatch.

### The subject

The default figure is drawn from primitives, so nothing has to be licensed or committed. It is
detected by mediapipe, but less reliably than a real person. For segmentation-*quality* work,
drop a cutout at `examples/e2e/public/subject.png` — it is picked up automatically. See
`examples/e2e/public/CREDITS.md`.

## Query parameters

Anything that can change at runtime is a method, not a parameter. These are parameters because
`segmenterOptions`, `assetPaths` and `maxFps` are read once inside `BackgroundProcessor()` and
cannot be changed afterwards, or because they must apply before boot. Tests vary them by
reloading, which matches how a real integration would.

| Param | Default | Effect |
| --- | --- | --- |
| `fallback` | `0` | Removes the insertable-streams globals before boot, forcing the canvas path |
| `delegate` | GPU | `segmenterOptions.delegate` — `CPU` or `GPU` |
| `assets` | `cdn` | `local` points wasm and model at self-hosted copies |
| `wasm` / `model` | CDN | Individual `assetPaths` overrides |
| `maxfps` | `30` | `ProcessorWrapperOptions.maxFps` |
| `api` | `modern` | `legacy` routes through the deprecated `BackgroundBlur()` / `VirtualBackground()` |
| `attach` | `set` | `capture` routes through `createLocalVideoTrack({ processor })` |
| `mode` | `background-blur` | Initial mode |
| `blur` | `10` | Blur radius |
| `bg` | `/bg-solid.png` | Virtual background image |
| `cam` | `front` | `front` 640×480, `wide` 1280×720, `portrait` 480×640, `back` 1280×720 |
| `camres` | per device | e.g. `camres=1280x720` |
| `backdrop` | `checker` | `flat`, `checker`, `gradient` |
| `backdropcolor` | `#1d6fa5` | Backdrop base colour |
| `motion` | `static` | `static`, `pan`, `wave` |
| `camclock` | `raf` | `raf`, `interval`, `worker`, `manual` |
| `camfps` | `30` | Compositor frame rate |
| `subject` | `/subject.png` | Subject cutout override |
| `camsrc` | — | Replace the compositor with a video file |
| `autostart` | `0` | Start camera and processor on load |
| `url` / `token` | — | Enable the optional room mode |

## Measurement

### `probe` — pixels and frames

Reads `processor.processedTrack` through its own offscreen video element. It never reads the
on-page preview, which is CSS-mirrored.

- `sample(opts)` → `FrameSample`: real `width`/`height`, a 64-bit average `hash`, per-region
  `blurEnergy` / `stdDev` / `edgeDensity` / `mean`, `backgroundMatchRatio`, `foregroundBox`.
- `waitForFrames(count, timeoutMs)` — liveness.
- `waitForStable()` — resolves once two consecutive samples hash-match. Call it before any
  pixel assertion.
- `expectedForegroundBox()` — compositor ground truth.
- `startRecording(opts)` / `stopRecording()` — fingerprint **every** presented frame, rather
  than polling. This is how mode-switch artifacts are caught: polling can only show that no bad
  frame was observed, never that none was published. Recording runs at 96px so it keeps up with
  a 30fps track, which means its `bgBlurEnergy` values are on a different scale from
  `sample()`'s — compare recorded frames only against recorded references.

**`foregroundBox` needs a low-frequency background.** It learns the background as a small
palette from a border ring. On `backdrop=flat`, or against an active virtual background, it is
exact. On `backdrop=checker` it returns the full frame, because downscaling blends adjacent
checker cells into colours that match neither — use `backdrop=flat` for geometry assertions,
and compare `regions.fg.blurEnergy` against `regions.bg.blurEnergy` for blur assertions.

**`processedSettings` is usually empty of dimensions.** On the insertable-streams path the
published track is a `MediaStreamTrackGenerator`, which reports no width/height. For real output
dimensions use `probe.sample().width/height`, which come from the decoded frame.

### `room` — encoder stats

Only needed by the cases that assert *publishing*: the hidden-tab and minimised-window freezes,
and cross-browser interop. A hidden tab throttles the probe's own video element, so
`requestVideoFrameCallback` can't tell a frozen pipeline from an unpainted probe — only a real
encoder can.

```ts
await harness.room.connect(url, token);
await harness.room.publish();
const { fps, framesEncodedDelta } = await harness.room.measure(5000);
```

### `counters` — leaks

`created` counts are exact and are what assertions should use. `liveWeak` rests on
`FinalizationRegistry`, which offers no timing guarantee — diagnostic only.

## Calibration

Observed on headless Chrome 153, macOS, 1280×720, with the default procedural subject. Treat as
order-of-magnitude, not as thresholds; recalibrate per target on the first green run.

| Measurement | Value |
| --- | --- |
| `regions.bg.blurEnergy`, raw checker input | 0.070 |
| `regions.bg.blurEnergy`, blur applied | 0.017 |
| `regions.fg.blurEnergy`, blur applied | 0.028 (sharper than bg — segmentation working) |
| `backgroundMatchRatio` against `bg-solid.png` | 0.994 |
| `foregroundBox` on `backdrop=flat`, raw | 0.19, 0.12, 0.63 × 0.87 (truth 0.20, 0.08, 0.60 × 0.92) |
| Processor fps | 24–30 |
| `processingMs.p50` | ~2.2 ms |
| Mic tone, gain 1.0 | rms 0.145, dominant 445 Hz (440 Hz source, 23 Hz bins) |
| Mic tone, gain 0 | rms 0.000 |
| GL renderer, Chrome | ANGLE / Metal — hardware |
| GL renderer, Playwright's bundled headless shell | SwiftShader — software, ~25x slower filter step |

## Known library findings this surfaced

These are the harness reporting real behaviour, not harness bugs.

- **WebGL contexts leak at ~2 per setProcessor/stopProcessor cycle.**
  `src/webgl/index.ts` `cleanup()` deletes textures and programs but never calls
  `loseContext()`, and `VideoTransformer.destroy()` only drops the reference. Chrome caps live
  contexts near 16 and starts discarding the oldest; past that the renderer becomes unresponsive.
  Reproduce with `harness.counters().webgl.created` across cycles.
- **`FrameProcessingStats` is not exported.** It is named by the public
  `BackgroundOptions.onFrameProcessed` signature but not re-exported from `src/index.ts`, so a
  consumer cannot name the type it is handed. `examples/e2e/types.ts` derives it from the public
  surface rather than importing the internal path — the pattern that broke Angular builds in
  issue #115.
- **`livekit-client` bundles `webrtc-adapter`,** which captures the native `getUserMedia` on
  import and installs its own shim as an *own* property of `navigator.mediaDevices`. Any mock
  must define on the instance as well as the prototype, and must install after livekit-client's
  module has been evaluated. See the comment in `fakeCamera.ts` `install()`.
