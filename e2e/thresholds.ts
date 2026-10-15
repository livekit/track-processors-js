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
  // #50 — the transform being structured-cloned while a track is created with a processor
  'TransformStream could not be cloned',
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

/**
 * B4 — a processor attached to a track that has never been published, then published.
 *
 * Guards [#97](https://github.com/livekit/track-processors-js/issues/97): on iPhone, a
 * processor attached before the track was published came out with the background laid over the
 * subject. The order is the case. `ProcessorWrapper.setup()` sizes `sourceDummy`, the GL canvas
 * and — on the canvas fallback — the `displayCanvas` the published track is captured from, all
 * from `waitForTrackResolution(source)`; attaching before anything has pulled from the track is
 * the moment that call is least likely to have an answer, and a processor that sizes its
 * buffers from a track with no dimensions is the bug shape #97 describes.
 *
 * Measured at the *far end* of `harness.loopback`, not on the local processed track, because
 * the case is about publishing. Two things make that a real measurement rather than a
 * re-reading of the local frame:
 *
 *   - The probe binds by track identity, not by track id. Chrome names a remote track after
 *     the `a=msid` of the offer, so the loopback's far end carries the *sender's* id — keyed by
 *     id the rebind is a no-op and every later sample silently re-reads the local frame. That
 *     is the C3 mistake recorded in e2e/AGENTS.md, and it is why `Probe` now holds the track
 *     object rather than its id.
 *   - The spec waits for `MIN_RECEIVED_FRAMES` frames presented *after* that rebind, and for
 *     the decoded size to equal the size inbound-rtp reports. A stale local frame is 1280x720
 *     while the far end is still ramping at 320x180, so it cannot pass for a received one.
 *
 * ### What the attach order turned out to be worth on Chrome
 *
 * Nothing, and that is a result rather than a gap. Forcing `waitForTrackResolution` to return
 * `{ width: undefined, height: undefined }` — the outcome of its 500ms timeout, i.e. the iOS
 * condition the `sleep(10)` at the top of it exists for — changes none of the numbers below, on
 * either pipeline: dx 0.0016, dy 0.0539, coverage 0.1455, subject-patch plate ratio 0.000, the
 * same figures a healthy run gives. Both pipelines re-derive the frame size every frame
 * afterwards — `BackgroundTransformer.transform` assigns `canvas.width = frame.displayWidth`,
 * and the fallback's enqueue follows `sourceDummy.videoWidth` — so the 300x300 fallback inside
 * `setup()` is corrected before a frame is ever published. #97's symptom does not reproduce
 * from the attach order here; reproducing it would need a device that reports a resolution
 * which is *wrong* rather than absent, which this harness cannot fake.
 *
 * So the assertions are calibrated against misalignment introduced directly, with a one-line
 * edit to `compositeShader.ts`. Neither control is committed, since each asserts that a bug
 * exists:
 *
 *   - `texture(mask, texCoords + vec2(0.0, 0.25))`, a mask offset by a quarter of the frame.
 *     dy goes 0.0539 -> 0.2400 local and received alike, the subject-patch plate ratio goes
 *     0.000 -> 0.217 local / 0.208 received, and coverage 0.1455 -> 0.0744. It fails on the
 *     centre tolerance and on the patch ratio, with roughly 2x and 4x margin.
 *   - `float maskVal = 1.0;`, the whole frame classified as background. The plate covers
 *     everything, `foregroundBox` returns null and the patch ratio is exactly 1.000. That is
 *     #97's symptom verbatim — the background over the subject — and it fails every assertion
 *     here.
 *
 * Geometry tolerances are GEOMETRY's, reused rather than redefined: read its comment first for
 * why the assertions are on the mask's centre and containment and not on its edges.
 */
export const PREPUBLISH = {
  /**
   * Frames the far end must present *after* the probe rebinds to it, before anything is
   * measured. Twenty is about two thirds of a second of the decoded track, reached in ~0.8s.
   */
  MIN_RECEIVED_FRAMES: 20,
  /**
   * The probe's presented-frame counter on the first sample of the far end.
   *
   * It restarts at a rebind, so a small number here *is* the proof that one happened. Observed
   * **0** on both pipelines. Keyed by track id instead of identity the probe never rebinds and
   * the same read returns 24-25 — the counter still running on the local track, and still
   * climbing past 590 by the time the measurement gives up.
   *
   * It carries the guard on its own, because the size check does not: the encoder ramps
   * 320 -> 480 -> 640 -> 960 -> 1280 over about fifteen seconds, and once it reaches 1280 a
   * stale 1280x720 local frame agrees with inbound-rtp by coincidence. With only the size
   * check, the id-keyed probe failed on insertable streams and *passed* on the canvas
   * fallback — a self-comparison that asserted nothing, which is the whole thing AGENTS.md
   * warns about.
   */
  MAX_REBIND_FRAME_INDEX: 5,
  /**
   * A patch well inside the segmented subject, in frame coordinates.
   *
   * Chosen against the observed mask rather than against the compositor's rect: mediapipe finds
   * head-and-shoulders at 0.344/0.122 0.313x0.728, so this sits comfortably inside it with room
   * on every side for the feathered edge. The compositor's own rect (0.20/0.08 0.60x0.92) would
   * not do — most of it is legitimately background.
   */
  SUBJECT_PATCH: { x: 0.42, y: 0.3, w: 0.16, h: 0.3 },
  /**
   * How much of that patch may be the virtual-background plate.
   *
   * This is #97 stated as a number: the background must not be drawn over the subject. Observed
   * **0.000** on both pipelines, locally and at the far end — not a small value, an exact zero.
   * The two negative controls above read 0.208-0.217 and 1.000, so the threshold has four times
   * the margin it needs in each direction.
   */
  MAX_SUBJECT_PLATE_RATIO: 0.05,
  /**
   * How far the far end's subject coverage may drift from the local track's, as a fraction.
   *
   * Observed 0.014 (0.1455 local at 1280x720 against 0.1476 received at 320x180). Secondary: it
   * says publishing did not change the picture, and it does *not* separate the controls above —
   * the shifted mask moves both sides equally, to a drift of 0.04. Kept because a published
   * frame that lost the subject while the local one kept it would show up here and nowhere else.
   */
  MAX_COVERAGE_DRIFT: 0.2,
};

