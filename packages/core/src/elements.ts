import { createIndexGenerator, elementId, seedFor } from "./ids.js";
import { FONT, LINE_HEIGHT, METRICS, PALETTE, TYPE_SCALE } from "./theme.js";
import { measureText } from "./text.js";
import type {
  Arrowhead,
  BoundElement,
  CustomData,
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawElementBase,
  ExcalidrawFrameElement,
  ExcalidrawLinearElement,
  ExcalidrawShapeElement,
  ExcalidrawTextElement,
  FillStyle,
  GameplanMeta,
  Roundness,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from "./excalidraw.js";

export interface BuilderOptions {
  planId: string;
  revision: number;
  /** fixed timestamp so a re-render of an unchanged spec is byte-identical */
  renderedAt: number;
}

interface BaseArgs {
  key: string;
  role: GameplanMeta["role"];
  nodeId?: string;
  ordinal?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: number;
  opacity?: number;
  roundness?: Roundness | null;
  frameId?: string | null;
  locked?: boolean;
  /**
   * Shared group id. Grouping is what makes a multi-part card behave as one
   * object: a reviewer drags the whole step, and "card moved" stays a clean
   * reorder signal instead of scattering its fields.
   */
  groupIds?: string[];
}

export interface CardArgs extends Omit<BaseArgs, "role" | "height"> {
  role: GameplanMeta["role"];
  height?: number;
  text: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  textColor?: string;
  shape?: "rectangle" | "ellipse" | "diamond";
}

export interface TextArgs {
  key: string;
  role: GameplanMeta["role"];
  nodeId?: string;
  ordinal?: number;
  x: number;
  y: number;
  text: string;
  maxWidth: number;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: TextAlign;
  color?: string;
  opacity?: number;
  frameId?: string | null;
  locked?: boolean;
  groupIds?: string[];
}

export interface ArrowArgs {
  key: string;
  from: ExcalidrawElement;
  to: ExcalidrawElement;
  role?: GameplanMeta["role"];
  nodeId?: string;
  strokeColor?: string;
  strokeStyle?: StrokeStyle;
  opacity?: number;
  frameId?: string | null;
}

export interface PathArgs {
  key: string;
  /** absolute scene coordinates; two points is a straight segment, more is a polyline */
  points: { x: number; y: number }[];
  role?: GameplanMeta["role"];
  nodeId?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: number;
  opacity?: number;
  frameId?: string | null;
  locked?: boolean;
  groupIds?: string[];
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  /** appends the first point at the end and fills the enclosed area — for icon glyphs */
  closed?: boolean;
  backgroundColor?: string;
  fillStyle?: FillStyle;
}

/**
 * Accumulates Excalidraw elements for one plan. Everything it emits carries
 * `customData.gameplan` so the feedback parser can tell generated content from
 * whatever a human draws on top of it.
 */
export class SceneBuilder {
  private readonly elements: ExcalidrawElement[] = [];
  private readonly byId = new Map<string, ExcalidrawElement>();
  private readonly nextIndex = createIndexGenerator();

  constructor(private readonly opts: BuilderOptions) {}

  private meta(
    role: GameplanMeta["role"],
    nodeId?: string,
    ordinal?: number,
  ): CustomData {
    const gameplan: GameplanMeta = {
      v: 1,
      planId: this.opts.planId,
      role,
      renderedAt: this.opts.renderedAt,
      revision: this.opts.revision,
    };
    if (nodeId !== undefined) gameplan.nodeId = nodeId;
    if (ordinal !== undefined) gameplan.ordinal = ordinal;
    return { gameplan };
  }

  private base(args: BaseArgs): ExcalidrawElementBase {
    const id = elementId(this.opts.planId, args.key);
    return {
      id,
      type: "rectangle",
      x: Math.round(args.x),
      y: Math.round(args.y),
      width: Math.round(args.width),
      height: Math.round(args.height),
      angle: 0,
      strokeColor: args.strokeColor ?? PALETTE.ink,
      backgroundColor: args.backgroundColor ?? PALETTE.transparent,
      fillStyle: args.fillStyle ?? "solid",
      strokeWidth: args.strokeWidth ?? 2,
      strokeStyle: args.strokeStyle ?? "solid",
      roughness: args.roughness ?? 1,
      opacity: args.opacity ?? 100,
      groupIds: args.groupIds ? [...args.groupIds] : [],
      frameId: args.frameId ?? null,
      index: this.nextIndex(),
      roundness: args.roundness === undefined ? { type: 3 } : args.roundness,
      seed: seedFor(this.opts.planId, args.key),
      version: 1,
      versionNonce: seedFor(this.opts.planId, `${args.key}::nonce`),
      isDeleted: false,
      boundElements: null,
      updated: this.opts.renderedAt,
      link: null,
      locked: args.locked ?? false,
      customData: this.meta(args.role, args.nodeId, args.ordinal),
    };
  }

  private push<T extends ExcalidrawElement>(el: T): T {
    this.elements.push(el);
    this.byId.set(el.id, el);
    return el;
  }

  /**
   * A named Excalidraw frame. Frames give the canvas its regions and give the
   * feedback parser a fallback anchor for comments that aren't near any card.
   */
  frame(args: {
    key: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): ExcalidrawFrameElement {
    const el: ExcalidrawFrameElement = {
      ...this.base({
        key: args.key,
        role: "frame",
        nodeId: args.key,
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
        strokeColor: "#bbb",
        backgroundColor: PALETTE.transparent,
        roughness: 0,
        strokeWidth: 2,
        roundness: null,
      }),
      type: "frame",
      name: args.name,
    };
    return this.push(el);
  }

  /**
   * A bare shape with no bound text. Used as the shell of multi-field cards,
   * where the fields are separate text elements held together by a group id
   * rather than by container binding (which allows only one text child).
   */
  rect(args: BaseArgs & { type?: "rectangle" | "ellipse" | "diamond" }): ExcalidrawShapeElement {
    const el: ExcalidrawShapeElement = {
      ...this.base(args),
      type: args.type ?? "rectangle",
    };
    return this.push(el);
  }

  /** A shape with text bound inside it — the standard single-label "card". */
  card(args: CardArgs): { container: ExcalidrawShapeElement; text: ExcalidrawTextElement } {
    const fontSize = args.fontSize ?? TYPE_SCALE.body;
    const fontFamily = args.fontFamily ?? FONT.hand;
    const innerWidth = args.width - 2 * METRICS.boundTextPadding - 2 * METRICS.cardPadding;
    const measured = measureText(args.text, fontSize, innerWidth, fontFamily);
    const height =
      args.height ??
      Math.max(
        measured.height + 2 * METRICS.cardPadding + 2 * METRICS.boundTextPadding,
        44,
      );

    const container: ExcalidrawShapeElement = {
      ...this.base({ ...args, height }),
      type: args.shape ?? "rectangle",
    };

    const textId = elementId(this.opts.planId, `${args.key}::text`);
    const textAlign = args.textAlign ?? "center";
    const verticalAlign = args.verticalAlign ?? "middle";

    const textX =
      textAlign === "left"
        ? container.x + METRICS.cardPadding
        : textAlign === "right"
          ? container.x + container.width - METRICS.cardPadding - measured.width
          : container.x + (container.width - measured.width) / 2;
    const textY =
      verticalAlign === "top"
        ? container.y + METRICS.cardPadding
        : container.y + (container.height - measured.height) / 2;

    const text: ExcalidrawTextElement = {
      ...this.base({
        key: `${args.key}::text`,
        role: args.role,
        nodeId: args.nodeId,
        ordinal: args.ordinal,
        x: textX,
        y: textY,
        width: measured.width,
        height: measured.height,
        strokeColor: args.textColor ?? PALETTE.ink,
        backgroundColor: PALETTE.transparent,
        roundness: null,
        frameId: args.frameId ?? null,
        opacity: args.opacity ?? 100,
        locked: args.locked ?? false,
        groupIds: args.groupIds,
      }),
      id: textId,
      type: "text",
      text: measured.text,
      originalText: args.text,
      fontSize,
      fontFamily,
      textAlign,
      verticalAlign,
      containerId: container.id,
      autoResize: false,
      lineHeight: LINE_HEIGHT,
    };

    container.boundElements = [{ id: textId, type: "text" }];

    this.push(container);
    this.push(text);
    return { container, text };
  }

  /** Free-standing text, not bound to any container. */
  text(args: TextArgs): ExcalidrawTextElement {
    const fontSize = args.fontSize ?? TYPE_SCALE.body;
    const fontFamily = args.fontFamily ?? FONT.hand;
    const measured = measureText(args.text, fontSize, args.maxWidth, fontFamily);
    const el: ExcalidrawTextElement = {
      ...this.base({
        key: args.key,
        role: args.role,
        nodeId: args.nodeId,
        ordinal: args.ordinal,
        x: args.x,
        y: args.y,
        width: measured.width,
        height: measured.height,
        strokeColor: args.color ?? PALETTE.ink,
        backgroundColor: PALETTE.transparent,
        roundness: null,
        frameId: args.frameId ?? null,
        opacity: args.opacity ?? 100,
        locked: args.locked ?? false,
        groupIds: args.groupIds,
      }),
      type: "text",
      text: measured.text,
      originalText: args.text,
      fontSize,
      fontFamily,
      textAlign: args.textAlign ?? "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: false,
      lineHeight: LINE_HEIGHT,
    };
    return this.push(el);
  }

  /**
   * A bound arrow between two elements.
   *
   * Both endpoints get the arrow appended to their `boundElements`. Skip that
   * and the arrow visually detaches the first time a reviewer drags a card,
   * which silently destroys the diagram they're supposed to be reviewing.
   */
  arrow(args: ArrowArgs): ExcalidrawArrowElement {
    const gap = 6;
    const from = args.from;
    const to = args.to;
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

    const start = edgePoint(from, toCenter, gap);
    const end = edgePoint(to, fromCenter, gap);

    const el: ExcalidrawArrowElement = {
      ...this.base({
        key: args.key,
        role: args.role ?? "decor",
        nodeId: args.nodeId,
        x: start.x,
        y: start.y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        strokeColor: args.strokeColor ?? PALETTE.muted,
        backgroundColor: PALETTE.transparent,
        strokeStyle: args.strokeStyle ?? "solid",
        strokeWidth: 2,
        roundness: { type: 2 },
        frameId: args.frameId ?? null,
        opacity: args.opacity ?? 100,
      }),
      type: "arrow",
      points: [
        [0, 0],
        [Math.round(end.x - start.x), Math.round(end.y - start.y)],
      ],
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap },
      endBinding: { elementId: to.id, focus: 0, gap },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    };

    bind(from, { id: el.id, type: "arrow" });
    bind(to, { id: el.id, type: "arrow" });

    return this.push(el);
  }

  /**
   * A positional polyline: the journey spine through steps, a fork's branch
   * lanes, an icon's strokes. Unlike `arrow()`, endpoints aren't bound to
   * shape elements — coordinates are absolute and fixed, which is what a
   * decorative or illustrative line needs.
   */
  path(args: PathArgs): ExcalidrawLinearElement | ExcalidrawArrowElement {
    const points = args.closed && args.points.length > 1
      ? [...args.points, args.points[0]!]
      : args.points;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const relPoints: [number, number][] = points.map((p) => [
      Math.round(p.x - minX),
      Math.round(p.y - minY),
    ]);

    const base = this.base({
      key: args.key,
      role: args.role ?? "decor",
      nodeId: args.nodeId,
      x: minX,
      y: minY,
      width: Math.max(1, Math.max(...xs) - minX),
      height: Math.max(1, Math.max(...ys) - minY),
      strokeColor: args.strokeColor ?? PALETTE.ink,
      backgroundColor: args.backgroundColor ?? PALETTE.transparent,
      fillStyle: args.fillStyle ?? "solid",
      strokeWidth: args.strokeWidth ?? 2,
      strokeStyle: args.strokeStyle ?? "solid",
      roughness: args.roughness ?? 1,
      opacity: args.opacity ?? 100,
      roundness: null,
      frameId: args.frameId ?? null,
      locked: args.locked ?? false,
      groupIds: args.groupIds,
    });
    const shared = {
      ...base,
      points: relPoints,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: args.startArrowhead ?? null,
      endArrowhead: args.endArrowhead ?? null,
    };

    if (args.startArrowhead || args.endArrowhead) {
      const el: ExcalidrawArrowElement = { ...shared, type: "arrow", elbowed: false };
      return this.push(el);
    }
    const el: ExcalidrawLinearElement = { ...shared, type: "line" };
    return this.push(el);
  }

  /** Assign every element created so far, without a frame, to `frameId`. */
  assignToFrame(frameId: string, elements: ExcalidrawElement[]): void {
    for (const el of elements) {
      if (el.type !== "frame") el.frameId = frameId;
    }
  }

  all(): ExcalidrawElement[] {
    return this.elements;
  }

  get(id: string): ExcalidrawElement | undefined {
    return this.byId.get(id);
  }
}

function bind(el: ExcalidrawElement, entry: BoundElement): void {
  if (el.boundElements === null || el.boundElements === undefined) {
    el.boundElements = [entry];
  } else if (!el.boundElements.some((b) => b.id === entry.id)) {
    el.boundElements.push(entry);
  }
}

/**
 * Where a line from `toward` meets the border of `el`, pushed out by `gap`.
 * Excalidraw recomputes this on load, but starting close keeps the initial
 * paint clean and keeps our width/height honest.
 */
function edgePoint(
  el: ExcalidrawElement,
  toward: { x: number; y: number },
  gap: number,
): { x: number; y: number } {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = el.width / 2 + gap;
  const halfH = el.height / 2 + gap;
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
