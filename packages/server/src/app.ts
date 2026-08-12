import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { SpecError } from "@gameplan/core";
import { attachCollab, type CollabHub } from "./collab.js";
import { planUrls } from "./net.js";
import { PlanStore } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));

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
  hub: CollabHub;
  port: number;
  close(): Promise<void>;
}

function defaultWebRoot(): string | undefined {
  const candidates = [
    join(here, "../../web/dist"),
    join(here, "../../../web/dist"),
  ];
  return candidates.find((p) => existsSync(join(p, "index.html")));
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const store = new PlanStore(options.dataDir);
  await store.init();

  const fastify = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const hub = attachCollab(fastify.server, store);

  fastify.get("/health", async () => ({
    ok: true,
    plans: store.list().length,
    pid: process.pid,
  }));

  fastify.get("/api/plans", async () => ({ plans: store.list() }));

  fastify.post<{ Body: { specYaml?: string } }>("/api/plans", async (request, reply) => {
    const specYaml = request.body?.specYaml;
    if (typeof specYaml !== "string" || specYaml.trim() === "") {
      return reply.code(400).send({ error: "specYaml is required" });
    }
    try {
      const plan = store.render(specYaml);
      const urls = planUrls(options.port, plan.id);
      // push the new revision to anyone already looking at the canvas
      const scene = store.scene(plan.id);
      for (const client of hub.wss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ t: "rerender", planId: plan.id, scene }));
        }
      }
      return {
        id: plan.id,
        title: plan.spec.title,
        revision: plan.spec.revision,
        elements: plan.elements.size,
        ...urls,
      };
    } catch (err) {
      if (err instanceof SpecError) {
        return reply.code(422).send({ error: err.message, issues: err.issues });
      }
      throw err;
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/plans/:id", async (request, reply) => {
    const plan = store.get(request.params.id);
    if (!plan) return reply.code(404).send({ error: "no such plan" });
    return {
      id: plan.id,
      spec: plan.spec,
      revision: plan.spec.revision,
      updatedAt: plan.updatedAt,
      submissions: plan.submissions.length,
      ...planUrls(options.port, plan.id),
    };
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/plans/:id/scene",
    async (request, reply) => {
      const scene = store.scene(request.params.id);
      if (!scene) return reply.code(404).send({ error: "no such plan" });
      return scene;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/plans/:id/feedback",
    async (request, reply) => {
      const report = store.feedback(request.params.id);
      if (!report) return reply.code(404).send({ error: "no such plan" });
      const latest = store.latestSubmission(request.params.id);
      return { report, submittedAt: latest?.at ?? null, submittedBy: latest?.by ?? [] };
    },
  );

  /**
   * Long-poll until a reviewer presses "Send to agent".
   *
   * The explicit handoff is what makes the loop workable: without it the agent
   * has to guess whether a quiet canvas means "still reading" or "done".
   */
  fastify.get<{ Params: { id: string }; Querystring: { since?: string; timeout?: string } }>(
    "/api/plans/:id/wait",
    async (request, reply) => {
      const { id } = request.params;
      if (!store.get(id)) return reply.code(404).send({ error: "no such plan" });

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
        const unsubscribe = hub.onSubmit((planId) => {
          if (planId !== id) return;
          const submission = store.latestSubmission(id);
          if (submission && submission.at > since) {
            finish({ status: "submitted", submission });
          }
        });
        request.raw.on("close", () => finish({ status: "aborted" }));
      });
    },
  );

  fastify.delete<{ Params: { id: string } }>("/api/plans/:id", async (request, reply) => {
    if (!store.delete(request.params.id)) {
      return reply.code(404).send({ error: "no such plan" });
    }
    return { deleted: request.params.id };
  });

  const webRoot = options.webRoot ?? defaultWebRoot();
  if (webRoot) {
    await fastify.register(fastifyStatic, { root: webRoot });
    // SPA fallback so /p/<id> deep links work on a hard refresh
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
    hub,
    port: options.port,
    async close() {
      hub.close();
      await store.flush();
      await fastify.close();
    },
  };
}
