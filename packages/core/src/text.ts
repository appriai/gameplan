import { CODE_ADVANCE, HAND_FALLBACK, HAND_WIDTHS, SAFETY } from "./metrics.js";
import { FONT, LINE_HEIGHT } from "./theme.js";

/**
 * Text measurement without a browser or the font files.
 *
 * Widths come from `metrics.ts`, measured against the real fonts Excalidraw
 * ships. See that file for why approximating them is not good enough.
 */

export type FontFamily = number;

function isMonospace(family: FontFamily): boolean {
  return family === FONT.code;
}

export function charWidth(ch: string, fontSize: number, family: FontFamily = FONT.hand): number {
  if (isMonospace(family)) return CODE_ADVANCE * fontSize * SAFETY;

  const known = HAND_WIDTHS[ch];
  if (known !== undefined) return known * fontSize * SAFETY;

  if (ch >= "a" && ch <= "z") return HAND_FALLBACK.lower * fontSize * SAFETY;
  if (ch >= "A" && ch <= "Z") return HAND_FALLBACK.upper * fontSize * SAFETY;
  if (ch.codePointAt(0)! > 0x2e80) return HAND_FALLBACK.wide * fontSize * SAFETY;
  return HAND_FALLBACK.other * fontSize * SAFETY;
}

/** Width of a single line of text at the given size, in px. */
export function measureLine(
  text: string,
  fontSize: number,
  family: FontFamily = FONT.hand,
): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch, fontSize, family);
  return total;
}

/** Break a word that cannot fit on one line at all. */
function breakWord(
  word: string,
  fontSize: number,
  maxWidth: number,
  family: FontFamily,
): string[] {
  const out: string[] = [];
  let current = "";
  let width = 0;
  for (const ch of word) {
    const w = charWidth(ch, fontSize, family);
    if (current !== "" && width + w > maxWidth) {
      out.push(current);
      current = ch;
      width = w;
    } else {
      current += ch;
      width += w;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

/**
 * Greedy word wrap. Honours explicit newlines, so a spec author can force a
 * break where the meaning needs one.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  family: FontFamily = FONT.hand,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (measureLine(candidate, fontSize, family) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      if (measureLine(word, fontSize, family) > maxWidth) {
        const pieces = breakWord(word, fontSize, maxWidth, family);
        for (const piece of pieces.slice(0, -1)) lines.push(piece);
        current = pieces[pieces.length - 1] ?? "";
      } else {
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

export interface Measured {
  /** wrapped text, newline joined — this is what goes in `text` */
  text: string;
  lines: string[];
  width: number;
  height: number;
}

/**
 * Wrap `text` to `maxWidth` and report the box Excalidraw will need. Height is
 * computed the way Excalidraw does: lines * fontSize * lineHeight.
 */
export function measureText(
  text: string,
  fontSize: number,
  maxWidth: number,
  family: FontFamily = FONT.hand,
): Measured {
  const lines = wrapText(text, fontSize, maxWidth, family);
  const width = Math.max(
    1,
    ...lines.map((line) => Math.ceil(measureLine(line, fontSize, family))),
  );
  return {
    text: lines.join("\n"),
    lines,
    width: Math.min(Math.ceil(width), Math.ceil(maxWidth)),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

/** Collapse a path to fit, keeping the informative tail: …/foo/bar.ts */
export function truncatePath(
  path: string,
  fontSize: number,
  maxWidth: number,
  family: FontFamily = FONT.code,
): string {
  if (measureLine(path, fontSize, family) <= maxWidth) return path;
  const parts = path.split("/");
  for (let keep = parts.length - 1; keep >= 1; keep--) {
    const candidate = `…/${parts.slice(-keep).join("/")}`;
    if (measureLine(candidate, fontSize, family) <= maxWidth) return candidate;
  }
  const tail = parts[parts.length - 1] ?? path;
  let out = tail;
  while (out.length > 1 && measureLine(`…${out}`, fontSize, family) > maxWidth) {
    out = out.slice(1);
  }
  return `…${out}`;
}