/**
 * B5 — the processor handed to `createLocalVideoTrack` through `VideoCaptureOptions.processor`
 * instead of attached afterwards with `setProcessor`, guarding
 * [#50](https://github.com/livekit/track-processors-js/issues/50).
 *
 * The blur figures are not redefined here: the capture-time output is measured against a raw
 * baseline with `BLUR.MIN_REDUCTION` and `BLUR.FG_OVER_BG_MIN`, because it has to be the same
 * effect by the same numbers as B1's. What is new is the comparison between the two routes.
 *
 * Observed on headless Chrome 153 / macOS at 1280x720, `backdrop=checker`, `motion=static`:
 * raw background energy 0.0700, capture-time 0.0169 (a reduction of 0.76) with fg 0.0273, i.e.
 * fg/bg 1.61 — and `setProcessor` on the same page measured 0.0169 and 0.0273 to every digit.
 *
 * Negative control: the same spec against `?attach=set`, which is a one-word edit to the
 * `goto` and leaves the start-video click attaching nothing. The track comes up with
 * `processorName: null` and `processedTrackId: null` against a non-null `id`, so the
 * published-track assertion fails first; behind it the background measures 0.0579 of a raw
 * 0.0700 — a reduction of 0.17 against the 0.55 required — fg/bg is 0.82 against 1.25, and the
 * WebGL counter never moves off 7, because no pipeline is built at all. Not committed, since it
 * asserts the feature is absent.
 */
export const CAPTURE_TIME = {
  /**
   * #50's exception, as it appears in the console, in a `pageerror`, or in the harness log line
   * the UI's handler wrapper writes.
   *
   * A pattern rather than the literal `DataCloneError: a TransformStream could not be cloned`
   * because the prefix depends on where the clone was attempted — Chrome words it "Failed to
   * execute 'postMessage' on 'Worker': a TransformStream could not be cloned." — while the
   * clause naming the TransformStream is the part that identifies the bug. `FORBIDDEN_CONSOLE`
   * carries the same clause, which is what makes the regression visible suite-wide rather than
   * only here.
   */
  CLONE_ERROR_PATTERN: /DataCloneError|TransformStream could not be cloned/,
  /**
   * How closely the capture-time output has to match the same effect attached with
   * `setProcessor`, as a share of pixels within the probe's default tolerance.
   *
   * Observed exactly 1.000, at a mean absolute difference of 0.00 and a maximum of 0 — the
   * compositor is deterministic under `motion=static` and the two routes end up running the
   * identical pipeline, so the frames are byte-identical rather than merely similar. Left at
   * B2's 0.98/5 anyway: the property is "the same picture", and pinning it to an exact match
   * would make the case fail on the first target whose encoder is not bit-exact.
   */
  SAME_OUTPUT_PIXEL_RATIO_MIN: 0.98,
  SAME_OUTPUT_MEAN_DIFF_MAX: 5,
  /**
   * WebGL contexts the capture-time attach may create, as a multiple of what the `setProcessor`
   * attach creates for the same effect on the same page.
   *
   * Observed 20-23 against 19-21 over eight runs, i.e. ratios of 0.95 to 1.11 — the two routes
   * cost the same pipeline, and the couple of contexts either way are mediapipe's rather than
   * the library's. A ratio rather than a difference because of that noise; the absolute figure
   * is #136's leak and is deliberately not asserted here. What this catches is the capture-time
   * route building its pipeline twice, which reads 2.0 while every pixel assertion above still
   * passes.
   */
  MAX_WEBGL_COST_RATIO: 1.5,
};

/**
 * B7 — `LocalVideoTrack.restartTrack()` under a running processor, plain and with new
 * constraints. Guards [#111] and [#96], and the console half of [#89].
 *
 * A restart is a full destroy-and-init of the pipeline against a freshly acquired source, which
 * is the same teardown #111 and #96 were filed against: a black frame or a grey plate reaching
 * the published track while the new one is being built. So every presented frame across the
 * restart is fingerprinted and classified, the way C1b classifies a mode switch, rather than
 * polled — polling could only show that no bad frame happened to be *observed*.
 *
 * Classification reuses SWITCH.MATCH_TOLERANCE and SWITCH.ENERGY_TOLERANCE: the measurement is
 * C1b's, taken at the same 96px recording scale against references from the same run.
 *
 * Observed on headless Chrome 153 / macOS, `backdrop=checker`, `motion=static`, on `fake-front`
 * (640x480) with background blur. The two sides are each exactly constant, the input being
 * static: bg 127,127,127 at energy 0.0560 before, the same after a plain restart, and
 * 127,127,128 at 0.1437 after a restart to 1280x720 — the energy moves with the frame size, not
 * with the treatment, which is why each side is classified against its own reference.
 *
 * [#111]: https://github.com/livekit/track-processors-js/pull/111
 * [#96]: https://github.com/livekit/track-processors-js/pull/96
 * [#89]: https://github.com/livekit/track-processors-js/issues/89
 */
