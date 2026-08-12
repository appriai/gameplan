#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseSpecYaml, SpecError, type FeedbackReport } from "@gameplan/core";
import { api, DATA_DIR, DEFAULT_PORT, ensureServer, health, stopServer } from "./daemon.js";
import { formatReport } from "./report.js";

interface Flags {
  port: number;
  open: boolean;
  json: boolean;
  timeout: number;
  positional: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    port: DEFAULT_PORT,
    open: false,
    json: false,
    timeout: 1800,
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

const USAGE = `gameplan — review agent plans on a live Excalidraw canvas

  gameplan render <spec.yaml> [--open]   render a plan and print its URLs
  gameplan wait <plan-id> [--timeout s]  block until reviewers send feedback
  gameplan feedback <plan-id> [--json]   read the current canvas as feedback
  gameplan list                          list plans on the server
  gameplan open <plan-id>                open the canvas in a browser
  gameplan status                        is the server up?
  gameplan stop                          stop the server

  --port <n>     server port (default ${DEFAULT_PORT}, or $GAMEPLAN_PORT)
  data directory: ${DATA_DIR} (or $GAMEPLAN_DATA)
`;

function openBrowser(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // headless box: the printed URL is the fallback
  }
}

async function cmdRender(flags: Flags): Promise<number> {
  const file = flags.positional[0];
  if (!file) {
    console.error("usage: gameplan render <spec.yaml> [--open]");
    return 2;
  }
  const specYaml = await readFile(resolve(file), "utf8");

  // fail fast and locally, so a typo doesn't need a server round-trip
  try {
    parseSpecYaml(specYaml);
  } catch (err) {
    if (err instanceof SpecError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  const port = await ensureServer(flags.port);
  const result = await api<{
    id: string;
    title: string;
    revision: number;
    elements: number;
    local: string;
    lan?: string;
  }>(port, "/api/plans", { method: "POST", body: JSON.stringify({ specYaml }) });

  console.log(`${result.title}  (rev ${result.revision}, ${result.elements} elements)`);
  console.log("");
  console.log(`  you:      ${result.local}`);
  if (result.lan) console.log(`  your team: ${result.lan}`);
  console.log("");
  console.log(`Waiting on review? \`gameplan wait ${result.id}\``);

  if (flags.open) openBrowser(result.local);
  return 0;
}

async function cmdWait(flags: Flags): Promise<number> {
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan wait <plan-id> [--timeout seconds]");
    return 2;
  }
  const port = await ensureServer(flags.port);

  const deadline = Date.now() + flags.timeout * 1000;
  let since = 0;
  const existing = await api<{ submittedAt: number | null }>(
    port,
    `/api/plans/${id}/feedback`,
  );
  since = existing.submittedAt ?? 0;

  while (Date.now() < deadline) {
    const remaining = Math.max(1000, Math.min(deadline - Date.now(), 120_000));
    const result = await api<{
      status: string;
      submission?: { at: number; by: string[]; report: FeedbackReport };
    }>(port, `/api/plans/${id}/wait?since=${since}&timeout=${remaining}`, {
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
    console.error("usage: gameplan feedback <plan-id> [--json]");
    return 2;
  }
  const port = await ensureServer(flags.port);
  const result = await api<{
    report: FeedbackReport;
    submittedAt: number | null;
    submittedBy: string[];
  }>(port, `/api/plans/${id}/feedback`);

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
  const { plans } = await api<{
    plans: { id: string; title: string; revision: number; updatedAt: number }[];
  }>(port, "/api/plans");
  if (plans.length === 0) {
    console.log("no plans yet — `gameplan render <spec.yaml>`");
    return 0;
  }
  for (const plan of plans) {
    console.log(
      `${plan.id.padEnd(24)} rev ${String(plan.revision).padEnd(4)} ${plan.title}`,
    );
  }
  return 0;
}

async function cmdOpen(flags: Flags): Promise<number> {
  const id = flags.positional[0];
  if (!id) {
    console.error("usage: gameplan open <plan-id>");
    return 2;
  }
  const port = await ensureServer(flags.port);
  const plan = await api<{ local: string; lan?: string }>(port, `/api/plans/${id}`);
  console.log(plan.local);
  if (plan.lan) console.log(plan.lan);
  openBrowser(plan.local);
  return 0;
}

async function cmdStatus(flags: Flags): Promise<number> {
  const status = await health(flags.port);
  if (!status) {
    console.log(`server not running on port ${flags.port}`);
    return 1;
  }
  console.log(`server up on port ${flags.port} (pid ${status.pid}, ${status.plans} plan(s))`);
  return 0;
}

async function cmdStop(flags: Flags): Promise<number> {
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
    case "wait":
      return cmdWait(flags);
    case "feedback":
      return cmdFeedback(flags);
    case "list":
      return cmdList(flags);
    case "open":
      return cmdOpen(flags);
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
