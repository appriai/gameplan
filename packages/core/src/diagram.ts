import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { SpecError } from "./spec.js";

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

const DiagramBase = z.object({
  id: nodeId,
  title: z.string().min(1),
  note: z.string().optional(),
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

export const GraphDiagram = DiagramBase.extend({
  layout: z.literal("graph"),
  /** LR reads like a pipeline; TB reads like a hierarchy */
  direction: z.enum(["LR", "TB"]).default("LR"),
  nodes: z.array(GraphNode).min(1),
  edges: z.array(GraphEdge).default([]),
  clusters: z.array(GraphCluster).default([]),
});
export type GraphDiagram = z.infer<typeof GraphDiagram>;

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

export const SequenceDiagram = DiagramBase.extend({
  layout: z.literal("sequence"),
  actors: z.array(SequenceActor).min(2),
  messages: z.array(SequenceMessage).min(1),
});
export type SequenceDiagram = z.infer<typeof SequenceDiagram>;

// ------------------------------------------------------------------ any

export const DiagramSpec = z.discriminatedUnion("layout", [GraphDiagram, SequenceDiagram]);
export type DiagramSpec = z.infer<typeof DiagramSpec>;

function checkReferences(spec: DiagramSpec): string[] {
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

export function parseDiagramSpec(input: unknown): DiagramSpec {
  const result = DiagramSpec.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new SpecError(`invalid diagram spec:\n  ${issues.join("\n  ")}`, issues);
  }
  const refIssues = checkReferences(result.data);
  if (refIssues.length > 0) {
    throw new SpecError(`invalid diagram spec:\n  ${refIssues.join("\n  ")}`, refIssues);
  }
  return result.data;
}

export function parseDiagramYaml(source: string): DiagramSpec {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (err) {
    throw new SpecError(`could not parse YAML: ${(err as Error).message}`, [
      (err as Error).message,
    ]);
  }
  return parseDiagramSpec(doc);
}