export const RESTART = {
  /** Settled output to record before the click, so the old treatment has its own reference. */
  PRE_ROLL_MS: 600,
  /** Frames to ask for after the restart, and the rate they have to arrive at. */
  FRAMES_AFTER_RESTART: 20,
  /** Observed 29.7fps over those 20 frames; a restart that never republished would give zero. */
  MIN_FPS_AFTER: 12,
  /** Observed 20 frames before the restart and 20 after it, on both variants. */
  MIN_FRAMES_EACH_SIDE: 8,

  /**
   * Background high-frequency energy at or below which a frame counts as a flat plate.
   *
   * This is what "near-black or near-grey" is actually measured as. Both failures are flat: a
   * black frame reads bg and fg means of 0,0,0 at energy 0.0000, and a grey or green plate
   * (#41) reads a flat mid-tone at energy 0.0000 too. Real output is nowhere near — 0.0560
   * blurred at 640x480, 0.1437 blurred at 1280x720, 0.1337 raw — so this sits an order of
   * magnitude below the quietest real frame and ten times above the observed flat reading.
   */
  FLAT_ENERGY_MAX: 0.005,
  /**
   * And, among flat frames, how dark one has to be to be reported as black rather than grey.
   *
   * Observed exactly 0 on every black frame; the darkest region of any real frame measured here
   * is the subject at 105. Only the wording of the failure message turns on this.
   */
  NEAR_BLACK_LEVEL_MAX: 24,

  /**
   * Flat frames on the published side of the recording.
   *
   * Zero, for the same reason SWITCH.MAX_UNCLASSIFIED_FRAMES is zero. Observed 0 of 39 on both
   * variants.
   *
   * "Published side" excludes exactly one frame: the last one the probe reads from the outgoing
   * track. It is black, and it is a probe artifact rather than something the library published —
   * see MAX_CONSECUTIVE_FLAT_FRAMES.
   *
   * That exclusion is also this threshold's negative control, since it is the only black frame
   * in the run: dropping the `.slice(0, -1)` fails both variants on a real recorded frame, with
   * `near-black #33 bg=(0,0,0) fg=(0,0,0) e=0.0000` and a timeline of
   * `FFFFFFFFFFFFFFFFFFBTTTTTTTTTTTTTTTTTTTT`. Not committed, since it asserts an artifact.
   */
  MAX_PUBLISHED_FLAT_FRAMES: 0,
  /**
   * The longest run of flat frames anywhere in the recording, the artifact included.
   *
   * Observed 1, both variants. That one frame is the probe's own offscreen <video> presenting
   * black as the outgoing `MediaStreamTrackGenerator` ends, not a frame the library handed on,
   * and it is bounded here rather than merely excluded so a teardown that went black for
   * *several* frames would still fail.
   *
   * Attributing it took a direct experiment, because the obvious control does not reproduce it:
   * the same restart with no processor attached shows no black frame at all, since the track
   * ending there is a canvas-capture track rather than a generator. Writing 20 orange VideoFrames
   * into a bare `MediaStreamTrackGenerator` wired to a <video>, then closing the writer and
   * calling `stop()` exactly as `ProcessorWrapper.cleanup()` does — no library code in the
   * picture — presents 21 frames: 20 at 255,128,0 and a 21st at 0,0,0. That is this frame.
   */
  MAX_CONSECUTIVE_FLAT_FRAMES: 1,

  /**
   * Background detail the blur must still be removing once the restart has settled, as a
   * fraction of the raw input measured *before* the processor was ever attached.
   *
   * Observed 0.89 after a plain restart (0.0587 raw to 0.0067) and 0.71 after one to 1280x720
   * (0.0587 to 0.0169 — the raw baseline is at 640x480, and the gap between the two scales is
   * what the second figure includes).
   *
   * Negative control, measured: the same restart with the processor never attached, which is
   * what a restart that silently dropped the effect would look like. The background comes back
   * at 0.0597 against a raw 0.0587 — a reduction of -0.02, i.e. none at all — so the threshold
   * has most of the range in hand on both sides.
   */
  BLUR_REDUCTION_MIN: 0.55,
  /**
   * And the subject must stay sharper than the background it sits on, which says segmentation is
   * running again rather than that the whole frame was smeared.
   *
   * Observed 2.19 plain (fg 0.0147, bg 0.0067) and 1.61 with new constraints (0.0273, 0.0169).
   * The same detached control measures 0.65 (fg 0.0388, bg 0.0597) — on a checker backdrop the
   * subject is the *least* detailed part of an untreated frame, so this separates cleanly.
   */
  FG_OVER_BG_MIN: 1.25,

  /**
   * The in-place negative control: how many black frames muting the camera has to produce
   * before the classifier above is credited with being able to see one.
   *
   * #111 and #96 are both fixed on this base, so the restart itself publishes nothing bad and a
   * "no black frames" assertion would pass just as happily with a classifier that could not
   * recognise black at all. Muting makes the pipeline emit real black frames — the state B6
   * leaves the output in — and the same classifier is run over them. Observed 35 over 1200ms,
   * every one of them flat at energy 0.0000 and reported near-black at 0,0,0.
   */
  MIN_BLACK_CONTROL_FRAMES: 10,
  BLACK_CONTROL_MS: 1200,
};

