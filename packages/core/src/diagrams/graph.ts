import dagre from "@dagrejs/dagre";
import { checkGlyph, crossGlyph, fileGlyph, flagGlyph, warningTriangle, type IconArgs } from "../icons.js";
import { clampLines, truncateLine } from "../text.js";
import { DIAGRAM_COLOR_STYLE, METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import type { ExcalidrawElement } from "../excalidraw.js";
import type { GraphDiagram, GraphNode } from "../diagram.js";
import { centeredText } from "../layout/common.js";
import type { DiagramLayoutCtx, DiagramLayoutResult } from "./registry.js";
import type { SceneBuilder } from "../elements.js";

const ICONS: Record<string, ((builder: SceneBuilder, args: IconArgs) => void) | null> = {
  file: fileGlyph,
  warning: warningTriangle,
  flag: flagGlyph,
  check: checkGlyph,
  cross: crossGlyph,
  none: null,
};

const NOTE_LINES = 2;
const CLUSTER_PAD = 20;
const CLUSTER_LABEL_HEIGHT = 24;

interface NodePlan {
  node: GraphNode;
  label: string;
  labelHeight: number;
  note: ReturnType<typeof clampLines> | null;
  hasIcon: boolean;
  height: number;
}

function planNode(node: GraphNode): NodePlan {
  const inner = METRICS.diagramNodeWidth - 24;
  const hasIcon = node.icon !== "none";
  const label = truncateLine(node.label, TYPE_SCALE.body, inner);
  const labelHeight = clampLines(label, TYPE_SCALE.body, inner, 1).height;
  const note = node.note ? clampLines(node.note, TYPE_SCALE.small, inner, NOTE_LINES) : null;

  let height = 12 + (hasIcon ? METRICS.diagramIconSize + 8 : 0) + labelHeight;
  if (note) height += 4 + note.height;
  height += 12;

  return { node, label, labelHeight, note, hasIcon, height };
}

/**
 * `graph`: boxes and arrows, auto-laid-out by dagre — architecture diagrams,
 * dependency trees, data flow. Nodes may belong to a named cluster, rendered
 * as a dashed boundary dagre sizes to fit its members (dagre's compound-graph
 * mode does this natively, so clustering is a property of this layout, not
 * a separate one).
 */
export function layoutGraph(
  spec: GraphDiagram,
  builder: SceneBuilder,
  ctx: DiagramLayoutCtx,
): DiagramLayoutResult {
  const pad = METRICS.framePadding;
  const NODE_WIDTH = METRICS.diagramNodeWidth;
  const plans = new Map(spec.nodes.map((n) => [n.id, planNode(n)]));

  const g = new dagre.graphlib.Graph({ multigraph: false, compound: true });
  g.setGraph({
    rankdir: spec.direction,
    nodesep: 30,
    ranksep: 70,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const cluster of spec.clusters) g.setNode(cluster.id, {});
  for (const node of spec.nodes) {
    const plan = plans.get(node.id)!;
    g.setNode(node.id, { width: NODE_WIDTH, height: plan.height });
    if (node.cluster) g.setParent(node.id, node.cluster);
  }
  for (const edge of spec.edges) g.setEdge(edge.from, edge.to);

  dagre.layout(g);

  const graph = g.graph();
  const graphWidth = Math.ceil(graph.width ?? NODE_WIDTH);
  const graphHeight = Math.ceil(graph.height ?? 0);
  const width = Math.max(ctx.width, graphWidth + 2 * pad);
  const height = graphHeight + 2 * pad;

  const offsetX = ctx.x + pad + Math.max(0, (width - 2 * pad - graphWidth) / 2);
  const offsetY = ctx.y + pad;

  // clusters first, so member nodes paint on top of the boundary
  for (const cluster of spec.clusters) {
    const laid = g.node(cluster.id);
    if (!laid) continue;
    const left = offsetX + laid.x - laid.width / 2 - CLUSTER_PAD;
    const top = offsetY + laid.y - laid.height / 2 - CLUSTER_PAD - CLUSTER_LABEL_HEIGHT;
    builder.rect({
      key: `cluster::${cluster.id}`,
      role: "cluster",
      nodeId: cluster.id,
      x: left,
      y: top,
      width: laid.width + CLUSTER_PAD * 2,
      height: laid.height + CLUSTER_PAD * 2 + CLUSTER_LABEL_HEIGHT,
      strokeColor: PALETTE.muted,
      backgroundColor: PALETTE.transparent,
      strokeStyle: "dashed",
      strokeWidth: 1.5,
      roughness: 0,
      frameId: ctx.frameId,
    });
    builder.text({
      key: `cluster::${cluster.id}::label`,
      role: "cluster",
      nodeId: cluster.id,
      x: left + 10,
      y: top + 6,
      text: cluster.label,
      maxWidth: laid.width + CLUSTER_PAD * 2 - 20,
      fontSize: TYPE_SCALE.small,
      color: PALETTE.muted,
      frameId: ctx.frameId,
    });
  }

  const boxes = new Map<string, ExcalidrawElement>();
  for (const node of spec.nodes) {
    const plan = plans.get(node.id)!;
    const laid = g.node(node.id);
    const x = offsetX + laid.x - NODE_WIDTH / 2;
    const y = offsetY + laid.y - plan.height / 2;
    const centerX = x + NODE_WIDTH / 2;
    const style = DIAGRAM_COLOR_STYLE[node.color]!;

    const box = builder.rect({
      key: `node::${node.id}`,
      role: "diagram-node",
      nodeId: node.id,
      x,
      y,
      width: NODE_WIDTH,
      height: plan.height,
      strokeColor: style.stroke,
      backgroundColor: style.background,
      strokeWidth: 1.5,
      frameId: ctx.frameId,
    });
    boxes.set(node.id, box);

    let cursor = y + 12;
    if (plan.hasIcon) {
      const draw = ICONS[node.icon];
      draw?.(builder, {
        key: `node::${node.id}::icon`,
        role: "diagram-node",
        nodeId: node.id,
        x: centerX - METRICS.diagramIconSize * 0.39,
        y: cursor,
        size: METRICS.diagramIconSize,
        color: style.stroke,
        frameId: ctx.frameId,
      });
      cursor += METRICS.diagramIconSize + 8;
    }

    centeredText(builder, {
      key: `node::${node.id}::label`,
      role: "diagram-node",
      nodeId: node.id,
      centerX,
      y: cursor,
      text: plan.label,
      maxWidth: NODE_WIDTH - 24,
      fontSize: TYPE_SCALE.body,
      frameId: ctx.frameId,
    });
    cursor += plan.labelHeight + 4;

    if (plan.note) {
      centeredText(builder, {
        key: `node::${node.id}::note`,
        role: "diagram-node",
        nodeId: node.id,
        centerX,
        y: cursor,
        text: plan.note.text,
        maxWidth: NODE_WIDTH - 24,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        frameId: ctx.frameId,
      });
    }
  }

  for (const edge of spec.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    builder.arrow({
      key: `edge::${edge.from}::${edge.to}`,
      from,
      to,
      strokeColor: PALETTE.muted,
      strokeStyle: edge.style,
      frameId: ctx.frameId,
    });
    if (edge.label) {
      const midX = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
      const midY = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
      centeredText(builder, {
        key: `edge::${edge.from}::${edge.to}::label`,
        role: "decor",
        centerX: midX,
        y: midY - 20,
        text: edge.label,
        maxWidth: 160,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        frameId: ctx.frameId,
      });
    }
  }

  return { width, height };
}
