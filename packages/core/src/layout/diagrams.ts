import { layoutDiagramFrames } from "../diagrams/panels.js";
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

  // the trailing gap belongs to the region stack, not to this region
  return layoutDiagramFrames(
    builder,
    spec.diagrams,
    { x: ctx.x, y: ctx.y, width: ctx.width },
    "plan diagram",
  );
}
