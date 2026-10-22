import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { SpecError } from "./errors.js";

/**
 * A DiagramSpec is a freestyle counterpart to PlanSpec: not a review of a
 * plan, just "draw this" — a system, a data flow, a sequence of calls. Same
 * rule as PlanSpec applies: semantic structure in, no coordinates. The
 * `layout` field selects which algorithm in the catalogue lays it out —
 * see diagrams/registry.ts. Adding a new layout kind later means writing a
 * new module and registering it, not touching this schema's shape.
 */

const nodeId = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, "ids must be alphanumeric with - or _");

export const DiagramIcon = z.enum(["file", "warning", "flag", "check", "cross", "none"]);
export type DiagramIcon = z.infer<typeof DiagramIcon>;

export const DiagramColor = z.enum(["ink", "green", "blue", "red", "yellow", "violet", "grey"]);
export type DiagramColor = z.infer<typeof DiagramColor>;

/**
 * How every layout draws: `sketch` is rough strokes and pencil hatching, like
 * a whiteboard; `clean` is crisp outlines and solid fills.
 */
export const DiagramStyle = z.enum(["sketch", "clean"]);
export type DiagramStyle = z.infer<typeof DiagramStyle>;

/**
 * What every diagram has regardless of where it lives. `revision` is *not*
 * here: a standalone diagram owns its own revision, while one embedded in a
 * plan is versioned by the plan around it.
 */
const DiagramIdentity = z.object({
  id: nodeId,
  title: z.string().min(1),
  note: z.string().optional(),
});

const DiagramBase = DiagramIdentity.extend({
  revision: z.number().int().nonnegative().default(1),
});

// ---------------------------------------------------------------- graph

