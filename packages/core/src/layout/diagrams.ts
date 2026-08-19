import { measureText } from "../text.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import { getDiagramLayout, listDiagramLayouts } from "../diagrams/registry.js";
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

  const pad = METRICS.framePadding;
  let y = ctx.y;
  let widest = ctx.width;

  spec.diagrams.forEach((diagram: PlanDiagram, index: number) => {
    const layout = getDiagramLayout(diagram.layout);
    if (!layout) {
      throw new Error(
        `unknown diagram layout "${diagram.layout}" in plan diagram "${diagram.id}" — known kinds: ${listDiagramLayouts().join(", ")}`,
      );
    }

    const inner = ctx.width - 2 * pad;
    const title = measureText(diagram.title, TYPE_SCALE.heading, inner);
    const note = diagram.note ? measureText(diagram.note, TYPE_SCALE.body, inner) : null;
    const headerHeight = pad + title.height + (note ? 6 + note.height : 0) + 16;

    // the frame must precede its children in z-order, but its height depends
    // on the body we haven't drawn yet — emit it, then resize once we know
    const frame = builder.frame({
      key: `frame::diagram::${diagram.id}`,
      name: diagram.title,
      x: ctx.x,
      y,
      width: ctx.width,
      height: headerHeight,
    });

    builder.text({
      key: `diagram::${diagram.id}::title`,
      role: "diagram-title",
      nodeId: diagram.id,
      ordinal: index,
      x: ctx.x + pad,
      y: y + pad,
      text: diagram.title,
      maxWidth: inner,
      fontSize: TYPE_SCALE.heading,
      frameId: frame.id,
    });
    if (note) {
      builder.text({
        key: `diagram::${diagram.id}::note`,
        role: "diagram-title",
        nodeId: diagram.id,
        x: ctx.x + pad,
        y: y + pad + title.height + 6,
        text: diagram.note!,
        maxWidth: inner,
        fontSize: TYPE_SCALE.body,
        color: PALETTE.muted,
        frameId: frame.id,
      });
    }

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
