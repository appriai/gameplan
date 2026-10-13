import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer, type RunningServer } from "./app.js";

const PORT = 39_412;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * What a request through the Cloudflare tunnel looks like to the server: it
 * arrives from localhost (cloudflared runs here) but carries the headers
 * Cloudflare's edge adds. That's the case these tests are about; a LAN
 * caller is untrusted for the same reason, just without the headers.
 */
const TUNNELLED = { "cf-connecting-ip": "203.0.113.7", "cf-ray": "abc123-LHR" };

const DIAGRAM = (id: string) => `
id: ${id}
title: ${id}
layout: graph
nodes:
  - { id: a, label: A }
  - { id: b, label: B }
edges:
  - { from: a, to: b }
`;

let server: RunningServer;
let dataDir: string;

async function local<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return (await res.json()) as T;
}

function remote(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { ...TUNNELLED, ...headers }, redirect: "manual" });
}

async function tokenFor(id: string): Promise<string> {
  return (await local<{ token: string }>(`/api/diagrams/${id}/share`, { method: "POST", body: "{}" })).token;
}

/** Open a socket as a remote browser would, and report what joining `id` gets back. */
function joinRemotely(
  id: string,
  headers: Record<string, string>,
): Promise<{ first: Record<string, unknown> | null; socket: WebSocket }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { ...TUNNELLED, ...headers } });
    socket.once("message", (raw) => resolve({ first: JSON.parse(raw.toString()), socket }));
    socket.once("close", () => resolve({ first: null, socket }));
    socket.once("open", () => socket.send(JSON.stringify({ t: "join", kind: "diagram", id, name: "Remote" })));
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "gameplan-access-"));
  server = await startServer({ port: PORT, host: "127.0.0.1", dataDir });
  await local("/api/diagrams", { method: "POST", body: JSON.stringify({ specYaml: DIAGRAM("shared") }) });
  await local("/api/diagrams", { method: "POST", body: JSON.stringify({ specYaml: DIAGRAM("private") }) });
});

