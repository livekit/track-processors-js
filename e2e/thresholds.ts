/**
 * Every number the suite asserts on, in one place.
 *
 * Each carries the value actually observed on headless Chrome 153 / macOS at 1280x720 with the
 * default subject, public/subject.png. They are deliberately loose around those observations: the point
 * is to catch a pipeline that has stopped working, not to pin rendering to the pixel. Recalibrate
 * per target before enabling a new browser, and move a threshold only with the observation
 * updated alongside it.
 */

export const BLUR = {
  /** Background high-frequency energy on a raw checker input. Observed 0.070. */
  RAW_BG_ENERGY_MIN: 0.04,
  /** Blur must remove at least this fraction of it. Observed drop 0.070 -> 0.017, i.e. 76%. */
  MIN_REDUCTION: 0.55,
  /**
   * With the processor detached, background energy must return to near the raw baseline.
   * Observed back to within a few percent.
   */
  RESTORED_RATIO_MIN: 0.7,
  /**
   * And the frame itself must be the one from before the processor was attached, not merely one
   * with comparable energy.
   *
   * Observed 99.90% of pixels unchanged at a mean difference of 1.49/255. The negative control
   * is the same comparison taken while the blur is still attached, which gives 62.87% and 10.43
   * — so these sit with a wide margin on both sides.
   */
  RESTORED_PIXEL_RATIO_MIN: 0.98,
  RESTORED_MEAN_DIFF_MAX: 5,
  /**
   * Segmentation is working when the subject stays sharper than the background it sits on.
   * Observed fg 0.028 vs bg 0.017.
   */
  FG_OVER_BG_MIN: 1.25,
};

export const VIRTUAL_BACKGROUND = {
  /** bg-solid.png is flat #FF00FF. */
  COLOR: { r: 255, g: 0, b: 255 },
  /** Per-channel tolerance when matching it. */
  TOLERANCE: 60,
  /** Fraction of background-region pixels that must match. Observed 0.994. */
  MATCH_RATIO_MIN: 0.9,
};

export const GEOMETRY = {
  /**
   * How far the centre of the segmented subject may sit from the centre of where the compositor
   * drew it. Observed 0.005 and 0.055 on the two axes.
   *
   * Centre rather than edges: the mask legitimately covers less than the layout rect handed to
   * the draw call — mediapipe finds the head and upper torso and drops the lower torso at the
   * frame edge, giving a box of 0.35/0.12 0.31x0.73 against a truth of 0.20/0.08 0.60x0.92.
   * The property worth asserting is that the subject is where it was drawn, not that the mask
   * traces a rectangle it was never going to trace.
   */
  CENTRE_TOLERANCE: 0.12,
  /** The mask must stay inside the drawn rect, allowing this much bleed. */
  CONTAINMENT_MARGIN: 0.08,
  /** Plausible share of the frame for a head-and-shoulders subject. */
  COVERAGE_MIN: 0.05,
  COVERAGE_MAX: 0.6,
};

export const PASSTHROUGH = {
  /**
   * In 'disabled' mode the output should be the input. Compared as per-channel distance between
   * region means, which tolerates encode differences without tolerating an actual effect.
   */
  MEAN_TOLERANCE: 18,
  /** And the background must keep its high-frequency detail, unlike in blur mode. */
  ENERGY_RATIO_MIN: 0.6,
};

export const PERFORMANCE = {
  /** Observed 24-30 on Chrome with a GPU, 16 on SwiftShader. */
  MIN_FPS: 12,
  /**
   * Observed p50 2.2ms on a real GPU. A 33ms p50 could not sustain 30fps.
   *
   * Only asserted on a hardware renderer: on SwiftShader the same work measures ~58ms, which
   * says something about the rasterizer rather than about the library.
   */
  MAX_P50_PROCESSING_MS: 33,
  /**
   * Segmentation runs on the mediapipe delegate rather than our WebGL path, and stays near 3ms
   * on both hardware and software renderers, so it can be asserted everywhere.
   */
  MAX_P50_SEGMENTATION_MS: 15,
  /** How many frames to gather before judging. */
  SAMPLE_FRAMES: 60,
};

