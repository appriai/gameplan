import { SceneBuilder } from "./elements.js";
import type { ExcalidrawElement, ExcalidrawScene } from "./excalidraw.js";
import { layoutGoal } from "./layout/goal.js";
import { layoutSteps } from "./layout/steps.js";
import { layoutForks } from "./layout/forks.js";
import { layoutSurface } from "./layout/surface.js";
import { layoutRisks } from "./layout/risks.js";
import { layoutLegend } from "./layout/legend.js";
import type { PlanSpec } from "./spec.js";
import { CANVAS_WIDTH, type RegionCtx } from "./layout/common.js";
import { METRICS } from "./theme.js";

export interface RenderOptions {
  /** fixed clock, so an unchanged spec renders byte-identically */
  now?: number;
}

/** A point-in-time record of what we generated, for later diffing. */
export interface Snapshot {
  planId: string;
  revision: number;
  renderedAt: number;
  elements: Record<
    string,
    {
      role: string;
      nodeId?: string;
      ordinal?: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text?: string;
    }
  >;
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
 */
const REGIONS: Region[] = [
  layoutGoal,
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

  let y = 0;
  for (const region of REGIONS) {
    const result = region({ builder, spec, x: 0, y, width: CANVAS_WIDTH });
    y += result.height + METRICS.frameGap;
  }

  // legend sits to the right of the stack, out of the reading path but always
  // visible when you zoom to fit
  layoutLegend({
    builder,
    spec,
    x: CANVAS_WIDTH + METRICS.frameGap,
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

function buildSnapshot(
  spec: PlanSpec,
  now: number,
  elements: ExcalidrawElement[],
): Snapshot {
  const snapshot: Snapshot = {
    planId: spec.id,
    revision: spec.revision,
    renderedAt: now,
    elements: {},
  };
  for (const el of elements) {
    const meta = el.customData?.gameplan;
    if (!meta) continue;
    snapshot.elements[el.id] = {
      role: meta.role,
      ...(meta.nodeId !== undefined ? { nodeId: meta.nodeId } : {}),
      ...(meta.ordinal !== undefined ? { ordinal: meta.ordinal } : {}),
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      ...("originalText" in el
        ? { text: (el as { originalText: string }).originalText }
        : {}),
    };
  }
  return snapshot;
}
