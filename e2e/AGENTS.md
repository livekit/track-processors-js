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
- **The clean-console assertion is automatic.** The `app` fixture checks after every passing test
  that no forbidden string appeared, so specs never repeat it. Strings in `FORBIDDEN_CONSOLE` are
  each a filed issue.
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

Roughly in priority order:

- **the attach/detach leak check** (`G5`, `G6`) — blocked on #136; `counters().webgl.contextsLost`
  is already instrumented and is what the check will assert on
- **capture-time attachment** (`B5`) and the un-awaited attach/detach race (`B3`)
- **cross-origin and failing images** (`D2`, `D3`), and crop/mirror geometry (`D6`, `D7`)
- **the rest of suite J** (`J3`-`J7`) — live gain changes, teardown, audio and video together
- anything needing rotation, a real device, a room, or a second browser engine

`examples/e2e/room.ts` is the publishing path those last ones will use. Nothing automated drives
it today; it is reachable from the harness UI for manual reproduction against a real SFU.

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
