import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDiagramSpec, parseDiagramYaml } from "./diagram.js";
import { SpecError } from "./spec.js";
import { renderDiagram } from "./diagrams/render.js";
import { listDiagramLayouts } from "./diagrams/registry.js";
import { METRICS } from "./theme.js";
import type { ExcalidrawScene } from "./excalidraw.js";

const ARCHITECTURE = fileURLToPath(
  new URL("../../../examples/system-architecture.diagram.yaml", import.meta.url),
);
const FLOWCHART = fileURLToPath(new URL("../../../examples/deploy.flowchart.yaml", import.meta.url));
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

  it("gives two edges between the same node pair independent labels", () => {
    // a non-multigraph dagre instance, or a label map keyed only by
    // "from to", collapses distinct parallel edges onto a single slot
    const spec = parseDiagramSpec({
      id: "d",
      title: "t",
      layout: "graph",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b", label: "request" },
        { from: "a", to: "b", label: "response" },
      ],
    });
    const { scene } = renderDiagram(spec, { now: FIXED_NOW });
    const labels = scene.elements.filter(
      (e) => e.type === "text" && e.customData?.gameplan?.role === "decor",
    );
    expect(labels.map((l) => (l as { originalText?: string }).originalText).sort()).toEqual([
      "request",
      "response",
    ]);
    const [first, second] = labels;
    expect(first.x !== second.x || first.y !== second.y).toBe(true);
  });
});

