#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseDiagramYaml, parseSpecYaml, SpecError, type FeedbackReport } from "gameplan-core";
import { api, DATA_DIR, DEFAULT_PORT, ensureServer, health, stopServer } from "./daemon.js";
import { formatReport } from "./report.js";
import { cloudflaredAvailable, ensureTunnel, stopTunnel, tunnelStatus } from "./tunnel.js";

type DocKind = "plan" | "diagram";

interface Flags {
  port: number;
  open: boolean;
  json: boolean;
  timeout: number;
  tunnel: boolean;
  positional: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    port: DEFAULT_PORT,
    open: false,
    json: false,
    timeout: 1800,
    tunnel: false,
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--open":
        flags.open = true;
        break;
      case "--json":
        flags.json = true;
        break;
      case "--tunnel":
        flags.tunnel = true;
        break;
      case "--port":
        flags.port = Number(argv[++i]);
        break;
      case "--timeout":
        flags.timeout = Number(argv[++i]);
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
        flags.positional.push(arg);
    }
  }
  return flags;
}

const USAGE = `gameplan — review agent plans and diagrams on a live Excalidraw canvas

  gameplan render <spec.yaml> [--open] [--tunnel]   render a plan, print its URLs
  gameplan draw <diagram.yaml> [--open] [--tunnel]  draw a diagram, own URL
  gameplan wait <id> [--timeout s]         block until reviewers send feedback
  gameplan feedback <id> [--json]          read the current canvas as feedback
  gameplan list                            list plans and diagrams on the server
  gameplan open <id> [--tunnel]            open the canvas in a browser
  gameplan tunnel <id>                     share one canvas publicly
  gameplan tunnel stop                     tear down the public tunnel
  gameplan revoke <id>                     invalidate a canvas's share links
  gameplan status                          is the server (and tunnel) up?
  gameplan stop                            stop the server and any tunnel

  wait / feedback / open take either a plan id or a diagram id — the server
  is checked to see which one it is, so you don't need to say which.

  Share links (LAN and tunnel) carry a per-canvas token: anyone with the
  link can view and edit that one canvas, and nothing else on the server.
  Only this machine can reach a canvas without one. \`gameplan revoke <id>\`
  rotates the token, so every link handed out so far stops working.

  --tunnel shares the canvas beyond your LAN via a Cloudflare quick tunnel
  (a random *.trycloudflare.com URL). Requires \`cloudflared\` on PATH. Run
  \`gameplan tunnel stop\` when you're done sharing; it does not close itself.

  --port <n>     server port (default ${DEFAULT_PORT}, or $GAMEPLAN_PORT)
  data directory: ${DATA_DIR} (or $GAMEPLAN_DATA)
`;

function apiPrefix(kind: DocKind): string {
  return kind === "plan" ? "/api/plans" : "/api/diagrams";
}

/** wait/feedback/open accept either kind of id; the plan namespace is tried first. */
async function resolveKind(port: number, id: string): Promise<DocKind> {
  try {
    await api(port, `/api/plans/${id}`);
    return "plan";
  } catch {
    return "diagram";
  }
}

function docPath(kind: DocKind, id: string): string {
  return kind === "plan" ? `/p/${id}` : `/d/${id}`;
}

/** Ensures a tunnel is up and prints the warning + public URL for one document. */
async function printTunnel(port: number, kind: DocKind, id: string): Promise<void> {
  if (!cloudflaredAvailable()) {
    console.error(
      "  --tunnel requires `cloudflared` on PATH — see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
    return;
  }
  console.log("  starting tunnel (cloudflared)...");
  const base = await ensureTunnel(port);
  const token = await shareToken(port, kind, id);
  console.log(`  public:   ${base}${docPath(kind, id)}?token=${token}`);
  console.log(`            anyone with this link can edit this canvas — \`gameplan revoke ${id}\` to cut it off`);
}

/** The canvas's share token, minted on first use. Only answered for local callers. */
async function shareToken(port: number, kind: DocKind, id: string): Promise<string> {
  const { token } = await api<{ token: string }>(port, `${apiPrefix(kind)}/${id}/share`, {
    method: "POST",
    body: "{}",
  });
  return token;
}

function openBrowser(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // headless box: the printed URL is the fallback
  }
}

