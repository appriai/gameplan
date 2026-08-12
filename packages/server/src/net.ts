import { networkInterfaces } from "node:os";

/**
 * Best-guess LAN address, so `gameplan render` can print a URL a teammate can
 * actually open rather than a localhost link that only works for the author.
 */
export function lanAddress(): string | undefined {
  const candidates: { address: string; rank: number }[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      // prefer ordinary wired/wireless interfaces over container bridges
      const rank = /^(docker|br-|veth|virbr|lo)/.test(name) ? 1 : 0;
      candidates.push({ address: info.address, rank });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.address;
}

export function planUrls(port: number, planId: string): { local: string; lan?: string } {
  const local = `http://localhost:${port}/p/${planId}`;
  const ip = lanAddress();
  return ip ? { local, lan: `http://${ip}:${port}/p/${planId}` } : { local };
}