export const SWITCH = {
  /**
   * Frames captured during a mode switch that match neither the old nor the new treatment.
   *
   * Zero. This is the assertion the test exists for: switching must go straight from a frame
   * with the old effect to a frame with the new one, with nothing — no grey flash (#96), no
   * green plate (#41), no black frame (#111), no raw camera showing through (#85) — in between.
   */
  MAX_UNCLASSIFIED_FRAMES: 0,
  /**
   * Per-channel distance from a reference fingerprint for a frame to count as that treatment.
   * Reference fingerprints are captured from the settled state in the same run, so this only
   * has to absorb frame-to-frame noise, not cross-machine variation.
   */
  MATCH_TOLERANCE: 30,
  /**
   * Blur-energy tolerance when matching a frame to a reference. Recording runs at 96px, where
   * energies are lower than the 320px figures elsewhere in this file; calibrated separately.
   */
  ENERGY_TOLERANCE: 0.02,
  /** Frames to capture on each side of the switch before judging it. */
  MIN_FRAMES_EACH_SIDE: 3,
};

/** Strings that must never appear in the console. Each one is a filed issue. */
export const FORBIDDEN_CONSOLE = [
  // #47 — logged when the blur effect is stopped
  'Empty video frame',
  // #89 — the restart race, which leaves a frozen published track
  'InvalidStateError: Stream closed',
  // #22 — setting a processor on an ended track
  'Input track cannot be ended',
  // #30 / #84 — the context leak becoming visible
  'too many active WebGL contexts',
];

/**
 * A2 — what an environment missing one of the four primitives has to look like.
 *
 * Strings rather than numbers, but the same rule applies: both were read off real runs
 * (`?break=offscreencanvas|videoframe|createimagebitmap|webgl2` on headless Chrome 153 /
 * macOS) rather than copied out of the source, so a reworded message fails here instead of
 * quietly passing a `toContain` that no longer means anything.
 *
 * The case has two negative controls, both reproduced by a one-line edit rather than
 * committed, since each asserts the bug rather than the fix:
 *
 * - Construct unconditionally in `Media`'s constructor instead of asking
 *   `support.supported` first — i.e. #10. Every `?break=` load then dies during boot with
 *   `body.dataset.bootError = "Background transformer is not supported in this browser"`,
 *   no `window.harness` at all, and the attach button left enabled behind a blank panel. All
 *   four A2 cases fail at `app.goto()`; A2b still passes, which is the point of having it.
 * - Keep that guard but drop the `PROCESSOR_CONTROLS` disable loop in `ui.ts`. The boot
 *   survives, and A2 fails on `toBeDisabled()` with `Received: enabled` — so the UI half of
 *   the assertion has teeth of its own and is not carried by the construction guard.
 */
export const DEGRADED = {
  /**
   * Thrown by `BackgroundProcessor()` when `BackgroundTransformer.isSupported` is false.
   *
   * Observed verbatim from `harness.tryCreateProcessor()` with each of the four primitives
   * removed in turn. It is a public, documented failure: an integration that calls the factory
   * without asking `supportsBackgroundProcessors()` first gets this, which is how #10 and #38
   * reached users as a white screen and an uncaught error.
   */
  TRANSFORMER_ERROR: 'Background transformer is not supported in this browser',
  /**
   * The start of the harness's own explanatory label, mirrored onto
   * `document.body.dataset.processorUnsupportedReason`.
   *
   * Observed in full as "Background processing is unavailable in this browser: missing
   * webgl2." and, with the other three removed, the same sentence naming `OffscreenCanvas`,
   * `VideoFrame` or `createImageBitmap`. The spec asserts the missing primitive is named as
   * well as the prefix, which is what makes the label explanatory rather than merely present.
   */
  REASON_PREFIX: 'Background processing is unavailable in this browser',
};