/**
 * B8 — the source `MediaStreamTrack` ending under a running processor, i.e. a device unplug.
 * Guards [#22](https://github.com/livekit/track-processors-js/issues/22).
 *
 * Almost entirely categorical: the case is about which state the wrapper lands in, which
 * strings the library writes, and whether the teardown after it completes at all. The two
 * numbers are both liveness bounds rather than measurements of quality — what they have to
 * separate is "promptly" from "never", so they sit an order of magnitude above the
 * observations rather than around them.
 *
 * Observed on headless Chrome 153 / macOS, insertable-streams pipeline, `?loglevel=debug`.
 *
 * Negative controls, both measured rather than imagined:
 *
 *  - **The same run without the `end-source` click.** `lifecycle` stays `running`, source and
 *    processed both stay `live`, 26 further frames arrive in the quiet second, and the library
 *    writes nothing at all. So every assertion below distinguishes the two states; none of them
 *    is true of a healthy pipeline.
 *  - **#22 itself, reproduced.** Ending the source, detaching, then attaching again hands
 *    `ProcessorWrapper.setup()` a track that is already `ended`, and
 *    `new MediaStreamTrackProcessor({ track })` throws `Failed to construct
 *    'MediaStreamTrackProcessor': Input track cannot be ended` — the exact #22 message. Worth
 *    recording where it surfaces: it arrives as a *rejection* out of `setProcessor()`, which
 *    the UI's handler catches, so `harness.lastError()` holds it while `page.on('console')` and
 *    `page.on('pageerror')` both stay empty. `FORBIDDEN_CONSOLE` would not have caught it on
 *    that path, which is why B8 asserts on all three channels instead of leaning on the
 *    fixture. Reproduce by appending a second `attach-processor` click to the end of the spec:
 *    `expectNothingEscaped` then fails on `lastError` carrying that message, while `pageErrors`
 *    and the console filter both stay empty.
 */
export const TRACK_ENDING = {
  /** `ProcessorWrapperLifecycleState` values, from src/ProcessorWrapper.ts. */
  RUNNING: 'running',
  EXHAUSTED: 'media-exhausted',
  DESTROYED: 'destroyed',
  /**
   * Click to the wrapper leaving `running`, measured from before the click so the dispatch and
   * the 10ms poll count against it. Observed 36, 51, 53 and 60ms over four runs.
   *
   * Nothing was seen between the two states: an exploratory run sampling every 50ms for two
   * seconds read `media-exhausted` on its first sample and never anything else. Left two orders
   * of magnitude above the observation because what it has to separate is "notices" from
   * "never notices" — a wrapper that kept `running` with a dead input would hang here rather
   * than fail slowly.
   */
  MAX_EXHAUSTED_MS: 2_000,
  /**
   * What `handleMediaExhausted()` logs at debug, and the public half of the state assertion:
   * `lifecycleState` is `private`, so reading it is reaching into the library, while this
   * record is the library saying so itself through `setLogExtension`.
   *
   * Observed exactly once, at level 1, as the only record between the attach and the detach.
   */
  EXHAUSTED_LOG: 'Media was exhausted from source',
  /**
   * `destroy()` logs the state it was entered from, which is what makes the successful teardown
   * demonstrably the media-exhausted one rather than an ordinary detach.
   *
   * Observed in full as `Destroy called - lifecycleState=media-exhausted,
   * transformerDestroyOptions={"willProcessorRestart":false}`; matched by prefix so the options
   * half can change without this becoming a false failure.
   */
  DESTROY_LOG_PREFIX: 'Destroy called - lifecycleState=media-exhausted',
  /**
   * How long to let the output settle before counting frames, and how long to count for.
   *
   * The settle is not padding. A frame can already be decoded and queued at the probe when the
   * source goes, and it is presented after the transition: counting from the transition itself
   * measured 1 frame on two runs in three and 0 on the other. That one frame is a frame the
   * pipeline had already produced, not evidence it is still running, so the window opens past
   * it. Observed 0 frames in every 1000ms window taken after a 300ms settle.
   */
  SETTLE_MS: 300,
  QUIET_MS: 1_000,
  /**
   * Frames allowed in that window. Zero: `cleanup()` stops the track generator, so the probe's
   * counter stops moving entirely. The control above produces 26 in the same window.
   */
  MAX_FRAMES_AFTER_END: 0,
  /**
   * Click to `stopProcessor()` having completed, on a processor whose source is already gone.
   * Observed 37-49ms over four runs. The failure this bounds is a teardown that never
   * resolves — which leaks the
   * canvas, the segmenter and the WebGL context (#136) — so it is a deadline, not a budget.
   */
  MAX_TEARDOWN_MS: 10_000,
};

/**
 * C2 — whether leaving virtual-background for blur releases the background image.
 *
 * Classification reuses SWITCH.MATCH_TOLERANCE and SWITCH.ENERGY_TOLERANCE, as C1b and D4 do:
 * same 96px recording scale, same references-from-this-run rule.
 *
 * GL state cannot be read from the page, so retention is measured by its consequence. After the
 * switch to blur has settled, the spec re-enters virtual-background with the *other* image and
 * holds that image's response back. `BackgroundTransformer.update` clears the blur radius before
 * it awaits the new image, so throughout that window the compositor renders whatever is still in
 * `bgTexture`.
 *
 * The case currently fails, and that failure is the finding — see the `test.fail()` in
 * modes.spec.ts. `setBackgroundImage(null)` nulls `customBackgroundImage` and
 * `backgroundSourceImage` but never writes to `bgTexture`, so the plate survives the switch and
 * composites again 25 frames later.
 */
