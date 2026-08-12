import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

export const DEFAULT_PORT = Number(process.env.GAMEPLAN_PORT ?? 3939);
export const DATA_DIR = resolve(process.env.GAMEPLAN_DATA ?? ".gameplan");
const RUNTIME_FILE = join(DATA_DIR, "server.json");

interface Runtime {
  pid: number;
  port: number;
  startedAt: number;
}

export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function readRuntime(): Promise<Runtime | undefined> {
  if (!existsSync(RUNTIME_FILE)) return undefined;
  try {
    return JSON.parse(await readFile(RUNTIME_FILE, "utf8")) as Runtime;
  } catch {
    return undefined;
  }
}

async function writeRuntime(runtime: Runtime): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RUNTIME_FILE, JSON.stringify(runtime, null, 2), "utf8");
}

export async function health(
  port: number,
): Promise<{ ok: boolean; plans: number; diagrams: number; pid: number } | undefined> {
  try {
    const res = await fetch(`${baseUrl(port)}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as { ok: boolean; plans: number; diagrams: number; pid: number };
  } catch {
    return undefined;
  }
}

function serverEntry(): string {
  // resolve through the package graph so this works from a global install too
  const pkg = require.resolve("@gameplan/server/package.json");
  return join(dirname(pkg), "dist", "main.js");
}

/**
 * Return a running server, starting a detached one if needed.
 *
 * The server outlives the CLI process on purpose: `gameplan render` should
 * hand back a URL that stays alive while the humans take their time.
 */
export async function ensureServer(port = DEFAULT_PORT): Promise<number> {
  const alive = await health(port);
  if (alive) return port;

  const entry = serverEntry();
  if (!existsSync(entry)) {
    throw new Error(
      `server build not found at ${entry} — run \`npm run build\` in the gameplan repo first`,
    );
  }

  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      GAMEPLAN_PORT: String(port),
      GAMEPLAN_DATA: DATA_DIR,
    },
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await health(port);
    if (status) {
      await writeRuntime({ pid: child.pid ?? -1, port, startedAt: Date.now() });
      return port;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not become healthy on port ${port} within 15s`);
}

export async function stopServer(port = DEFAULT_PORT): Promise<boolean> {
  const status = await health(port);
  const runtime = await readRuntime();
  const pid = status?.pid ?? runtime?.pid;
  if (!pid || pid < 0) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export async function api<T>(
  port: number,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init ?? {};
  const res = await fetch(`${baseUrl(port)}${path}`, {
    ...rest,
    headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = Array.isArray(body.issues)
      ? `\n  ${(body.issues as string[]).join("\n  ")}`
      : "";
    throw new Error(`${String(body.error ?? res.statusText)}${detail}`);
  }
  return body as T;
}
