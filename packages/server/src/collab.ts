import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ExcalidrawElement } from "@gameplan/core";
import type { DocStore } from "./store.js";

/** Cursor colours, cycled so two reviewers rarely collide. */
const PEER_COLORS = [
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#f08c00",
  "#6741d9",
  "#0c8599",
  "#e8590c",
  "#c2255c",
];

export type DocKind = "plan" | "diagram";

export interface Peer {
  id: string;
  name: string;
  color: string;
  kind: DocKind;
  docId: string;
  socket: WebSocket;
  pointer?: { x: number; y: number };
  selectedElementIds?: Record<string, boolean>;
}

type ClientMessage =
  | { t: "join"; kind: DocKind; id: string; name: string }
  | { t: "elements"; elements: ExcalidrawElement[] }
  | { t: "pointer"; x: number; y: number; selectedElementIds?: Record<string, boolean> }
  | { t: "submit" }
  | { t: "ping" };

export interface CollabHub {
  wss: WebSocketServer;
  /** notify long-pollers that a reviewer handed feedback to the agent */
  onSubmit(listener: (kind: DocKind, id: string) => void): () => void;
  /** push a fresh scene to every client watching this document right now */
  broadcastRerender(kind: DocKind, id: string, scene: unknown): void;
  close(): void;
}

/** Groups peers per document — a plan and a diagram can share an id string. */
function room(kind: DocKind, id: string): string {
  return `${kind}:${id}`;
}

export function attachCollab(
  server: Server,
  stores: Record<DocKind, DocStore<unknown>>,
): CollabHub {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const peers = new Map<WebSocket, Peer>();
  const submitListeners = new Set<(kind: DocKind, id: string) => void>();
  let colorCursor = 0;

  function peersOf(kind: DocKind, id: string): Peer[] {
    const key = room(kind, id);
    return [...peers.values()].filter((p) => room(p.kind, p.docId) === key);
  }

  function send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }

  function broadcast(kind: DocKind, id: string, payload: unknown, except?: WebSocket): void {
    for (const peer of peersOf(kind, id)) {
      if (peer.socket === except) continue;
      send(peer.socket, payload);
    }
  }

  function publicPeers(kind: DocKind, id: string) {
    return peersOf(kind, id).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      pointer: p.pointer,
      selectedElementIds: p.selectedElementIds,
    }));
  }

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (msg.t === "join") {
        const store = stores[msg.kind];
        const scene = store?.scene(msg.id);
        if (!store || !scene) {
          send(socket, { t: "error", message: `no ${msg.kind} "${msg.id}"` });
          socket.close();
          return;
        }
        const peer: Peer = {
          id: randomUUID(),
          name: msg.name?.trim() || "Anonymous",
          color: PEER_COLORS[colorCursor++ % PEER_COLORS.length]!,
          kind: msg.kind,
          docId: msg.id,
          socket,
        };
        peers.set(socket, peer);
        send(socket, {
          t: "init",
          scene,
          you: { id: peer.id, name: peer.name, color: peer.color },
          spec: store.get(msg.id)?.spec,
          peers: publicPeers(msg.kind, msg.id).filter((p) => p.id !== peer.id),
        });
        broadcast(msg.kind, msg.id, { t: "peers", peers: publicPeers(msg.kind, msg.id) });
        return;
      }

      const peer = peers.get(socket);
      if (!peer) return;
      const store = stores[peer.kind];

      switch (msg.t) {
        case "elements": {
          const accepted = store.applyElements(peer.docId, msg.elements);
          if (accepted.length > 0) {
            broadcast(peer.kind, peer.docId, { t: "elements", elements: accepted }, socket);
          }
          break;
        }
        case "pointer": {
          peer.pointer = { x: msg.x, y: msg.y };
          peer.selectedElementIds = msg.selectedElementIds;
          broadcast(
            peer.kind,
            peer.docId,
            {
              t: "pointer",
              id: peer.id,
              name: peer.name,
              color: peer.color,
              x: msg.x,
              y: msg.y,
              selectedElementIds: msg.selectedElementIds,
            },
            socket,
          );
          break;
        }
        case "submit": {
          const names = [...new Set(peersOf(peer.kind, peer.docId).map((p) => p.name))];
          const submission = store.submit(peer.docId, names);
          if (submission) {
            broadcast(peer.kind, peer.docId, {
              t: "submitted",
              at: submission.at,
              by: submission.by,
              summary: summarise(submission.report),
            });
            for (const listener of submitListeners) listener(peer.kind, peer.docId);
          }
          break;
        }
        case "ping":
          send(socket, { t: "pong" });
          break;
      }
    });

    socket.on("close", () => {
      const peer = peers.get(socket);
      peers.delete(socket);
      if (peer) {
        broadcast(peer.kind, peer.docId, { t: "peers", peers: publicPeers(peer.kind, peer.docId) });
        broadcast(peer.kind, peer.docId, { t: "peer-left", id: peer.id });
      }
    });
  });

  return {
    wss,
    onSubmit(listener) {
      submitListeners.add(listener);
      return () => submitListeners.delete(listener);
    },
    broadcastRerender(kind, id, scene) {
      broadcast(kind, id, { t: "rerender", id, scene });
    },
    close() {
      for (const socket of peers.keys()) socket.close();
      wss.close();
    },
  };
}

function summarise(report: {
  comments: unknown[];
  reorders: unknown[];
  removals: unknown[];
  rewrites: unknown[];
}): string {
  const parts: string[] = [];
  if (report.comments.length) parts.push(`${report.comments.length} comment(s)`);
  if (report.removals.length) parts.push(`${report.removals.length} removal(s)`);
  if (report.rewrites.length) parts.push(`${report.rewrites.length} rewrite(s)`);
  if (report.reorders.length) parts.push("reordered steps");
  return parts.length > 0 ? parts.join(", ") : "no changes";
}
