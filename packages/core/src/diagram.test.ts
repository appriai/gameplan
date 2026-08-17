import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDiagramSpec, parseDiagramYaml } from "./diagram.js";
import { SpecError } from "./spec.js";
import { renderDiagram } from "./diagrams/render.js";
import { listDiagramLayouts } from "./diagrams/registry.js";

const ARCHITECTURE = fileURLToPath(
  new URL("../../../examples/system-architecture.diagram.yaml", import.meta.url),
);
const SEQUENCE = fileURLToPath(new URL("../../../examples/login-flow.diagram.yaml", import.meta.url));

const FIXED_NOW = 1_700_000_000_000;

function loadGraph() {
  return parseDiagramYaml(readFileSync(ARCHITECTURE, "utf8"));
}
function loadSequence() {
  return parseDiagramYaml(readFileSync(SEQUENCE, "utf8"));
}

describe("diagram spec", () => {
  it("accepts the graph and sequence examples", () => {
    const graph = loadGraph();
    expect(graph.layout).toBe("graph");
    const seq = loadSequence();
    expect(seq.layout).toBe("sequence");
  });

  it("registers graph and sequence in the layout catalogue", () => {
    expect(listDiagramLayouts()).toEqual(expect.arrayContaining(["graph", "sequence"]));
  });

  it("rejects an edge referencing an unknown node", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "graph",
        nodes: [{ id: "a", label: "A" }],
        edges: [{ from: "a", to: "ghost" }],
      }),
    ).toThrow(/unknown node "ghost"/);
  });

  it("rejects a node referencing an unknown cluster", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "graph",
        nodes: [{ id: "a", label: "A", cluster: "ghost" }],
      }),
    ).toThrow(/unknown cluster "ghost"/);
  });

  it("rejects duplicate node ids", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "graph",
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "A again" },
        ],
      }),
    ).toThrow(SpecError);
  });

  it("rejects a message referencing an unknown actor", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "sequence",
        actors: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        messages: [{ from: "a", to: "ghost", label: "hi" }],
      }),
    ).toThrow(/unknown actor "ghost"/);
  });

  it("rejects a sequence diagram with fewer than two actors", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "sequence",
        actors: [{ id: "a", label: "A" }],
        messages: [],
      }),
    ).toThrow(SpecError);
  });
});

function scanIntegrity(scene: ReturnType<typeof renderDiagram>["scene"]) {
  const ids = new Set(scene.elements.map((e) => e.id));
  const bad: string[] = [];
  for (const el of scene.elements) {
    for (const b of el.boundElements ?? []) if (!ids.has(b.id)) bad.push(`bound ${el.id}`);
    if (el.frameId && !ids.has(el.frameId)) bad.push(`frame ${el.id}`);
    if ("containerId" in el && el.containerId && !ids.has(el.containerId as string)) {
      bad.push(`container ${el.id}`);
    }
    if ("startBinding" in el && el.startBinding) {
      const target = (el.startBinding as { elementId: string }).elementId;
      if (!ids.has(target)) bad.push(`start ${el.id}`);
    }
  }
  return { ids, bad };
}

