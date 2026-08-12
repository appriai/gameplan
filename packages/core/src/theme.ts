import type { Severity, SurfaceKind } from "./spec.js";

/**
 * Excalidraw's own default palette. Sticking to these hexes matters: the
 * annotation protocol asks humans to pick colors from the standard Excalidraw
 * swatches, and feedback parsing matches on exactly these values.
 */
export const PALETTE = {
  ink: "#1e1e1e",
  muted: "#5c5f66",
  transparent: "transparent",

  strokeRed: "#e03131",
  strokeGreen: "#2f9e44",
  strokeBlue: "#1971c2",
  strokeYellow: "#f08c00",
  strokeViolet: "#6741d9",

  bgRed: "#ffc9c9",
  bgGreen: "#b2f2bb",
  bgBlue: "#a5d8ff",
  bgYellow: "#ffec99",
  bgViolet: "#d0bfff",
  bgGrey: "#e9ecef",
  bgWhite: "#ffffff",
} as const;

/** Human annotation colors -> intent. The protocol, in one place. */
export const INTENT_BY_BG: Record<string, "reject" | "approve" | "question" | "add"> = {
  [PALETTE.bgRed]: "reject",
  [PALETTE.bgGreen]: "approve",
  [PALETTE.bgYellow]: "question",
  [PALETTE.bgBlue]: "add",
};

export const INTENT_BY_STROKE: Record<
  string,
  "reject" | "approve" | "question" | "add"
> = {
  [PALETTE.strokeRed]: "reject",
  [PALETTE.strokeGreen]: "approve",
  [PALETTE.strokeYellow]: "question",
  [PALETTE.strokeBlue]: "add",
};

export const INTENT_STYLE = {
  reject: { stroke: PALETTE.strokeRed, background: PALETTE.bgRed, label: "Reject / remove" },
  approve: { stroke: PALETTE.strokeGreen, background: PALETTE.bgGreen, label: "Approve / must do" },
  question: { stroke: PALETTE.strokeYellow, background: PALETTE.bgYellow, label: "Question / unclear" },
  add: { stroke: PALETTE.strokeBlue, background: PALETTE.bgBlue, label: "Add this" },
} as const;

export type Intent = keyof typeof INTENT_STYLE;

export const SURFACE_STYLE: Record<SurfaceKind, { stroke: string; background: string }> = {
  new: { stroke: PALETTE.strokeGreen, background: PALETTE.bgGreen },
  modified: { stroke: PALETTE.strokeBlue, background: PALETTE.bgBlue },
  read: { stroke: PALETTE.muted, background: PALETTE.bgGrey },
  untouched: { stroke: PALETTE.muted, background: PALETTE.transparent },
};

/** Named colours for freestyle diagram nodes — not tied to plan semantics. */
export const DIAGRAM_COLOR_STYLE: Record<string, { stroke: string; background: string }> = {
  ink: { stroke: PALETTE.ink, background: PALETTE.transparent },
  green: { stroke: PALETTE.strokeGreen, background: PALETTE.bgGreen },
  blue: { stroke: PALETTE.strokeBlue, background: PALETTE.bgBlue },
  red: { stroke: PALETTE.strokeRed, background: PALETTE.bgRed },
  yellow: { stroke: PALETTE.strokeYellow, background: PALETTE.bgYellow },
  violet: { stroke: PALETTE.strokeViolet, background: PALETTE.bgViolet },
  grey: { stroke: PALETTE.muted, background: PALETTE.bgGrey },
};

export const RISK_STYLE: Record<Severity, { stroke: string; background: string }> = {
  high: { stroke: PALETTE.strokeRed, background: PALETTE.bgRed },
  med: { stroke: PALETTE.strokeYellow, background: PALETTE.bgYellow },
  low: { stroke: PALETTE.muted, background: PALETTE.bgGrey },
};

/** Typography. fontFamily 1 is the hand-drawn face (Virgil -> Excalifont). */
export const FONT = {
  hand: 1,
  normal: 2,
  code: 3,
} as const;

export const TYPE_SCALE = {
  title: 28,
  heading: 20,
  body: 16,
  small: 12,
} as const;

export const LINE_HEIGHT = 1.25;

/** Layout constants, tuned against rendered output. */
export const METRICS = {
  cardWidth: 260,
  cardPadding: 14,
  cardGap: 28,
  columnGap: 80,
  framePadding: 40,
  frameGap: 100,
  /** Excalidraw's own padding for text bound inside a container. */
  boundTextPadding: 5,

  // journey-map: steps as waypoints on a path, not cards in a grid
  waypointRadius: 22,
  stepPitch: 210,
  iconSize: 20,

  // journey-map: forks as a diamond fanning into stacked lanes
  laneHeight: 68,
  laneStub: 46,
  laneLength: 190,
  laneTerminusRadius: 9,

  // journey-map: surface nodes as small icon+label, not padded cards
  surfaceIconSize: 26,
  surfaceNodeWidth: 190,

  // journey-map: risk cards, icon-first
  riskIconSize: 24,

  // freestyle diagrams
  diagramNodeWidth: 200,
  diagramIconSize: 26,
  sequenceLaneWidth: 200,
  sequenceRowHeight: 56,
  sequenceActorHeight: 44,
} as const;
