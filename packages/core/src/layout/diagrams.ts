import { METRICS, TYPE_SCALE } from "../theme.js";
import { getDiagramLayout, listDiagramLayouts } from "../diagrams/registry.js";
import { layoutDiagramHeader } from "../diagrams/header.js";
import type { PlanDiagram } from "../diagram.js";
import type { RegionCtx, RegionResult } from "./common.js";

/**
 * Diagrams a plan carries with it — an architecture graph, a request
 * sequence — each in its own titled frame.
 *
 * This is the same catalogue that backs `gameplan draw`, called with a
 * `scope` so two diagrams in one plan can both name a node `api` without
 * colliding on an element id. Nothing about the layouts themselves is
 * plan-aware; they only learn they're embedded from that one field.
 *
 * Returns the total height of every frame it emitted, so the region stack
 * above and below it lands in the right place.
 */
export function layoutDiagrams(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  if (spec.diagrams.length === 0) return { width: ctx.width, height: 0 };

  let y = ctx.y;
  let widest = ctx.width;

  spec.diagrams.forEach((diagram: PlanDiagram, index: number) => {
    const layout = getDiagramLayout(diagram.layout);
    if (!layout) {
      throw new Error(
        `unknown diagram layout "${diagram.layout}" in plan diagram "${diagram.id}" — known kinds: ${listDiagramLayouts().join(", ")}`,
      );
    }

    const { frame, headerHeight } = layoutDiagramHeader({
      builder,
      x: ctx.x,
      y,
      width: ctx.width,
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
      x: ctx.x,
      y: y + headerHeight,
      width: ctx.width,
      frameId: frame.id,
      scope: diagram.id,
    });

    frame.width = Math.max(ctx.width, body.width);
    frame.height = headerHeight + body.height;
    widest = Math.max(widest, frame.width);
    y += frame.height + METRICS.frameGap;
  });

  // the trailing gap belongs to the region stack, not to this region
  return { width: widest, height: y - ctx.y - METRICS.frameGap };
}