interface CreateResult {
  id: string;
  title?: string;
  revision?: number;
  layout?: string;
  elements: number;
  local: string;
  lan?: string;
}

async function create(flags: Flags, kind: DocKind): Promise<number> {
  const file = flags.positional[0];
  const verb = kind === "plan" ? "render" : "draw";
  const noun = kind === "plan" ? "spec.yaml" : "diagram.yaml";
  if (!file) {
    console.error(`usage: gameplan ${verb} <${noun}> [--open]`);
    return 2;
  }
  const specYaml = await readFile(resolve(file), "utf8");

  // fail fast and locally, so a typo doesn't need a server round-trip
  try {
    if (kind === "plan") parseSpecYaml(specYaml);
    else parseDiagramYaml(specYaml);
  } catch (err) {
    if (err instanceof SpecError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  const port = await ensureServer(flags.port);
  const result = await api<CreateResult>(port, apiPrefix(kind), {
    method: "POST",
    body: JSON.stringify({ specYaml }),
  });

  const headline =
    kind === "plan"
      ? `${result.title}  (rev ${result.revision}, ${result.elements} elements)`
      : `${result.title}  [${result.layout}]  (rev ${result.revision}, ${result.elements} elements)`;
  console.log(headline);
  console.log("");
  console.log(`  you:      ${result.local}`);
  if (result.lan) console.log(`  your team: ${result.lan}`);
  if (flags.tunnel) await printTunnel(port, kind, result.id);
  if (kind === "plan") {
    console.log("");
    console.log(`Waiting on review? \`gameplan wait ${result.id}\``);
  }

  if (flags.open) openBrowser(result.local);
  return 0;
}

async function cmdRender(flags: Flags): Promise<number> {
  return create(flags, "plan");
}

async function cmdDraw(flags: Flags): Promise<number> {
  return create(flags, "diagram");
}

async function cmdWait(flags: Flags): Promise<number> {
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan wait <id> [--timeout seconds]");
    return 2;
  }
  const port = await ensureServer(flags.port);
  const prefix = apiPrefix(await resolveKind(port, id));

  const deadline = Date.now() + flags.timeout * 1000;
  let since = 0;
  const existing = await api<{ submittedAt: number | null }>(port, `${prefix}/${id}/feedback`);
  since = existing.submittedAt ?? 0;

  while (Date.now() < deadline) {
    const remaining = Math.max(1000, Math.min(deadline - Date.now(), 120_000));
    const result = await api<{
      status: string;
      submission?: { at: number; by: string[]; report: FeedbackReport };
    }>(port, `${prefix}/${id}/wait?since=${since}&timeout=${remaining}`, {
      timeoutMs: remaining + 10_000,
    });

    if (result.status === "submitted" && result.submission) {
      console.log(
        formatReport(result.submission.report, {
          submittedAt: result.submission.at,
          submittedBy: result.submission.by,
        }),
      );
      return 0;
    }
  }

  console.error(`timed out after ${flags.timeout}s with no feedback submitted`);
  return 3;
}

async function cmdFeedback(flags: Flags): Promise<number> {
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan feedback <id> [--json]");
    return 2;
  }
  const port = await ensureServer(flags.port);
  const prefix = apiPrefix(await resolveKind(port, id));
  const result = await api<{
    report: FeedbackReport;
    submittedAt: number | null;
    submittedBy: string[];
  }>(port, `${prefix}/${id}/feedback`);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      formatReport(result.report, {
        submittedAt: result.submittedAt,
        submittedBy: result.submittedBy,
      }),
    );
  }
  return 0;
}

async function cmdList(flags: Flags): Promise<number> {
  const port = await ensureServer(flags.port);
  const [{ plans }, { diagrams }] = await Promise.all([
    api<{ plans: { id: string; title: string; revision: number; updatedAt: number }[] }>(
      port,
      "/api/plans",
    ),
    api<{ diagrams: { id: string; title: string; revision: number; updatedAt: number }[] }>(
      port,
      "/api/diagrams",
    ),
  ]);
  if (plans.length === 0 && diagrams.length === 0) {
    console.log("nothing yet — `gameplan render <spec.yaml>` or `gameplan draw <diagram.yaml>`");
    return 0;
  }
  for (const plan of plans) {
    console.log(`plan     ${plan.id.padEnd(22)} rev ${String(plan.revision).padEnd(4)} ${plan.title}`);
  }
  for (const diagram of diagrams) {
    console.log(
      `diagram  ${diagram.id.padEnd(22)} rev ${String(diagram.revision).padEnd(4)} ${diagram.title}`,
    );
  }
  return 0;
}

