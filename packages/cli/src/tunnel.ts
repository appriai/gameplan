import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "./daemon.js";

const RUNTIME_FILE = join(DATA_DIR, "tunnel.json");
const LOG_FILE = join(DATA_DIR, "tunnel.log");
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

interface TunnelRuntime {
  pid: number;
  port: number;
  url: string;
  startedAt: number;
}

async function readRuntime(): Promise<TunnelRuntime | undefined> {
  if (!existsSync(RUNTIME_FILE)) return undefined;
  try {
    return JSON.parse(await readFile(RUNTIME_FILE, "utf8")) as TunnelRuntime;
  } catch {
    return undefined;
  }
}

async function writeRuntime(runtime: TunnelRuntime): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RUNTIME_FILE, JSON.stringify(runtime, null, 2), "utf8");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cloudflaredAvailable(): boolean {
  return spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * Return the public URL of a running quick tunnel for `port`, starting one
 * if none is up.
 *
 * This is Cloudflare's account-less "quick tunnel" — no login, no config, a
 * random `*.trycloudflare.com` hostname that dies with the process. It's the
 * right default for "let someone remote look at this canvas for a bit," not
 * for anything meant to stay up: there's no auth in front of it, so the
 * hostname being unguessable is the *only* thing protecting whatever's on
 * the other end.
 */
export async function ensureTunnel(port: number): Promise<string> {
  const existing = await readRuntime();
  if (existing && existing.port === port && isAlive(existing.pid)) {
    return existing.url;
  }

  if (!cloudflaredAvailable()) {
    throw new Error(
      "cloudflared is not installed — see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
  }

  await mkdir(DATA_DIR, { recursive: true });

  // cloudflared's stderr has to land in a real file, not a pipe back to this
  // process: `gameplan render` exits right after this call, and a detached
  // child writing to a pipe whose reader just vanished gets SIGPIPE'd on its
  // next log line — the tunnel would die within a second of being created.
  const logFd = openSync(LOG_FILE, "w");
  const child = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
    detached: true,
    stdio: ["ignore", "ignore", logFd],
  });
  child.unref();

  const pid = child.pid ?? -1;
  const url = await pollForUrl(pid);
  await writeRuntime({ pid, port, url, startedAt: Date.now() });
  return url;
}

async function pollForUrl(pid: number): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (pid > 0 && !isAlive(pid)) {
      const log = await readFile(LOG_FILE, "utf8").catch(() => "");
      throw new Error(`cloudflared exited before establishing a tunnel:\n${log.trim()}`);
    }
    const log = await readFile(LOG_FILE, "utf8").catch(() => "");
    const match = log.match(URL_PATTERN);
    if (match) return match[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("cloudflared did not report a tunnel URL within 20s");
}

export async function tunnelStatus(): Promise<TunnelRuntime | undefined> {
  const runtime = await readRuntime();
  if (!runtime || !isAlive(runtime.pid)) return undefined;
  return runtime;
}

export async function stopTunnel(): Promise<boolean> {
  const runtime = await readRuntime();
  if (!runtime) return false;
  let stopped = false;
  if (isAlive(runtime.pid)) {
    try {
      process.kill(runtime.pid, "SIGTERM");
      stopped = true;
    } catch {
      // already gone
    }
  }
  await unlink(RUNTIME_FILE).catch(() => {});
  return stopped;
}
