import dagre from "@dagrejs/dagre";
import { groupId } from "../ids.js";
import { clampLines, measureText } from "../text.js";
import { DIAGRAM_COLOR_STYLE, PALETTE, TYPE_SCALE, METRICS } from "../theme.js";
import type { ExcalidrawElement } from "../excalidraw.js";
import type { DiagramColor, FlowchartDiagram, FlowchartNode, FlowchartShape } from "../diagram.js";
import { centeredText } from "../layout/common.js";
import { scopedKey, scopedNodeId, type DiagramLayoutCtx, type DiagramLayoutResult } from "./registry.js";
import type { SceneBuilder } from "../elements.js";
import { DIAGRAM_LOOKS } from "./style.js";

const LABEL_LINES = 3;
const EDGE_LABEL_MAX_WIDTH = 120;
/** gap between a branch label and its line — a rough stroke and its arrowhead wander a few px */
const LABEL_CLEARANCE = 14;
/** sideways drift (px) below which an edge counts as running straight down the flow */
const STRAIGHT_RUN = 10;

/**
 * Per-shape geometry. A label has to fit the shape's *inscribed* box, not its
 * bounding box: an oval gives up its corners and a diamond gives up half its
 * width, so each shape measures its label against a narrower column and grows
 * its height to keep the label clear of the outline.
 */
const SHAPES: Record<
  FlowchartShape,
  {
    type: "rectangle" | "ellipse" | "diamond";
    width: number;
    /** label column width, inside the outline */
    inner: number;
    minHeight: number;
    /** bounding height needed to hold a label block this tall */
    heightFor: (labelHeight: number) => number;
    color: DiagramColor;
  }
> = {
  // an ellipse at height offset y from centre is W·√(1 − (2y/H)²) wide; the
  // label's top and bottom lines need `inner` of that, so H ≥ h / √(1 − (inner/W)²)
  terminator: {
    type: "ellipse",
    width: 200,
    inner: 150,
    minHeight: 64,
    heightFor: (h) => Math.ceil((h + 14) / Math.sqrt(1 - (150 / 200) ** 2)),
    color: "green",
  },
  process: {
    type: "rectangle",
    width: 190,
    inner: 160,
    minHeight: 60,
    heightFor: (h) => h + 32,
    color: "blue",
  },
  // a diamond at offset y is W·(1 − 2|y|/H) wide, so H ≥ h / (1 − inner/W)
  decision: {
    type: "diamond",
    width: 240,
    inner: 130,
    minHeight: 110,
    heightFor: (h) => Math.ceil((h + 12) / (1 - 130 / 240)),
    color: "yellow",
  },
};

interface NodePlan {
  node: FlowchartNode;
  label: ReturnType<typeof clampLines>;
  width: number;
  height: number;
}

function planNode(node: FlowchartNode): NodePlan {
  const shape = SHAPES[node.shape];
  const label = clampLines(node.label, TYPE_SCALE.body, shape.inner, LABEL_LINES);
  const height = Math.max(shape.minHeight, shape.heightFor(label.height));
  return { node, label, width: shape.width, height };
}

/**
 * `flowchart`: a procedure drawn the way you'd sketch it on a whiteboard —
 * ovals to start and end, boxes for steps, diamonds for decisions, labelled
 * branches between them. Laid out by dagre like `graph`, but edges follow
 * dagre's routed path, so a loop back to an earlier step curves around the
 * steps in between rather than cutting through them.
 */