export const TEXTURE_RELEASE = {
  /**
   * How long the incoming image's response is held back while the return leg is recorded.
   *
   * Same role as BACKGROUND_SWAP.IMAGE_DELAY_MS and the same value: off the local dev server the
   * image arrives in a couple of milliseconds, and the window the retained texture shows in would
   * land on no frame at all. 800ms spans ~25 frames at 30fps. Observed 25 frames of the retained
   * plate in that window, so the delay translates into frames at very nearly the capture rate.
   */
  PROBE_IMAGE_DELAY_MS: 800,
  /**
   * Frames published after the switch to blur that still carry the image the switch left behind.
   *
   * Zero. Observed **25 of 39** — a timeline of `BBBBBBBSSSSSSSSSSSSSSSSSSSSSSSSS.......`, where
   * every S reads bg=(254,1,254) at energy 0.0063, byte-for-byte the bg-solid.png reference
   * captured before the switch. Not a re-fetch and not a re-render: the same texture, never
   * overwritten. The blur before it reads (127,127,128) at 0.1437 and the cyan successor
   * (1,254,254) at 0.0048, so the three are far apart in both colour and energy.
   *
   * Two controls, neither committed:
   *
   * - **Is the magenta attributable to the virtual background?** The same probe on a page that
   *   never entered virtual-background — load at `mode=background-blur`, attach, click the swap —
   *   reads `BBBBBBB` then 23 frames of bg=(1,1,1) at 0.0119, the never-written bgTexture, then
   *   8 of (1,254,254). So the window exists either way; what fills it with the previous plate is
   *   having been in virtual-background. That is what makes this a measurement of retention
   *   rather than of the fetch delay.
   * - **Does the assertion pass when the texture is released?** Uploading the empty placeholder
   *   into bgTexture in `setBackgroundImage(null)` takes the count from 25 to 0 and the case
   *   green. So the zero is reachable and the failure is this one cause.
   *
   * That second control is *not* the fix: it is exactly the shape of #105, and
   * BACKGROUND_SWAP.MAX_UNCLASSIFIED_FRAMES records it producing 23 frames of white during a
   * direct image swap. A real fix has to release the plate when the mode is left without dropping
   * it when one image is replaced by another, which is a change to where the clear happens rather
   * than a one-line addition here.
   */
  MAX_STALE_PLATE_FRAMES: 0,
  /**
   * Frames the probe must have captured before any of the above means anything — a recording that
   * missed the window would report zero stale frames for the wrong reason. Observed 39.
   */
  MIN_PROBE_FRAMES: 10,
};

/**
 * D2 — a virtual background served from another origin, with and without a usable
 * `Access-Control-Allow-Origin`.
 *
 * Observed on headless Chrome 153 / macOS at 640x480, `backdrop=flat`, `motion=pan`, with the
 * same `bg-solid.png` bytes served from `https://cdn.example.test/bg.png` through
 * `page.route`. The two legs differ only in the header value, so every number below has its
 * counterpart from the leg that worked.
 *
 * The negative control for the liveness half is not a second route: it is the same assertions
 * run against a deliberately blanked pipeline, reproduced by inserting
 * `await page.evaluate(() => window.harness.media.setVideoMuted(true))` before
 * `recordLiveness`. Measured there: 30 frames in 1034ms (28fps), 1 distinct hash and a
 * foreground luma of 0.0 — so `MIN_DISTINCT_HASHES` and `MIN_FOREGROUND_LUMA` both fail while
 * `MIN_FPS` still passes, which is the point: frame *count* alone cannot tell a live pipeline
 * from a frozen one.
 */
export const CROSS_ORIGIN_BACKGROUND = {
  /**
   * Background match against the plate when the load was blocked. Observed 0.000; the leg that
   * loaded observes 1.000 against `VIRTUAL_BACKGROUND.MATCH_RATIO_MIN`. A blocked image leaves
   * the background texture at its initial empty state, so the background region renders black.
   */
  FAILED_MATCH_RATIO_MAX: 0.05,
  /** One request, one error. Observed exactly 1 of each, over 60 further frames. */
  EXPECTED_IMAGE_REQUESTS: 1,
  EXPECTED_ERROR_COUNT: 1,
  /** Frames to fingerprint while judging the degraded pipeline. 60 is two seconds at 30fps. */
  LIVENESS_FRAMES: 60,
  /** Observed 30.0 in both legs. The blanked control still manages 28, so this is not the teeth. */
  MIN_FPS: 12,
  /**
   * Distinct frame hashes among those 60. Observed 13 in both legs; 1 when the pipeline is
   * blanked. `motion=pan` is what makes this meaningful — on a static source a working
   * pipeline also produces one hash.
   */
  MIN_DISTINCT_HASHES: 4,
  /** Luma of the subject region on every recorded frame. Observed min 31.8 blocked, 85.8 loaded, 0.0 blanked. */
  MIN_FOREGROUND_LUMA: 12,
  /** Whole-frame spread. Observed 49.6 blocked and 29.5 loaded; a flat or black frame gives 0. */
  MIN_FULL_STDDEV: 10,
  /** Subject detail, so the figure is still being composited. Observed 0.021 blocked, 0.016 loaded. */
  MIN_FOREGROUND_ENERGY: 0.005,
};

