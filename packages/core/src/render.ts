import { SceneBuilder } from "./elements.js";
import type { ExcalidrawScene } from "./excalidraw.js";
import { layoutGoal } from "./layout/goal.js";
import { layoutSteps } from "./layout/steps.js";
import { layoutForks } from "./layout/forks.js";
import { layoutSurface } from "./layout/surface.js";
import { layoutRisks } from "./layout/risks.js";
import { layoutLegend } from "./layout/legend.js";
import { layoutDiagrams } from "./layout/diagrams.js";
// registering side effect: makes the layout catalogue available to embedded
// plan diagrams even when nothing imported the standalone diagram renderer
import "./diagrams/render.js";
import type { PlanSpec } from "./spec.js";
import { CANVAS_WIDTH, type RegionCtx } from "./layout/common.js";
import { METRICS } from "./theme.js";
import { buildSnapshot, type Snapshot } from "./snapshot.js";

export interface RenderOptions {
  /** fixed clock, so an unchanged spec renders byte-identically */
  now?: number;
}

export interface RenderResult {
  scene: ExcalidrawScene;
  snapshot: Snapshot;
}

type Region = (ctx: RegionCtx) => { width: number; height: number };

/**
 * Regions stack vertically in reading order. Goal first because it catches
 * misunderstood briefs; forks before the surface map because "did you pick the
 * right approach" is a bigger question than "which files change".
 *
 * Diagrams sit second, between the goal and the steps: when a plan carries an
 * architecture picture it's there to orient the reader in the system *before*
 * they read what we intend to do to it. A plan with no diagrams renders zero
 * height here and the stack closes up as if the region weren't there.
 */
const REGIONS: Region[] = [
  layoutGoal,
  layoutDiagrams,
  layoutSteps,
  layoutForks,
  layoutSurface,
  layoutRisks,
];

export function renderPlan(spec: PlanSpec, options: RenderOptions = {}): RenderResult {
  const now = options.now ?? Date.now();
  const builder = new SceneBuilder({
    planId: spec.id,
    revision: spec.revision,
    renderedAt: now,
  });

  // regions size themselves to their content — a long journey path can
  // exceed CANVAS_WIDTH — so the legend's x has to track the widest one
  // actually drawn, not the nominal grid width, or a big plan collides with it
  let y = 0;
  let maxWidth = CANVAS_WIDTH;
  for (const region of REGIONS) {
    const result = region({ builder, spec, x: 0, y, width: CANVAS_WIDTH });
    maxWidth = Math.max(maxWidth, result.width);
    // a region that drew nothing (a plan with no diagrams) takes no gap
    // either, or the stack shows a hole where an absent section would be
    if (result.height === 0) continue;
    y += result.height + METRICS.frameGap;
  }

  // legend sits to the right of the stack, out of the reading path but always
  // visible when you zoom to fit
  layoutLegend({
    builder,
    spec,
    x: maxWidth + METRICS.frameGap,
    y: 0,
    width: 340,
  });

  const elements = builder.all();

  return {
    scene: {
      type: "excalidraw",
      version: 2,
      source: "gameplan",
      elements,
      appState: {
        gridSize: null,
        viewBackgroundColor: "#ffffff",
      },
      files: {},
    },
    snapshot: buildSnapshot(spec, now, elements),
  };
}
