import { SceneBuilder } from "../elements.js";
import type { ExcalidrawScene } from "../excalidraw.js";
import type { DiagramSpec, PanelsDiagram } from "../diagram.js";
import { buildSnapshot, type Snapshot } from "../snapshot.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import { getDiagramLayout, listDiagramLayouts, registerDiagramLayout } from "./registry.js";
import { layoutDiagramFrames } from "./panels.js";
import { layoutDiagramHeader } from "./header.js";
import { layoutFlowchart } from "./flowchart.js";
import { layoutGraph } from "./graph.js";
import { layoutSequence } from "./sequence.js";

// the catalogue: registered once, here, so "what diagram kinds exist" has
// one visible answer rather than being scattered across side-effect imports
registerDiagramLayout("graph", layoutGraph);
registerDiagramLayout("flowchart", layoutFlowchart);
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

  if ("panels" in spec) return renderPanels(spec, builder, now);

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

  return finish(spec, builder, now);
}

function finish(spec: DiagramSpec, builder: SceneBuilder, now: number): DiagramRenderResult {
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

/**
 * A multi-panel diagram: the title and note sit as plain text above, since
 * Excalidraw frames can't nest, and each panel is its own titled frame below
 * — the same stacking a plan uses for its embedded diagrams.
 */
function renderPanels(spec: PanelsDiagram, builder: SceneBuilder, now: number): DiagramRenderResult {
  const pad = METRICS.framePadding;
  const inner = DIAGRAM_WIDTH - 2 * pad;
  let y = 0;

  const title = builder.text({
    key: "diagram::title",
    role: "diagram-title",
    nodeId: "title",
    x: pad,
    y,
    text: `${spec.title} — rev ${spec.revision}`,
    maxWidth: inner,
    fontSize: TYPE_SCALE.title,
  });
  y += title.height;

  if (spec.note) {
    y += 8;
    const note = builder.text({
      key: "diagram::note",
      role: "diagram-title",
      nodeId: "note",
      x: pad,
      y,
      text: spec.note,
      maxWidth: inner,
      fontSize: TYPE_SCALE.body,
      color: PALETTE.muted,
    });
    y += note.height;
  }
  y += METRICS.frameGap / 2;

  layoutDiagramFrames(builder, spec.panels, { x: 0, y, width: DIAGRAM_WIDTH }, "panel");
  return finish(spec, builder, now);
}
