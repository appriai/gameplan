import type { FillStyle } from "../excalidraw.js";
import type { DiagramStyle } from "../diagram.js";

export interface DiagramLook {
  roughness: number;
  fillStyle: FillStyle;
  strokeWidth: number;
}

/** How rough the strokes are and how shapes are filled, per diagram `style`. */
export const DIAGRAM_LOOKS: Record<DiagramStyle, DiagramLook> = {
  // roughness 2 is Excalidraw's "cartoonist" setting; hachure is its pencil
  // shading. Together they read as drawn on a whiteboard, not generated.
  sketch: { roughness: 2, fillStyle: "hachure", strokeWidth: 2 },
  clean: { roughness: 0, fillStyle: "solid", strokeWidth: 1.5 },
};
