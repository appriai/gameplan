import { SceneBuilder } from "../elements.js";
import type { ExcalidrawScene } from "../excalidraw.js";
import type { DiagramSpec } from "../diagram.js";
import { buildSnapshot, type Snapshot } from "../snapshot.js";
import { TYPE_SCALE } from "../theme.js";
import { getDiagramLayout, listDiagramLayouts, registerDiagramLayout } from "./registry.js";
import { layoutDiagramHeader } from "./header.js";
import { layoutGraph } from "./graph.js";
import { layoutSequence } from "./sequence.js";

// the catalogue: registered once, here, so "what diagram kinds exist" has
// one visible answer rather than being scattered across side-effect imports
registerDiagramLayout("graph", layoutGraph);
registerDiagramLayout("sequence", layoutSequence);

export { listDiagramLayouts };

export interface DiagramRenderOptions {
  now?: number;
}

export interface DiagramRenderResult {
  scene: ExcalidrawScene;
  snapshot: Snapshot;
}

const DIAGRAM_WIDTH = 1100;

export function renderDiagram(
  spec: DiagramSpec,
  options: DiagramRenderOptions = {},
): DiagramRenderResult {
  const now = options.now ?? Date.now();
  const builder = new SceneBuilder({ planId: spec.id, revision: spec.revision, renderedAt: now });

  const layout = getDiagramLayout(spec.layout);
  if (!layout) {
    throw new Error(
      `unknown diagram layout "${spec.layout}" — known kinds: ${listDiagramLayouts().join(", ")}`,
    );
  }

  const { frame, headerHeight } = layoutDiagramHeader({
    builder,
    x: 0,
    y: 0,
    width: DIAGRAM_WIDTH,
    frameKey: "frame::diagram",
    frameName: `${spec.title} — rev ${spec.revision}`,
    titleKey: "diagram::title",
    noteKey: "diagram::note",
    titleNodeId: "title",
    noteNodeId: "note",
    title: spec.title,
    note: spec.note,
    titleFontSize: TYPE_SCALE.title,
    noteFontSize: TYPE_SCALE.body,
    noteGap: 8,
    trailingGap: 20,
  });

  // the registry is keyed by spec.layout, so this call always reaches the
  // function registered for exactly this spec's shape — TS can't see that
  // cross-cutting invariant through a heterogeneous map, hence the cast
  const body = layout(spec as never, builder, {
    x: 0,
    y: headerHeight,
    width: DIAGRAM_WIDTH,
    frameId: frame.id,
  });

  frame.width = Math.max(DIAGRAM_WIDTH, body.width);
  frame.height = headerHeight + body.height;

  const elements = builder.all();

  return {
    scene: {
      type: "excalidraw",
      version: 2,
      source: "gameplan",
      elements,
      appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
      files: {},
    },
    snapshot: buildSnapshot(spec, now, elements),
  };
}
