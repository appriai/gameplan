/**
 * Advance widths as a fraction of font size, measured from the real fonts.
 *
 * We generate scenes in Node, where the fonts aren't available, but Excalidraw
 * lays text out in the browser with Excalifont loaded. Guessed widths are not
 * good enough: an underestimate of a few percent per character pushes lines
 * past the edge of their card, and the reviewer sees clipped text.
 *
 * These numbers come from `canvas.measureText` against the fonts Excalidraw
 * actually ships. To regenerate after a font change, see scripts/calibrate.md.
 *
 * Measured kerning ratio for running text was 0.999, so summing per-character
 * advances is accurate — no pair-kerning table needed.
 */

/** fontFamily 1 — Excalifont, the hand-drawn default. */
export const HAND_WIDTHS: Readonly<Record<string, number>> = {
  " ": 0.4,
  a: 0.576, b: 0.555, c: 0.504, d: 0.605, e: 0.537, f: 0.497, g: 0.555,
  h: 0.567, i: 0.244, j: 0.328, k: 0.533, l: 0.225, m: 0.663, n: 0.526,
  o: 0.6, p: 0.537, q: 0.539, r: 0.412, s: 0.543, t: 0.553, u: 0.548,
  v: 0.525, w: 0.693, x: 0.591, y: 0.53, z: 0.572,
  A: 0.676, B: 0.761, C: 0.629, D: 0.78, E: 0.707, F: 0.661, G: 0.78,
  H: 0.573, I: 0.545, J: 0.569, K: 0.613, L: 0.543, M: 0.766, N: 0.632,
  O: 0.767, P: 0.698, Q: 0.768, R: 0.736, S: 0.622, T: 0.857, U: 0.73,
  V: 0.592, W: 0.786, X: 0.628, Y: 0.564, Z: 0.832,
  "0": 0.664, "1": 0.427, "2": 0.7, "3": 0.608, "4": 0.585,
  "5": 0.618, "6": 0.64, "7": 0.558, "8": 0.636, "9": 0.629,
  ".": 0.274, ",": 0.257, ":": 0.264, ";": 0.298, "!": 0.314, "|": 0.299,
  "(": 0.441, ")": 0.402, "[": 0.472, "]": 0.497, "{": 0.504, "}": 0.544,
  "-": 0.411, "/": 0.561, "\\": 0.589, _: 0.67, "@": 0.829, "%": 0.928,
  "#": 0.783, "*": 0.525, "+": 0.55, "=": 0.55, "<": 0.55, ">": 0.55,
  "?": 0.466, "~": 0.669, "^": 0.51, "&": 0.718, $: 0.721,
  "'": 0.218, "`": 0.6, '"': 0.371,
  // glyphs the layouts use as bullets and badges
  "✓": 0.838, "✗": 0.838, "→": 0.838, "☐": 0.897, "…": 0.709, "•": 0.838,
};

/** fontFamily 3 — Cascadia, monospace. Every glyph is the same width. */
export const CODE_ADVANCE = 0.5859;

/** Fallbacks for anything not in the table, by character class. */
export const HAND_FALLBACK = {
  lower: 0.53,
  upper: 0.68,
  other: 0.55,
  /** CJK and other full-width scripts render roughly square */
  wide: 1.0,
} as const;

/**
 * A small margin over the measured widths. If Excalifont fails to load, the
 * browser substitutes a fallback face that may run slightly wider; wrapping a
 * hair early is invisible, wrapping a hair late clips the text.
 */
export const SAFETY = 1.02;
