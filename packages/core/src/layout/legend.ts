import { groupId } from "../ids.js";
import { checkGlyph, fileGlyph, warningTriangle } from "../icons.js";
import { measureText } from "../text.js";
import { INTENT_STYLE, METRICS, PALETTE, TYPE_SCALE, type Intent } from "../theme.js";
import type { RegionCtx, RegionResult } from "./common.js";

const INTENT_ORDER: Intent[] = ["approve", "reject", "question", "add"];

const HOW_TO = [
  "Drop a sticky next to anything. Colour = what you mean.",
  "Drag an arrow from a sticky to a card to pin it to that card.",
  "Drag a step's waypoint to a new position to reorder it.",
  "Scribble over something to kill it. Delete it to drop it entirely.",
  "Edit any text in place to rewrite it.",
  "Then hit “Send to agent”.",
];

const ROW = 30;
const GLYPH = 20;

/**
 * The legend is the contract between the humans and the agent — split in
 * two: how to *read* the new visual language (path, diamond, icons), and
 * how to *write* on it (the sticky protocol). A teammate who opens the link
 * cold needs both without being told either in chat.
 */
export function layoutLegend(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = 24;
  const inner = ctx.width - 2 * pad;
  const labelWidth = inner - GLYPH - 12;

  const readingHeading = measureText("Reading the canvas", TYPE_SCALE.heading, inner);
  const reviewHeading = measureText("How to review this", TYPE_SCALE.heading, inner);
  const howToRows = HOW_TO.map((line) => measureText(`•  ${line}`, TYPE_SCALE.small, inner));

  const readingRows = 7;
  const intentRows = INTENT_ORDER.length;

  const contentHeight =
    readingHeading.height +
    14 +
    readingRows * ROW +
    24 +
    reviewHeading.height +
    14 +
    intentRows * ROW +
    18 +
    howToRows.reduce((a, r) => a + r.height + 8, 0);

  const frameHeight = contentHeight + 2 * pad;
  const frame = builder.frame({
    key: "frame::legend",
    name: "Legend",
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: frameHeight,
  });

  const locked = true;
  let cursor = ctx.y + pad;

  builder.text({
    key: "legend::reading-heading",
    role: "legend",
    x: ctx.x + pad,
    y: cursor,
    text: "Reading the canvas",
    maxWidth: inner,
    fontSize: TYPE_SCALE.heading,
    frameId: frame.id,
    locked,
  });
  cursor += readingHeading.height + 14;

  const glyphX = ctx.x + pad;
  const labelX = glyphX + GLYPH + 12;

  const row = (key: string, draw: (y: number) => void, label: string) => {
    const midY = cursor + ROW / 2;
    draw(midY - GLYPH / 2);
    builder.text({
      key: `legend::${key}::label`,
      role: "legend",
      x: labelX,
      y: midY - TYPE_SCALE.small * 0.7,
      text: label,
      maxWidth: labelWidth,
      fontSize: TYPE_SCALE.small,
      frameId: frame.id,
      locked,
    });
    cursor += ROW;
  };

  row(
    "waypoint",
    (y) =>
      builder.rect({
        key: "legend::waypoint::glyph",
        role: "legend",
        type: "ellipse",
        x: glyphX,
        y,
        width: GLYPH,
        height: GLYPH,
        strokeColor: PALETTE.ink,
        backgroundColor: PALETTE.bgWhite,
        strokeWidth: 2,
        frameId: frame.id,
        locked,
      }),
    "Steps, in order",
  );

  row(
    "diamond",
    (y) =>
      builder.rect({
        key: "legend::diamond::glyph",
        role: "legend",
        type: "diamond",
        x: glyphX,
        y,
        width: GLYPH,
        height: GLYPH,
        strokeColor: PALETTE.ink,
        backgroundColor: PALETTE.bgWhite,
        strokeWidth: 2,
        frameId: frame.id,
        locked,
      }),
    "A decision point",
  );

  row(
    "chosen",
    (y) => {
      const midY = y + GLYPH / 2;
      builder.path({
        key: "legend::chosen::line",
        role: "legend",
        points: [
          { x: glyphX, y: midY },
          { x: glyphX + GLYPH, y: midY },
        ],
        strokeColor: PALETTE.strokeGreen,
        strokeWidth: 2.5,
        frameId: frame.id,
        locked,
      });
      builder.rect({
        key: "legend::chosen::dot",
        role: "legend",
        type: "ellipse",
        x: glyphX + GLYPH - 5,
        y: midY - 5,
        width: 10,
        height: 10,
        strokeColor: PALETTE.strokeGreen,
        backgroundColor: PALETTE.bgGreen,
        strokeWidth: 2,
        frameId: frame.id,
        locked,
      });
    },
    "Chosen path — bold, filled",
  );

  row(
    "rejected",
    (y) => {
      const midY = y + GLYPH / 2;
      builder.path({
        key: "legend::rejected::line",
        role: "legend",
        points: [
          { x: glyphX, y: midY },
          { x: glyphX + GLYPH, y: midY },
        ],
        strokeColor: PALETTE.muted,
        strokeStyle: "dashed",
        strokeWidth: 1.5,
        opacity: 65,
        frameId: frame.id,
        locked,
      });
      builder.rect({
        key: "legend::rejected::dot",
        role: "legend",
        type: "ellipse",
        x: glyphX + GLYPH - 5,
        y: midY - 5,
        width: 10,
        height: 10,
        strokeColor: PALETTE.muted,
        backgroundColor: PALETTE.transparent,
        strokeWidth: 2,
        opacity: 65,
        frameId: frame.id,
        locked,
      });
    },
    "Considered, not taken",
  );

  row(
    "file",
    (y) =>
      fileGlyph(builder, {
        key: "legend::file",
        role: "legend",
        x: glyphX,
        y,
        size: GLYPH,
        frameId: frame.id,
        locked,
      }),
    "A file this plan touches",
  );

  row(
    "check",
    (y) =>
      checkGlyph(builder, {
        key: "legend::check",
        role: "legend",
        x: glyphX,
        y,
        size: GLYPH,
        frameId: frame.id,
        locked,
      }),
    "How we'll verify it",
  );

  row(
    "warning",
    (y) =>
      warningTriangle(builder, {
        key: "legend::warning",
        role: "legend",
        x: glyphX,
        y,
        size: GLYPH,
        frameId: frame.id,
        locked,
      }),
    "A risk, coloured by severity",
  );

  cursor += 24;

  builder.text({
    key: "legend::review-heading",
    role: "legend",
    x: ctx.x + pad,
    y: cursor,
    text: "How to review this",
    maxWidth: inner,
    fontSize: TYPE_SCALE.heading,
    frameId: frame.id,
    locked,
  });
  cursor += reviewHeading.height + 14;

  for (const intent of INTENT_ORDER) {
    const style = INTENT_STYLE[intent];
    const group = groupId(spec.id, `legend::${intent}`);
    const swatchY = cursor + (ROW - GLYPH) / 2;
    builder.rect({
      key: `legend::swatch::${intent}`,
      role: "legend",
      nodeId: intent,
      x: glyphX,
      y: swatchY,
      width: GLYPH,
      height: GLYPH,
      strokeColor: style.stroke,
      backgroundColor: style.background,
      frameId: frame.id,
      groupIds: [group],
      locked,
    });
    builder.text({
      key: `legend::label::${intent}`,
      role: "legend",
      nodeId: intent,
      x: labelX,
      y: cursor + (ROW - TYPE_SCALE.small * 1.4) / 2,
      text: style.label,
      maxWidth: labelWidth,
      fontSize: TYPE_SCALE.small,
      frameId: frame.id,
      groupIds: [group],
      locked,
    });
    cursor += ROW;
  }

  cursor += 18;
  HOW_TO.forEach((line, i) => {
    builder.text({
      key: `legend::howto::${i}`,
      role: "legend",
      x: ctx.x + pad,
      y: cursor,
      text: `•  ${line}`,
      maxWidth: inner,
      fontSize: TYPE_SCALE.small,
      color: PALETTE.muted,
      frameId: frame.id,
      locked,
    });
    cursor += howToRows[i]!.height + 8;
  });

  return { width: ctx.width, height: frameHeight };
}
