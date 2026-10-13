import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname } from "node:path";
import type { DocKind } from "./collab.js";

/**
 * Who may see what.
 *
 * Only this machine is trusted outright. Everyone else — a teammate on the
 * LAN, or anyone reaching the server through a Cloudflare tunnel — needs a
 * share token, and a token unlocks exactly one plan or diagram: its page, its
 * scene, its feedback and its websocket room. Listing, creating, deleting and
 * minting tokens stay local-only, so a shared link never exposes the rest of
 * the server.
 */

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Headers a proxy adds on the way in. cloudflared connects to the server from
 * localhost, so a tunnelled request *looks* local by address alone; these are
 * what give it away. Cloudflare's edge always sets `cf-connecting-ip`, and a
 * remote client can't strip a header the edge adds after it.
 */
const FORWARDED_HEADERS = ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "forwarded"];

/** Host names a local caller uses to reach the server. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True only for a request that originated on this machine.
 *
 * The Host check closes DNS rebinding: a hostile page can point its own
 * domain at 127.0.0.1, and the victim's browser then reaches us from
 * loopback with no proxy headers — but still sends that domain as Host.
 */
export function isTrusted(req: IncomingMessage): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return false;
  if (!FORWARDED_HEADERS.every((header) => req.headers[header] === undefined)) return false;
  const host = req.headers.host;
  if (host === undefined) return true;
  return LOCAL_HOSTS.has(host.replace(/:\d+$/, "").toLowerCase());
}

/** True when the request reached us over https (the tunnel terminates TLS at Cloudflare). */
export function isHttps(req: IncomingMessage): boolean {
  if (req.headers["x-forwarded-proto"] === "https") return true;
  const visitor = req.headers["cf-visitor"];
  return typeof visitor === "string" && visitor.includes('"https"');
}

/** One cookie per document, so a reviewer can hold tokens for several shared canvases. */
export function cookieName(kind: DocKind, id: string): string {
  return `gp_${kind === "plan" ? "p" : "d"}_${id}`;
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function shareCookie(kind: DocKind, id: string, token: string, secure: boolean): string {
  // HttpOnly: page scripts never see it. SameSite=Lax: another site can't
  // ride it into a websocket or an API call. Path=/ because the page, the
  // API and /ws all need it.
  const attrs = [`${cookieName(kind, id)}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function key(kind: DocKind, id: string): string {
  return `${kind}:${id}`;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Share tokens, one per document, persisted so a server restart doesn't
 * break links people already have. The file is 0600: anyone who can read it
 * can already reach the server as a local, trusted caller.
 */
export class ShareStore {
  private tokens = new Map<string, string>();

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Record<string, string>;
      this.tokens = new Map(Object.entries(raw));
    } catch {
      // a corrupt file only costs outstanding links; new tokens get minted
      this.tokens = new Map();
    }
  }

  /** The document's current token, minting one the first time it's shared. */
  async tokenFor(kind: DocKind, id: string): Promise<string> {
    const existing = this.tokens.get(key(kind, id));
    if (existing) return existing;
    return this.rotate(kind, id);
  }

  /** Replace the document's token, so every link handed out so far stops working. */
  async rotate(kind: DocKind, id: string): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    this.tokens.set(key(kind, id), token);
    await this.save();
    return token;
  }

  async remove(kind: DocKind, id: string): Promise<void> {
    if (this.tokens.delete(key(kind, id))) await this.save();
  }

  /** Constant-time check of a presented token against the document's current one. */
  check(kind: DocKind, id: string, presented: string | undefined): boolean {
    const expected = this.tokens.get(key(kind, id));
    if (!expected || !presented) return false;
    // compare fixed-length digests so neither length nor content leaks through timing
    return timingSafeEqual(digest(expected), digest(presented));
  }

  /** May this request see this document? Local callers always may. */
  allows(req: IncomingMessage, kind: DocKind, id: string, queryToken?: string): boolean {
    if (isTrusted(req)) return true;
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    return [queryToken, bearer, readCookie(req, cookieName(kind, id))].some((token) =>
      this.check(kind, id, token),
    );
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.tokens), null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    // writeFile's mode only applies when it creates the file
    await chmod(this.file, 0o600);
  }
}
