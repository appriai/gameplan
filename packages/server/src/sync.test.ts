import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ExcalidrawElement, FeedbackReport } from "gameplan-core";
import { startServer, type RunningServer } from "./app.js";
import { reconcile } from "./store.js";

const SPEC = readFileSync(
  fileURLToPath(new URL("../../../examples/rate-limiting.plan.yaml", import.meta.url)),
  "utf8",
);

const PORT = 39_411;
const BASE = `http://127.0.0.1:${PORT}`;

let server: RunningServer;
let dataDir: string;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  return (await (await fetch(`${BASE}${path}`)).json()) as T;
}

/** A headless stand-in for a browser tab. */
class Client {
  readonly received: ExcalidrawElement[] = [];
  private readonly socket: WebSocket;
  private readonly waiters: ((m: Record<string, unknown>) => boolean)[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.t === "elements" || message.t === "init") {
        const elements = (message.t === "init"
          ? (message.scene as { elements: ExcalidrawElement[] }).elements
          : (message.elements as ExcalidrawElement[])) ?? [];
        this.received.push(...elements);
      }
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i]!(message)) this.waiters.splice(i, 1);
      }
    });
  }

  static async join(id: string, name: string, kind: "plan" | "diagram" = "plan"): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((resolve) => socket.once("open", resolve));
    const client = new Client(socket);
    const init = client.next((m) => m.t === "init");
    socket.send(JSON.stringify({ t: "join", kind, id, name }));
    await init;
    return client;
  }

  next(match: (m: Record<string, unknown>) => boolean, timeoutMs = 4000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      this.waiters.push((message) => {
        if (!match(message)) return false;
        clearTimeout(timer);
        resolve(message);
        return true;
      });
    });
  }

  send(payload: unknown): void {
    this.socket.send(JSON.stringify(payload));
  }

  close(): void {
    this.socket.close();
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "gameplan-test-"));
  server = await startServer({ port: PORT, host: "127.0.0.1", dataDir });
  await post("/api/plans", { specYaml: SPEC });
});

