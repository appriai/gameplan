import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SyncElement } from "./protocol";

/** Clear of Excalidraw's floating toolbar island. */
const TOP_INSET = 112;
const SIDE_INSET = 32;
const BOTTOM_INSET = 32;

/** Below this the plan is a thumbnail, not a document. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1;

/**
 * Land the reviewer at the top of the plan, as zoomed out as still reads.
 *
 * `scrollToContent({ fitToContent, minZoom })` centres the content, so on any
 * plan too tall to fit at the minimum zoom the Goal frame ends up above the
 * viewport and the first thing a reviewer sees is the middle of the Steps
 * region, half-hidden behind the toolbar. Setting the viewport ourselves is
 * less code than working around that.
 *
 * Excalidraw maps a scene point to the viewport as `(scene + scroll) * zoom`,
 * so placing scene point `p` at viewport pixel `v` means `scroll = v / zoom - p`.
 */
export function frameContent(api: ExcalidrawImperativeAPI, elements: SyncElement[]): void {
  const visible = elements.filter((el) => !el.isDeleted);
  if (visible.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of visible) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }

  const state = api.getAppState();
  const availableWidth = Math.max(1, state.width - 2 * SIDE_INSET);
  const availableHeight = Math.max(1, state.height - TOP_INSET - BOTTOM_INSET);
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  const fit = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));

  // centre horizontally when it fits; otherwise pin to the left edge
  const scaledWidth = contentWidth * zoom;
  const left =
    scaledWidth < availableWidth
      ? SIDE_INSET + (availableWidth - scaledWidth) / 2
      : SIDE_INSET;

  api.updateScene({
    appState: {
      scrollX: left / zoom - minX,
      scrollY: TOP_INSET / zoom - minY,
      zoom: { value: zoom as never },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}
