import { SceneBuilder } from "../elements.js";
import type { ExcalidrawScene } from "../excalidraw.js";
import type { DiagramSpec } from "../diagram.js";
import { buildSnapshot, type Snapshot } from "../snapshot.js";
import { measureText } from "../text.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import { getDiagramLayout, listDiagramLayouts, registerDiagramLayout } from "./registry.js";
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
  const pad = METRICS.framePadding;

  const layout = getDiagramLayout(spec.layout);
  if (!layout) {
    throw new Error(
      `unknown diagram layout "${spec.layout}" — known kinds: ${listDiagramLayouts().join(", ")}`,
    );
  }

  const title = measureText(spec.title, TYPE_SCALE.title, DIAGRAM_WIDTH - 2 * pad);
  const note = spec.note ? measureText(spec.note, TYPE_SCALE.body, DIAGRAM_WIDTH - 2 * pad) : null;
  const headerHeight = pad + title.height + (note ? 8 + note.height : 0) + 20;

  // the frame has to exist before its children in z-order, but its final
  // height depends on the layout body we haven't drawn yet — reserve the
  // header, run the layout, then go back and size the frame to fit both
  const frame = builder.frame({
    key: "frame::diagram",
    name: `${spec.title} — rev ${spec.revision}`,
    x: 0,
    y: 0,
    width: DIAGRAM_WIDTH,
    height: headerHeight,
  });

  builder.text({
    key: "diagram::title",
    role: "diagram-title",
    nodeId: "title",
    x: pad,
    y: pad,
    text: spec.title,
    maxWidth: DIAGRAM_WIDTH - 2 * pad,
    fontSize: TYPE_SCALE.title,
    frameId: frame.id,
  });
  if (note) {
    builder.text({
      key: "diagram::note",
      role: "diagram-title",
      nodeId: "note",
      x: pad,
      y: pad + title.height + 8,
      text: spec.note!,
      maxWidth: DIAGRAM_WIDTH - 2 * pad,
      fontSize: TYPE_SCALE.body,
      color: PALETTE.muted,
      frameId: frame.id,
    });
  }

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
