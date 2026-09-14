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

Sixteen cases across eleven concerns. IDs match the coverage plan.

| Spec | IDs | Concern |
| --- | --- | --- |
| `capability.spec.ts` | A1, A3, A4 | Support predicates; both pipelines selected and working |
| `lifecycle.spec.ts` | B1, B2 | Attach produces blurred frames; detach restores them |
| `modes.spec.ts` | C1, C1b, C3 | Switching lands correctly, publishes no intermediate frame, and `disabled` is true passthrough |
| `background.spec.ts` | D1, D5 | Image composited behind the subject; fetched once |
| `geometry.spec.ts` | E1 | Output dimensions follow the source at three resolutions |
| `performance.spec.ts` | G1 | `onFrameProcessed` timings are coherent at a usable frame rate |

Not covered yet, in rough priority order: audio (J1, J2 — the harness measurement already
works), the attach/detach leak check (blocked on the WebGL context leak below), capture-time
attachment (B5), mute/unmute (B6), and everything needing rotation, a real device, a room or a
second browser.

## How the artifact test works

`C1b` is the one worth understanding. Switching modes must go straight from a frame carrying the
old treatment to a frame carrying the new one — no grey flash (#96), no green plate (#41), no
black frame (#111), no raw camera showing through (#85).

Polling with `sample()` cannot establish that: it only shows that no bad frame happened to be
observed. So the probe fingerprints **every presented frame** across the transition, and each is
classified against references captured from the settled state in the same run — which is why the
tolerances only have to absorb frame-to-frame noise rather than variation between machines.

It has teeth. Replacing `switchTo()` with the teardown-and-rebuild pattern it was introduced to
avoid produces a timeline of `FFFFFXXTTTTTTTT` — two frames matching neither treatment — where
`switchTo()` produces zero. That negative control is not committed, since it asserts that a bug
exists; it is reproduced by swapping the switch in the spec for
`setVideoProcessorEnabled(false)` followed by `switchMode(...)`.

## Conventions

- **Setup goes through the harness API, the behaviour under test goes through the UI.** Helpers
  in `helpers.ts` drive setup so it cannot race a button's async handler; whatever a spec is
  actually asserting is driven by a real click.
- **Never assert on button text** — labels change with state. Use `data-testid`, or the mirrored
  `document.body.dataset` values.
- **Every threshold lives in `thresholds.ts`**, each with the value actually observed beside it.
  Move one only with its observation updated too.
- **The clean-console assertion is automatic.** The `app` fixture checks after every passing test
  that no forbidden string appeared, so specs never repeat it. Strings in `FORBIDDEN_CONSOLE` are
  each a filed issue.

## Why one worker

`workers: 1`, deliberately. Every attach/detach cycle leaks a WebGL context — `src/webgl/index.ts`
`cleanup()` never calls `loseContext()` — and Chrome caps live contexts per GPU process at around
16, past which it discards the oldest and the renderer can stop responding. Parallel workers share
that process and would hit the cap several times faster, failing in ways that look like flakiness
rather than like the leak they are. Raise this once the leak is fixed.

## Known slow spot

A page load fetches the mediapipe wasm fileset and model from a CDN, which dominates per-test
cost and puts a network dependency in a suite that is otherwise hermetic. Self-hosting them
behind `?assets=local` is the fix.
