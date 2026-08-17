import { clampLines } from "../text.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import type { SequenceDiagram } from "../diagram.js";
import { centeredText } from "../layout/common.js";
import type { SceneBuilder } from "../elements.js";
import { scopedKey, scopedNodeId, type DiagramLayoutCtx, type DiagramLayoutResult } from "./registry.js";

const LABEL_LINES = 2;

/**
 * `sequence`: actors as columns with a lifeline running down through time,
 * messages as arrows crossing between them in array order. A fundamentally
 * different shape from `graph` — rows are time, not a dependency rank — so
 * it earns its own algorithm rather than being bent to fit dagre.
 */
export function layoutSequence(
  spec: SequenceDiagram,
  builder: SceneBuilder,
  ctx: DiagramLayoutCtx,
): DiagramLayoutResult {
  const pad = METRICS.framePadding;
  const k = (key: string) => scopedKey(ctx, key);
  const n = (id: string) => scopedNodeId(ctx, id);
  const laneWidth = METRICS.sequenceLaneWidth;
  const rowHeight = METRICS.sequenceRowHeight;
  const headerHeight = METRICS.sequenceActorHeight;

  const width = Math.max(ctx.width, spec.actors.length * laneWidth + 2 * pad);
  const laneStart = ctx.x + pad + Math.max(0, (width - 2 * pad - spec.actors.length * laneWidth) / 2);
  const laneX = (i: number) => laneStart + i * laneWidth + laneWidth / 2;
  const actorIndex = new Map(spec.actors.map((a, i) => [a.id, i]));

  const headerY = ctx.y + pad;
  const lifelineTop = headerY + headerHeight + 16;
  const lifelineBottom = lifelineTop + spec.messages.length * rowHeight + 24;
  const height = lifelineBottom - ctx.y + pad;

  // lifelines first, so actor headers and messages paint on top
  spec.actors.forEach((actor, i) => {
    builder.path({
      key: k(`actor::${actor.id}::lifeline`),
      role: "decor",
      points: [
        { x: laneX(i), y: lifelineTop },
        { x: laneX(i), y: lifelineBottom },
      ],
      strokeColor: PALETTE.muted,
      strokeStyle: "dashed",
      strokeWidth: 1.5,
      frameId: ctx.frameId,
    });
  });

  spec.actors.forEach((actor, i) => {
    const x = laneX(i) - laneWidth / 2 + 10;
    builder.card({
      key: k(`actor::${actor.id}`),
      role: "diagram-node",
      nodeId: n(actor.id),
      x,
      y: headerY,
      width: laneWidth - 20,
      height: headerHeight,
      text: actor.label,
      fontSize: TYPE_SCALE.body,
      backgroundColor: PALETTE.bgWhite,
      strokeColor: PALETTE.ink,
      strokeWidth: 2,
      frameId: ctx.frameId,
    });
  });

  spec.messages.forEach((msg, row) => {
    const y = lifelineTop + 20 + row * rowHeight;
    const fromI = actorIndex.get(msg.from)!;
    const toI = actorIndex.get(msg.to)!;
    const fromX = laneX(fromI);
    const toX = laneX(toI);
    const dashed = msg.style === "return";
    const key = k(`message::${row}`);

    if (fromI === toI) {
      // a self-call: a small loop out and back, since a zero-length arrow
      // would just be an arrowhead sitting on the lifeline
      const bump = 46;
      builder.path({
        key: `${key}::loop`,
        role: "diagram-node",
        nodeId: n(`${msg.from}:${row}`),
        points: [
          { x: fromX, y },
          { x: fromX + bump, y },
          { x: fromX + bump, y: y + rowHeight * 0.55 },
          { x: fromX, y: y + rowHeight * 0.55 },
        ],
        strokeColor: PALETTE.muted,
        strokeStyle: dashed ? "dashed" : "solid",
        endArrowhead: "triangle",
        frameId: ctx.frameId,
      });
      const label = clampLines(msg.label, TYPE_SCALE.small, laneWidth - 30, LABEL_LINES);
      builder.text({
        key: `${key}::label`,
        role: "diagram-node",
        nodeId: n(`${msg.from}:${row}`),
        x: fromX + bump + 6,
        y: y + 2,
        text: label.text,
        maxWidth: laneWidth - bump - 20,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        frameId: ctx.frameId,
      });
      return;
    }

    builder.path({
      key,
      role: "diagram-node",
      nodeId: n(`${msg.from}:${msg.to}:${row}`),
      points: [
        { x: fromX, y },
        { x: toX, y },
      ],
      strokeColor: PALETTE.ink,
      strokeStyle: dashed ? "dashed" : "solid",
      endArrowhead: msg.style === "async" ? "triangle" : "triangle",
      frameId: ctx.frameId,
    });

    const midX = (fromX + toX) / 2;
    centeredText(builder, {
      key: `${key}::label`,
      role: "diagram-node",
      nodeId: n(`${msg.from}:${msg.to}:${row}`),
      centerX: midX,
      y: y - 20,
      text: msg.label,
      maxWidth: Math.abs(toX - fromX) - 16,
      fontSize: TYPE_SCALE.small,
      color: PALETTE.muted,
      frameId: ctx.frameId,
    });
  });

  return { width, height };
}
