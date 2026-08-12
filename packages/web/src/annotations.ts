import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { INTENT_STYLE, type Intent } from "./protocol";

const STICKY_WIDTH = 240;
const STICKY_HEIGHT = 110;

/**
 * Drop a correctly-coloured, correctly-tagged sticky at the centre of the
 * viewport and select it so the reviewer can type straight away.
 *
 * The palette exists so nobody has to remember which hex means "reject". The
 * stamped `customData.gameplanAnnotation` also means the agent reads the
 * reviewer's intent and name directly, instead of inferring intent from colour.
 */
export function dropSticky(
  api: ExcalidrawImperativeAPI,
  intent: Intent,
  author: string,
): void {
  const state = api.getAppState();
  const zoom = state.zoom.value || 1;
  const centreX = -state.scrollX + state.width / (2 * zoom);
  const centreY = -state.scrollY + state.height / (2 * zoom);

  const style = INTENT_STYLE[intent];
  const created = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: centreX - STICKY_WIDTH / 2,
      y: centreY - STICKY_HEIGHT / 2,
      width: STICKY_WIDTH,
      height: STICKY_HEIGHT,
      backgroundColor: style.background,
      strokeColor: style.stroke,
      fillStyle: "solid",
      strokeWidth: 2,
      roundness: { type: 3 },
      customData: {
        gameplanAnnotation: {
          v: 1,
          kind: "annotation",
          intent,
          author,
          createdAt: Date.now(),
        },
      },
      label: {
        text: "",
        fontSize: 16,
        textAlign: "left",
        verticalAlign: "top",
      },
    },
  ]);

  const container = created.find((el) => el.type === "rectangle") ?? created[0];

  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: { selectedElementIds: container ? { [container.id]: true } : {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  api.scrollToContent(container, { animate: false });
}