describe("graph layout", () => {
  it("produces a structurally valid scene", () => {
    const { scene } = renderDiagram(loadGraph(), { now: FIXED_NOW });
    const { ids, bad } = scanIntegrity(scene);
    expect(bad).toEqual([]);
    expect(ids.size).toBe(scene.elements.length);
  });

  it("draws the outer frame before every child", () => {
    const { scene } = renderDiagram(loadGraph(), { now: FIXED_NOW });
    for (const el of scene.elements) {
      if (!el.frameId) continue;
      const frameAt = scene.elements.findIndex((e) => e.id === el.frameId);
      const childAt = scene.elements.findIndex((e) => e.id === el.id);
      expect(frameAt).toBeLessThan(childAt);
    }
  });

  it("sizes a cluster to enclose its member nodes", () => {
    const { scene } = renderDiagram(loadGraph(), { now: FIXED_NOW });
    const cluster = scene.elements.find(
      (e) => e.customData?.gameplan?.role === "cluster" && e.type === "rectangle",
    )!;
    // node boxes and their icon glyphs share the "diagram-node" role and
    // nodeId, so distinguish by size: only the outer box is node-width
    const members = scene.elements.filter(
      (e) =>
        e.customData?.gameplan?.role === "diagram-node" &&
        e.type === "rectangle" &&
        e.width > 100 &&
        ["auth-api", "sessions"].includes(e.customData.gameplan.nodeId ?? ""),
    );
    expect(members.length).toBe(2);
    for (const member of members) {
      expect(member.x).toBeGreaterThanOrEqual(cluster.x);
      expect(member.y).toBeGreaterThanOrEqual(cluster.y);
      expect(member.x + member.width).toBeLessThanOrEqual(cluster.x + cluster.width);
      expect(member.y + member.height).toBeLessThanOrEqual(cluster.y + cluster.height);
    }
  });

  it("is byte-identical across re-renders of an unchanged spec", () => {
    const a = renderDiagram(loadGraph(), { now: FIXED_NOW });
    const b = renderDiagram(loadGraph(), { now: FIXED_NOW });
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
  });

  it("keeps edge labels clear of the nodes", () => {
    // dagre reserves space for each label; the geometric midpoint used to put
    // a spanning edge's label right on top of whatever node sat in the middle
    const { scene } = renderDiagram(loadGraph(), { now: FIXED_NOW });
    const nodes = scene.elements.filter(
      (e) => e.customData?.gameplan?.role === "diagram-node" && e.type === "rectangle",
    );
    const labels = scene.elements.filter(
      (e) => e.type === "text" && e.customData?.gameplan?.role === "decor",
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      for (const node of nodes) {
        const w = Math.min(label.x + label.width, node.x + node.width) - Math.max(label.x, node.x);
        const h = Math.min(label.y + label.height, node.y + node.height) - Math.max(label.y, node.y);
        const overlap = w > 0 && h > 0 ? w * h : 0;
        expect(overlap, `"${(label as { originalText?: string }).originalText}" overlaps ${node.customData?.gameplan?.nodeId}`).toBe(0);
      }
    }
  });

  it("tags every element with the diagram id", () => {
    const { scene } = renderDiagram(loadGraph(), { now: FIXED_NOW });
    for (const el of scene.elements) {
      expect(el.customData?.gameplan?.planId).toBe("system-architecture");
    }
  });
});

describe("sequence layout", () => {
  it("produces a structurally valid scene", () => {
    const { scene } = renderDiagram(loadSequence(), { now: FIXED_NOW });
    const { ids, bad } = scanIntegrity(scene);
    expect(bad).toEqual([]);
    expect(ids.size).toBe(scene.elements.length);
  });

  it("gives every actor a lifeline spanning the full message range", () => {
    const { scene } = renderDiagram(loadSequence(), { now: FIXED_NOW });
    const lifelines = scene.elements.filter(
      (e) => e.type === "line" && (e.strokeStyle as string) === "dashed" && !e.customData?.gameplan?.nodeId,
    );
    expect(lifelines.length).toBe(3); // client, api, db
    const heights = lifelines.map((l) => l.height);
    // all three lifelines should span the same vertical range
    expect(new Set(heights).size).toBe(1);
  });

  it("renders a self-message as a loop, not a zero-width line", () => {
    const { scene } = renderDiagram(loadSequence(), { now: FIXED_NOW });
    // the loop carries an arrowhead (endArrowhead: "triangle"), which makes
    // it an "arrow" element, not a "line" — same as every other message
    const selfCall = scene.elements.find(
      (e) => e.customData?.gameplan?.nodeId?.startsWith("api:") && e.type === "arrow",
    );
    expect(selfCall).toBeDefined();
    expect(selfCall!.width).toBeGreaterThan(20);
  });

  it("is byte-identical across re-renders of an unchanged spec", () => {
    const a = renderDiagram(loadSequence(), { now: FIXED_NOW });
    const b = renderDiagram(loadSequence(), { now: FIXED_NOW });
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
  });
});
