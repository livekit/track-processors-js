# Working on the e2e suite

Context for changing these tests. [`README.md`](./README.md) covers running them; the harness
app they drive is documented in [`examples/e2e`](../examples/e2e/README.md).

## Conventions

- **Setup goes through the harness API, the behaviour under test goes through the UI.** Helpers
  in `helpers.ts` drive setup so it cannot race a button's async handler; whatever a spec is
  actually asserting is driven by a real click.
- **Never assert on button text** — labels change with state. Use `data-testid`, or the mirrored
  `document.body.dataset` values.
- **Every threshold lives in `thresholds.ts`**, each with the value actually observed beside it.
  Move one only with its observation updated too, and prefer recording the negative control —
  the value the same measurement takes when the behaviour is broken — next to it.
- **The clean-console assertion is automatic, and it is an allowlist.** The `app` fixture checks
  after every passing test that nothing reached `console.error`, `pageerror` or the harness's own
  log that an entry in `ALLOWED_CONSOLE` does not explain. Strings in `FORBIDDEN_CONSOLE` are
  each a filed issue and are named first, so a known bug reports by name. If your case provokes
  an error on purpose, declare it — `app.allowConsole()` beside the provocation where it is
  local to one test, or a URL- and test-scoped entry in `ALLOWED_CONSOLE` where the browser
  emits it and the page cannot clear it. Never widen an existing entry to cover a new case.
- **Frame count is not liveness.** A muted or frozen pipeline still presents frames: D2 measured
  60 frames at 29.8 fps with **one distinct hash** and zero foreground luma. If you mean "still
  working", assert on distinct hashes, foreground luma or energy — not on `waitForFrames` alone.
- **Take raw-camera baselines before attaching.** `setProcessor` leaves
  `LocalVideoTrack.mediaStreamTrack` pointing at the processed track, so `sampleSource()` returns
  *treated* frames once a processor is attached — measured identical to `sampleProcessed()`, hash
  and all. A before/after comparison taken the wrong way round compares a thing with itself and
  cannot fail; that is exactly how `C3` passed while asserting nothing.
- **Prefer comparing frames to comparing statistics.** Region energy says a frame is *as detailed
  as* the reference; `probe.captureReference()` / `probe.diffFromReference()` say it is *the same
  frame*. B2 uses the second for exactly that reason.

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

## Adding a browser

`capability.spec.ts` holds a per-browser capability matrix. A new Playwright project fails `A1`
until it has an entry, on purpose: those flags decide which pipeline the library selects, so they
have to be observed on the target rather than inherited from Chrome. Safari is the interesting
case — no insertable streams, so `hasModernApiSupport` is false and the fallback path becomes the
live one rather than something `A3` has to force.

`A1b` asserts the predicates follow from the underlying primitives and holds anywhere, so it
needs no entry.

Thresholds are calibrated on headless Chrome and need a recalibration pass per target.

## Why one worker

