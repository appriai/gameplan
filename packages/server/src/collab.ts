import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ExcalidrawElement } from "@gameplan/core";
import type { PlanStore } from "./store.js";

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

export interface Peer {
  id: string;
  name: string;
  color: string;
  planId: string;
  socket: WebSocket;
  pointer?: { x: number; y: number };
  selectedElementIds?: Record<string, boolean>;
}

type ClientMessage =
  | { t: "join"; planId: string; name: string }
  | { t: "elements"; elements: ExcalidrawElement[] }
  | { t: "pointer"; x: number; y: number; selectedElementIds?: Record<string, boolean> }
  | { t: "submit" }
  | { t: "ping" };

export interface CollabHub {
  wss: WebSocketServer;
  /** notify long-pollers that a reviewer handed feedback to the agent */
  onSubmit(listener: (planId: string) => void): () => void;
  close(): void;
}

export function attachCollab(server: Server, store: PlanStore): CollabHub {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const peers = new Map<WebSocket, Peer>();
  const submitListeners = new Set<(planId: string) => void>();
  let colorCursor = 0;

  function peersOf(planId: string): Peer[] {
    return [...peers.values()].filter((p) => p.planId === planId);
  }

  function send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }

  function broadcast(planId: string, payload: unknown, except?: WebSocket): void {
    for (const peer of peersOf(planId)) {
      if (peer.socket === except) continue;
      send(peer.socket, payload);
    }
  }

  function publicPeers(planId: string) {
    return peersOf(planId).map((p) => ({
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
        const scene = store.scene(msg.planId);
        if (!scene) {
          send(socket, { t: "error", message: `no plan "${msg.planId}"` });
          socket.close();
          return;
        }
        const peer: Peer = {
          id: randomUUID(),
          name: msg.name?.trim() || "Anonymous",
          color: PEER_COLORS[colorCursor++ % PEER_COLORS.length]!,
          planId: msg.planId,
          socket,
        };
        peers.set(socket, peer);
        send(socket, {
          t: "init",
          scene,
          you: { id: peer.id, name: peer.name, color: peer.color },
          spec: store.get(msg.planId)?.spec,
          peers: publicPeers(msg.planId).filter((p) => p.id !== peer.id),
        });
        broadcast(msg.planId, { t: "peers", peers: publicPeers(msg.planId) }, undefined);
        return;
      }

      const peer = peers.get(socket);
      if (!peer) return;

      switch (msg.t) {
        case "elements": {
          const accepted = store.applyElements(peer.planId, msg.elements);
          if (accepted.length > 0) {
            broadcast(peer.planId, { t: "elements", elements: accepted }, socket);
          }
          break;
        }
        case "pointer": {
          peer.pointer = { x: msg.x, y: msg.y };
          peer.selectedElementIds = msg.selectedElementIds;
          broadcast(
            peer.planId,
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
          const names = [...new Set(peersOf(peer.planId).map((p) => p.name))];
          const submission = store.submit(peer.planId, names);
          if (submission) {
            broadcast(peer.planId, {
              t: "submitted",
              at: submission.at,
              by: submission.by,
              summary: summarise(submission.report),
            });
            for (const listener of submitListeners) listener(peer.planId);
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
        broadcast(peer.planId, { t: "peers", peers: publicPeers(peer.planId) });
        broadcast(peer.planId, { t: "peer-left", id: peer.id });
      }
    });
  });

  return {
    wss,
    onSubmit(listener) {
      submitListeners.add(listener);
      return () => submitListeners.delete(listener);
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
