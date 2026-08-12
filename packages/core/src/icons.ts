import type { SceneBuilder } from "./elements.js";
import type { GameplanMeta } from "./excalidraw.js";
import { FONT, PALETTE } from "./theme.js";

/**
 * Hand-drawn pictograms, built from Excalidraw's own primitives.
 *
 * There's no icon font or SVG import available inside a generated
 * `.excalidraw` scene — every mark has to be a rectangle, ellipse, diamond,
 * line, or arrow to stay editable and re-tagged like everything else. These
 * are small, fixed compositions of those primitives, each carrying the same
 * role/nodeId as whatever they decorate so a sticky dropped on the glyph
 * anchors to the right spec node.
 */

export interface IconArgs {
  key: string;
  /** top-left of the icon's bounding box */
  x: number;
  y: number;
  size: number;
  role: GameplanMeta["role"];
  nodeId?: string;
  color?: string;
  background?: string;
  frameId?: string | null;
  groupIds?: string[];
  opacity?: number;
  locked?: boolean;
}

function shared(args: IconArgs, suffix: string) {
  return {
    key: `${args.key}::${suffix}`,
    role: args.role,
    nodeId: args.nodeId,
    frameId: args.frameId,
    groupIds: args.groupIds,
    opacity: args.opacity,
    locked: args.locked,
  };
}

/** A small check mark — verification, "this is how we'll know it worked". */
export function checkGlyph(builder: SceneBuilder, args: IconArgs): void {
  const { x, y, size } = args;
  builder.path({
    ...shared(args, "check"),
    points: [
      { x: x + size * 0.12, y: y + size * 0.55 },
      { x: x + size * 0.42, y: y + size * 0.85 },
      { x: x + size * 0.92, y: y + size * 0.15 },
    ],
    strokeColor: args.color ?? PALETTE.strokeGreen,
    strokeWidth: 2.5,
  });
}

/** A filled warning triangle with a bang — risk, severity-coloured. */
export function warningTriangle(builder: SceneBuilder, args: IconArgs): void {
  const { x, y, size } = args;
  const color = args.color ?? PALETTE.strokeRed;
  builder.path({
    ...shared(args, "triangle"),
    points: [
      { x: x + size * 0.5, y },
      { x: x + size, y: y + size * 0.92 },
      { x, y: y + size * 0.92 },
    ],
    closed: true,
    strokeColor: color,
    backgroundColor: args.background ?? PALETTE.bgRed,
    strokeWidth: 2,
  });
  builder.text({
    ...shared(args, "bang"),
    x: x + size * 0.4,
    y: y + size * 0.32,
    text: "!",
    maxWidth: size,
    fontSize: Math.round(size * 0.55),
    fontFamily: FONT.hand,
    color,
  });
}

/** A document with a folded corner and two lines of "text" — a file. */
export function fileGlyph(builder: SceneBuilder, args: IconArgs): void {
  const { x, y, size } = args;
  const color = args.color ?? PALETTE.ink;
  const w = size * 0.78;
  builder.rect({
    ...shared(args, "body"),
    x,
    y,
    width: w,
    height: size,
    strokeColor: color,
    backgroundColor: args.background ?? PALETTE.transparent,
    roundness: { type: 3 },
  });
  builder.path({
    ...shared(args, "fold"),
    points: [
      { x: x + w * 0.62, y },
      { x: x + w, y: y + size * 0.3 },
    ],
    strokeColor: color,
    strokeWidth: 1.5,
  });
  for (const frac of [0.52, 0.72]) {
    builder.path({
      ...shared(args, `line-${frac}`),
      points: [
        { x: x + w * 0.18, y: y + size * frac },
        { x: x + w * 0.82, y: y + size * frac },
      ],
      strokeColor: color,
      strokeWidth: 1.5,
    });
  }
}

/** A pole with a pennant — the goal, the destination of the journey. */
export function flagGlyph(builder: SceneBuilder, args: IconArgs): void {
  const { x, y, size } = args;
  const color = args.color ?? PALETTE.strokeBlue;
  builder.path({
    ...shared(args, "pole"),
    points: [
      { x: x + size * 0.12, y },
      { x: x + size * 0.12, y: y + size },
    ],
    strokeColor: PALETTE.ink,
    strokeWidth: 2.5,
  });
  builder.path({
    ...shared(args, "pennant"),
    points: [
      { x: x + size * 0.12, y },
      { x: x + size * 0.95, y: y + size * 0.2 },
      { x: x + size * 0.12, y: y + size * 0.42 },
    ],
    closed: true,
    strokeColor: color,
    backgroundColor: args.background ?? PALETTE.bgBlue,
    strokeWidth: 1.5,
  });
}

/** A cross — struck an idea that was considered and set aside. */
export function crossGlyph(builder: SceneBuilder, args: IconArgs): void {
  const { x, y, size } = args;
  const color = args.color ?? PALETTE.muted;
  builder.path({
    ...shared(args, "cross-a"),
    points: [
      { x: x + size * 0.15, y: y + size * 0.15 },
      { x: x + size * 0.85, y: y + size * 0.85 },
    ],
    strokeColor: color,
    strokeWidth: 2,
  });
  builder.path({
    ...shared(args, "cross-b"),
    points: [
      { x: x + size * 0.85, y: y + size * 0.15 },
      { x: x + size * 0.15, y: y + size * 0.85 },
    ],
    strokeColor: color,
    strokeWidth: 2,
  });
}
