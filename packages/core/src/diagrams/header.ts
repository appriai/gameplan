import type { ExcalidrawFrameElement } from "../excalidraw.js";
import type { SceneBuilder } from "../elements.js";
import { measureText } from "../text.js";
import { METRICS, PALETTE } from "../theme.js";

export interface DiagramHeaderResult {
  frame: ExcalidrawFrameElement;
  headerHeight: number;
}

/**
 * Measures a diagram's title/note block and emits the frame — sized to the
 * header only, since its final height depends on the body layout the caller
 * hasn't run yet — plus the title/note text. Shared by the standalone
 * (`gameplan draw`) and plan-embedded diagram render paths, which differ
 * only in coordinates, key/nodeId namespacing, and the font tier/spacing
 * passed in below; the caller runs the body layout and resizes the frame.
 */
export function layoutDiagramHeader(options: {
  builder: SceneBuilder;
  x: number;
  y: number;
  width: number;
  frameKey: string;
  frameName: string;
  titleKey: string;
  noteKey: string;
  titleNodeId: string;
  noteNodeId: string;
  ordinal?: number;
  title: string;
  note?: string | null;
  titleFontSize: number;
  noteFontSize: number;
  /** gap between the title and note, when a note is present */
  noteGap: number;
  /** space below the title/note block before the diagram body starts */
  trailingGap: number;
}): DiagramHeaderResult {
  const {
    builder,
    x,
    y,
    width,
    frameKey,
    frameName,
    titleKey,
    noteKey,
    titleNodeId,
    noteNodeId,
    ordinal,
    title,
    note,
    titleFontSize,
    noteFontSize,
    noteGap,
    trailingGap,
  } = options;
  const pad = METRICS.framePadding;
  const inner = width - 2 * pad;

  const measuredTitle = measureText(title, titleFontSize, inner);
  const measuredNote = note ? measureText(note, noteFontSize, inner) : null;
  const headerHeight =
    pad + measuredTitle.height + (measuredNote ? noteGap + measuredNote.height : 0) + trailingGap;

  const frame = builder.frame({
    key: frameKey,
    name: frameName,
    x,
    y,
    width,
    height: headerHeight,
  });

  builder.text({
    key: titleKey,
    role: "diagram-title",
    nodeId: titleNodeId,
    ordinal,
    x: x + pad,
    y: y + pad,
    text: title,
    maxWidth: inner,
    fontSize: titleFontSize,
    frameId: frame.id,
  });

  if (measuredNote && note) {
    builder.text({
      key: noteKey,
      role: "diagram-title",
      nodeId: noteNodeId,
      x: x + pad,
      y: y + pad + measuredTitle.height + noteGap,
      text: note,
      maxWidth: inner,
      fontSize: noteFontSize,
      color: PALETTE.muted,
      frameId: frame.id,
    });
  }

  return { frame, headerHeight };
}
