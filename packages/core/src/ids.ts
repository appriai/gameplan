/**
 * Deterministic ids, seeds and fractional indices.
 *
 * Determinism is a feature, not a nicety: re-rendering a revised spec must
 * produce the same element id for the same logical node, otherwise every
 * re-render orphans the human annotations anchored to it and the snapshot
 * diff sees churn everywhere.
 */

/** FNV-1a, 32-bit. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/**
 * A stable, Excalidraw-shaped (21 char, nanoid-ish) element id derived from the
 * plan id and a logical key such as "step:s3:card".
 */
export function elementId(planId: string, key: string): string {
  let state = hash32(`${planId}::${key}`);
  let out = "";
  for (let i = 0; i < 21; i++) {
    // xorshift32 keeps the stream deterministic but well distributed
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out += ID_ALPHABET[state % ID_ALPHABET.length];
  }
  return out;
}

/** Stable group id, so multi-part cards drag as a single object. */
export function groupId(planId: string, key: string): string {
  return elementId(planId, `group::${key}`);
}

/** Roughness seed. Same input -> same hand-drawn strokes across renders. */
export function seedFor(planId: string, key: string): number {
  return hash32(`seed::${planId}::${key}`) % 2_147_483_647;
}

const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Increment a fractional index integer, per the `fractional-indexing`
 * algorithm Excalidraw uses. We only ever need the ascending case (append at
 * end), never a true midpoint, so this is the whole implementation.
 */
function incrementInteger(x: string): string | null {
  const head = x[0]!;
  const digs = x.slice(1).split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = BASE62.indexOf(digs[i]!) + 1;
    if (d === BASE62.length) {
      digs[i] = BASE62[0]!;
    } else {
      digs[i] = BASE62[d]!;
      carry = false;
    }
  }
  if (!carry) return head + digs.join("");

  if (head === "Z") return "a" + BASE62[0];
  if (head === "z") return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > "a") {
    digs.push(BASE62[0]!);
  } else {
    digs.pop();
  }
  return h + digs.join("");
}

/**
 * An ascending fractional index generator. Excalidraw sorts elements by this
 * string; a monotonic sequence reproduces plain array order.
 */
export function createIndexGenerator(): () => string {
  let current: string | null = null;
  return () => {
    current = current === null ? "a0" : incrementInteger(current);
    if (current === null) {
      throw new Error("fractional index space exhausted");
    }
    return current;
  };
}