/**
 * B6 — the virtual background surviving a mute/unmute cycle.
 *
 * Observed on headless Chrome 153 / macOS with `backdrop=flat`, `motion=static` and the default
 * `/bg-solid.png` plate. See [#41](https://github.com/livekit/track-processors-js/issues/41):
 * unmuting brought the pipeline back as a flat green plate rather than the configured image.
 */
export const MUTE_RESTORE = {
  /** How long to leave the camera muted. Long enough for the pipeline to settle on black. */
  MUTED_MS: 2000,
  /**
   * The image must be back this soon after the unmute click, measured from before the click so
   * the dispatch and the handler count against it. Observed 74-104ms over five runs, i.e. the
   * first or second frame after the source started producing again.
   *
   * Left at a second rather than tightened around that: the property worth guarding is that
   * the image returns promptly, not that it returns in two frames on this machine. The
   * negative control below sits at the deadline, so the gap is an order of magnitude wide.
   */
  MAX_RECOVERY_MS: 1000,
  /**
   * The specific colour #41 produced: a flat green where the image belongs.
   *
   * It is what a zero-filled YUV420 frame decodes to under BT.601 — Y=U=V=0 gives r 0, g 135,
   * b 0 — which is the shape of that bug, a frame handed on before anything was drawn into it.
   */
  GREEN_PLATE: { r: 0, g: 135, b: 0 },
  /**
   * Minimum per-channel distance the restored background mean must keep from that green, and
   * from black (#111's failure).
   *
   * The restored background measures rgb(255, 0, 255) — the plate exactly — which is 255 from
   * both, so this has four times the margin it needs. It is asserted separately from the match
   * ratio so a regression names the colour it came back as instead of only reporting that the
   * ratio fell.
   *
   * Negative control: suppressing the unmute click leaves the frame at rgb(0, 0, 0), a
   * distance of 0 from black, and the recovery assertion fails first at 1002ms with a 0.0%
   * match. The same sample taken during the mute reads 0.0% and rgb(0, 0, 0) too, and B6
   * records it in its failure message for exactly that reason.
   */
  MIN_PLATE_DISTANCE: 60,
};

/**
 * Clearing an effect by handing `updateTransformerOptions` a falsy value — #37.
 *
 * Both numbers are about the same thing: after `blurRadius: 0` or `imagePath: undefined` the
 * background must be camera content again, not a treated or blank plate.
 */
export const FALSY_OPTIONS = {
  /**
   * Background energy after clearing, as a fraction of the same background unprocessed.
   *
   * Observed 0.83 (0.0579 of a raw 0.0700) once the effect is genuinely gone — the shortfall is
   * the encode hop, not a residual effect. Three negative controls sit well below it: a blur
   * that stayed on measures 0.24, `blurRadius: 0` on the library as it stands measures 0.04
   * (it blanks the background to black rather than restoring it — see C7), and a virtual
   * background that stayed up measures 0.02.
   */
  CLEARED_ENERGY_RATIO_MIN: 0.6,
  /**
   * And no trace of the virtual background plate may remain. Observed 0.000, against 0.994 with
   * the plate still composited, which is what reintroducing #37's guard on `imagePath` produces.
   */
  CLEARED_MATCH_RATIO_MAX: 0.1,
};

/**
 * D4 — swapping one virtual background image for another.
 *
 * Classification reuses SWITCH.MATCH_TOLERANCE and SWITCH.ENERGY_TOLERANCE: the measurement is
 * C1b's, taken at the same 96px recording scale against references from the same run.
 */