async function cmdOpen(flags: Flags): Promise<number> {
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan open <id> [--tunnel]");
    return 2;
  }
  const port = await ensureServer(flags.port);
  const kind = await resolveKind(port, id);
  const doc = await api<{ local: string; lan?: string }>(port, `${apiPrefix(kind)}/${id}`);
  console.log(doc.local);
  if (doc.lan) console.log(doc.lan);
  if (flags.tunnel) await printTunnel(port, kind, id);
  openBrowser(doc.local);
  return 0;
}

async function cmdTunnel(flags: Flags): Promise<number> {
  if (flags.positional[0] === "stop") {
    const stopped = await stopTunnel();
    console.log(stopped ? "tunnel stopped" : "no tunnel to stop");
    return stopped ? 0 : 1;
  }

  // a bare server URL is no use to anyone now: every canvas needs its own
  // token, so sharing is always per canvas
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan tunnel <id>   (or `gameplan tunnel stop`)");
    return 2;
  }
  const port = await ensureServer(flags.port);

  if (!cloudflaredAvailable()) {
    console.error(
      "cloudflared is not installed — see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
    return 1;
  }

  const kind = await resolveKind(port, id);
  console.log("starting tunnel (cloudflared)...");
  const base = await ensureTunnel(port);
  const token = await shareToken(port, kind, id);
  console.log(`public: ${base}${docPath(kind, id)}?token=${token}`);
  console.log(`anyone with this link can edit this canvas, and only this one — \`gameplan revoke ${id}\` to cut it off`);
  console.log("`gameplan tunnel stop` when you're done sharing");
  return 0;
}

async function cmdRevoke(flags: Flags): Promise<number> {
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan revoke <id>");
    return 2;
  }
  const port = await ensureServer(flags.port);
  const kind = await resolveKind(port, id);
  const { token } = await api<{ token: string }>(port, `${apiPrefix(kind)}/${id}/share`, {
    method: "DELETE",
    body: "{}",
  });
  console.log(`revoked every share link for ${kind} "${id}" — remote reviewers were disconnected`);
  const doc = await api<{ lan?: string }>(port, `${apiPrefix(kind)}/${id}`);
  if (doc.lan) console.log(`new team link: ${doc.lan}`);
  const tunnel = await tunnelStatus();
  if (tunnel) console.log(`new public link: ${tunnel.url}${docPath(kind, id)}?token=${token}`);
  return 0;
}

async function cmdStatus(flags: Flags): Promise<number> {
  const status = await health(flags.port);
  const tunnel = await tunnelStatus();
  if (!status) {
    console.log(`server not running on port ${flags.port}`);
    return 1;
  }
  console.log(
    `server up on port ${flags.port} (pid ${status.pid}, ${status.plans} plan(s), ${status.diagrams ?? 0} diagram(s))`,
  );
  console.log(tunnel ? `tunnel up: ${tunnel.url}` : "tunnel: not running");
  return 0;
}

async function cmdStop(flags: Flags): Promise<number> {
  // stop everything, including anything shared publicly — leaving a tunnel
  // up after "stopping gameplan" would be a quiet way to keep it exposed
  const tunnelStopped = await stopTunnel();
  if (tunnelStopped) console.log("tunnel stopped");
  const stopped = await stopServer(flags.port);
  console.log(stopped ? "server stopped" : "no server to stop");
  return stopped ? 0 : 1;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  const flags = parseArgs(rest);
  switch (command) {
    case "render":
      return cmdRender(flags);
    case "draw":
      return cmdDraw(flags);
    case "wait":
      return cmdWait(flags);
    case "feedback":
      return cmdFeedback(flags);
    case "list":
      return cmdList(flags);
    case "open":
      return cmdOpen(flags);
    case "tunnel":
      return cmdTunnel(flags);
    case "revoke":
      return cmdRevoke(flags);
    case "status":
      return cmdStatus(flags);
    case "stop":
      return cmdStop(flags);
    default:
      console.error(`unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
