import type { ExcalidrawElement } from "./excalidraw.js";

/**
 * A point-in-time record of what we generated, for later diffing against
 * whatever a reviewer does to the scene. Shared by plans and diagrams — both
 * are "a document rendered at revision N", and feedback parsing doesn't care
 * which kind of document it's reading back.
 */
export interface Snapshot {
  planId: string;
  revision: number;
  renderedAt: number;
  elements: Record<
    string,
    {
      role: string;
      nodeId?: string;
      ordinal?: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text?: string;
    }
  >;
}

export function buildSnapshot(
  doc: { id: string; revision: number },
  now: number,
  elements: ExcalidrawElement[],
): Snapshot {
  const snapshot: Snapshot = {
    planId: doc.id,
    revision: doc.revision,
    renderedAt: now,
    elements: {},
  };
  for (const el of elements) {
    const meta = el.customData?.gameplan;
    if (!meta) continue;
    snapshot.elements[el.id] = {
      role: meta.role,
      ...(meta.nodeId !== undefined ? { nodeId: meta.nodeId } : {}),
      ...(meta.ordinal !== undefined ? { ordinal: meta.ordinal } : {}),
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      ...("originalText" in el
        ? { text: (el as { originalText: string }).originalText }
        : {}),
    };
  }
  return snapshot;
}