describe("flowchart layout", () => {
  const load = () => parseDiagramYaml(readFileSync(FLOWCHART, "utf8"));
  const render = (spec = load()) => renderDiagram(spec, { now: FIXED_NOW });
  const nodeShape = (scene: ExcalidrawScene, id: string) => {
    const shape = scene.elements.find(
      (element) =>
        element.customData?.gameplan?.nodeId === id &&
        element.customData.gameplan.role === "diagram-node" &&
        element.type !== "text",
    );
    if (!shape) throw new Error(`missing flowchart node "${id}"`);
    return shape;
  };

  type Point = { x: number; y: number };
  type Arrow = {
    type: "arrow";
    x: number;
    y: number;
    points: [number, number][];
    startBinding: { elementId: string } | null;
    endBinding: { elementId: string } | null;
  };
  type EdgeLabel = { originalText: string; x: number; y: number; width: number; height: number };

  const arrowsBetween = (scene: ExcalidrawScene, from: string, to: string) => {
    const fromId = nodeShape(scene, from).id;
    const toId = nodeShape(scene, to).id;
    const arrows = scene.elements.filter(
      (element) =>
        element.type === "arrow" &&
        (element as Arrow).startBinding?.elementId === fromId &&
        (element as Arrow).endBinding?.elementId === toId,
    );
    return arrows as Arrow[];
  };
  const arrowPoints = (arrow: Arrow): Point[] =>
    arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
  const edgeLabel = (scene: ExcalidrawScene, text: string) =>
    scene.elements.find(
      (element) =>
        element.type === "text" &&
        element.customData?.gameplan?.role === "decor" &&
        (element as unknown as EdgeLabel).originalText === text,
    ) as unknown as EdgeLabel;
  const distanceToRoute = (point: Point, route: Point[]) =>
    Math.min(
      ...route.slice(1).map((end, i) => {
        const start = route[i]!;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const projection =
          lengthSquared === 0 ? 0 : ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
        const t = Math.max(0, Math.min(1, projection));
        return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
      }),
    );
  const expectContentInsideFrame = (scene: ExcalidrawScene) => {
    const frame = scene.elements.find((element) => element.type === "frame")!;
    for (const element of scene.elements.filter((item) => item.frameId === frame.id)) {
      const points =
        element.type === "arrow"
          ? arrowPoints(element as Arrow)
          : [
              { x: element.x, y: element.y },
              { x: element.x + element.width, y: element.y + element.height },
            ];
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(frame.x);
      expect(Math.max(...xs)).toBeLessThanOrEqual(frame.x + frame.width);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(frame.y);
      expect(Math.max(...ys)).toBeLessThanOrEqual(frame.y + frame.height);
    }
  };

  it("is in the catalogue and produces a structurally valid scene", () => {
    expect(listDiagramLayouts()).toContain("flowchart");
    const { scene } = render();
    const { ids, bad } = scanIntegrity(scene);
    expect(bad).toEqual([]);
    expect(ids.size).toBe(scene.elements.length);
  });

  it("draws each flowchart shape as its Excalidraw counterpart", () => {
    const { scene } = render();
    expect(nodeShape(scene, "start").type).toBe("ellipse");
    expect(nodeShape(scene, "build").type).toBe("rectangle");
    expect(nodeShape(scene, "green").type).toBe("diamond");
  });

  it("draws sketch rough and hatched, and clean crisp and solid", () => {
    const sketch = nodeShape(render().scene, "build");
    expect(sketch.roughness).toBe(2);
    expect(sketch.fillStyle).toBe("hachure");

    const clean = nodeShape(render({ ...load(), style: "clean" } as never).scene, "build");
    expect(clean.roughness).toBe(0);
    expect(clean.fillStyle).toBe("solid");
  });

  it("routes a loop back up the chart, and draws forward edges straight", () => {
    const { scene } = render();
    const arrows = scene.elements.filter((e) => e.type === "arrow") as { id: string; points: number[][] }[];
    const retry = arrows.find((a) => a.id === nodeArrowId(scene, "fix", "build"))!;
    expect(retry.points.length).toBeGreaterThan(2);
    const forward = arrows.filter((a) => a !== retry);
    expect(forward.every((a) => a.points.length === 2)).toBe(true);
  });

  it.each(["TB", "LR"] as const)("routes a reciprocal %s pair through an outer lane", (direction) => {
    const spec = parseDiagramSpec({
      id: `cycle-${direction.toLowerCase()}`,
      title: "Cycle",
      layout: "flowchart",
      direction,
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Review" },
      ],
      edges: [
        { from: "a", to: "b", label: "forward" },
        { from: "b", to: "a", label: "back" },
      ],
    });
    const { scene } = render(spec);
    const [forward] = arrowsBetween(scene, "a", "b");
    const [back] = arrowsBetween(scene, "b", "a");
    const a = nodeShape(scene, "a");
    const b = nodeShape(scene, "b");
    const backRoute = arrowPoints(back!);
    const backLabel = edgeLabel(scene, "back");

    expect(forward!.points.length).toBe(2);
    expect(backRoute.length).toBeGreaterThan(2);
    if (direction === "TB") {
      const outerRight = Math.max(a.x + a.width, b.x + b.width);
      expect(Math.max(...backRoute.map((point) => point.x))).toBeGreaterThan(outerRight + 20);
      expect(backLabel.x).toBeGreaterThan(outerRight);
    } else {
      const outerBottom = Math.max(a.y + a.height, b.y + b.height);
      expect(Math.max(...backRoute.map((point) => point.y))).toBeGreaterThan(outerBottom + 20);
      expect(backLabel.y).toBeGreaterThan(outerBottom);
    }
    expectContentInsideFrame(scene);
  });

  it.each(["TB", "LR"] as const)("keeps parallel %s branches and their labels distinct", (direction) => {
    const spec = parseDiagramSpec({
      id: `parallel-${direction.toLowerCase()}`,
      title: "Parallel branches",
      layout: "flowchart",
      direction,
      nodes: [
        { id: "a", label: "Choose" },
        { id: "b", label: "Continue" },
      ],
      edges: [
        { from: "a", to: "b", label: "yes" },
        { from: "a", to: "b", label: "no" },
      ],
    });
    const { scene } = render(spec);
    const [yes, no] = arrowsBetween(scene, "a", "b");
    const yesRoute = arrowPoints(yes!);
    const noRoute = arrowPoints(no!);
    const yesLabel = edgeLabel(scene, "yes");
    const noLabel = edgeLabel(scene, "no");
    const yesCenter = { x: yesLabel.x + yesLabel.width / 2, y: yesLabel.y + yesLabel.height / 2 };
    const noCenter = { x: noLabel.x + noLabel.width / 2, y: noLabel.y + noLabel.height / 2 };

    expect(yesRoute.length).toBeGreaterThan(2);
    expect(noRoute.length).toBeGreaterThan(2);
    expect(
      yesRoute.slice(1, -1).some((point) =>
        noRoute.slice(1, -1).every((other) => Math.hypot(point.x - other.x, point.y - other.y) > 5),
      ),
    ).toBe(true);
    expect(distanceToRoute(yesCenter, yesRoute)).toBeLessThan(distanceToRoute(yesCenter, noRoute));
    expect(distanceToRoute(noCenter, noRoute)).toBeLessThan(distanceToRoute(noCenter, yesRoute));
    expectContentInsideFrame(scene);
  });

  it("ends arrows on a diamond's outline, not its bounding box", () => {
    const { scene } = render();
    const diamond = nodeShape(scene, "green");
    const arrow = scene.elements.find(
      (e) => e.type === "arrow" && (e as { endBinding?: { elementId: string } }).endBinding?.elementId === diamond.id,
    ) as { x: number; y: number; points: number[][] };
    const last = arrow.points[arrow.points.length - 1]!;
    const end = { x: arrow.x + last[0]!, y: arrow.y + last[1]! };
    const cx = diamond.x + diamond.width / 2;
    const cy = diamond.y + diamond.height / 2;
    // |x|/halfW + |y|/halfH = 1 on the outline; the arrow stops a few px outside it
    const along = Math.abs(end.x - cx) / (diamond.width / 2) + Math.abs(end.y - cy) / (diamond.height / 2);
    expect(along).toBeGreaterThan(1);
    expect(along).toBeLessThan(1.25);
  });

  it("groups each label with its shape so they move together", () => {
    const { scene } = render();
    const shape = nodeShape(scene, "approve");
    const label = scene.elements.find(
      (e) => e.type === "text" && e.customData?.gameplan?.nodeId === "approve",
    )!;
    expect(shape.groupIds.length).toBe(1);
    expect(label.groupIds).toEqual(shape.groupIds);
  });

  it("is byte-identical across re-renders of an unchanged spec", () => {
    expect(JSON.stringify(render().scene)).toBe(JSON.stringify(render().scene));
  });

  it("rejects an edge referencing an unknown node", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [{ from: "a", to: "ghost" }],
      }),
    ).toThrow(/unknown node "ghost"/);
  });

  it("works as a panel, with panel-scoped node ids", () => {
    // a panel is versioned by its diagram, so it carries no revision of its own
    const { revision: _revision, ...flow } = load();
    const spec = parseDiagramSpec({ id: "d", title: "t", panels: [{ ...flow, id: "flow" }] });
    const { snapshot } = renderDiagram(spec, { now: FIXED_NOW });
    const nodeIds = Object.values(snapshot.elements).map((e) => e.nodeId);
    expect(nodeIds).toContain("flow:approve");
  });
});

