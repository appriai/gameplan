import { groupId } from "../ids.js";
import { measureText, truncatePath } from "../text.js";
import { FONT, METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import type { ExcalidrawElement } from "../excalidraw.js";
import type { Step } from "../spec.js";
import {
  COLUMNS,
  columnX,
  contentWidth,
  emptyNote,
  type RegionCtx,
  type RegionResult,
} from "./common.js";

const INNER = METRICS.cardWidth - 2 * METRICS.cardPadding;

interface CardPlan {
  step: Step;
  index: number;
  height: number;
  title: ReturnType<typeof measureText>;
  detail: ReturnType<typeof measureText> | null;
  files: string[];
  verify: ReturnType<typeof measureText> | null;
}

function planCard(step: Step, index: number): CardPlan {
  const title = measureText(`${index + 1}.  ${step.title}`, TYPE_SCALE.heading, INNER);
  const detail = step.detail
    ? measureText(step.detail, TYPE_SCALE.body, INNER)
    : null;
  const files = step.files.map((f) => truncatePath(f, TYPE_SCALE.small, INNER, FONT.code));
  const verify = step.verify
    ? measureText(`✓  ${step.verify}`, TYPE_SCALE.small, INNER - 8)
    : null;

  let height = METRICS.cardPadding + title.height;
  if (detail) height += 8 + detail.height;
  if (files.length > 0) {
    height += 10;
    height += files.length * Math.ceil(TYPE_SCALE.small * 1.5);
  }
  if (verify) height += 10 + verify.height;
  height += METRICS.cardPadding;

  return { step, index, height, title, detail, files, verify };
}

/**
 * The Steps region: the execution sequence as a grid of cards.
 *
 * Cards are grouped so a reviewer can drag one to a new position — that drag
 * is the reorder signal the feedback parser reads back.
 */
export function layoutSteps(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = METRICS.framePadding;

  if (spec.steps.length === 0) {
    const frame = builder.frame({
      key: "frame::steps",
      name: "Steps",
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
      height: 2 * pad + 24,
    });
    const h = emptyNote(ctx, "steps", ctx.y + pad, "No steps in this plan.");
    builder.assignToFrame(frame.id, []);
    return { width: ctx.width, height: 2 * pad + h };
  }

  const plans = spec.steps.map(planCard);
  const rows: CardPlan[][] = [];
  for (let i = 0; i < plans.length; i += COLUMNS) {
    rows.push(plans.slice(i, i + COLUMNS));
  }
  const rowHeights = rows.map((row) => Math.max(...row.map((p) => p.height)));
  const frameHeight =
    2 * pad +
    rowHeights.reduce((a, b) => a + b, 0) +
    Math.max(0, rows.length - 1) * METRICS.cardGap;

  const frame = builder.frame({
    key: "frame::steps",
    name: "Steps",
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: frameHeight,
  });

  const containers = new Map<string, ExcalidrawElement>();
  let rowTop = ctx.y + pad;

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex]!;
    row.forEach((plan, colIndex) => {
      const x = columnX(ctx.x, colIndex);
      const group = groupId(spec.id, `step::${plan.step.id}`);
      const shared = {
        frameId: frame.id,
        groupIds: [group],
      };

      const container = builder.rect({
        key: `step::${plan.step.id}`,
        role: "step",
        nodeId: plan.step.id,
        ordinal: plan.index,
        x,
        y: rowTop,
        width: METRICS.cardWidth,
        height: rowHeight,
        backgroundColor: PALETTE.bgWhite,
        strokeColor: PALETTE.ink,
        ...shared,
      });
      containers.set(plan.step.id, container);

      let cursor = rowTop + METRICS.cardPadding;

      builder.text({
        key: `step::${plan.step.id}::title`,
        role: "step-field",
        nodeId: plan.step.id,
        x: x + METRICS.cardPadding,
        y: cursor,
        text: `${plan.index + 1}.  ${plan.step.title}`,
        maxWidth: INNER,
        fontSize: TYPE_SCALE.heading,
        ...shared,
      });
      cursor += plan.title.height;

      if (plan.detail) {
        cursor += 8;
        builder.text({
          key: `step::${plan.step.id}::detail`,
          role: "step-field",
          nodeId: plan.step.id,
          x: x + METRICS.cardPadding,
          y: cursor,
          text: plan.step.detail!,
          maxWidth: INNER,
          fontSize: TYPE_SCALE.body,
          color: PALETTE.muted,
          ...shared,
        });
        cursor += plan.detail.height;
      }

      if (plan.files.length > 0) {
        cursor += 10;
        plan.files.forEach((file, i) => {
          builder.text({
            key: `step::${plan.step.id}::file::${i}`,
            role: "step-field",
            nodeId: plan.step.id,
            x: x + METRICS.cardPadding,
            y: cursor,
            text: file,
            maxWidth: INNER,
            fontSize: TYPE_SCALE.small,
            fontFamily: FONT.code,
            color: PALETTE.strokeBlue,
            ...shared,
          });
          cursor += Math.ceil(TYPE_SCALE.small * 1.5);
        });
      }

      if (plan.verify) {
        cursor += 10;
        builder.text({
          key: `step::${plan.step.id}::verify`,
          role: "step-field",
          nodeId: plan.step.id,
          x: x + METRICS.cardPadding,
          y: cursor,
          text: `✓  ${plan.step.verify!}`,
          maxWidth: INNER - 8,
          fontSize: TYPE_SCALE.small,
          color: PALETTE.strokeGreen,
          ...shared,
        });
      }
    });
    rowTop += rowHeight + METRICS.cardGap;
  });

  // explicit dependencies only — implicit sequence is already carried by the
  // numbering, and drawing it too turns the region into arrow spaghetti
  for (const step of spec.steps) {
    for (const dep of step.dependsOn) {
      const from = containers.get(dep);
      const to = containers.get(step.id);
      if (!from || !to) continue;
      builder.arrow({
        key: `step-dep::${dep}::${step.id}`,
        from,
        to,
        role: "decor",
        strokeColor: PALETTE.muted,
        frameId: frame.id,
        opacity: 60,
      });
    }
  }

  return { width: ctx.width, height: frameHeight };
}