afterAll(async () => {
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("local callers", () => {
  it("need no token", async () => {
    const res = await fetch(`${BASE}/api/diagrams/shared/scene`);
    expect(res.status).toBe(200);
  });

  it("get a LAN link that carries the canvas's token", async () => {
    const doc = await local<{ lan?: string }>("/api/diagrams/shared");
    // a CI box may have no LAN interface at all; when it does, the link must be tokenised
    if (doc.lan) expect(doc.lan).toContain(`?token=${await tokenFor("shared")}`);
  });
});

describe("remote callers", () => {
  it("are refused a canvas without its token", async () => {
    expect((await remote("/api/diagrams/shared/scene")).status).toBe(401);
    expect((await remote("/d/shared")).status).toBe(401);
  });

  it("can never list, create, delete or mint tokens", async () => {
    const token = await tokenFor("shared");
    const auth = { authorization: `Bearer ${token}` };
    expect((await remote("/api/diagrams", auth)).status).toBe(403);
    expect((await remote("/health", auth)).status).toBe(403);
    for (const [method, path] of [
      ["POST", "/api/diagrams"],
      ["DELETE", "/api/diagrams/shared"],
      ["POST", "/api/diagrams/shared/share"],
      ["DELETE", "/api/diagrams/shared/share"],
    ] as const) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { ...TUNNELLED, ...auth, "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("trade a link's token for a cookie and land on the clean URL", async () => {
    const token = await tokenFor("shared");
    const res = await remote(`/d/shared?token=${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/d/shared");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("gp_d_shared=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const pair = cookie.split(";")[0]!;
    expect((await remote("/api/diagrams/shared/scene", { cookie: pair })).status).toBe(200);
  });

  it("marks the cookie Secure when the request came in over https", async () => {
    const token = await tokenFor("shared");
    const res = await remote(`/d/shared?token=${token}`, { "cf-visitor": '{"scheme":"https"}' });
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("can't use one canvas's token on another", async () => {
    const token = await tokenFor("shared");
    expect((await remote(`/d/private?token=${token}`)).status).toBe(401);
    expect((await remote("/api/diagrams/private/scene", { authorization: `Bearer ${token}` })).status).toBe(
      401,
    );
    expect((await remote("/api/diagrams/private/scene", { cookie: `gp_d_private=${token}` })).status).toBe(401);
  });

  it("are refused a wrong token", async () => {
    expect((await remote("/api/diagrams/shared/scene", { authorization: "Bearer nope" })).status).toBe(401);
  });

  it("join the canvas's websocket room with the cookie, and only that room", async () => {
    const token = await tokenFor("shared");
    const cookie = `gp_d_shared=${token}`;

    const joined = await joinRemotely("shared", { cookie });
    expect(joined.first?.t).toBe("init");
    joined.socket.close();

    const other = await joinRemotely("private", { cookie });
    expect(other.first?.t).toBe("error");

    const none = await joinRemotely("shared", {});
    expect(none.first?.t).toBe("error");
  });

  it("can't be ridden from another site's page", async () => {
    const token = await tokenFor("shared");
    const attempt = await joinRemotely("shared", {
      cookie: `gp_d_shared=${token}`,
      origin: "https://evil.example",
    });
    expect(attempt.first).toBeNull();
  });
});

describe("hostile pages in the author's own browser", () => {
  it("can't reach the server by rebinding their own domain to localhost", async () => {
    // loopback address, no proxy headers — but the Host is the attacker's
    // domain. node:http, because fetch quietly replaces a custom Host header.
    const status = await new Promise<number>((resolve, reject) => {
      request(
        { host: "127.0.0.1", port: PORT, path: "/api/diagrams", headers: { host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on("error", reject)
        .end();
    });
    expect(status).toBe(403);
  });

  it("can't open a websocket to the local server from another origin", async () => {
    const result = await new Promise<Record<string, unknown> | null>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: "https://evil.example" } });
      socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
      socket.once("close", () => resolve(null));
      socket.once("open", () =>
        socket.send(JSON.stringify({ t: "join", kind: "diagram", id: "private", name: "x" })),
      );
    });
    expect(result).toBeNull();
  });

  it("still let the author's own tab in", async () => {
    const result = await new Promise<Record<string, unknown> | null>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: `http://127.0.0.1:${PORT}` } });
      socket.once("message", (raw) => {
        resolve(JSON.parse(raw.toString()));
        socket.close();
      });
      socket.once("open", () =>
        socket.send(JSON.stringify({ t: "join", kind: "diagram", id: "private", name: "me" })),
      );
    });
    expect(result?.t).toBe("init");
  });
});

describe("revoking", () => {
  it("kills old links and drops remote reviewers already on the canvas", async () => {
    const old = await tokenFor("shared");
    const joined = await joinRemotely("shared", { cookie: `gp_d_shared=${old}` });
    expect(joined.first?.t).toBe("init");
    const dropped = new Promise<number>((resolve) => joined.socket.once("close", (code) => resolve(code)));

    const { token: fresh } = await local<{ token: string }>("/api/diagrams/shared/share", {
      method: "DELETE",
      body: "{}",
    });
    expect(fresh).not.toBe(old);
    expect(await dropped).toBe(1008);

    expect((await remote("/api/diagrams/shared/scene", { authorization: `Bearer ${old}` })).status).toBe(401);
    expect((await remote("/api/diagrams/shared/scene", { authorization: `Bearer ${fresh}` })).status).toBe(200);
  });

  it("keeps tokens across a restart, in a file only the owner can read", async () => {
    const token = await tokenFor("shared");
    const mode = (await stat(join(dataDir, "shares.json"))).mode & 0o777;
    expect(mode).toBe(0o600);

    await server.close();
    server = await startServer({ port: PORT, host: "127.0.0.1", dataDir });
    expect((await remote("/api/diagrams/shared/scene", { authorization: `Bearer ${token}` })).status).toBe(200);
  });
});
