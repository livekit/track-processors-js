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

Seventeen cases across eleven concerns.

| Spec | IDs | Concern |
| --- | --- | --- |
| `capability.spec.ts` | A1, A1b, A3, A4 | Support predicates; both pipelines selected and working |
| `lifecycle.spec.ts` | B1, B2 | Attach produces blurred frames; detach restores them |
| `modes.spec.ts` | C1, C1b, C3 | Switching lands correctly, publishes no intermediate frame, and `disabled` is true passthrough |
| `background.spec.ts` | D1, D5 | Image composited behind the subject; fetched once |
| `geometry.spec.ts` | E1 | Output dimensions follow the source at three resolutions |
| `performance.spec.ts` | G1 | `onFrameProcessed` timings are coherent at a usable frame rate |

[`AGENTS.md`](./AGENTS.md) covers the rest: the conventions these specs follow, how the
mode-switch artifact test works, what adding a browser involves, why the suite runs on one
worker, and what is not covered yet.