export const BACKGROUND_SWAP = {
  /** bg-alt.png is flat #00FFFF, picked so it cannot be confused with bg-solid.png's #FF00FF. */
  ALT_COLOR: { r: 0, g: 255, b: 255 },
  /**
   * How long the incoming image's response is held back while the swap is recorded.
   *
   * The delay is the case. Off the local dev server bg-alt.png arrives in a couple of
   * milliseconds, and a flash confined to that window lands on no frame at all — which is why
   * #105 was only ever reported from slow machines. With the bug reinstated and no delay the
   * recording reads AAAAAABBBBBBBB, zero bad frames; at 800ms it reads
   * AAAAAAAXXXXXXXXXXXXXXXXXXXXXXXBBBBBBBB.
   *
   * 800ms spans ~23 frames at 30fps, which is wide enough to be unambiguous and short enough
   * that the case still runs in about four seconds.
   */
  IMAGE_DELAY_MS: 800,
  /**
   * Frames captured across the swap matching neither image.
   *
   * Zero, for the same reason SWITCH.MAX_UNCLASSIFIED_FRAMES is zero: the outgoing plate has to
   * stay up until the incoming one is ready. Observed 0 of 39.
   *
   * The negative control is the #105 shape itself — clearing bgTexture to the empty placeholder
   * in setBackgroundImage(null), so the plate is dropped when the swap is requested rather than
   * when the new image lands. That gives 23 frames of bg=(255,255,255), the empty background
   * showing through as white. Not committed, since it asserts that a bug exists.
   *
   * Driving the swap from the spec cannot produce it: clearing the image and re-setting it,
   * or routing through background-blur in between, both still read 0, because the GL keeps the
   * old plate in bgTexture and nothing overwrites it until the new crop is ready.
   */
  MAX_UNCLASSIFIED_FRAMES: 0,
  /**
   * Frames of the outgoing image before the new one lands.
   *
   * Guards against the opposite failure of a too-short measurement: if the response were served
   * from cache, or the recording started late, the window the bug lives in would never have been
   * covered and a clean timeline would prove nothing. Observed 31 of 39 with the delay applied,
   * against 6 without it.
   */
  MIN_HELD_FRAMES: 10,
};

/**
 * E3 — the frame size changing under a running processor.
 *
 * Separate from GEOMETRY, which is about where the mask sits at one fixed resolution. These are
 * about how the output follows a resolution change that arrives mid-call.
 *
 * Negative controls, one per pipeline, since the two fail differently:
 *
 *   - **Canvas fallback.** Pinning `displayCanvas` to its setup size (dropping the per-frame
 *     resize in ProcessorWrapper's render loop) leaves the published output stuck at 1280x720
 *     while the source produces 640x360 — the frame is just stretched back up. `aligned` never
 *     becomes true and the trail shows `size` at "1280x720" for the full 10s. That is the
 *     control this case is really calibrated against.
 *   - **Insertable streams.** Making `ensureBuffersMatchCanvas()` a no-op, which is the pre-#128
 *     "allocate once" behaviour, does *not* fail at a constant aspect ratio: the shaders sample
 *     the mask through normalized coordinates, so a stale buffer only costs mask resolution
 *     (coverage 0.1646 against 0.1752 correct, centre off by 0.0016). It is a genuine
 *     misalignment only once the aspect ratio changes too, which is the rotation half of #128
 *     and needs a real device. Recorded here so the next person does not read this case as
 *     covering more of the WebGL path than it does.
 */
export const RESOLUTION_CHANGE = {
  /**
   * How long the mask may lag the frame size, measured from the first frame carrying the new
   * size rather than from the click — the click-to-first-frame part is capture latency and is
   * bounded separately below.
   *
   * Observed 0ms on both pipelines and in both directions: `ensureBuffersMatchCanvas()`
   * reallocates inside the same `renderFrame` call that first sees the new canvas size, so the
   * first frame out at the new size is already correct. The window absorbs a frame or two of
   * latency on a slower target; nothing here was seen to need it.
   */
  MAX_REALIGN_MS: 500,
  /**
   * And how long the new frame size may take to reach the output at all, from the click.
   * Observed 35-114ms across both pipelines and both directions.
   */
  MAX_RESIZE_MS: 1500,
  /**
   * Share of each pure-backdrop edge strip that must still carry the backdrop colour.
   *
   * The letterbox check: bars pad the frame with something that is not the backdrop. Observed
   * 1.000 on the top, left and right strips at every resolution, on both pipelines.
   */
  EDGE_BACKDROP_RATIO_MIN: 0.9,
  /**
   * How far the segmented subject's share of the frame may drift from its share before the
   * resolution change. The clipping check: a clipped subject loses coverage, and a letterboxed
   * one shrinks away from the edges.
   *
   * Observed 0.064 (insertable streams) and 0.067 (fallback) going down to 360p, and 0.000
   * coming back to 720p. The 360p figure is the mask being computed from a quarter of the
   * pixels, not the subject moving.
   */
  MAX_COVERAGE_DRIFT: 0.25,
};

