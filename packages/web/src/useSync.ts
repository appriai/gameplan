import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  socketUrl,
  type ClientMessage,
  type DocKind,
  type PeerInfo,
  type ServerMessage,
  type SyncElement,
} from "./protocol";
import { frameContent } from "./viewport";

export type SyncStatus = "connecting" | "live" | "reconnecting" | "error";

export interface Submitted {
  at: number;
  by: string[];
  summary: string;
}

export interface Sync {
  status: SyncStatus;
  error?: string;
  peers: PeerInfo[];
  me?: { id: string; name: string; color: string };
  title?: string;
  revision?: number;
  lastSubmitted?: Submitted;
  ready: boolean;
  onChange: () => void;
  onPointerUpdate: (payload: { x: number; y: number }) => void;
  submit: () => void;
}

const CHANGE_DEBOUNCE_MS = 120;
const POINTER_THROTTLE_MS = 60;

/**
 * Two-way sync between this browser and the gameplan server.
 *
 * Convergence is element-level last-write-wins on `version`, the same rule
 * Excalidraw's own collaboration uses.
 *
 * The echo guard is the `known` version map rather than an "applying remote"
 * flag. Before handing remote elements to `updateScene` we record their
 * versions as already-seen, so the `onChange` that inevitably fires finds
 * nothing new to send. A flag would have to guess how long Excalidraw takes to
 * emit that callback, and would swallow genuine local edits made in the gap.
 */
export function useSync(
  api: ExcalidrawImperativeAPI | null,
  id: string,
  name: string,
  kind: DocKind = "plan",
): Sync {
  const socketRef = useRef<WebSocket | null>(null);
  const known = useRef(new Map<string, number>());
  const collaborators = useRef(new Map<string, unknown>());
  const changeTimer = useRef<number | undefined>(undefined);
  const lastPointerSent = useRef(0);
  const retryDelay = useRef(500);
  const closedByUs = useRef(false);
  /** our own peer id, as a ref: the socket handler closes over its first
   *  render and would otherwise filter the peer list against a stale `me` */
  const meId = useRef<string | undefined>(undefined);

  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [error, setError] = useState<string | undefined>();
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [me, setMe] = useState<{ id: string; name: string; color: string }>();
  const [title, setTitle] = useState<string>();
  const [revision, setRevision] = useState<number>();
  const [lastSubmitted, setLastSubmitted] = useState<Submitted>();
  const [ready, setReady] = useState(false);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  /** Replace or insert remote elements without disturbing local undo history. */
  const applyRemote = useCallback(
    (incoming: SyncElement[], replaceAll = false) => {
      if (!api || incoming.length === 0) return;
      let next: SyncElement[];
      if (replaceAll) {
        known.current.clear();
        next = incoming;
      } else {
        const merged = new Map(
          api.getSceneElementsIncludingDeleted().map((el) => [el.id, el]),
        );
        for (const el of incoming) merged.set(el.id, el);
        next = [...merged.values()];
      }
      for (const el of next) known.current.set(el.id, el.version);
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [api],
  );

  const pushCollaborators = useCallback(() => {
    if (!api) return;
    api.updateScene({
      collaborators: collaborators.current as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api]);

  useEffect(() => {
    if (!api || !id) return;
    closedByUs.current = false;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        retryDelay.current = 500;
        socket.send(JSON.stringify({ t: "join", kind, id, name } satisfies ClientMessage));
      });

      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        switch (message.t) {
          case "init":
            applyRemote(message.scene.elements, true);
            meId.current = message.you.id;
            setMe(message.you);
            setPeers(message.peers.filter((p) => p.id !== message.you.id));
            setTitle(message.spec?.title);
            setRevision(message.spec?.revision);
            setStatus("live");
            setReady(true);
            frameContent(api, message.scene.elements);
            break;

          case "rerender":
            applyRemote(message.scene.elements, true);
            break;

          case "elements":
            applyRemote(message.elements);
            break;

          case "peers":
            setPeers(message.peers.filter((p) => p.id !== meId.current));
            for (const id of collaborators.current.keys()) {
              if (!message.peers.some((p) => p.id === id)) collaborators.current.delete(id);
            }
            pushCollaborators();
            break;

          case "pointer":
            collaborators.current.set(message.id, {
              id: message.id,
              username: message.name,
              pointer: { x: message.x, y: message.y, tool: "pointer" },
              color: { background: message.color, stroke: message.color },
              selectedElementIds: message.selectedElementIds,
              isCurrentUser: false,
            });
            pushCollaborators();
            break;

          case "peer-left":
            collaborators.current.delete(message.id);
            pushCollaborators();
            break;

          case "submitted":
            setLastSubmitted({ at: message.at, by: message.by, summary: message.summary });
            break;

          case "error":
            setError(message.message);
            setStatus("error");
            break;
        }
      });

      socket.addEventListener("close", () => {
        if (disposed || closedByUs.current) return;
        setStatus("reconnecting");
        const delay = retryDelay.current;
        retryDelay.current = Math.min(delay * 2, 8000);
        window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      disposed = true;
      closedByUs.current = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
    // `me` is intentionally excluded: it changes once, after init, and
    // reconnecting on it would drop the session we just established
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, name, kind, applyRemote, pushCollaborators]);

  const flushChanges = useCallback(() => {
    if (!api) return;
    const all = api.getSceneElementsIncludingDeleted();
    const changed: SyncElement[] = [];
    for (const el of all) {
      if (known.current.get(el.id) === el.version) continue;
      known.current.set(el.id, el.version);
      changed.push(el);
    }
    if (changed.length > 0) send({ t: "elements", elements: changed });
  }, [api, send]);

  const onChange = useCallback(() => {
    if (changeTimer.current !== undefined) window.clearTimeout(changeTimer.current);
    changeTimer.current = window.setTimeout(flushChanges, CHANGE_DEBOUNCE_MS);
  }, [flushChanges]);

  const onPointerUpdate = useCallback(
    (payload: { x: number; y: number }) => {
      const now = Date.now();
      if (now - lastPointerSent.current < POINTER_THROTTLE_MS) return;
      lastPointerSent.current = now;
      send({
        t: "pointer",
        x: payload.x,
        y: payload.y,
        selectedElementIds: api?.getAppState().selectedElementIds,
      });
    },
    [api, send],
  );

  const submit = useCallback(() => {
    flushChanges();
    // let the element flush land server-side before it reads the canvas
    window.setTimeout(() => send({ t: "submit" }), 150);
  }, [flushChanges, send]);

  useEffect(
    () => () => {
      if (changeTimer.current !== undefined) window.clearTimeout(changeTimer.current);
    },
    [],
  );

  return {
    status,
    error,
    peers,
    me,
    title,
    revision,
    lastSubmitted,
    ready,
    onChange,
    onPointerUpdate,
    submit,
  };
}
