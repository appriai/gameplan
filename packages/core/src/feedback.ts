import {
  annotationMeta,
  gameplanMeta,
  isFreedrawElement,
  isLinearElement,
  isTextElement,
  type ExcalidrawElement,
  type ExcalidrawScene,
} from "./excalidraw.js";
import type { Snapshot } from "./snapshot.js";
import { INTENT_BY_BG, INTENT_BY_STROKE, type Intent } from "./theme.js";

/**
 * Reading human edits back off the canvas.
 *
 * Everything the renderer emits is tagged with `customData.gameplan`, so the
 * split between "what the agent drew" and "what a human did to it" is exact
 * rather than heuristic. The heuristics start only once we know something is
 * human-authored, and are limited to deciding what it refers to.
 */

/** Card-like roles a comment can sensibly be attached to. */
const ANCHORABLE_ROLES = new Set([
  "step",
  "fork-option",
  "surface",
  "risk",
  "criterion",
  "out-of-scope",
  "goal",
  "diagram-node",
  "cluster",
]);

/** Beyond this distance a floating sticky is treated as a region comment. */
const PROXIMITY_RADIUS = 360;
/** Movement under this is noise from a nudge, not a reorder. */
const MOVE_EPSILON = 8;
/** Fraction of a card a scribble must cover to count as striking it out. */
const STRIKE_COVERAGE = 0.4;

export type AnchorVia = "arrow" | "containment" | "proximity" | "frame" | "none";

export interface Anchor {
  via: AnchorVia;
  role?: string;
  nodeId?: string;
  elementId?: string;
}

export interface Comment {
  intent: Intent;
  text: string;
  author?: string;
  anchor: Anchor;
}

export interface Reorder {
  region: "steps";
  /** step ids in the order the reviewer left them */
  order: string[];
  previous: string[];
}

export interface Removal {
  role: string;
  nodeId: string;
  reason: "deleted" | "struck";
}

export interface Rewrite {
  role: string;
  nodeId: string;
  before: string;
  after: string;
}