afterAll(async () => {
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("reconcile", () => {
  const el = (version: number, versionNonce: number): ExcalidrawElement =>
    ({ id: "x", version, versionNonce }) as ExcalidrawElement;

  it("prefers the higher version", () => {
    expect(reconcile(el(1, 5), el(2, 9))).toMatchObject({ version: 2 });
    expect(reconcile(el(3, 5), el(2, 9))).toMatchObject({ version: 3 });
  });

  it("breaks version ties on the lower nonce, symmetrically", () => {
    expect(reconcile(el(2, 9), el(2, 4))).toMatchObject({ versionNonce: 4 });
    expect(reconcile(el(2, 4), el(2, 9))).toMatchObject({ versionNonce: 4 });
  });

  it("accepts anything when there is no local copy", () => {
    expect(reconcile(undefined, el(1, 1))).toMatchObject({ version: 1 });
  });
});

describe("http api", () => {
  it("serves the rendered scene", async () => {
    const scene = await get<{ elements: ExcalidrawElement[] }>(
      "/api/plans/rate-limiting/scene",
    );
    expect(scene.elements.length).toBeGreaterThan(100);
    expect(scene.elements.every((el) => el.customData?.gameplan)).toBe(true);
  });

  it("serves elements in the order Excalidraw will paint them", async () => {
    const scene = await get<{ elements: ExcalidrawElement[] }>(
      "/api/plans/rate-limiting/scene",
    );
    const indices = scene.elements.map((el) => el.index ?? "");
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i - 1]! <= indices[i]!).toBe(true);
    }

    // the invariant that actually matters: a frame must precede its children,
    // or it paints over the cards it contains
    const position = new Map(scene.elements.map((el, i) => [el.id, i]));
    for (const el of scene.elements) {
      if (!el.frameId) continue;
      expect(position.get(el.frameId)!).toBeLessThan(position.get(el.id)!);
    }
  });

  it("rejects an invalid spec with the failing paths", async () => {
    const res = await fetch(`${BASE}/api/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specYaml: "id: bad\ntitle: t\n" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: string[] };
    expect(body.issues.join(" ")).toMatch(/goal/);
  });
});

describe("realtime sync", () => {
  it("gives a joining client the whole scene", async () => {
    const client = await Client.join("rate-limiting", "Sam");
    expect(client.received.length).toBeGreaterThan(100);
    client.close();
  });

  it("relays one client's edits to another but not back to the author", async () => {
    const a = await Client.join("rate-limiting", "A");
    const b = await Client.join("rate-limiting", "B");

    const sticky = {
      id: "note-relay",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      version: 1,
      versionNonce: 11,
      isDeleted: false,
      backgroundColor: "#ffc9c9",
    } as unknown as ExcalidrawElement;

    const seenByB = b.next(
      (m) =>
        m.t === "elements" &&
        (m.elements as ExcalidrawElement[]).some((el) => el.id === "note-relay"),
    );
    const echoToA = a
      .next(
        (m) =>
          m.t === "elements" &&
          (m.elements as ExcalidrawElement[]).some((el) => el.id === "note-relay"),
        800,
      )
      .then(() => "echoed")
      .catch(() => "silent");

    a.send({ t: "elements", elements: [sticky] });

    await seenByB;
    expect(await echoToA).toBe("silent");

    a.close();
    b.close();
  });

  it("drops a stale edit and keeps the newer one", async () => {
    const a = await Client.join("rate-limiting", "A");
    const b = await Client.join("rate-limiting", "B");

    const make = (version: number, x: number) =>
      ({
        id: "note-lww",
        type: "rectangle",
        x,
        y: 0,
        width: 10,
        height: 10,
        version,
        versionNonce: 1,
        isDeleted: false,
      }) as unknown as ExcalidrawElement;

    const arrived = b.next(
      (m) =>
        m.t === "elements" &&
        (m.elements as ExcalidrawElement[]).some((el) => el.id === "note-lww" && el.version === 5),
    );
    a.send({ t: "elements", elements: [make(5, 500)] });
    await arrived;

    // an older version for the same element must not win
    const rejected = b
      .next(
        (m) =>
          m.t === "elements" &&
          (m.elements as ExcalidrawElement[]).some((el) => el.id === "note-lww" && el.version === 2),
        800,
      )
      .then(() => "relayed")
      .catch(() => "dropped");
    a.send({ t: "elements", elements: [make(2, 999)] });
    expect(await rejected).toBe("dropped");

    const scene = await get<{ elements: ExcalidrawElement[] }>(
      "/api/plans/rate-limiting/scene",
    );
    expect(scene.elements.find((el) => el.id === "note-lww")).toMatchObject({ x: 500 });

    a.close();
    b.close();
  });

  it("broadcasts peer presence and cursors", async () => {
    const a = await Client.join("rate-limiting", "Ana");
    const peersSeen = a.next((m) => m.t === "peers");
    const b = await Client.join("rate-limiting", "Bo");
    const message = await peersSeen;
    expect((message.peers as { name: string }[]).map((p) => p.name)).toContain("Bo");

    const cursor = a.next((m) => m.t === "pointer");
    b.send({ t: "pointer", x: 42, y: 24 });
    const pointer = await cursor;
    expect(pointer).toMatchObject({ name: "Bo", x: 42, y: 24 });

    a.close();
    b.close();
  });
});

describe("the review handoff", () => {
  it("resolves a waiting agent when a reviewer submits", async () => {
    const planId = "rate-limiting";
    const reviewer = await Client.join(planId, "Sam");

    // the waypoint dot for "rollout" — an ellipse, not a card
    const stepCard = (
      await get<{ elements: ExcalidrawElement[] }>(`/api/plans/${planId}/scene`)
    ).elements.find(
      (el) =>
        el.customData?.gameplan?.role === "step" &&
        el.customData.gameplan.nodeId === "rollout" &&
        el.type === "ellipse",
    )!;

    // the agent parks on the long-poll before any feedback exists
    const waiting = fetch(
      `${BASE}/api/plans/${planId}/wait?since=0&timeout=8000`,
    ).then((r) => r.json() as Promise<{ status: string; submission?: { report: FeedbackReport; by: string[] } }>);

    reviewer.send({
      t: "elements",
      elements: [
        {
          id: "note-reject",
          type: "rectangle",
          x: stepCard.x + 20,
          y: stepCard.y + 20,
          width: 120,
          height: 50,
          version: 1,
          versionNonce: 3,
          isDeleted: false,
          backgroundColor: "#ffc9c9",
          boundElements: [{ id: "note-reject-text", type: "text" }],
        },
        {
          id: "note-reject-text",
          type: "text",
          x: stepCard.x + 24,
          y: stepCard.y + 24,
          width: 110,
          height: 20,
          version: 1,
          versionNonce: 4,
          isDeleted: false,
          text: "ship this behind the flag from day one",
          originalText: "ship this behind the flag from day one",
          containerId: "note-reject",
          customData: {
            gameplanAnnotation: {
              v: 1,
              kind: "annotation",
              intent: "reject",
              author: "Sam",
              createdAt: Date.now(),
            },
          },
        },
      ] as unknown as ExcalidrawElement[],
    });

    reviewer.send({ t: "submit" });

    const result = await waiting;
    expect(result.status).toBe("submitted");
    expect(result.submission!.by).toContain("Sam");

    const report = result.submission!.report;
    expect(report.empty).toBe(false);
    const comment = report.comments.find((c) => c.text.includes("behind the flag"))!;
    expect(comment.intent).toBe("reject");
    expect(comment.author).toBe("Sam");
    expect(comment.anchor.nodeId).toBe("rollout");

    reviewer.close();
  });

  it("keeps human annotations when the agent re-renders a revision", async () => {
    const revised = SPEC.replace("revision: 1", "revision: 2");
    await post("/api/plans", { specYaml: revised });

    const scene = await get<{ elements: ExcalidrawElement[] }>(
      "/api/plans/rate-limiting/scene",
    );
    expect(scene.elements.find((el) => el.id === "note-reject")).toBeDefined();

    const generated = scene.elements.filter((el) => el.customData?.gameplan);
    expect(generated.every((el) => el.customData!.gameplan!.revision === 2)).toBe(true);
  });
});

describe("diagrams", () => {
  const DIAGRAM_YAML = `
id: test-graph
title: Test architecture
layout: graph
clusters:
  - id: svc
    label: auth-service
nodes:
  - id: client
    label: Client
  - id: api
    label: API
    icon: file
    color: blue
    cluster: svc
edges:
  - from: client
    to: api
`;

  it("renders, persists, and serves independently of the plan namespace", async () => {
    const created = await post<{ id: string; local: string }>("/api/diagrams", {
      specYaml: DIAGRAM_YAML,
    });
    expect(created.id).toBe("test-graph");
    expect(created.local).toContain("/d/test-graph");

    // same id namespace as a plan would use, but stored and served separately
    const scene = await get<{ elements: ExcalidrawElement[] }>(
      "/api/diagrams/test-graph/scene",
    );
    expect(scene.elements.length).toBeGreaterThan(5);
    expect(scene.elements.every((el) => el.customData?.gameplan?.planId === "test-graph")).toBe(
      true,
    );

    const planLookup = await fetch(`${BASE}/api/plans/test-graph/scene`);
    expect(planLookup.status).toBe(404);
  });

  it("collaborates over the same websocket protocol as plans, in its own room", async () => {
    const a = await Client.join("test-graph", "A", "diagram");
    const b = await Client.join("test-graph", "B", "diagram");
    expect(a.received.length).toBeGreaterThan(5);

    const node = a.received.find(
      (el) => el.customData?.gameplan?.role === "diagram-node" && el.type === "rectangle",
    )!;
    const seenByB = b.next(
      (m) =>
        m.t === "elements" &&
        (m.elements as ExcalidrawElement[]).some((el) => el.id === "diagram-note"),
    );
    a.send({
      t: "elements",
      elements: [
        {
          id: "diagram-note",
          type: "rectangle",
          x: node.x,
          y: node.y - 60,
          width: 100,
          height: 30,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          backgroundColor: "#b2f2bb",
        },
      ] as unknown as ExcalidrawElement[],
    });
    await seenByB;

    a.close();
    b.close();
  });

  it("resolves its own long-poll independently of plan submissions", async () => {
    const reviewer = await Client.join("test-graph", "Sam", "diagram");
    const waiting = fetch(
      `${BASE}/api/diagrams/test-graph/wait?since=0&timeout=8000`,
    ).then((r) => r.json() as Promise<{ status: string; submission?: { by: string[] } }>);

    reviewer.send({ t: "submit" });
    const result = await waiting;
    expect(result.status).toBe("submitted");
    expect(result.submission!.by).toContain("Sam");

    reviewer.close();
  });
});