export const GraphNode = z.object({
  id: nodeId,
  label: z.string().min(1),
  note: z.string().optional(),
  icon: DiagramIcon.default("none"),
  color: DiagramColor.default("ink"),
  /** id of a cluster this node belongs to, if any */
  cluster: z.string().optional(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  from: nodeId,
  to: nodeId,
  label: z.string().optional(),
  style: z.enum(["solid", "dashed"]).default("solid"),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

export const GraphCluster = z.object({
  id: nodeId,
  label: z.string().min(1),
});
export type GraphCluster = z.infer<typeof GraphCluster>;

/** The graph layout's own fields, independent of where the diagram lives. */
const GRAPH_BODY = {
  layout: z.literal("graph"),
  /** LR reads like a pipeline; TB reads like a hierarchy */
  direction: z.enum(["LR", "TB"]).default("LR"),
  style: DiagramStyle.default("sketch"),
  nodes: z.array(GraphNode).min(1),
  edges: z.array(GraphEdge).default([]),
  clusters: z.array(GraphCluster).default([]),
} as const;

export const GraphDiagram = DiagramBase.extend(GRAPH_BODY);
export type GraphDiagram = z.infer<typeof GraphDiagram>;

// ------------------------------------------------------------ flowchart

/**
 * The classic flowchart vocabulary: `terminator` (start/end, drawn as an
 * oval), `process` (a step, a box) and `decision` (a question, a diamond).
 */
export const FlowchartShape = z.enum(["terminator", "process", "decision"]);
export type FlowchartShape = z.infer<typeof FlowchartShape>;

export const FlowchartNode = z.object({
  id: nodeId,
  label: z.string().min(1),
  shape: FlowchartShape.default("process"),
  /** defaults per shape: terminators green, decisions yellow, processes blue */
  color: DiagramColor.optional(),
});
export type FlowchartNode = z.infer<typeof FlowchartNode>;

export const FlowchartEdge = z.object({
  from: nodeId,
  to: nodeId,
  /** a decision's branch — "yes", "no", "retry" */
  label: z.string().optional(),
  style: z.enum(["solid", "dashed"]).default("solid"),
});
export type FlowchartEdge = z.infer<typeof FlowchartEdge>;

/** The flowchart layout's own fields, independent of where the diagram lives. */
const FLOWCHART_BODY = {
  layout: z.literal("flowchart"),
  /** TB reads like a procedure; LR suits a wide, shallow flow */
  direction: z.enum(["TB", "LR"]).default("TB"),
  style: DiagramStyle.default("sketch"),
  nodes: z.array(FlowchartNode).min(1),
  edges: z.array(FlowchartEdge).default([]),
} as const;

export const FlowchartDiagram = DiagramBase.extend(FLOWCHART_BODY);
export type FlowchartDiagram = z.infer<typeof FlowchartDiagram>;

// ------------------------------------------------------------- sequence

export const SequenceActor = z.object({
  id: nodeId,
  label: z.string().min(1),
});
export type SequenceActor = z.infer<typeof SequenceActor>;

export const SequenceMessage = z.object({
  from: nodeId,
  to: nodeId,
  label: z.string().min(1),
  /** call = solid arrow forward; return = dashed arrow back; async = solid, open head */
  style: z.enum(["call", "return", "async"]).default("call"),
});
export type SequenceMessage = z.infer<typeof SequenceMessage>;

/** The sequence layout's own fields, independent of where the diagram lives. */
const SEQUENCE_BODY = {
  layout: z.literal("sequence"),
  style: DiagramStyle.default("sketch"),
  actors: z.array(SequenceActor).min(2),
  messages: z.array(SequenceMessage).min(1),
} as const;

export const SequenceDiagram = DiagramBase.extend(SEQUENCE_BODY);
export type SequenceDiagram = z.infer<typeof SequenceDiagram>;

// ------------------------------------------------------------------ any

/** A standalone diagram with a single layout — the original form. */
export const LayoutDiagram = z.discriminatedUnion("layout", [
  GraphDiagram,
  FlowchartDiagram,
  SequenceDiagram,
]);
export type LayoutDiagram = z.infer<typeof LayoutDiagram>;

/**
 * The same diagram embedded inside a PlanSpec — identical drawing fields,
 * but versioned by the plan rather than carrying its own `revision`.
 */
export const PlanDiagram = z.discriminatedUnion("layout", [
  DiagramIdentity.extend(GRAPH_BODY),
  DiagramIdentity.extend(FLOWCHART_BODY),
  DiagramIdentity.extend(SEQUENCE_BODY),
]);
export type PlanDiagram = z.infer<typeof PlanDiagram>;

/**
 * A standalone diagram holding several panels, each with its own layout,
 * rendered as titled frames on one canvas. Panels are the same shape as a
 * plan's embedded diagrams, so they share the drawing vocabulary and the
 * `panel:node` id namespacing.
 */
export const PanelsDiagram = DiagramBase.extend({
  panels: z.array(PlanDiagram).min(1),
});
export type PanelsDiagram = z.infer<typeof PanelsDiagram>;

/** A standalone diagram, rendered by `gameplan draw` at its own URL. */
export const DiagramSpec = z.union([LayoutDiagram, PanelsDiagram]);
export type DiagramSpec = z.infer<typeof DiagramSpec>;

/**
 * Dangling-reference checks over a diagram's body. Exported so a plan can run
 * the same validation over each diagram it embeds — an edge pointing at a
 * node that doesn't exist is exactly as broken either way.
 */
export function checkDiagramReferences(spec: LayoutDiagram | PlanDiagram): string[] {
  const issues: string[] = [];

  if (spec.layout === "graph") {
    const nodeIds = new Set(spec.nodes.map((n) => n.id));
    const clusterIds = new Set(spec.clusters.map((c) => c.id));
    const seenNodes = new Set<string>();
    for (const node of spec.nodes) {
      if (seenNodes.has(node.id)) issues.push(`duplicate node id "${node.id}"`);
      seenNodes.add(node.id);
      if (node.cluster && !clusterIds.has(node.cluster)) {
        issues.push(`node "${node.id}" references unknown cluster "${node.cluster}"`);
      }
    }
    const seenClusters = new Set<string>();
    for (const cluster of spec.clusters) {
      if (seenClusters.has(cluster.id)) issues.push(`duplicate cluster id "${cluster.id}"`);
      seenClusters.add(cluster.id);
    }
    spec.edges.forEach((edge, i) => {
      if (!nodeIds.has(edge.from)) issues.push(`edges[${i}] references unknown node "${edge.from}"`);
      if (!nodeIds.has(edge.to)) issues.push(`edges[${i}] references unknown node "${edge.to}"`);
    });
  }

  if (spec.layout === "flowchart") {
    const nodeIds = new Set(spec.nodes.map((n) => n.id));
    const seen = new Set<string>();
    for (const node of spec.nodes) {
      if (seen.has(node.id)) issues.push(`duplicate node id "${node.id}"`);
      seen.add(node.id);
    }
    spec.edges.forEach((edge, i) => {
      if (!nodeIds.has(edge.from)) issues.push(`edges[${i}] references unknown node "${edge.from}"`);
      if (!nodeIds.has(edge.to)) issues.push(`edges[${i}] references unknown node "${edge.to}"`);
    });
  }

  if (spec.layout === "sequence") {
    const actorIds = new Set(spec.actors.map((a) => a.id));
    const seen = new Set<string>();
    for (const actor of spec.actors) {
      if (seen.has(actor.id)) issues.push(`duplicate actor id "${actor.id}"`);
      seen.add(actor.id);
    }
    spec.messages.forEach((msg, i) => {
      if (!actorIds.has(msg.from)) issues.push(`messages[${i}] references unknown actor "${msg.from}"`);
      if (!actorIds.has(msg.to)) issues.push(`messages[${i}] references unknown actor "${msg.to}"`);
    });
  }

  return issues;
}

/** Top-level fields that belong to a single layout, never to a panels diagram. */
const LAYOUT_ONLY_FIELDS = ["layout", "direction", "style", "nodes", "edges", "clusters", "actors", "messages"];

/** Panel ids the diagram's own header already uses as feedback node ids. */
const RESERVED_PANEL_IDS = new Set(["title", "note"]);

/**
 * Mistakes zod would otherwise swallow: it strips unknown keys, so a leftover
 * top-level `layout`/`nodes` next to `panels:` (or a `revision` on a panel)
 * would silently vanish from the drawing instead of failing.
 */
function checkPanelsShape(input: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const field of LAYOUT_ONLY_FIELDS) {
    if (field in input) {
      issues.push(`"${field}" cannot be combined with "panels" — use either a single layout or panels, not both`);
    }
  }
  if (Array.isArray(input.panels)) {
    input.panels.forEach((panel, i) => {
      if (typeof panel !== "object" || panel === null) return;
      if ("revision" in panel) {
        issues.push(`panels.${i}.revision: a panel is versioned by its diagram — set "revision" at the top level`);
      }
      const id = (panel as { id?: unknown }).id;
      if (typeof id === "string" && RESERVED_PANEL_IDS.has(id)) {
        issues.push(`panels.${i}.id: "${id}" is reserved — it names the diagram's own header`);
      }
    });
  }
  return issues;
}

export interface DiagramParseOptions {
  /** Restore previously accepted saved specs; new renders must remain strict. */
  allowLegacyPanels?: boolean;
}

export function parseDiagramSpec(input: unknown, options?: DiagramParseOptions): DiagramSpec {
  // pick the schema by shape up front: a z.union would bury the real problem
  // under "invalid input" errors from whichever branch wasn't meant
  const hasPanels = typeof input === "object" && input !== null && "panels" in input;
  if (hasPanels && !options?.allowLegacyPanels) {
    const shapeIssues = checkPanelsShape(input as Record<string, unknown>);
    if (shapeIssues.length > 0) {
      throw new SpecError(`invalid diagram spec:\n  ${shapeIssues.join("\n  ")}`, shapeIssues);
    }
  }
  const result = (hasPanels ? PanelsDiagram : LayoutDiagram).safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new SpecError(`invalid diagram spec:\n  ${issues.join("\n  ")}`, issues);
  }
  const data: DiagramSpec = result.data;
  const refIssues: string[] = [];
  if ("panels" in data) {
    const seen = new Set<string>();
    for (const panel of data.panels) {
      if (seen.has(panel.id)) refIssues.push(`duplicate panel id "${panel.id}"`);
      seen.add(panel.id);
      for (const issue of checkDiagramReferences(panel)) {
        refIssues.push(`panel "${panel.id}": ${issue}`);
      }
    }
  } else {
    refIssues.push(...checkDiagramReferences(data));
  }
  if (refIssues.length > 0) {
    throw new SpecError(`invalid diagram spec:\n  ${refIssues.join("\n  ")}`, refIssues);
  }
  return data;
}

export function parseDiagramYaml(source: string, options?: DiagramParseOptions): DiagramSpec {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (err) {
    throw new SpecError(`could not parse YAML: ${(err as Error).message}`, [
      (err as Error).message,
    ]);
  }
  return parseDiagramSpec(doc, options);
}
