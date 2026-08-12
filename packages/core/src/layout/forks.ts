import { groupId } from "../ids.js";
import { clampLines, measureText } from "../text.js";
import { METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import type { Fork, ForkOption } from "../spec.js";
import { contentWidth, emptyNote, type RegionCtx, type RegionResult } from "./common.js";

const DIAMOND = 26;
const RATIONALE_LINES = 3;

interface OptionPlan {
  option: ForkOption;
  index: number;
  label: ReturnType<typeof measureText>;
  rationale: ReturnType<typeof clampLines>;
  contentHeight: number;
}

interface ForkPlan {
  fork: Fork;
  question: ReturnType<typeof measureText>;
  options: OptionPlan[];
  laneHeight: number;
  blockHeight: number;
}

function planFork(fork: Fork, labelWidth: number): ForkPlan {
  const question = measureText(fork.question, TYPE_SCALE.heading, labelWidth + METRICS.laneLength);
  const options = fork.options.map((option, index) => {
    const label = measureText(option.label, TYPE_SCALE.body, labelWidth);
    const rationale = clampLines(option.rationale, TYPE_SCALE.small, labelWidth, RATIONALE_LINES);
    return { option, index, label, rationale, contentHeight: label.height + 4 + rationale.height };
  });
  // lane spacing adapts to whichever option in this fork needs the most room,
  // so a two-line rationale never runs into the next lane down
  const laneHeight = Math.max(METRICS.laneHeight, ...options.map((o) => o.contentHeight + 26));
  const blockHeight = question.height + 14 + options.length * laneHeight;
  return { fork, question, options, laneHeight, blockHeight };
}

/**
 * The Forks region: every decision as a junction. A diamond marks the
 * choice; each option is a lane peeling off it. The chosen lane is solid,
 * bold, and lands on a filled dot. Every rejected lane is dashed, faded, and
 * lands on a hollow one — still labelled, still legible, visibly not taken.
 *
 * Rationale gets up to two real lines, not one truncated one — a reviewer
 * should be able to read *why* a path was rejected, not just that it was.
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

  const diamondX = ctx.x + pad + DIAMOND / 2;
  const labelX = ctx.x + pad + DIAMOND + METRICS.laneStub + METRICS.laneLength + 14;
  const labelWidth = Math.max(120, ctx.x + ctx.width - pad - labelX);

  const plans = spec.forks.map((f) => planFork(f, labelWidth));
  const frameHeight =
    2 * pad + plans.reduce((a, p) => a + p.blockHeight, 0) + (plans.length - 1) * 28;

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
    const suffix = fork.atStep ? `  ·  step ${fork.atStep}` : "";
    builder.text({
      key: `fork::${fork.id}::question`,
      role: "fork",
      nodeId: fork.id,
      x: ctx.x + pad,
      y: cursor,
      text: `${fork.question}${suffix}`,
      maxWidth: contentWidth(ctx.width),
      fontSize: TYPE_SCALE.heading,
      frameId: frame.id,
    });
    cursor += plan.question.height + 14;

    const n = plan.options.length;
    const laneTop = cursor;
    const diamondY = laneTop + ((n - 1) * plan.laneHeight) / 2 + plan.laneHeight / 2;

    builder.rect({
      key: `fork::${fork.id}::diamond`,
      role: "fork",
      nodeId: fork.id,
      type: "diamond",
      x: diamondX - DIAMOND / 2,
      y: diamondY - DIAMOND / 2,
      width: DIAMOND,
      height: DIAMOND,
      strokeColor: PALETTE.ink,
      backgroundColor: PALETTE.bgWhite,
      strokeWidth: 2.5,
      frameId: frame.id,
    });

    plan.options.forEach((op) => {
      const chosen = op.option.chosen;
      const laneY = laneTop + op.index * plan.laneHeight + plan.laneHeight / 2;
      const stroke = chosen ? PALETTE.strokeGreen : PALETTE.muted;
      const opacity = chosen ? 100 : 65;
      const group = groupId(spec.id, `fork-option::${fork.id}::${op.option.id}`);
      const shared = { frameId: frame.id, groupIds: [group] };

      builder.path({
        key: `fork-option::${fork.id}::${op.option.id}::stub`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        points: [
          { x: diamondX, y: diamondY },
          { x: ctx.x + pad + DIAMOND + METRICS.laneStub, y: laneY },
        ],
        strokeColor: stroke,
        strokeWidth: chosen ? 2.5 : 1.5,
        strokeStyle: chosen ? "solid" : "dashed",
        opacity,
        ...shared,
      });
      builder.path({
        key: `fork-option::${fork.id}::${op.option.id}::lane`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        points: [
          { x: ctx.x + pad + DIAMOND + METRICS.laneStub, y: laneY },
          { x: labelX - 14, y: laneY },
        ],
        strokeColor: stroke,
        strokeWidth: chosen ? 2.5 : 1.5,
        strokeStyle: chosen ? "solid" : "dashed",
        opacity,
        ...shared,
      });

      const tr = METRICS.laneTerminusRadius;
      builder.rect({
        key: `fork-option::${fork.id}::${op.option.id}::terminus`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        ordinal: op.index,
        type: "ellipse",
        x: labelX - 14 - tr,
        y: laneY - tr,
        width: tr * 2,
        height: tr * 2,
        strokeColor: stroke,
        backgroundColor: chosen ? PALETTE.bgGreen : PALETTE.transparent,
        strokeWidth: 2,
        opacity,
        ...shared,
      });

      // label + rationale as one block, vertically centred on the lane
      const blockTop = laneY - op.contentHeight / 2;
      builder.text({
        key: `fork-option::${fork.id}::${op.option.id}::label`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        x: labelX,
        y: blockTop,
        text: op.option.label,
        maxWidth: labelWidth,
        fontSize: TYPE_SCALE.body,
        color: chosen ? PALETTE.ink : PALETTE.muted,
        opacity,
        ...shared,
      });
      builder.text({
        key: `fork-option::${fork.id}::${op.option.id}::rationale`,
        role: "fork-option",
        nodeId: `${fork.id}:${op.option.id}`,
        x: labelX,
        y: blockTop + op.label.height + 4,
        text: op.rationale.text,
        maxWidth: labelWidth,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        opacity,
        ...shared,
      });
    });

    cursor += n * plan.laneHeight + 28;
  }

  return { width: ctx.width, height: frameHeight };
}
