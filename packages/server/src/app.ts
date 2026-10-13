import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { SpecError } from "gameplan-core";
import { attachCollab, type CollabHub, type DocKind } from "./collab.js";
import { isHttps, isTrusted, ShareStore, shareCookie } from "./access.js";
import { diagramUrls, planUrls } from "./net.js";
import { DiagramStore, PlanStore, type DocStore } from "./store.js";

const require = createRequire(import.meta.url);

export interface ServerOptions {
  port: number;
  host: string;
  dataDir: string;
  /** built web client; when absent the API still works headlessly */
  webRoot?: string;
}

export interface RunningServer {
  fastify: FastifyInstance;
  store: PlanStore;
  diagrams: DiagramStore;
  hub: CollabHub;
  shares: ShareStore;
  port: number;
  close(): Promise<void>;
}

function defaultWebRoot(): string | undefined {
  // resolve through the package graph, same as the cli locating this
  // package's own entry point, so it works from a global install too —
  // a hardcoded relative path breaks the moment gameplan-web isn't hoisted
  // to the exact directory depth it assumes
  let webPkg: string;
  try {
    webPkg = require.resolve("gameplan-web/package.json");
  } catch {
    return undefined;
  }
  const root = join(dirname(webPkg), "dist");
  return existsSync(join(root, "index.html")) ? root : undefined;
}

/** Registers the same seven routes for either `/api/plans` or `/api/diagrams`. */
function registerDocRoutes(
  fastify: FastifyInstance,
  opts: {
    kind: DocKind;
    prefix: string;
    store: DocStore<unknown>;
    hub: CollabHub;
    shares: ShareStore;
    urls: (port: number, id: string, token: string) => { local: string; lan?: string };
    port: number;
    summarize: (id: string, doc: ReturnType<DocStore<unknown>["get"]>) => Record<string, unknown>;
  },
): void {
  const { kind, prefix, store, hub, shares, urls, port, summarize } = opts;
  // the LAN link needs the document's share token; the local one doesn't
  const linksFor = async (id: string) => urls(port, id, await shares.tokenFor(kind, id));

  fastify.get(prefix, async () => ({ [kind === "plan" ? "plans" : "diagrams"]: store.list() }));

  fastify.post<{ Body: { specYaml?: string } }>(prefix, async (request, reply) => {
    const specYaml = request.body?.specYaml;
    if (typeof specYaml !== "string" || specYaml.trim() === "") {
      return reply.code(400).send({ error: "specYaml is required" });
    }
    try {
      const doc = store.render(specYaml);
      const scene = store.scene(doc.id);
      hub.broadcastRerender(kind, doc.id, scene);
      return {
        id: doc.id,
        elements: doc.elements.size,
        ...(await linksFor(doc.id)),
        ...summarize(doc.id, doc),
      };
    } catch (err) {
      if (err instanceof SpecError) {
        return reply.code(422).send({ error: err.message, issues: err.issues });
      }
      throw err;
    }
  });

  fastify.get<{ Params: { id: string } }>(`${prefix}/:id`, async (request, reply) => {
    const doc = store.get(request.params.id);
    if (!doc) return reply.code(404).send({ error: `no such ${kind}` });
    return {
      id: doc.id,
      spec: doc.spec,
      updatedAt: doc.updatedAt,
      submissions: doc.submissions.length,
      ...(await linksFor(doc.id)),
      ...summarize(doc.id, doc),
    };
  });

  fastify.get<{ Params: { id: string } }>(`${prefix}/:id/scene`, async (request, reply) => {
    const scene = store.scene(request.params.id);
    if (!scene) return reply.code(404).send({ error: `no such ${kind}` });
    return scene;
  });

  fastify.get<{ Params: { id: string } }>(`${prefix}/:id/feedback`, async (request, reply) => {
    const report = store.feedback(request.params.id);
    if (!report) return reply.code(404).send({ error: `no such ${kind}` });
    const latest = store.latestSubmission(request.params.id);
    return { report, submittedAt: latest?.at ?? null, submittedBy: latest?.by ?? [] };
  });

  /**
   * Long-poll until a reviewer presses "Send to agent".
   *
   * The explicit handoff is what makes the loop workable: without it the agent
   * has to guess whether a quiet canvas means "still reading" or "done".
   */
  fastify.get<{ Params: { id: string }; Querystring: { since?: string; timeout?: string } }>(
    `${prefix}/:id/wait`,
    async (request, reply) => {
      const { id } = request.params;
      if (!store.get(id)) return reply.code(404).send({ error: `no such ${kind}` });

      const since = Number(request.query.since ?? 0);
      const timeoutMs = Math.min(Number(request.query.timeout ?? 300_000), 600_000);

      const existing = store.latestSubmission(id);
      if (existing && existing.at > since) {
        return { status: "submitted", submission: existing };
      }

      return new Promise((resolve) => {
        const finish = (value: unknown) => {
          clearTimeout(timer);
          unsubscribe();
          resolve(value);
        };
        const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
        const unsubscribe = hub.onSubmit((eventKind, eventId) => {
          if (eventKind !== kind || eventId !== id) return;
          const submission = store.latestSubmission(id);
          if (submission && submission.at > since) {
            finish({ status: "submitted", submission });
          }
        });
        request.raw.on("close", () => finish({ status: "aborted" }));
      });
    },
  );

  fastify.delete<{ Params: { id: string } }>(`${prefix}/:id`, async (request, reply) => {
    if (!store.delete(request.params.id)) {
      return reply.code(404).send({ error: `no such ${kind}` });
    }
    hub.disconnectShared(kind, request.params.id);
    await shares.remove(kind, request.params.id);
    return { deleted: request.params.id };
  });

  // share tokens — local-only, enforced by the access hook in startServer
  fastify.post<{ Params: { id: string } }>(`${prefix}/:id/share`, async (request, reply) => {
    if (!store.get(request.params.id)) return reply.code(404).send({ error: `no such ${kind}` });
    return { token: await shares.tokenFor(kind, request.params.id) };
  });

  /** Rotate the token: every link handed out so far stops working, and remote reviewers are dropped. */
  fastify.delete<{ Params: { id: string } }>(`${prefix}/:id/share`, async (request, reply) => {
    if (!store.get(request.params.id)) return reply.code(404).send({ error: `no such ${kind}` });
    const token = await shares.rotate(kind, request.params.id);
    hub.disconnectShared(kind, request.params.id);
    return { token };
  });
}