/**
 * Mask stability, measured as the fraction of pixels whose foreground/background classification
 * changes between two consecutive output frames (H2, issues #76 and #98).
 *
 * Measured at the probe's default 160px classification scale. The rate is a fraction rather than
 * a count, so it is resolution-independent in that sense — but not scale-free: churn lives on
 * the silhouette, whose share of the frame grows as resolution falls, so these numbers belong to
 * that scale.
 */
export const SEGMENTATION = {
  /**
   * Observed **0.000% on all 59 transitions** — not a small number, an exact zero, and still
   * exactly zero when the sweep is repeated at 320px and 640px and at tolerances of 20 and 100.
   * Fed byte-identical input, mediapipe returns a byte-identical mask; the shimmer users report
   * is the segmenter amplifying real sensor noise, not instability of its own.
   *
   * Set well above that and well below the control, so a regression that introduced any
   * per-frame mask churn at all would be caught while ordinary noise would not trip it.
   */
  MAX_STATIC_FLIP_RATE: 0.002,
  /** Worst single transition. Observed 0.000%; the moving control peaks at 1.188%. */
  MAX_STATIC_PEAK_FLIP_RATE: 0.005,
  /**
   * The negative control, and the reason the zero above means anything: the same measurement
   * under `motion=pan`, where the subject genuinely moves, observed 0.485-0.503% mean with a
   * 1.188% peak and 21-23% of pixels flipping at least once. A measurement that could not
   * report motion could not report flicker either.
   */
  MIN_MOVING_FLIP_RATE: 0.001,
  /**
   * The classifier has to have found a subject: at 0 or 1 the frame is uniform and a flip rate
   * of zero says nothing. Observed 14.5-14.7% of the frame.
   */
  FOREGROUND_RATIO_MIN: 0.03,
  FOREGROUND_RATIO_MAX: 0.8,
  /** Frames to classify, and the transitions that must survive frame drops. Observed 59 of 59. */
  SAMPLE_FRAMES: 60,
  MIN_TRANSITIONS: 40,
};

/**
 * I4 — how long a bad asset path may take to make itself known, and how long the retry after
 * it may take.
 *
 * The bound is the assertion. A 404 on the tasks-vision fileset must reach the caller, not
 * leave `setProcessor()` pending: an integration that hangs has nothing to show and nothing to
 * retry, and the naive version of this test — wait for an error, no deadline — passes just as
 * happily after thirty silent seconds as after fifty milliseconds.
 */
export const ASSET_FAILURE = {
  /**
   * Click to the failure reaching the app. Observed 81, 82, 85 and 136ms over four runs, and
   * 56ms measured inside the page around `setVideoProcessorEnabled()` itself — one failed
   * script load, no retry. A second failing attach on the same page took 21ms.
   *
   * Left loose enough to absorb a real CDN round trip and a slow CI machine rather than pinned
   * near the observation: what it has to separate is "fails" from "hangs". The negative
   * control is a route that holds the fileset request for 15s before answering it — a
   * plausible shape for the bug — which takes the measurement from ~85ms to a timeout here,
   * failing the test in 5.5s. Reproduce it by wrapping the `route.fulfill` in the spec in a
   * `setTimeout` of 15s.
   */
  MAX_SURFACE_MS: 5_000,
  /**
   * And the retry with a working path, from the click to `videoProcessor` flipping true.
   * Observed 4.1s on a cold CDN cache and 0.70-0.73s warm, against 455ms for a first attach
   * that never failed. Generous because the fetch it waits on is the one the suite already
   * calls its slowest step; it is a liveness bound, not a performance one.
   */
  MAX_RECOVERY_MS: 30_000,
};

