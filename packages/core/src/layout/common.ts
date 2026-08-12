import type { SceneBuilder } from "../elements.js";
import type { PlanSpec } from "../spec.js";
import { METRICS } from "../theme.js";

export interface RegionCtx {
  builder: SceneBuilder;
  spec: PlanSpec;
  /** top-left of the region's frame */
  x: number;
  y: number;
  /** the width every region is laid out against, so frames stack cleanly */
  width: number;
}

export interface RegionResult {
  width: number;
  height: number;
}

/** Cards per row in the wide regions. Four fits a 1440px viewport at ~90% zoom. */
export const COLUMNS = 4;

/** Inner content width available once frame padding is removed. */
export function contentWidth(width: number): number {
  return width - 2 * METRICS.framePadding;
}

/** The canvas width, derived from the card grid rather than hard-coded. */
export const CANVAS_WIDTH =
  COLUMNS * METRICS.cardWidth +
  (COLUMNS - 1) * METRICS.cardGap +
  2 * METRICS.framePadding;

/** Column x offsets for a `COLUMNS`-wide grid starting at `x`. */
export function columnX(x: number, column: number): number {
  return x + METRICS.framePadding + column * (METRICS.cardWidth + METRICS.cardGap);
}

/** An empty region still needs to say so, rather than leaving a silent hole. */
export function emptyNote(
  ctx: RegionCtx,
  key: string,
  y: number,
  message: string,
): number {
  const el = ctx.builder.text({
    key: `${key}::empty`,
    role: "decor",
    x: ctx.x + METRICS.framePadding,
    y,
    text: message,
    maxWidth: contentWidth(ctx.width),
    fontSize: 16,
    color: "#868e96",
  });
  return el.height;
}