/** What a single document's share token may reach, beyond its page. */
const SHARED_API = /^\/api\/(plans|diagrams)\/([a-zA-Z0-9_-]+)(\/(scene|feedback|wait))?$/;
const DOC_PAGE = /^\/(p|d)\/([a-zA-Z0-9_-]+)\/?$/;

const NEEDS_TOKEN_PAGE = `<!doctype html><meta charset="utf-8"><title>gameplan</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1e1e1e">
<h1 style="font-size:1.25rem">This link needs a share token</h1>
<p>Ask whoever shared this canvas for its full link. Share links end in <code>?token=…</code>.</p>
</body>`;

/**
 * The access gate. Local callers (the CLI, the agent, the author's browser)
 * pass straight through. A remote caller gets static assets — the app shell
 * holds no data — plus exactly the one document its token was minted for.
 */
function registerAccessGate(fastify: FastifyInstance, shares: ShareStore): void {
  fastify.addHook("onRequest", async (request, reply) => {
    if (isTrusted(request.raw)) return;

    const url = new URL(request.url, "http://gameplan.invalid");
    const path = url.pathname;
    const queryToken = url.searchParams.get("token") ?? undefined;

    const page = path.match(DOC_PAGE);
    if (page) {
      const kind: DocKind = page[1] === "p" ? "plan" : "diagram";
      const id = page[2]!;
      if (!shares.allows(request.raw, kind, id, queryToken)) {
        return reply.code(401).type("text/html; charset=utf-8").send(NEEDS_TOKEN_PAGE);
      }
      if (queryToken) {
        // swap the token for a cookie and drop it from the address bar, so it
        // isn't left in history or passed on when someone copies the URL
        url.searchParams.delete("token");
        return reply
          .code(302)
          .header("set-cookie", shareCookie(kind, id, queryToken, isHttps(request.raw)))
          .header("cache-control", "no-store")
          .header("referrer-policy", "no-referrer")
          .header("location", `${url.pathname}${url.search}`)
          .send();
      }
      return;
    }

    const api = path.match(SHARED_API);
    if (api && request.method === "GET") {
      const kind: DocKind = api[1] === "plans" ? "plan" : "diagram";
      if (shares.allows(request.raw, kind, api[2]!, queryToken)) return;
      return reply.code(401).send({ error: "a share token for this document is required" });
    }

    // everything else under /api — listing, creating, deleting, minting
    // tokens — and server status are for this machine only
    if (path.startsWith("/api/") || path === "/health") {
      return reply.code(403).send({ error: "only available from the machine running gameplan" });
    }
    // static assets and the websocket upgrade (checked per document on join) fall through
  });
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const store = new PlanStore(options.dataDir);
  const diagrams = new DiagramStore(join(options.dataDir, "diagrams"));
  await Promise.all([store.init(), diagrams.init()]);

  const shares = new ShareStore(join(options.dataDir, "shares.json"));
  await shares.init();

  const fastify = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const hub = attachCollab(
    fastify.server,
    {
      plan: store as unknown as DocStore<unknown>,
      diagram: diagrams as unknown as DocStore<unknown>,
    },
    {
      allows: (req, kind, id) => shares.allows(req, kind, id),
      isTrusted,
    },
  );
  registerAccessGate(fastify, shares);

  fastify.get("/health", async () => ({
    ok: true,
    plans: store.list().length,
    diagrams: diagrams.list().length,
    pid: process.pid,
  }));

  registerDocRoutes(fastify, {
    kind: "plan",
    prefix: "/api/plans",
    store: store as unknown as DocStore<unknown>,
    hub,
    shares,
    urls: planUrls,
    port: options.port,
    summarize: (id, doc) => {
      const spec = (doc as { spec: { title: string; revision: number } } | undefined)?.spec;
      return { title: spec?.title, revision: spec?.revision };
    },
  });

  registerDocRoutes(fastify, {
    kind: "diagram",
    prefix: "/api/diagrams",
    store: diagrams as unknown as DocStore<unknown>,
    hub,
    shares,
    urls: diagramUrls,
    port: options.port,
    summarize: (id, doc) => {
      const spec = (
        doc as { spec: { title: string; revision: number; layout?: string; panels?: unknown[] } } | undefined
      )?.spec;
      // a multi-panel diagram has no single layout of its own
      return {
        title: spec?.title,
        revision: spec?.revision,
        layout: spec?.panels ? "panels" : spec?.layout,
      };
    },
  });

  const webRoot = options.webRoot ?? defaultWebRoot();
  if (webRoot) {
    await fastify.register(fastifyStatic, { root: webRoot });
    // SPA fallback so /p/<id> and /d/<id> deep links work on a hard refresh
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await fastify.listen({ port: options.port, host: options.host });

  return {
    fastify,
    store,
    diagrams,
    hub,
    shares,
    port: options.port,
    async close() {
      hub.close();
      await Promise.all([store.flush(), diagrams.flush()]);
      await fastify.close();
    },
  };
}
