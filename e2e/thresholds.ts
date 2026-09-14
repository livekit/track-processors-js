/**
 * Every number the suite asserts on, in one place.
 *
 * Each carries the value actually observed on headless Chrome 153 / macOS at 1280x720 with the
 * default procedural subject. They are deliberately loose around those observations: the point
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
