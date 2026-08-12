import type { SceneBuilder } from "../elements.js";
import type { GameplanMeta } from "../excalidraw.js";
import type { PlanSpec } from "../spec.js";
import { measureText } from "../text.js";
import { FONT, METRICS } from "../theme.js";

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

/**
 * Text centred on `centerX`: measure first, then place the box so Excalidraw's
 * own multi-line centring has the right width to work within. Used wherever
 * the journey-map layouts hang a label under a floating icon or waypoint
 * rather than inside a left-anchored card.
 */
export function centeredText(
  builder: SceneBuilder,
  args: {
    key: string;
    role: GameplanMeta["role"];
    nodeId?: string;
    ordinal?: number;
    centerX: number;
    y: number;
    text: string;
    maxWidth: number;
    fontSize: number;
    fontFamily?: number;
    color?: string;
    opacity?: number;
    frameId: string;
    groupIds?: string[];
  },
): ReturnType<typeof measureText> {
  const fontFamily = args.fontFamily ?? FONT.hand;
  const measured = measureText(args.text, args.fontSize, args.maxWidth, fontFamily);
  builder.text({
    key: args.key,
    role: args.role,
    nodeId: args.nodeId,
    ordinal: args.ordinal,
    x: args.centerX - measured.width / 2,
    y: args.y,
    text: args.text,
    maxWidth: args.maxWidth,
    fontSize: args.fontSize,
    fontFamily,
    textAlign: "center",
    color: args.color,
    opacity: args.opacity,
    frameId: args.frameId,
    groupIds: args.groupIds,
  });
  return measured;
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
