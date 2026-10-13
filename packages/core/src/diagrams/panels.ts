import type { SceneBuilder } from "../elements.js";
import type { PlanDiagram } from "../diagram.js";
import { METRICS, TYPE_SCALE } from "../theme.js";
import { getDiagramLayout, listDiagramLayouts } from "./registry.js";
import { layoutDiagramHeader } from "./header.js";

/**
 * Stacks diagrams as titled frames, one per entry, each laid out by its own
 * `layout` kind. Shared by a plan's embedded diagrams and a standalone
 * diagram's `panels:` — both are "several scoped diagrams on one canvas".
 *
 * Every element is scoped by the diagram's id so two panels can both name a
 * node `api` without colliding, and feedback reads `panel:node`.
 *
 * Returns the total height of every frame emitted, without a trailing gap.
 */
export function layoutDiagramFrames(
  builder: SceneBuilder,
  diagrams: PlanDiagram[],
  at: { x: number; y: number; width: number },
  where: string,
): { width: number; height: number } {
  let y = at.y;
  let widest = at.width;

  diagrams.forEach((diagram, index) => {
    const layout = getDiagramLayout(diagram.layout);
    if (!layout) {
      throw new Error(
        `unknown diagram layout "${diagram.layout}" in ${where} "${diagram.id}" — known kinds: ${listDiagramLayouts().join(", ")}`,
      );
    }

    const { frame, headerHeight } = layoutDiagramHeader({
      builder,
      x: at.x,
      y,
      width: at.width,
      frameKey: `frame::diagram::${diagram.id}`,
      frameName: diagram.title,
      titleKey: `diagram::${diagram.id}::title`,
      noteKey: `diagram::${diagram.id}::note`,
      titleNodeId: diagram.id,
      noteNodeId: diagram.id,
      ordinal: index,
      title: diagram.title,
      note: diagram.note,
      titleFontSize: TYPE_SCALE.heading,
      noteFontSize: TYPE_SCALE.body,
      noteGap: 6,
      trailingGap: 16,
    });

    // safe cast: `layout` was looked up by this exact diagram's `layout`
    // field, see the longer note on the same pattern in diagrams/render.ts
    const body = layout(diagram as never, builder, {
      x: at.x,
      y: y + headerHeight,
      width: at.width,
      frameId: frame.id,
      scope: diagram.id,
    });

    frame.width = Math.max(at.width, body.width);
    frame.height = headerHeight + body.height;
    widest = Math.max(widest, frame.width);
    y += frame.height + METRICS.frameGap;
  });

  return { width: widest, height: y - at.y - METRICS.frameGap };
}
