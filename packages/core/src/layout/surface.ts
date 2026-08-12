import dagre from "@dagrejs/dagre";
import { groupId } from "../ids.js";
import { measureText, truncatePath } from "../text.js";
import { FONT, METRICS, PALETTE, SURFACE_STYLE, TYPE_SCALE } from "../theme.js";
import type { ExcalidrawElement } from "../excalidraw.js";
import type { SurfaceNode } from "../spec.js";
import { contentWidth, emptyNote, type RegionCtx, type RegionResult } from "./common.js";

const NODE_WIDTH = 240;
const INNER = NODE_WIDTH - 2 * METRICS.cardPadding;

interface NodePlan {
  node: SurfaceNode;
  index: number;
  path: string;
  pathBox: ReturnType<typeof measureText>;
  kindBox: ReturnType<typeof measureText>;
  noteBox: ReturnType<typeof measureText> | null;
  height: number;
}

function planNode(node: SurfaceNode, index: number): NodePlan {
  const path = truncatePath(node.path, TYPE_SCALE.body, INNER);
  const pathBox = measureText(path, TYPE_SCALE.body, INNER, FONT.code);
  const kindBox = measureText(node.kind.toUpperCase(), TYPE_SCALE.small, INNER);
  const noteBox = node.note ? measureText(node.note, TYPE_SCALE.small, INNER) : null;
  let height = METRICS.cardPadding + kindBox.height + 6 + pathBox.height;
  if (noteBox) height += 6 + noteBox.height;
  height += METRICS.cardPadding;
  return { node, index, path, pathBox, kindBox, noteBox, height };
}

/**
 * The Code surface region: which files the plan touches, how they relate, and
 * the blast radius implied by that. Laid out with dagre so dependency edges
 * flow left to right instead of crossing arbitrarily.
 */
export function layoutSurface(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = METRICS.framePadding;

  if (spec.surface.length === 0) {
    const height = 2 * pad + 24;
    builder.frame({
      key: "frame::surface",
      name: "Code surface",
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
      height,
    });
    emptyNote(ctx, "surface", ctx.y + pad, "No files declared for this plan.");
    return { width: ctx.width, height };
  }

  const plans = spec.surface.map(planNode);
  const byId = new Map(plans.map((p) => [p.node.id, p]));

  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 80, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const plan of plans) {
    g.setNode(plan.node.id, { width: NODE_WIDTH, height: plan.height });
  }
  for (const plan of plans) {
    for (const dep of plan.node.dependsOn) {
      if (byId.has(dep)) g.setEdge(dep, plan.node.id);
    }
  }
  dagre.layout(g);

  const graph = g.graph();
  const graphWidth = Math.ceil(graph.width ?? NODE_WIDTH);
  const graphHeight = Math.ceil(graph.height ?? 0);
  const frameWidth = Math.max(ctx.width, graphWidth + 2 * pad);
  const frameHeight = graphHeight + 2 * pad;

  // centre the graph when it's narrower than the canvas column
  const offsetX = ctx.x + pad + Math.max(0, (contentWidth(frameWidth) - graphWidth) / 2);
  const offsetY = ctx.y + pad;

  const frame = builder.frame({
    key: "frame::surface",
    name: "Code surface",
    x: ctx.x,
    y: ctx.y,
    width: frameWidth,
    height: frameHeight,
  });

  const boxes = new Map<string, ExcalidrawElement>();

  for (const plan of plans) {
    const laid = g.node(plan.node.id);
    // dagre reports centres; Excalidraw wants top-left
    const x = offsetX + laid.x - NODE_WIDTH / 2;
    const y = offsetY + laid.y - plan.height / 2;
    const style = SURFACE_STYLE[plan.node.kind];
    const group = groupId(spec.id, `surface::${plan.node.id}`);
    const shared = { frameId: frame.id, groupIds: [group] };

    const box = builder.rect({
      key: `surface::${plan.node.id}`,
      role: "surface",
      nodeId: plan.node.id,
      ordinal: plan.index,
      x,
      y,
      width: NODE_WIDTH,
      height: plan.height,
      strokeColor: style.stroke,
      backgroundColor: style.background,
      ...shared,
    });
    boxes.set(plan.node.id, box);

    let cursor = y + METRICS.cardPadding;
    builder.text({
      key: `surface::${plan.node.id}::kind`,
      role: "surface",
      nodeId: plan.node.id,
      x: x + METRICS.cardPadding,
      y: cursor,
      text: plan.node.kind.toUpperCase(),
      maxWidth: INNER,
      fontSize: TYPE_SCALE.small,
      color: style.stroke,
      ...shared,
    });
    cursor += plan.kindBox.height + 6;

    builder.text({
      key: `surface::${plan.node.id}::path`,
      role: "surface",
      nodeId: plan.node.id,
      x: x + METRICS.cardPadding,
      y: cursor,
      text: plan.path,
      maxWidth: INNER,
      fontSize: TYPE_SCALE.body,
      fontFamily: FONT.code,
      ...shared,
    });
    cursor += plan.pathBox.height;

    if (plan.noteBox) {
      cursor += 6;
      builder.text({
        key: `surface::${plan.node.id}::note`,
        role: "surface",
        nodeId: plan.node.id,
        x: x + METRICS.cardPadding,
        y: cursor,
        text: plan.node.note!,
        maxWidth: INNER,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        ...shared,
      });
    }
  }

  for (const plan of plans) {
    for (const dep of plan.node.dependsOn) {
      const from = boxes.get(dep);
      const to = boxes.get(plan.node.id);
      if (!from || !to) continue;
      builder.arrow({
        key: `surface-dep::${dep}::${plan.node.id}`,
        from,
        to,
        strokeColor: PALETTE.muted,
        frameId: frame.id,
        opacity: 70,
      });
    }
  }

  return { width: frameWidth, height: frameHeight };
}
