/**
 * A pragmatic subset of Excalidraw's element schema (v0.18.x). We model only
 * what we generate and what we need to read back, but every field Excalidraw
 * requires is present so scenes load without triggering schema repair.
 *
 * Reference: excalidraw/packages/element/src/types.ts
 */

export type FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type Arrowhead = "arrow" | "bar" | "dot" | "triangle" | null;

export interface Roundness {
  type: 1 | 2 | 3;
  value?: number;
}

export interface BoundElement {
  id: string;
  type: "text" | "arrow";
}

export interface PointBinding {
  elementId: string;
  focus: number;
  gap: number;
}

/** Namespaced metadata we attach to every element we generate. */
export interface GameplanMeta {
  v: 1;
  planId: string;
  role:
    | "frame"
    | "goal"
    | "criterion"
    | "step"
    | "step-field"
    | "fork"
    | "fork-option"
    | "surface"
    | "risk"
    | "out-of-scope"
    | "legend"
    | "decor";
  /** id of the corresponding node in the PlanSpec, when there is one */
  nodeId?: string;
  /** ordinal within its region, used to detect reordering */
  ordinal?: number;
  renderedAt: number;
  revision: number;
}

/** Metadata the web client stamps onto human-authored annotations. */
export interface AnnotationMeta {
  v: 1;
  kind: "annotation";
  intent: "approve" | "reject" | "question" | "add";
  author?: string;
  createdAt: number;
}

export interface CustomData {
  gameplan?: GameplanMeta;
  gameplanAnnotation?: AnnotationMeta;
  [key: string]: unknown;
}

export interface ExcalidrawElementBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  index: string | null;
  roundness: Roundness | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: BoundElement[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  customData?: CustomData;
}

export interface ExcalidrawShapeElement extends ExcalidrawElementBase {
  type: "rectangle" | "ellipse" | "diamond";
}

export interface ExcalidrawTextElement extends ExcalidrawElementBase {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  containerId: string | null;
  autoResize: boolean;
  lineHeight: number;
}

export interface ExcalidrawLinearElement extends ExcalidrawElementBase {
  type: "arrow" | "line";
  points: [number, number][];
  lastCommittedPoint: [number, number] | null;
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
}

export interface ExcalidrawArrowElement extends ExcalidrawLinearElement {
  type: "arrow";
  elbowed: boolean;
}

export interface ExcalidrawFrameElement extends ExcalidrawElementBase {
  type: "frame";
  name: string | null;
}

export interface ExcalidrawFreedrawElement extends ExcalidrawElementBase {
  type: "freedraw";
  points: [number, number][];
  pressures: number[];
  simulatePressure: boolean;
  lastCommittedPoint: [number, number] | null;
}

export type ExcalidrawElement =
  | ExcalidrawShapeElement
  | ExcalidrawTextElement
  | ExcalidrawLinearElement
  | ExcalidrawArrowElement
  | ExcalidrawFrameElement
  | ExcalidrawFreedrawElement
  | ExcalidrawElementBase;

export interface ExcalidrawScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: {
    gridSize: number | null;
    gridStep?: number;
    gridModeEnabled?: boolean;
    viewBackgroundColor: string;
    [key: string]: unknown;
  };
  files: Record<string, unknown>;
}

export function isTextElement(el: ExcalidrawElement): el is ExcalidrawTextElement {
  return el.type === "text";
}

export function isFrameElement(el: ExcalidrawElement): el is ExcalidrawFrameElement {
  return el.type === "frame";
}

export function isLinearElement(
  el: ExcalidrawElement,
): el is ExcalidrawLinearElement {
  return el.type === "arrow" || el.type === "line";
}

export function isFreedrawElement(
  el: ExcalidrawElement,
): el is ExcalidrawFreedrawElement {
  return el.type === "freedraw";
}

/** The gameplan metadata on an element, if we generated it. */
export function gameplanMeta(el: ExcalidrawElement): GameplanMeta | undefined {
  return el.customData?.gameplan;
}

export function annotationMeta(
  el: ExcalidrawElement,
): AnnotationMeta | undefined {
  return el.customData?.gameplanAnnotation;
}
