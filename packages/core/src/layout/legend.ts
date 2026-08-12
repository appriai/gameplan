import { groupId } from "../ids.js";
import { measureText } from "../text.js";
import { INTENT_STYLE, METRICS, PALETTE, TYPE_SCALE, type Intent } from "../theme.js";
import type { RegionCtx, RegionResult } from "./common.js";

const ORDER: Intent[] = ["approve", "reject", "question", "add"];

const HOW_TO = [
  "Drop a sticky next to anything. Colour = what you mean.",
  "Drag an arrow from a sticky to a card to pin it to that card.",
  "Drag a step card to a new position to reorder it.",
  "Scribble over a card to kill it. Delete it to drop it entirely.",
  "Edit any text in place to rewrite it.",
  "Then hit “Send to agent”.",
];

/**
 * The legend is the contract between the humans and the agent. A teammate who
 * opens the link cold needs to know the colour protocol without being told it
 * in chat, so it lives on the canvas.
 */
export function layoutLegend(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = 24;
  const inner = ctx.width - 2 * pad;
  const swatch = 26;
  const labelWidth = inner - swatch - 12;

  const heading = measureText("How to review this", TYPE_SCALE.heading, inner);
  const intentRows = ORDER.map((intent) =>
    measureText(INTENT_STYLE[intent].label, TYPE_SCALE.body, labelWidth),
  );
  const howToRows = HOW_TO.map((line) =>
    measureText(`•  ${line}`, TYPE_SCALE.small, inner),
  );

  let contentHeight = heading.height + 14;
  for (const row of intentRows) contentHeight += Math.max(swatch, row.height) + 10;
  contentHeight += 18;
  for (const row of howToRows) contentHeight += row.height + 8;

  const frameHeight = contentHeight + 2 * pad;
  const frame = builder.frame({
    key: "frame::legend",
    name: "Legend",
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: frameHeight,
  });

  let cursor = ctx.y + pad;
  builder.text({
    key: "legend::heading",
    role: "legend",
    x: ctx.x + pad,
    y: cursor,
    text: "How to review this",
    maxWidth: inner,
    fontSize: TYPE_SCALE.heading,
    frameId: frame.id,
    locked: true,
  });
  cursor += heading.height + 14;

  ORDER.forEach((intent, i) => {
    const style = INTENT_STYLE[intent];
    const rowHeight = Math.max(swatch, intentRows[i]!.height);
    const group = groupId(spec.id, `legend::${intent}`);
    const shared = { frameId: frame.id, groupIds: [group], locked: true };

    builder.rect({
      key: `legend::swatch::${intent}`,
      role: "legend",
      nodeId: intent,
      x: ctx.x + pad,
      y: cursor + (rowHeight - swatch) / 2,
      width: swatch,
      height: swatch,
      strokeColor: style.stroke,
      backgroundColor: style.background,
      ...shared,
    });

    builder.text({
      key: `legend::label::${intent}`,
      role: "legend",
      nodeId: intent,
      x: ctx.x + pad + swatch + 12,
      y: cursor + (rowHeight - intentRows[i]!.height) / 2,
      text: style.label,
      maxWidth: labelWidth,
      fontSize: TYPE_SCALE.body,
      ...shared,
    });

    cursor += rowHeight + 10;
  });

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
      locked: true,
    });
    cursor += howToRows[i]!.height + 8;
  });

  return { width: ctx.width, height: frameHeight };
}