/**
 * E2 — the aspect ratio a remote peer decodes, read from the in-page loopback's inbound-rtp
 * stats with the processor on and off. Guards [#28] and [#54], both reported as a stretched
 * remote view.
 *
 * Observed on headless Chrome 153 / macOS, `backdrop=checker`, `motion=static`, with the
 * processor on and off and in both orientations. A longer 24-read sweep was taken first to see
 * the whole encoder ramp:
 *
 *   - 1280x720 source: decoded 320x180 up to t=4.1s, then 480x270 for the rest of the sweep.
 *     Ratio **1.777778 at every single read**, in both halves — the ramp changes the size and
 *     never the ratio. The committed 2s window sits entirely in the 320x180 phase.
 *   - 480x640 source: decoded 480x640 throughout, no ramp at all. Ratio **0.750000 at every
 *     read**, in both halves.
 *
 * The measured spread is therefore exactly zero, which is why the tolerance below is argued for
 * rather than read off a distribution.
 *
 * [#28]: https://github.com/livekit/track-processors-js/issues/28
 * [#54]: https://github.com/livekit/track-processors-js/issues/54
 */
export const PEER_ASPECT = {
  /**
   * How far the decoded ratio may sit from the source's, relative.
   *
   * Observed 0.000000 everywhere, so this is sized by what it has to let through and what it
   * has to catch rather than by noise. Letting through: the encoder picks scaled sizes with
   * even dimensions, so a ratio can in principle land a pixel or two out — 322x180 against
   * 320x180 is 0.0069 relative, and 2% leaves room for about three such pixels at the smallest
   * height seen here (180). Catching: the bug is a *stretch*, and the smallest plausible one is
   * 16:9 delivered as 4:3, which is 0.25 relative — twelve times the tolerance. There is no
   * stretch anywhere near 2% that a user would have filed an issue about.
   *
   * Negative control, since these issues are fixed and a stretched output cannot be provoked
   * from the spec: replace `width / height` in the spec with `4 / 3`. Run, the landscape case
   * fails on its first read with `Received: 0.3333333333333333` against this 0.02 — sixteen
   * times over — and the message reads "remote aspect ratio 320x180 (1.7778) is not the
   * source's 1.3333 with the processor off". The portrait run is the
   * committed half of the same control — it runs the identical assertion against a source whose
   * ratio is 0.75, so an expectation frozen at 16:9 fails there without any edit at all.
   */
  MAX_RATIO_ERROR: 0.02,
  /**
   * Reads per half, and their spacing. 8 x 250ms spans ~2s, which at the observed 29-30fps is
   * 42-52 decoded frames — long enough to cover more than a momentary agreement, short enough
   * that the case runs in 6-8s per source including both page loads.
   */
  READS: 8,
  READ_INTERVAL_MS: 250,
  /** Reads that must have carried a size. Observed 8 of 8 in every run. */
  MIN_READS: 6,
  /**
   * Frames the receiver must decode across the window.
   *
   * This is what stops the ratio assertions being vacuous: a receiver that has stopped decoding
   * keeps reporting its last `frameWidth` indefinitely, and a stale number agrees with itself
   * and with the source. Observed 42, 49, 50 and 52 frames over the four 2s windows; a stalled
   * publish — the shape of #127 — would give 0.
   */
  MIN_FRAMES_DECODED: 20,
};

/**
 * G2 — the frame rate a remote peer actually receives from 720p blur, sustained.
 *
 * Counted from `framesDecoded` on the receiving end of the in-page loopback, in half-second
 * buckets, rather than read from the reported `framesPerSecond` — that figure is a short rolling
 * average and lags a stall, which is the failure these floors exist to catch (#77, #79).
 *
 * Measured on headless Chrome 153 / macOS, ANGLE Metal on an Apple M4 Pro, at 1280x720 with
 * `backdrop=checker`, `motion=pan`. **All three calibration runs were taken while eleven other
 * agents were driving browsers on the same machine**, so the spread below is contention as much
 * as it is the library:
 *
 *   median 27.9 / 29.9 / 29.9 / 29.9 / 29.9
 *   p5     24.0 / 27.9 / 27.9 / 27.9 / 27.9
 *   min    22.0 / 27.9 / 27.9 / 25.9 / 21.9
 *
 * The first run is the worst — the source is a 30fps capture, so 29.9 is the ceiling and the
 * shortfall is contention rather than headroom in the library. The 21.9 min in the last run is
 * one half-second bucket, with that run's median still at 29.9: that is what this distribution
 * is for, and why the floors are set off the tail and not off the mean. The
 * floors are set under the *worst* of the three with room to spare, which is the right way round
 * — recalibrate upward on a serial run if they turn out to be loose, and treat them as ratchets
 * from there.
 */