function nodeArrowId(scene: ReturnType<typeof renderDiagram>["scene"], from: string, to: string): string {
  const id = (nodeId: string) =>
    scene.elements.find(
      (e) => e.customData?.gameplan?.nodeId === nodeId && e.type !== "text" && e.type !== "arrow",
    )!.id;
  const arrow = scene.elements.find(
    (e) =>
      e.type === "arrow" &&
      (e as { startBinding?: { elementId: string } }).startBinding?.elementId === id(from) &&
      (e as { endBinding?: { elementId: string } }).endBinding?.elementId === id(to),
  )!;
  return arrow.id;
}

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

describe("multi-panel diagram", () => {
  const PANELS = fileURLToPath(
    new URL("../../../examples/checkout.diagram.yaml", import.meta.url),
  );
  const load = () => parseDiagramYaml(readFileSync(PANELS, "utf8"));

  it("renders each panel as its own titled frame, with panel:node ids", () => {
    const { scene, snapshot } = renderDiagram(load(), { now: FIXED_NOW });
    const frames = scene.elements.filter((e) => e.type === "frame");
    expect(frames.map((f) => (f as { name: string }).name)).toEqual([
      "Architecture",
      "One purchase, end to end",
    ]);
    const nodeIds = Object.values(snapshot.elements).map((e) => e.nodeId);
    expect(nodeIds).toContain("architecture:api");
    expect(nodeIds).toContain("purchase:api");
  });

  it("is byte-identical across re-renders", () => {
    const a = renderDiagram(load(), { now: FIXED_NOW });
    const b = renderDiagram(load(), { now: FIXED_NOW });
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
  });

  it("reports dangling references and duplicate panels by panel id", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        panels: [
          {
            id: "p",
            title: "P",
            layout: "graph",
            nodes: [{ id: "a", label: "A" }],
            edges: [{ from: "a", to: "ghost" }],
          },
          { id: "p", title: "P2", layout: "graph", nodes: [{ id: "a", label: "A" }] },
        ],
      }),
    ).toThrow(/panel "p": edges\[0\] references unknown node "ghost"[\s\S]*duplicate panel id "p"/);
  });

  it("leaves single-layout diagrams unchanged", () => {
    expect(loadGraph()).not.toHaveProperty("panels");
    // no panel scoping leaks into the single-layout path: node ids stay bare,
    // so annotations anchored before panels existed still resolve
    const { snapshot } = renderDiagram(loadGraph(), { now: FIXED_NOW });
    const spec = loadGraph();
    if (spec.layout !== "graph") throw new Error("expected a graph example");
    const nodeIds = new Set(
      Object.values(snapshot.elements)
        .filter((e) => e.role === "diagram-node")
        .map((e) => e.nodeId),
    );
    expect(nodeIds).toEqual(new Set(spec.nodes.map((n) => n.id)));
  });

  it("rejects a top-level layout alongside panels instead of dropping it", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        layout: "graph",
        nodes: [{ id: "a", label: "A" }],
        panels: [{ id: "p", title: "P", layout: "graph", nodes: [{ id: "a", label: "A" }] }],
      }),
    ).toThrow(/"layout" cannot be combined with "panels"[\s\S]*"nodes" cannot be combined/);
  });

  it("rejects top-level style while retaining panel-local style", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        style: "clean",
        panels: [{ id: "p", title: "P", layout: "flowchart", nodes: [{ id: "a", label: "A" }] }],
      }),
    ).toThrow(SpecError);

    const spec = parseDiagramSpec({
      id: "d",
      title: "t",
      panels: [
        {
          id: "p",
          title: "P",
          layout: "flowchart",
          style: "clean",
          nodes: [{ id: "a", label: "A" }],
        },
      ],
    });
    if (!("panels" in spec)) throw new Error("expected panels diagram");
    expect(spec.panels[0]?.style).toBe("clean");
  });

  it("rejects a revision set on a panel", () => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        panels: [
          { id: "p", title: "P", revision: 3, layout: "graph", nodes: [{ id: "a", label: "A" }] },
        ],
      }),
    ).toThrow(/panels\.0\.revision/);
  });

  it.each(["title", "note"])("reserves %s as a panel id", (id) => {
    expect(() =>
      parseDiagramSpec({
        id: "d",
        title: "t",
        panels: [{ id, title: "P", layout: "graph", nodes: [{ id: "a", label: "A" }] }],
      }),
    ).toThrow(new RegExp(`"${id}" is reserved`));
  });

  it("rejects an empty panels list and a bad layout inside a panel", () => {
    expect(() => parseDiagramSpec({ id: "d", title: "t", panels: [] })).toThrow(/panels/);
    expect(() =>
      parseDiagramSpec({ id: "d", title: "t", panels: [{ id: "p", title: "P", layout: "state" }] }),
    ).toThrow(/panels\.0\.layout/);
  });
});

