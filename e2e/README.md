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

Twenty-eight cases across eleven spec files; thirty-six tests at runtime, since several are
parameterised over primitives, resolutions or transitions.

| Spec | IDs | Concern |
| --- | --- | --- |
| `capability.spec.ts` | A1, A1b, A2, A2b, A3, A4 | Support predicates, both pipelines, and degrading to a disabled control |
| `lifecycle.spec.ts` | B1, B2, B6 | Attach, detach, and mute/unmute with a virtual background |
| `modes.spec.ts` | C1, C1b, C3, C7, C7b | Switching lands correctly and publishes no intermediate frame; `disabled` is true passthrough; falsy options clear the effect |
| `background.spec.ts` | D1, D4, D5 | Image composited behind the subject, swapped without a blank frame, fetched once |
| `geometry.spec.ts` | E1, E3 | Output dimensions follow the source, and a mid-call resolution change resizes the buffers |
| `performance.spec.ts` | G1 | `onFrameProcessed` timings are coherent at a usable frame rate |
| `segmentation.spec.ts` | H2 | A static subject does not make the mask flicker |
| `assets.spec.ts` | I4 | A 404 fileset fails fast, and a retry recovers |
| `audio.spec.ts` | J1, J2 | Gain at unity preserves the tone; gain values map to measured level |
| `devices.spec.ts` | K1 | A camera switch keeps the processor attached at the new resolution |
| `logging.spec.ts` | M1, M1b, M1c | The library's log level is respected |

IDs come from the coverage plan linked in the pull request.

[`AGENTS.md`](./AGENTS.md) covers the rest: the conventions these specs follow, how the
mode-switch artifact test works, what adding a browser involves, why the suite runs on one
worker, and what is not covered yet.