export const SUSTAINED_FPS = {
  /**
   * How long to hold the measurement.
   *
   * The case was specified at 30s; 20s is what is committed, because the per-test timeout is 60s
   * and the window is not the only thing in it — the mediapipe CDN fetch, the attach and the
   * encoder ramp come first. 20s at this bucket size is 40 samples, enough for a p5 that is not
   * just the minimum, and long enough that any stall this is meant to catch — a pipeline that
   * stops producing partway through a call — lands inside it. A 30s window that times out on a
   * slow CDN response catches nothing at all.
   */
  WINDOW_MS: 20_000,
  /**
   * Bucket width. Half a second quantizes to ~2fps per decoded frame, which is why the observed
   * buckets cluster on 27.9 / 29.9 rather than spreading; finer buckets would read as noise and
   * coarser ones would leave too few samples for a tail statistic.
   */
  SAMPLE_INTERVAL_MS: 500,
  /**
   * How long to wait for the encoder to reach the source resolution before starting the window.
   *
   * It ramps: a 1280x720 source decodes at 320x180 and steps up over the following seconds.
   * Bounded rather than required, and the bound is usually what ends the wait — observed at
   * 640x360 when the window opens, reaching 1280x720 partway through it. That is WebRTC's
   * quality ramp-up, not the library: the capture, the segmenter and the WebGL filter are all
   * running at 720p throughout, which is what "720p blur" means here. The spec records the
   * decoded size at both ends of the window so a run that *fell* to 640x360 instead of climbing
   * to 720p is distinguishable in the report.
   *
   * Waiting it out instead would cost another ten seconds for a resolution this case does not
   * assert on — E2 is the case about decoded frame size.
   */
  RAMP_TIMEOUT_MS: 8_000,
  /**
   * Buckets a run must produce before its distribution is read. Observed 40 of 40 healthy, and
   * 33 under the negative control below — which is why it is not pinned at 40.
   */
  MIN_SAMPLES: 30,
  /**
   * Per-project floors. **Chrome only**: the others in the plan (Firefox 18, Safari 18, recent
   * iPhone 20, mid-tier Android 15) are unverified, and a guess here would be a threshold nobody
   * ever observed. A project with no entry fails rather than inheriting Chrome's, like the
   * capability matrix in `capability.spec.ts` — these are a hardware tier, not a property of the
   * library, so a new target has to have them measured.
   *
   * The negative control is synthetic main-thread load: a 50ms busy loop every 16ms inside the
   * page for the length of the window takes the same measurement to **median 9.7, p5 7.7, min
   * 6.1** over 33 buckets, and fails the case on the median first — a third of the floor, so
   * the margin is wide on both sides. Not committed, since it asserts that the pipeline is
   * broken; reproduce it by starting that interval just before `buckets` in the measurement
   * `page.evaluate`. (It also shows why MIN_SAMPLES sits under 40: the load slows the sampling
   * loop itself, and the count guard must not be what fails instead of the floor.)
   *
   * The software-renderer figure is the other half of the picture, and the reason the assertion
   * is skipped there rather than lowered: under SwiftShader the WebGL filter step costs ~56ms a
   * frame (see PERFORMANCE.MAX_P50_PROCESSING_MS), which caps the pipeline below any floor worth
   * asserting on hardware.
   */
  FLOORS: {
    /**
     * Median 24: four under the worst observed median (27.9) and 2.5x the loaded control's 9.7.
     * P5 18: six under the worst observed p5 (24.0), and 2.3x the control's 7.7. Both sit well
     * under contended measurements on purpose — a tight floor taken from a contended run is the
     * one that goes flaky on a quiet machine's bad day. 24 is also the figure the plan proposed
     * for desktop Chrome, which the measurements turn out to support.
     */
    chrome: { MEDIAN_MIN: 24, P5_MIN: 18 },
  } as Record<string, { MEDIAN_MIN: number; P5_MIN: number }>,
};

/**
 * H1 — the segmentation mask against the golden committed at
 * `e2e/golden/h1-virtual-background-mask.txt`.
 *
 * The one case here that compares the mask to a *recording* rather than to a property of
 * itself. Every other segmentation assertion — stability (H2), placement (GEOMETRY), the plate
 * showing through (VIRTUAL_BACKGROUND) — survives the silhouette changing shape, which is
 * exactly what a silent mediapipe or model-asset change does. [#59] and the downgrade that
 * shipped in [#72] are both that failure.
 *
 * Measured on headless Chrome 153 / macOS, `backdrop=flat` with `motion=pan` pinned to frame 30,
 * virtual-background mode on the default `/bg-solid.png` plate, classified by
 * `probe.captureMask()` at 160x90 against rgb(255,0,255) +/-60 — the same classifier, palette
 * and scale H2 uses, so the two cases are talking about the same mask.
 *
 * [#59]: https://github.com/livekit/track-processors-js/issues/59
 * [#72]: https://github.com/livekit/track-processors-js/issues/72
 */
export const GOLDEN_MASK = {
  /**
   * Per-pixel classification agreement with the golden.
   *
   * Observed **100.000% on five consecutive runs** — not a rounded figure: all 14400 pixels
   * identical, every time. That follows from H2's result, which is why these two cases belong
   * together: fed byte-identical input mediapipe returns a byte-identical mask, so with the
   * compositor pinned there is no run-to-run noise for a threshold to absorb, and any
   * disagreement at all is the model rather than the measurement.
   *
   * 0.995 therefore is not fitted to a spread; it is a deliberate 72-pixel allowance — about
   * 3.5% of the 2084-pixel silhouette — for sub-pixel edge drift on a target whose rasterizer
   * is not this one. It still sits above every perturbation worth catching, measured by
   * transforming the committed golden itself:
   *
   *   - whole silhouette moved one pixel sideways:  99.097%
   *   - moved one pixel vertically:                 99.278%
   *   - one pixel fatter (dilated):                 98.354%
   *   - one pixel thinner (eroded):                 98.403%
   *
   * So a model change that moved the mask by a single pixel anywhere fails here, while a
   * handful of individual edge pixels landing differently does not. Recalibrate on a new target
   * before trusting it there — this number is a statement about one renderer.
   */
  MIN_AGREEMENT: 0.995,
  /**
   * The negative control, asserted in the same run so the number above cannot be a comparison
   * that agrees with everything.
   *
   * The same scene at a different pinned compositor frame: `motion=pan` offsets the subject by
   * `0.08 * sin(2*PI*n/120)` of the frame width, so frame 90 is frame 30's subject moved 0.16
   * of the width — 26 pixels at the classification scale. Observed **79.424%**, exactly
   * reproducible across the same five runs, against a shift-26 transform of the golden at
   * 79.167%. A foreground ratio of 14.40% against the golden's 14.47% confirms it is the same
   * silhouette in a different place rather than a mask that fell apart.
   *
   * 0.90 sits 10.6 points above that control and 9.5 below the pass band.
   */
  MAX_DISPLACED_AGREEMENT: 0.9,
};