describe("drawing style", () => {
  // a graph node's icon glyph is drawn from small rectangles and lines of its
  // own, at a fixed stroke; the style applies to the shapes around it
  const drawn = (spec: ReturnType<typeof parseDiagramYaml>) =>
    renderDiagram(spec, { now: FIXED_NOW }).scene.elements.filter(
      (e) => e.width > METRICS.diagramIconSize || e.height > METRICS.diagramIconSize,
    );
  const shapes = (spec: ReturnType<typeof parseDiagramYaml>) =>
    drawn(spec).filter((e) => e.customData?.gameplan?.role === "diagram-node" && e.type === "rectangle");
  const arrows = (spec: ReturnType<typeof parseDiagramYaml>) =>
    drawn(spec).filter((e) => e.type === "arrow" || e.type === "line");

  it.each([
    ["graph", loadGraph],
    ["sequence", loadSequence],
  ] as const)("draws %s sketched by default", (_, load) => {
    const spec = load();
    expect(spec.style).toBe("sketch");
    expect(shapes(spec).length).toBeGreaterThan(0);
    expect(shapes(spec).every((e) => e.roughness === 2 && e.fillStyle === "hachure")).toBe(true);
    expect(arrows(spec).every((e) => e.roughness === 2)).toBe(true);
  });

  it.each([
    ["graph", loadGraph],
    ["sequence", loadSequence],
  ] as const)("draws %s crisp and solid when clean", (_, load) => {
    const spec = { ...load(), style: "clean" } as never;
    expect(shapes(spec).every((e) => e.roughness === 0 && e.fillStyle === "solid")).toBe(true);
    expect(arrows(spec).every((e) => e.roughness === 0)).toBe(true);
  });

  it("draws a graph's cluster boundary in the same style as its nodes", () => {
    const spec = loadGraph();
    if (spec.layout !== "graph" || spec.clusters.length === 0) throw new Error("expected a clustered graph example");
    const cluster = renderDiagram(spec, { now: FIXED_NOW }).scene.elements.find(
      (e) => e.customData?.gameplan?.role === "cluster" && e.type === "rectangle",
    )!;
    expect(cluster.roughness).toBe(2);
    expect(cluster.strokeStyle).toBe("dashed");
  });

  it("rejects an unknown style", () => {
    expect(() =>
      parseDiagramSpec({ id: "d", title: "t", layout: "graph", style: "pencil", nodes: [{ id: "a", label: "A" }] }),
    ).toThrow(/style/);
  });
});