`workers: 1`, until [#136](https://github.com/livekit/track-processors-js/issues/136) is fixed.
Each attach/detach cycle creates a WebGL context the library never releases — `cleanup()` does
not call `loseContext()` — so contexts accumulate until GC collects them. Chrome caps live
contexts per GPU process near 16 and discards the oldest past that, which can leave the renderer
unresponsive. Workers share that GPU process, so parallelism reaches the cap several times faster
and fails as what looks like flakiness.

`harness.counters().webgl` tracks this directly: `created` rises by one per cycle, and
`contextsLost` stays at zero while the bug is open. Once the fix lands, `contextsLost` should
rise in step and `created - contextsLost` should stop growing — which is the assertion the leak
check has been waiting on.

## Not covered yet

Thirty-four of the ninety-nine cases in the coverage plan are written. Every P0 that runs on
desktop Chrome is now covered; what is left falls into four groups.

- **Thirty cases that could be written today**, all P1 or P2: the rest of suite J (`J3`-`J7`),
  more of D (`D3`, `D6`, `D7`, `D9`), C (`C5`, `C6`, `C8`), A (`A5`, `A6`, `A7`), H (`H3`, `H4`),
  I (`I3`, `I5`, `I6`), K (`K2`-`K4`), M (`M2`, `M4`), B (`B3`, `B10`-`B12`), E (`E10`), G (`G3`).
- **Five blocked on [#136](https://github.com/livekit/track-processors-js/issues/136)** — the
  leak checks (`G5`, `G6`, `B3`, `B9`, `B12`). `counters().webgl.contextsLost` is already
  instrumented and is what they will assert on.
- **Seventeen needing a target this runner does not have**: Firefox (`C4`, `D8`, `F1`, `F4`,
  `F5`, `F7`, `G4`, `G7`), real iOS (`E4`-`E7`, `E9`, `F6`, `J6`, `K5`) and Android (`E8`).
- **Thirteen that are not Playwright work**: suite N (packaging, seven) and suite L (peer
  interop, six — two browsers or a real room).

`examples/e2e/room.ts` is the publishing path suite L will use. Nothing automated drives it
today; `harness.loopback` covers the cases that only need an encoder, without a server.

### Known gaps in the harness itself

- **The fake camera has no noise.** `H2` measures a flip rate of exactly zero on a static input,
  because mediapipe is deterministic and a canvas compositor has no sensor noise. The shimmer in
  #76 and #98 is the segmenter amplifying noise that this harness cannot produce, so `H2` guards
  against a regression rather than reproducing the complaint. Closing those issues needs a noise
  option on the compositor, or a real-camera fixture.
- **`setBackgroundImage` rebinds its own config copy**, so `snapshot().backgroundImage` is stale
  after any image change, and the "Swap bg image" control is advertised as a toggle but only moves
  one way. Sample pixels through the probe rather than trusting that field.
- **Rebinding the probe to the source serves stale frames.** After the probe has been bound to the
  processor's output, `sample({ source: 'source' })` can return the previously painted processed
  frame for ~300 ms: `waitForData()` returns immediately because `readyState` is still ≥2 from the
  old stream, and `waitForStable()` does not save you, since two stale reads hash-match. Take raw
  baselines *before* attaching.

## Known slow spot

A page load fetches the mediapipe wasm fileset and model from a CDN, which dominates per-test
cost and puts a network dependency in a suite that is otherwise hermetic. Self-hosting them
behind `?assets=local` is the fix.

## Traps, each one measured

Every item here cost an agent a wrong result before it was found. Read before writing a case
that touches the same machinery.

- **The probe binds on the track object, not its id.** Chrome names a remote track after the
  `a=msid` of the offer, so a loopback's far end carries the *sender's* track id. Keyed by id,
  a rebind is a silent no-op and every sample re-reads the local frame. Worse, the obvious guard
  does not catch it: the encoder ramps 320→480→640→960→1280, so once it reaches 1280 a stale
  local 1280x720 frame agrees with the decoded size by coincidence. Assert the probe's frame
  counter restarted as well.
- **The probe presents one black frame when a generator track ends.** Proven with no library
  code at all: 20 orange `VideoFrame`s into a bare `MediaStreamTrackGenerator`, then
  `writer.close(); gen.stop()`, presents 21 frames — the last at (0,0,0). Exclude that one
  frame, keep a longest-run bound, and never attribute it to the library.
- **Counting frames straight after a teardown reads 1, not 0**, on about two runs in three — a
  frame already decoded and queued at the probe. Open the window after a settle.
- **`route.fulfill` injects `access-control-allow-origin: *`.** A truly absent CORS header is
  not expressible; use a mismatched origin instead. The two-real-origins trick does not work
  either, since vite's dev server answers both.
- **`camera.freeze()` stops the redraw, and a canvas-captured track only emits while something
  draws into it.** Freezing alone kills the track. Pin a frame with `freeze()` plus a repaint of
  the same index. `motion=static` with `setFrame(n)` does not work: under static the offset is
  hard-coded to 0, so the index has no effect on pixels.
- **The encoder ramps.** A 1280x720 source decodes at 320x180 for the first seconds. The aspect
  ratio is right from the first frame; the absolute size is not.
- **Assets can be served locally.** `?assets=local` serves the wasm fileset out of
  `node_modules` and a cached model, with nothing committed, and attaches in 141-194 ms against
  762-874 ms on a warm CDN. Prefer it for any case that does not test the CDN itself.
