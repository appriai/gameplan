import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * The element shape Excalidraw actually hands us — ordered, and including the
 * internal selection element. Deriving it from the API signature keeps us in
 * step with the library instead of guessing at its element union.
 */
export type SyncElement = ReturnType<
  ExcalidrawImperativeAPI["getSceneElementsIncludingDeleted"]
>[number];

/** Mirrors packages/core theme.ts. Duplicated rather than imported so the
 *  web bundle doesn't pull in the Node-side layout engine. */
export const INTENT_STYLE = {
  approve: { stroke: "#2f9e44", background: "#b2f2bb", label: "Approve", hint: "this must happen" },
  reject: { stroke: "#e03131", background: "#ffc9c9", label: "Reject", hint: "drop or rethink this" },
  question: { stroke: "#f08c00", background: "#ffec99", label: "Question", hint: "unclear to me" },
  add: { stroke: "#1971c2", background: "#a5d8ff", label: "Add", hint: "this is missing" },
} as const;

export type Intent = keyof typeof INTENT_STYLE;
export const INTENT_ORDER: Intent[] = ["approve", "reject", "question", "add"];

export interface PeerInfo {
  id: string;
  name: string;
  color: string;
  pointer?: { x: number; y: number };
  selectedElementIds?: Record<string, boolean>;
}

export interface SceneLike {
  elements: SyncElement[];
}

export type ServerMessage =
  | {
      t: "init";
      scene: SceneLike;
      you: { id: string; name: string; color: string };
      spec?: { id: string; title: string; revision: number };
      peers: PeerInfo[];
    }
  | { t: "elements"; elements: SyncElement[] }
  | {
      t: "pointer";
      id: string;
      name: string;
      color: string;
      x: number;
      y: number;
      selectedElementIds?: Record<string, boolean>;
    }
  | { t: "peers"; peers: PeerInfo[] }
  | { t: "peer-left"; id: string }
  | { t: "submitted"; at: number; by: string[]; summary: string }
  | { t: "rerender"; planId: string; scene: SceneLike }
  | { t: "error"; message: string }
  | { t: "pong" };

export type ClientMessage =
  | { t: "join"; planId: string; name: string }
  | { t: "elements"; elements: SyncElement[] }
  | { t: "pointer"; x: number; y: number; selectedElementIds?: Record<string, boolean> }
  | { t: "submit" }
  | { t: "ping" };

export function planIdFromLocation(): string | undefined {
  const match = window.location.pathname.match(/^\/p\/([^/]+)/);
  return match?.[1];
}

export function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // in dev the Vite proxy forwards /ws to the API server
  return `${protocol}//${window.location.host}/ws`;
}