/**
 * GainAudioProcessor (#124), measured through `harness.mic.level()` on the published track.
 *
 * The fake mic is a 440 Hz sine at amplitude 0.25, so these are compared against an exact
 * expected value rather than against a recording. Audio turns out to be far steadier than the
 * video figures above — rms repeats to three decimal places across runs — so the tolerances are
 * set by what the cases are stated in (1 dB) rather than by measurement noise, which leaves
 * roughly five times the observed spread in hand.
 */
export const AUDIO = {
  /** The oscillator frequency in examples/e2e/fakeMic.ts. */
  TONE_HZ: 440,
  /**
   * How far the loudest FFT bin may sit from it. Observed 445.3 Hz, i.e. 5.3 Hz out, which is
   * the 2048-point FFT's bin width (23.4 Hz at 48 kHz) rather than anything the processor did —
   * so the tolerance is one bin. Gain 0 reports 0 Hz, which is the negative control.
   */
  TONE_HZ_TOLERANCE: 25,
  /** A tone is present at all. Observed 0.166 unprocessed and 0.164 through the processor. */
  TONE_RMS_MIN: 0.05,
  /** How long to keep sampling the published level while the processor is attached. */
  CONTINUITY_WINDOW_MS: 2000,
  /**
   * The quietest window allowed while audio is handed over to the processor.
   *
   * Observed 0.124-0.126 across 15 consecutive windows, never approaching silence. Short windows
   * read lower than a settled 400 ms one because the measuring analyser's first reads land before
   * audio reaches it. The negative control is gain 0, which reads exactly 0.000.
   */
  CONTINUITY_RMS_MIN: 0.05,
  /**
   * Attaching at gain 1.0 must not change the level. Observed -0.003 to -0.157 dB over four runs.
   *
   * The negative control is the same comparison at a wrong gain: 0.5 measures -6.22 dB and 1.5
   * measures +3.40 dB, both an order of magnitude outside this band.
   */
  UNITY_TOLERANCE_DB: 1,
  /** Gain 0 is silence. Observed rms exactly 0.000, against 0.163 at unity. */
  SILENCE_RMS_MAX: 0.01,
  /** 0.5x and 2x in dB. Observed -5.92 to -6.00 and +6.02 to +6.23 over three runs. */
  HALF_GAIN_DB: -6.02,
  DOUBLE_GAIN_DB: 6.02,
  GAIN_TOLERANCE_DB: 1,
  /**
   * The source tone peaks at 0.25, so 2x has headroom. Observed peak exactly 0.5000 — asserted
   * because a clipped 2x would still measure close to +6 dB on rms alone.
   */
  PEAK_MAX: 0.99,
};

/**
 * K1 — switching camera device while the processor is attached ([#70]).
 *
 * Observed switching the fake 1280x720 camera for the fake 640x480 one on `backdrop=checker`,
 * `motion=static`. The negative control throughout is the same switch performed with the
 * processor detached: that is what the numbers look like when the restart drops the effect, and
 * it was measured rather than imagined.
 *
 * [#70]: https://github.com/livekit/track-processors-js/issues/70
 */
