import { flagGlyph } from "../icons.js";
import { measureText } from "../text.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import { contentWidth, type RegionCtx, type RegionResult } from "./common.js";

const FLAG_SIZE = 30;
const FLAG_GUTTER = 14;

/**
 * The Goal region: what we're trying to achieve and how we'll know we got
 * there. Deliberately first and deliberately short — if a reviewer only reads
 * one frame, this is the one that catches a misunderstood brief.
 */
export function layoutGoal(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = METRICS.framePadding;
  const titleInset = FLAG_SIZE + FLAG_GUTTER;
  const inner = contentWidth(ctx.width);

  // measure pass: we need the frame's height before we can emit it, because
  // the frame must come first in z-order to sit behind its children
  const title = measureText(spec.title, TYPE_SCALE.title, inner - titleInset);
  const goal = measureText(spec.goal, TYPE_SCALE.heading, inner);
  const criteria = spec.successCriteria.map((c) =>
    measureText(`☐  ${c}`, TYPE_SCALE.body, inner - 16),
  );

  let contentHeight = title.height + 12 + goal.height;
  if (criteria.length > 0) {
    contentHeight += 24 + measureText("Done when", TYPE_SCALE.small, inner).height + 8;
    for (const c of criteria) contentHeight += c.height + 6;
  }

  const frameHeight = contentHeight + 2 * pad;
  const frame = builder.frame({
    key: "frame::goal",
    name: `Goal — rev ${spec.revision}`,
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: frameHeight,
  });

  let cursor = ctx.y + pad;

  flagGlyph(builder, {
    key: "goal::flag",
    role: "goal",
    nodeId: "title",
    x: ctx.x + pad,
    y: cursor + (title.height - FLAG_SIZE) / 2,
    size: FLAG_SIZE,
    frameId: frame.id,
  });
  builder.text({
    key: "goal::title",
    role: "goal",
    nodeId: "title",
    x: ctx.x + pad + titleInset,
    y: cursor,
    text: spec.title,
    maxWidth: inner - titleInset,
    fontSize: TYPE_SCALE.title,
    frameId: frame.id,
  });
  cursor += title.height + 12;

  builder.text({
    key: "goal::goal",
    role: "goal",
    nodeId: "goal",
    x: ctx.x + pad,
    y: cursor,
    text: spec.goal,
    maxWidth: inner,
    fontSize: TYPE_SCALE.heading,
    color: PALETTE.muted,
    frameId: frame.id,
  });
  cursor += goal.height;

  if (spec.successCriteria.length > 0) {
    cursor += 24;
    const label = builder.text({
      key: "goal::criteria-label",
      role: "decor",
      x: ctx.x + pad,
      y: cursor,
      text: "Done when",
      maxWidth: inner,
      fontSize: TYPE_SCALE.small,
      color: "#868e96",
      frameId: frame.id,
    });
    cursor += label.height + 8;

    spec.successCriteria.forEach((criterion, i) => {
      const el = builder.text({
        key: `goal::criterion::${i}`,
        role: "criterion",
        nodeId: `criterion-${i}`,
        ordinal: i,
        x: ctx.x + pad + 16,
        y: cursor,
        text: `☐  ${criterion}`,
        maxWidth: inner - 16,
        fontSize: TYPE_SCALE.body,
        frameId: frame.id,
      });
      cursor += el.height + 6;
    });
  }

  return { width: ctx.width, height: frameHeight };
}