/**
 * I1 — the asset URLs the library reaches for when no `assetPaths` override is given.
 *
 * Categorical rather than numeric: what this case asserts is a set of URLs and an HTTP status,
 * not a measurement. The values below were read off a real run rather than copied out of
 * `BackgroundTransformer.init()`, so a path the library quietly changes fails here instead of
 * agreeing with itself.
 *
 * Observed on headless Chrome 153 / macOS, `pnpm test:e2e --grep I1`, page loaded at its
 * defaults. Exactly three remote requests leave the page across a whole attach, all 200:
 *
 *   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.js
 *   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.wasm
 *   https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
 *
 * No redirects on either host, so a 3xx is already a change worth looking at. That list is also
 * the set a self-hosting integration has to mirror.
 *
 * The segmenter those three files produce is then checked against `BLUR` rather than against a
 * number of its own: observed background energy 0.0579 -> 0.0169, a 71% reduction, against the
 * 55% `BLUR.MIN_REDUCTION` asks for.
 *
 * Two negative controls, neither committed, since each asserts a broken CDN rather than a
 * working one:
 *
 * - Return a deliberately wrong pin from `pinnedTasksVisionVersion()` (`'0.10.13'` instead of
 *   `pin`). Both halves fail in about 1.5s, naming the served version against the expected one
 *   — so the version match is carried by the comparison and not by the URL shape.
 * - Route `MODEL_GLOB` to a 404 in I1b before `app.goto()`. Caught in 1.3s as
 *   `asset did not answer 200: 404 .../selfie_segmenter.tflite`, rather than as the attach
 *   timeout it would be if the status check ran after the wait on `videoProcessor`.
 */
export const CDN_ASSETS = {
  /** The dependency whose pin ends up in the fileset URL. */
  PINNED_DEPENDENCY: '@mediapipe/tasks-vision',
  /**
   * Everything in the URL up to the version. Spelled out so a move off jsDelivr, or to a
   * differently shaped npm path, fails rather than passing a version regex that still matches.
   */
  FILESET_PREFIX: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@',
  /** The model path, which carries no version of its own — `latest` is resolved server-side. */
  MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  /** Route patterns covering both hosts, used to keep the version half of I1 offline. */
  FILESET_GLOB: '**/cdn.jsdelivr.net/npm/@mediapipe/tasks-vision**',
  MODEL_GLOB: '**/storage.googleapis.com/mediapipe-models/**',
  /** The three files above, by their tails. */
  EXPECTED_SUFFIXES: [
    '/wasm/vision_wasm_internal.js',
    '/wasm/vision_wasm_internal.wasm',
    '/selfie_segmenter.tflite',
  ],
  OK_STATUS: 200,
  /**
   * Click to the fileset request appearing, with the CDN intercepted. Observed 102ms, which is
   * `expect.poll`'s first interval rather than anything the request took — there is no fetch in
   * the way. Left as a liveness bound rather than pinned near that: what it has to separate is
   * "asks for the fileset" from "never asks".
   */
  MAX_REQUEST_WAIT_MS: 10_000,
  /**
   * And a real attach over the live CDN, click to `videoProcessor` flipping true. Observed
   * 692ms and 801ms warm; `ASSET_FAILURE.MAX_RECOVERY_MS` records 4.1s on a cold CDN cache for
   * the same fetch. Generous for the same reason: this is the step the suite already calls its
   * slowest, and a cold CI runner pays that cost.
   */
  MAX_ATTACH_MS: 40_000,
};

/**
 * Self-hosted mediapipe assets (`?assets=local`), used by I2.
 *
 * The measurement that case leans on hardest has no number in it: "external requests attempted"
 * is categorical, and the only acceptable value is zero. It is asserted inline in the spec
 * rather than given a constant here, because a tolerance on it would itself be a bug.
 */
export const SELF_HOSTED_ASSETS = {
  /**
   * Click on `attach-processor` to `document.body.dataset.videoProcessor` flipping true, with
   * the wasm fileset and the model both served from the harness origin.
   *
   * Observed 194, 181 and 141 ms over three runs, against 874 and 762 ms for the same attach
   * reaching a warm CDN and 4.1 s cold (ASSET_FAILURE.MAX_RECOVERY_MS records that one) — a
   * 4-6x saving on the step e2e/AGENTS.md calls the suite's slowest, which is the point of
   * "Known slow spot". Loose by two orders of magnitude on purpose: what this has to catch is
   * an attach that never completes because an asset is unreachable, not a slow machine. The
   * negative control is the same page without `assets=local` against the same aborted CDN
   * routes, where the attach fails 113 ms after the click and this wait times out instead.
   */
  MAX_ATTACH_MS: 20_000,
};