export interface FeedbackReport {
  planId: string;
  revision: number;
  /** true when nothing at all was changed on the canvas */
  empty: boolean;
  comments: Comment[];
  reorders: Reorder[];
  removals: Removal[];
  rewrites: Rewrite[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centre(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function contains(outer: Box, point: { x: number; y: number }): boolean {
  return (
    point.x >= outer.x &&
    point.x <= outer.x + outer.width &&
    point.y >= outer.y &&
    point.y <= outer.y + outer.height
  );
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Stamped metadata for an annotation, wherever it happens to live.
 *
 * The palette puts it on the container, but a note typed straight onto the
 * canvas carries it on the text element instead. Checking both means we never
 * silently fall back to guessing intent from colour when the reviewer told us.
 */
function stampedMeta(
  el: ExcalidrawElement,
  boundTextByContainer: Map<string, ExcalidrawElement>,
) {
  return annotationMeta(el) ?? annotationMeta(boundTextByContainer.get(el.id) ?? el);
}

function intentOf(
  el: ExcalidrawElement,
  boundTextByContainer: Map<string, ExcalidrawElement>,
): Intent {
  const stamped = stampedMeta(el, boundTextByContainer)?.intent;
  if (stamped) return stamped;

  const label = boundTextByContainer.get(el.id);
  for (const candidate of [el, label]) {
    if (!candidate) continue;
    const byBg = INTENT_BY_BG[candidate.backgroundColor];
    if (byBg) return byBg;
    const byStroke = INTENT_BY_STROKE[candidate.strokeColor];
    if (byStroke) return byStroke;
  }
  // an uncoloured note is a remark, not a verdict
  return "question";
}

/** Text carried by an annotation, either directly or via its bound label. */
function textOf(
  el: ExcalidrawElement,
  boundTextByContainer: Map<string, ExcalidrawElement>,
): string {
  if (isTextElement(el)) return el.originalText || el.text;
  const bound = boundTextByContainer.get(el.id);
  if (bound && isTextElement(bound)) return bound.originalText || bound.text;
  return "";
}

export function parseFeedback(
  scene: ExcalidrawScene,
  snapshot: Snapshot,
): FeedbackReport {
  const live = scene.elements.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));

  const generated: ExcalidrawElement[] = [];
  const annotations: ExcalidrawElement[] = [];
  const boundTextByContainer = new Map<string, ExcalidrawElement>();

  for (const el of live) {
    if (isTextElement(el) && el.containerId) {
      boundTextByContainer.set(el.containerId, el);
    }
    if (gameplanMeta(el)) generated.push(el);
    else annotations.push(el);
  }

  /** Generated cards a comment can attach to. */
  const targets = generated.filter((el) => {
    const meta = gameplanMeta(el)!;
    return ANCHORABLE_ROLES.has(meta.role) && !isTextElement(el);
  });
  // regions with only text (criteria, out-of-scope) still deserve anchors
  const textTargets = generated.filter((el) => {
    const meta = gameplanMeta(el)!;
    return ANCHORABLE_ROLES.has(meta.role) && isTextElement(el) && !el.containerId;
  });
  const allTargets = [...targets, ...textTargets];

  const frames = generated.filter((el) => gameplanMeta(el)!.role === "frame");

  const comments = collectComments(
    annotations,
    allTargets,
    frames,
    byId,
    boundTextByContainer,
  );
  const removals = collectRemovals(snapshot, byId, annotations, allTargets);
  const rewrites = collectRewrites(snapshot, generated);
  const reorders = collectReorders(snapshot, generated);

  return {
    planId: snapshot.planId,
    revision: snapshot.revision,
    empty:
      comments.length === 0 &&
      removals.length === 0 &&
      rewrites.length === 0 &&
      reorders.length === 0,
    comments,
    reorders,
    removals,
    rewrites,
  };
}

function collectComments(
  annotations: ExcalidrawElement[],
  targets: ExcalidrawElement[],
  frames: ExcalidrawElement[],
  byId: Map<string, ExcalidrawElement>,
  boundTextByContainer: Map<string, ExcalidrawElement>,
): Comment[] {
  const consumedAsLabel = new Set<string>();
  for (const el of annotations) {
    if (isTextElement(el) && el.containerId && byId.has(el.containerId)) {
      consumedAsLabel.add(el.id);
    }
  }

  // arrows drawn by a human from a sticky to a card are explicit anchoring
  const arrowAnchor = new Map<string, ExcalidrawElement>();
  for (const el of annotations) {
    if (!isLinearElement(el)) continue;
    const start = el.startBinding ? byId.get(el.startBinding.elementId) : undefined;
    const end = el.endBinding ? byId.get(el.endBinding.elementId) : undefined;
    if (!start || !end) continue;
    const startIsTarget = targets.includes(start);
    const endIsTarget = targets.includes(end);
    if (startIsTarget && !endIsTarget) arrowAnchor.set(end.id, start);
    else if (endIsTarget && !startIsTarget) arrowAnchor.set(start.id, end);
  }

  const comments: Comment[] = [];
  for (const el of annotations) {
    if (consumedAsLabel.has(el.id)) continue;
    if (isLinearElement(el)) continue;
    if (isFreedrawElement(el)) continue; // handled as a strike, not a comment

    const text = textOf(el, boundTextByContainer).trim();
    if (text === "") continue;

    const author = stampedMeta(el, boundTextByContainer)?.author;
    comments.push({
      intent: intentOf(el, boundTextByContainer),
      text,
      ...(author ? { author } : {}),
      anchor: resolveAnchor(el, targets, frames, arrowAnchor),
    });
  }
  return comments;
}

function resolveAnchor(
  el: ExcalidrawElement,
  targets: ExcalidrawElement[],
  frames: ExcalidrawElement[],
  arrowAnchor: Map<string, ExcalidrawElement>,
): Anchor {
  const explicit = arrowAnchor.get(el.id);
  if (explicit) return anchorTo(explicit, "arrow");

  const point = centre(el);

  for (const target of targets) {
    if (contains(target, point)) return anchorTo(target, "containment");
  }

  /**
   * Proximity is scoped to the enclosing region.
   *
   * Regions stack vertically, so a note dropped in the Goal frame can easily
   * sit closer to the first Steps card than to anything in Goal. Matching it
   * to that card would attribute a comment about the goal to an unrelated
   * step — worse than reporting it against the region.
   */
  const enclosing = frames.find((frame) => contains(frame, point));
  const candidates = enclosing
    ? targets.filter((t) => t.frameId === enclosing.id)
    : targets;

  let nearest: ExcalidrawElement | undefined;
  let nearestDistance = Infinity;
  for (const target of candidates) {
    const c = centre(target);
    const d = Math.hypot(c.x - point.x, c.y - point.y);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = target;
    }
  }
  if (nearest && nearestDistance <= PROXIMITY_RADIUS) {
    return anchorTo(nearest, "proximity");
  }

  if (enclosing) return anchorTo(enclosing, "frame");
  return { via: "none" };
}

function anchorTo(el: ExcalidrawElement, via: AnchorVia): Anchor {
  const meta = gameplanMeta(el);
  return {
    via,
    elementId: el.id,
    ...(meta?.role ? { role: meta.role } : {}),
    ...(meta?.nodeId ? { nodeId: meta.nodeId } : {}),
  };
}

function collectRemovals(
  snapshot: Snapshot,
  byId: Map<string, ExcalidrawElement>,
  annotations: ExcalidrawElement[],
  targets: ExcalidrawElement[],
): Removal[] {
  const removals: Removal[] = [];
  const seen = new Set<string>();

  for (const [id, snap] of Object.entries(snapshot.elements)) {
    if (!snap.nodeId || !ANCHORABLE_ROLES.has(snap.role)) continue;
    if (byId.has(id)) continue;
    const key = `${snap.role}:${snap.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    removals.push({ role: snap.role, nodeId: snap.nodeId, reason: "deleted" });
  }

  // a scribble covering most of a card is the analogue of crossing it out
  for (const scribble of annotations) {
    if (!isFreedrawElement(scribble)) continue;
    for (const target of targets) {
      const area = target.width * target.height;
      if (area === 0) continue;
      if (overlapArea(scribble, target) / area < STRIKE_COVERAGE) continue;
      const meta = gameplanMeta(target)!;
      if (!meta.nodeId) continue;
      const key = `${meta.role}:${meta.nodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      removals.push({ role: meta.role, nodeId: meta.nodeId, reason: "struck" });
    }
  }

  return removals;
}

function collectRewrites(
  snapshot: Snapshot,
  generated: ExcalidrawElement[],
): Rewrite[] {
  const rewrites: Rewrite[] = [];
  for (const el of generated) {
    if (!isTextElement(el)) continue;
    const snap = snapshot.elements[el.id];
    if (!snap?.text || !snap.nodeId) continue;
    const after = el.originalText || el.text;
    if (after === snap.text) continue;
    rewrites.push({
      role: snap.role,
      nodeId: snap.nodeId,
      before: snap.text,
      after,
    });
  }
  return rewrites;
}

/**
 * Reorder detection. Reviewers reorder by dragging cards, so we re-derive
 * reading order from geometry (rows top to bottom, cards left to right within
 * a row) and compare it against the order we rendered.
 */
function collectReorders(
  snapshot: Snapshot,
  generated: ExcalidrawElement[],
): Reorder[] {
  const cards = generated.filter((el) => {
    const meta = gameplanMeta(el)!;
    return meta.role === "step" && !isTextElement(el) && meta.nodeId;
  });
  if (cards.length < 2) return [];

  const moved = cards.some((el) => {
    const snap = snapshot.elements[el.id];
    if (!snap) return false;
    return Math.abs(snap.x - el.x) > MOVE_EPSILON || Math.abs(snap.y - el.y) > MOVE_EPSILON;
  });
  if (!moved) return [];

  const rowBand = Math.max(40, Math.min(...cards.map((c) => c.height)) / 2);
  const sorted = [...cards].sort((a, b) => {
    if (Math.abs(a.y - b.y) > rowBand) return a.y - b.y;
    return a.x - b.x;
  });

  const order = sorted.map((el) => gameplanMeta(el)!.nodeId!);
  const previous = [...cards]
    .sort((a, b) => (gameplanMeta(a)!.ordinal ?? 0) - (gameplanMeta(b)!.ordinal ?? 0))
    .map((el) => gameplanMeta(el)!.nodeId!);

  if (order.join(" ") === previous.join(" ")) return [];
  return [{ region: "steps", order, previous }];
}