export function layoutFlowchart(
  spec: FlowchartDiagram,
  builder: SceneBuilder,
  ctx: DiagramLayoutCtx,
): DiagramLayoutResult {
  const pad = METRICS.framePadding;
  const k = (key: string) => scopedKey(ctx, key);
  const n = (id: string) => scopedNodeId(ctx, id);
  const look = DIAGRAM_LOOKS[spec.style];
  const plans = new Map(spec.nodes.map((node) => [node.id, planNode(node)]));

  const edgeLabels = new Map<number, ReturnType<typeof measureText>>();
  spec.edges.forEach((edge, i) => {
    if (edge.label) {
      edgeLabels.set(i, measureText(edge.label, TYPE_SCALE.small, EDGE_LABEL_MAX_WIDTH));
    }
  });

  // Two passes. Forward edges are drawn straight with their label beside the
  // line, so dagre mustn't reserve label slots for them — a slot is a dummy
  // node the edge bends around, which turns a plain step-to-step arrow into a
  // hook. Loops back up the chart are the exception: they follow dagre's
  // routed path, and their label slot keeps it clear of the steps they pass.
  // Which edges loop back is only known once dagre has ranked the nodes.
  const firstPass = runDagre(spec, plans, edgeLabels, new Set());
  const backEdges = new Set<number>();
  spec.edges.forEach((edge, i) => {
    const from = firstPass.node(edge.from);
    const to = firstPass.node(edge.to);
    const along = spec.direction === "TB" ? to.y - from.y : to.x - from.x;
    if (along <= 0) backEdges.add(i);
  });
  const g = backEdges.size > 0 ? runDagre(spec, plans, edgeLabels, backEdges) : firstPass;

  const graph = g.graph();
  const graphWidth = Math.ceil(graph.width ?? 0);
  const graphHeight = Math.ceil(graph.height ?? 0);
  const width = Math.max(ctx.width, graphWidth + 2 * pad);
  const height = graphHeight + 2 * pad;
  const offsetX = ctx.x + pad + Math.max(0, (width - 2 * pad - graphWidth) / 2);
  const offsetY = ctx.y + pad;

  const shapes = new Map<string, ExcalidrawElement>();
  for (const plan of plans.values()) {
    const { node } = plan;
    const shape = SHAPES[node.shape];
    const color = DIAGRAM_COLOR_STYLE[node.color ?? shape.color]!;
    const laid = g.node(node.id);
    const x = offsetX + laid.x - plan.width / 2;
    const y = offsetY + laid.y - plan.height / 2;
    // the label is free text, not bound into the shape, so it's grouped with
    // it — a reviewer dragging a step moves its label too
    const group = [groupId(spec.id, k(`node::${node.id}`))];

    const el = builder.rect({
      key: k(`node::${node.id}`),
      role: "diagram-node",
      nodeId: n(node.id),
      type: shape.type,
      x,
      y,
      width: plan.width,
      height: plan.height,
      strokeColor: color.stroke,
      backgroundColor: color.background,
      fillStyle: look.fillStyle,
      strokeWidth: look.strokeWidth,
      roughness: look.roughness,
      roundness: shape.type === "rectangle" ? { type: 3 } : null,
      frameId: ctx.frameId,
      groupIds: group,
    });
    shapes.set(node.id, el);

    centeredText(builder, {
      key: k(`node::${node.id}::label`),
      role: "diagram-node",
      nodeId: n(node.id),
      centerX: x + plan.width / 2,
      y: y + (plan.height - plan.label.height) / 2,
      text: plan.label.text,
      maxWidth: shape.inner,
      fontSize: TYPE_SCALE.body,
      frameId: ctx.frameId,
      groupIds: group,
    });
  }

  spec.edges.forEach((edge, i) => {
    const from = shapes.get(edge.from);
    const to = shapes.get(edge.to);
    if (!from || !to) return;
    const back = backEdges.has(i);
    const laid = g.edge(edge.from, edge.to, String(i)) as
      | { points?: { x: number; y: number }[]; x?: number; y?: number }
      | undefined;
    // dagre's first and last points sit on the bounding boxes; the arrow
    // finds its own ends on the real outline, so keep only the bends
    const via = back
      ? (laid?.points ?? []).slice(1, -1).map((p) => ({ x: offsetX + p.x, y: offsetY + p.y }))
      : [];

    const arrow = builder.arrow({
      key: k(`edge::${i}::${edge.from}::${edge.to}`),
      from,
      to,
      via,
      hugShape: true,
      strokeColor: PALETTE.ink,
      strokeStyle: edge.style,
      strokeWidth: look.strokeWidth,
      roughness: look.roughness,
      frameId: ctx.frameId,
    });

    const measured = edgeLabels.get(i);
    if (!edge.label || !measured) return;
    let centerX: number;
    let centerY: number;
    if (back && laid?.x !== undefined && laid.y !== undefined) {
      centerX = offsetX + laid.x;
      centerY = offsetY + laid.y;
    } else {
      // beside the midpoint of the drawn line, on its outer side: a branch
      // that leans away from the flow's axis gets its label on the side it
      // leans toward, so a decision's "yes" and "no" sit apart rather than
      // bunched in the fork between them. A straight run gets it on the
      // right (TB) or underneath (LR).
      const last = arrow.points[arrow.points.length - 1]!;
      const start = { x: arrow.x, y: arrow.y };
      const end = { x: arrow.x + last[0], y: arrow.y + last[1] };
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / length, y: dx / length };
      const lean = spec.direction === "TB" ? dx : dy;
      const side = Math.abs(lean) > STRAIGHT_RUN ? Math.sign(lean) : 1;
      const normalAcross = spec.direction === "TB" ? normal.x : normal.y;
      if (Math.sign(normalAcross) !== side) {
        normal.x = -normal.x;
        normal.y = -normal.y;
      }
      const clearance =
        Math.abs(normal.x) * (measured.width / 2) + Math.abs(normal.y) * (measured.height / 2) + LABEL_CLEARANCE;
      centerX = (start.x + end.x) / 2 + normal.x * clearance;
      centerY = (start.y + end.y) / 2 + normal.y * clearance;
    }
    centeredText(builder, {
      key: k(`edge::${i}::${edge.from}::${edge.to}::label`),
      role: "decor",
      centerX,
      y: centerY - measured.height / 2,
      text: edge.label,
      maxWidth: EDGE_LABEL_MAX_WIDTH,
      fontSize: TYPE_SCALE.small,
      color: PALETTE.muted,
      frameId: ctx.frameId,
    });
  });

  return { width, height };
}

function runDagre(
  spec: FlowchartDiagram,
  plans: Map<string, NodePlan>,
  edgeLabels: Map<number, ReturnType<typeof measureText>>,
  labelled: Set<number>,
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: spec.direction, nodesep: 60, ranksep: 70, edgesep: 20, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const plan of plans.values()) {
    g.setNode(plan.node.id, { width: plan.width, height: plan.height });
  }
  // edges are named by index so two between the same pair stay distinct
  spec.edges.forEach((edge, i) => {
    const measured = edgeLabels.get(i);
    g.setEdge(
      edge.from,
      edge.to,
      labelled.has(i) && measured
        ? { width: measured.width, height: measured.height, labelpos: "r", labeloffset: 8 }
        : {},
      String(i),
    );
  });
  dagre.layout(g);
  return g;
}