export const DEVICE_SWITCH = {
  /**
   * Background detail the blur must still be removing once the new device is live, as a fraction
   * of the raw input measured before the switch.
   *
   * Observed 0.90 — 0.0700 raw to 0.0067 processed. Detached, the same background measures
   * 0.0597, a reduction of 0.15, so the threshold has a wide margin on both sides. The raw
   * baseline is taken at 1280x720 and the processed figure at 640x480; the two scales are close
   * enough that the gap between 0.15 and 0.90 is nowhere near it.
   */
  BLUR_REDUCTION_MIN: 0.55,
  /**
   * And the subject must stay sharper than the background it sits on, which says segmentation is
   * running rather than that the whole frame was smeared.
   *
   * Observed 2.19 (fg 0.0147, bg 0.0067) against 0.65 detached, where the subject is the
   * *least* detailed part of a checker frame.
   */
  FG_OVER_BG_MIN: 1.25,

  /** Frames to ask for after the switch, and the rate they have to arrive at. */
  FRAMES_AFTER_SWITCH: 15,
  /** Observed 27.9fps over the 15 frames; a restart that never republished would give zero. */
  MIN_FPS_AFTER: 12,

  /** Settled output to record before the switch, so the old treatment has its own reference. */
  PRE_ROLL_MS: 600,
  /** Observed 18 frames before the switch and 16 after it. */
  MIN_FRAMES_EACH_SIDE: 8,
  /**
   * Per-channel distance from the reference fingerprint for a recorded frame to count as that
   * treatment, and the matching tolerance on its background energy.
   *
   * The input is static, so within each half of the recording both are observed to be exactly
   * constant — 127,127,128 at energy 0.1437 before, 127,127,127 at 0.0560 after. These only have
   * to leave a green plate (#41) or a black frame (#111) outside: a green plate sits 128 away in
   * colour, and any flat plate reads energy 0.0000, 0.056 from the nearer of the two.
   */
  MATCH_TOLERANCE: 30,
  ENERGY_TOLERANCE: 0.02,
};

/**
 * M1 — what the library is allowed to say at a given log level. Guards #106 and #109.
 *
 * Categorical rather than numeric: the assertion is which records exist, not how large a
 * measurement is, so there is nothing here to recalibrate per target. The one number,
 * `ERROR_LEVEL`, is the `LogLevel` enum value from src/logger.ts rather than an observation.
 */
export const LOGGING = {
  /** `LogLevel.error`. Nothing below it may survive `setLogLevel('error')`. */
  ERROR_LEVEL: 4,
  /**
   * The error `BackgroundTransformer.init()` logs when the background image will not load.
   *
   * The cheapest reproducible library error there is, and the only image one that is *logged*:
   * `init()` catches the rejection and logs it, where `update()` — the `switchTo` path —
   * propagates it to the caller and logs nothing. Observed exactly once per forced failure, at
   * level 4, with no other record in the same run.
   */
  IMAGE_LOAD_ERROR: 'Error while loading processor background image',
  /**
   * A below-error record every attach produces (`ProcessorWrapper.init`).
   *
   * The same forced failure yields 4 records at `?loglevel=debug` — `Init called`, `Media was
   * exhausted from source`, `stream processor underlying stream closed`, plus the image error —
   * against 1 at `error` and 0 at `silent`. That spread is what gives "nothing below error"
   * something to suppress; without it the assertion would hold on a run with nothing to say.
   */
  INIT_DEBUG: 'Init called',
  /**
   * Every string the library can write to the console, from `grep -n 'log\.' src/`.
   *
   * Needed because loglevel binds `console.error` and friends directly: the line carries no
   * logger name, so a library record is indistinguishable from one livekit-client or the
   * harness wrote except by its text. This is the check that is independent of the
   * `setLogExtension` capture — a mis-wired hook could agree with itself, but it could not also
   * keep the console clean.
   */
  LIBRARY_CONSOLE_TEXT: [
    'Init called',
    'Restart called',
    'Destroy called',
    'Media was exhausted from source',
    'stream processor path aborted',
    'stream processor underlying stream closed',
    'error when trying to pipe',
    'Error in transform:',
    'Error in render loop:',
    'Video is paused, trying to play',
    'Unable to play video',
    'Estimated video FPS',
    'empty frame detected, ignoring',
    'Error while loading processor background image',
    'Error while processing frame:',
    'Error processing background image, falling back to black background:',
    'Shader compile failed:',
    'Program link failed:',
    'Failed to create WebGL context',
    'Frame ticker worker could not be created',
    'Frame ticker worker failed',
  ],
};
