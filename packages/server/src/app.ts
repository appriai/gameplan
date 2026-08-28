import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { SpecError } from "gameplan-core";
import { attachCollab, type CollabHub, type DocKind } from "./collab.js";
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
    urls: (port: number, id: string) => { local: string; lan?: string };
    port: number;
    summarize: (id: string, doc: ReturnType<DocStore<unknown>["get"]>) => Record<string, unknown>;
  },
): void {
  const { kind, prefix, store, hub, urls, port, summarize } = opts;

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
      return { id: doc.id, elements: doc.elements.size, ...urls(port, doc.id), ...summarize(doc.id, doc) };
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
      ...urls(port, doc.id),
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
    return { deleted: request.params.id };
  });
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const store = new PlanStore(options.dataDir);
  const diagrams = new DiagramStore(join(options.dataDir, "diagrams"));
  await Promise.all([store.init(), diagrams.init()]);

  const fastify = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const hub = attachCollab(fastify.server, {
    plan: store as unknown as DocStore<unknown>,
    diagram: diagrams as unknown as DocStore<unknown>,
  });

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
    urls: diagramUrls,
    port: options.port,
    summarize: (id, doc) => {
      const spec = (doc as { spec: { title: string; revision: number; layout: string } } | undefined)
        ?.spec;
      return { title: spec?.title, revision: spec?.revision, layout: spec?.layout };
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
    port: options.port,
    async close() {
      hub.close();
      await Promise.all([store.flush(), diagrams.flush()]);
      await fastify.close();
    },
  };
}
