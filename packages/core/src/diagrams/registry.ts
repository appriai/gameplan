import type { SceneBuilder } from "../elements.js";
import type { DiagramSpec } from "../diagram.js";

/**
 * The layout catalogue. Each entry is a self-contained algorithm that knows
 * how to turn one `DiagramSpec` variant into Excalidraw elements — `graph`
 * (dagre, with optional clustering) and `sequence` (actor lifelines) ship
 * built in. Adding a new diagram kind later is: write a module exporting a
 * function of this shape, call `registerDiagramLayout` with it, and add the
 * matching branch to `DiagramSpec`'s discriminated union — nothing else in
 * the render path needs to change.
 */

export interface DiagramLayoutCtx {
  x: number;
  y: number;
  width: number;
  /** every element this layout draws belongs to this frame */
  frameId: string;
  /**
   * Set when this diagram is one of several embedded in a plan, to the
   * diagram's own id. Element keys are derived from `planId + key`, so two
   * diagrams in one plan that both name a node `api` would otherwise collide
   * on the same element id. Also namespaces the `nodeId` in customData, so
   * feedback says which diagram a comment landed on.
   *
   * Left undefined for a standalone diagram — keeping its element ids exactly
   * as they were before embedding existed, so annotations stay anchored.
   */
  scope?: string;
}

/** Element key, namespaced when the diagram is embedded in a plan. */
export function scopedKey(ctx: DiagramLayoutCtx, key: string): string {
  return ctx.scope ? `dgm::${ctx.scope}::${key}` : key;
}

/** customData nodeId, namespaced when the diagram is embedded in a plan. */
export function scopedNodeId(ctx: DiagramLayoutCtx, nodeId: string): string {
  return ctx.scope ? `${ctx.scope}:${nodeId}` : nodeId;
}

export interface DiagramLayoutResult {
  width: number;
  height: number;
}

export type DiagramLayoutFn<T extends DiagramSpec = DiagramSpec> = (
  spec: T,
  builder: SceneBuilder,
  ctx: DiagramLayoutCtx,
) => DiagramLayoutResult;

const catalogue = new Map<DiagramSpec["layout"], DiagramLayoutFn<never>>();

export function registerDiagramLayout<T extends DiagramSpec>(
  name: T["layout"],
  fn: DiagramLayoutFn<T>,
): void {
  catalogue.set(name, fn as DiagramLayoutFn<never>);
}

export function getDiagramLayout(name: string): DiagramLayoutFn<never> | undefined {
  return catalogue.get(name as DiagramSpec["layout"]);
}

export function listDiagramLayouts(): string[] {
  return [...catalogue.keys()];
}
