import dagre from "@dagrejs/dagre";
import { groupId } from "../ids.js";
import { fileGlyph } from "../icons.js";
import { clampLines, truncateLine } from "../text.js";
import { FONT, METRICS, PALETTE, SURFACE_STYLE, TYPE_SCALE } from "../theme.js";
import type { ExcalidrawElement } from "../excalidraw.js";
import type { SurfaceNode } from "../spec.js";
import { centeredText, contentWidth, emptyNote, type RegionCtx, type RegionResult } from "./common.js";

const NODE_WIDTH = METRICS.surfaceNodeWidth;
const INNER = NODE_WIDTH - 24;
const NOTE_LINES = 3;

interface NodePlan {
  node: SurfaceNode;
  index: number;
  label: string;
  labelHeight: number;
  note: ReturnType<typeof clampLines> | null;
  height: number;
}

function planNode(node: SurfaceNode, index: number): NodePlan {
  const basename = node.path.split("/").pop() ?? node.path;
  // a filename is an identifier, not a sentence — one line is right for it
  const label = truncateLine(basename, TYPE_SCALE.body, INNER, FONT.code);
  const labelHeight = clampLines(label, TYPE_SCALE.body, INNER, 1, FONT.code).height;
  const note = node.note ? clampLines(node.note, TYPE_SCALE.small, INNER, NOTE_LINES) : null;

  let height = 12 + METRICS.surfaceIconSize + 8 + labelHeight;
  if (note) height += 4 + note.height;
  height += 12;

  return { node, index, label, labelHeight, note, height };
}

/**
 * The Code surface region: which files the plan touches, laid out as a small
 * system diagram — a file glyph and a filename, coloured by kind, connected
 * by dependency arrows. No separate KIND / path / note lines: the icon
 * colour already says new vs modified vs read, and the label is the
 * filename a reviewer actually recognises, not the full path.
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
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 64, marginx: 0, marginy: 0 });
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
    const x = offsetX + laid.x - NODE_WIDTH / 2;
    const y = offsetY + laid.y - plan.height / 2;
    const centerX = x + NODE_WIDTH / 2;
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
      strokeWidth: 1.5,
      ...shared,
    });
    boxes.set(plan.node.id, box);

    let cursor = y + 12;
    fileGlyph(builder, {
      key: `surface::${plan.node.id}::icon`,
      role: "surface",
      nodeId: plan.node.id,
      x: centerX - METRICS.surfaceIconSize * 0.39,
      y: cursor,
      size: METRICS.surfaceIconSize,
      color: style.stroke,
      ...shared,
    });
    cursor += METRICS.surfaceIconSize + 8;

    centeredText(builder, {
      key: `surface::${plan.node.id}::label`,
      role: "surface",
      nodeId: plan.node.id,
      centerX,
      y: cursor,
      text: plan.label,
      maxWidth: INNER,
      fontSize: TYPE_SCALE.body,
      fontFamily: FONT.code,
      frameId: frame.id,
      groupIds: [group],
    });
    cursor += plan.labelHeight + 4;

    if (plan.note) {
      centeredText(builder, {
        key: `surface::${plan.node.id}::note`,
        role: "surface",
        nodeId: plan.node.id,
        centerX,
        y: cursor,
        text: plan.note.text,
        maxWidth: INNER,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        frameId: frame.id,
        groupIds: [group],
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
