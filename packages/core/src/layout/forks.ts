import { groupId } from "../ids.js";
import { measureText } from "../text.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import type { Fork, ForkOption } from "../spec.js";
import {
  COLUMNS,
  columnX,
  contentWidth,
  emptyNote,
  type RegionCtx,
  type RegionResult,
} from "./common.js";

const INNER = METRICS.cardWidth - 2 * METRICS.cardPadding;

interface OptionPlan {
  option: ForkOption;
  index: number;
  height: number;
  label: ReturnType<typeof measureText>;
  rationale: ReturnType<typeof measureText>;
  badge: ReturnType<typeof measureText>;
}

interface ForkPlan {
  fork: Fork;
  question: ReturnType<typeof measureText>;
  options: OptionPlan[];
  rowHeight: number;
  height: number;
}

function planOption(option: ForkOption, index: number): OptionPlan {
  const label = measureText(option.label, TYPE_SCALE.heading, INNER);
  const rationale = measureText(option.rationale, TYPE_SCALE.body, INNER);
  const badge = measureText(
    option.chosen ? "✓  CHOSEN" : "✗  not taken",
    TYPE_SCALE.small,
    INNER,
  );
  const height =
    METRICS.cardPadding +
    badge.height +
    8 +
    label.height +
    8 +
    rationale.height +
    METRICS.cardPadding;
  return { option, index, height, label, rationale, badge };
}

function planFork(fork: Fork, width: number): ForkPlan {
  const question = measureText(
    `?  ${fork.question}`,
    TYPE_SCALE.heading,
    contentWidth(width),
  );
  const options = fork.options.map(planOption);
  const rowHeight = Math.max(...options.map((o) => o.height));
  const rows = Math.ceil(options.length / COLUMNS);
  const height =
    question.height +
    14 +
    rows * rowHeight +
    Math.max(0, rows - 1) * METRICS.cardGap;
  return { fork, question, options, rowHeight, height };
}

/**
 * The Forks region: every decision point with the alternatives that were
 * considered, the chosen one marked, and the reasoning visible.
 *
 * This is the region that justifies the whole project. A text plan states the
 * conclusion; the trajectories it rejected stay in the model's head, which is
 * exactly where a reviewer can't see them.
 */
export function layoutForks(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = METRICS.framePadding;

  if (spec.forks.length === 0) {
    const height = 2 * pad + 24;
    builder.frame({
      key: "frame::forks",
      name: "Decision forks",
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
      height,
    });
    emptyNote(ctx, "forks", ctx.y + pad, "No branch points — this plan has one obvious path.");
    return { width: ctx.width, height };
  }

  const plans = spec.forks.map((f) => planFork(f, ctx.width));
  const frameHeight =
    2 * pad +
    plans.reduce((a, p) => a + p.height, 0) +
    Math.max(0, plans.length - 1) * (METRICS.cardGap + 16);

  const frame = builder.frame({
    key: "frame::forks",
    name: "Decision forks",
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: frameHeight,
  });

  let cursor = ctx.y + pad;

  for (const plan of plans) {
    const fork = plan.fork;
    const suffix = fork.atStep ? `  (step ${fork.atStep})` : "";
    builder.text({
      key: `fork::${fork.id}::question`,
      role: "fork",
      nodeId: fork.id,
      x: ctx.x + pad,
      y: cursor,
      text: `?  ${fork.question}${suffix}`,
      maxWidth: contentWidth(ctx.width),
      fontSize: TYPE_SCALE.heading,
      frameId: frame.id,
    });
    cursor += plan.question.height + 14;

    plan.options.forEach((op, i) => {
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const x = columnX(ctx.x, column);
      const y = cursor + row * (plan.rowHeight + METRICS.cardGap);
      const chosen = op.option.chosen;
      const group = groupId(spec.id, `fork-option::${fork.id}::${op.option.id}`);
      const shared = { frameId: frame.id, groupIds: [group] };

      builder.rect({
        key: `fork-option::${fork.id}::${op.option.id}`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        ordinal: op.index,
        x,
        y,
        width: METRICS.cardWidth,
        height: plan.rowHeight,
        strokeColor: chosen ? PALETTE.strokeGreen : PALETTE.muted,
        backgroundColor: chosen ? PALETTE.bgGreen : PALETTE.transparent,
        strokeStyle: chosen ? "solid" : "dashed",
        strokeWidth: chosen ? 2 : 1,
        opacity: chosen ? 100 : 60,
        ...shared,
      });

      let inner = y + METRICS.cardPadding;
      builder.text({
        key: `fork-option::${fork.id}::${op.option.id}::badge`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        x: x + METRICS.cardPadding,
        y: inner,
        text: chosen ? "✓  CHOSEN" : "✗  not taken",
        maxWidth: INNER,
        fontSize: TYPE_SCALE.small,
        color: chosen ? PALETTE.strokeGreen : "#868e96",
        opacity: chosen ? 100 : 60,
        ...shared,
      });
      inner += op.badge.height + 8;

      builder.text({
        key: `fork-option::${fork.id}::${op.option.id}::label`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        x: x + METRICS.cardPadding,
        y: inner,
        text: op.option.label,
        maxWidth: INNER,
        fontSize: TYPE_SCALE.heading,
        opacity: chosen ? 100 : 60,
        ...shared,
      });
      inner += op.label.height + 8;

      builder.text({
        key: `fork-option::${fork.id}::${op.option.id}::rationale`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        x: x + METRICS.cardPadding,
        y: inner,
        text: op.option.rationale,
        maxWidth: INNER,
        fontSize: TYPE_SCALE.body,
        color: PALETTE.muted,
        opacity: chosen ? 100 : 60,
        ...shared,
      });
    });

    const rows = Math.ceil(plan.options.length / COLUMNS);
    cursor +=
      rows * plan.rowHeight +
      Math.max(0, rows - 1) * METRICS.cardGap +
      METRICS.cardGap +
      16;
  }

  return { width: ctx.width, height: frameHeight };
}
