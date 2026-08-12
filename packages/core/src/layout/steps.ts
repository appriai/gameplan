import { groupId } from "../ids.js";
import { checkGlyph, fileGlyph } from "../icons.js";
import { clampLines, measureText } from "../text.js";
import { FONT, METRICS, PALETTE, TYPE_SCALE } from "../theme.js";
import type { ExcalidrawElement } from "../excalidraw.js";
import type { Step } from "../spec.js";
import { centeredText, emptyNote, type RegionCtx, type RegionResult } from "./common.js";

/** Width the caption text under each waypoint has to work with. */
const LABEL_GUTTER = 22;
const labelWidth = () => METRICS.stepPitch - LABEL_GUTTER;
// the waypoint column is narrow (~190px), so a real sentence needs three
// lines here, not two, to actually fit rather than trail off with "…"
const DETAIL_LINES = 3;
const VERIFY_LINES = 3;

interface WaypointPlan {
  step: Step;
  index: number;
  title: ReturnType<typeof measureText>;
  detail: ReturnType<typeof clampLines> | null;
  files: ReturnType<typeof measureText> | null;
  filesText: string | null;
  verify: ReturnType<typeof clampLines> | null;
  contentHeight: number;
}

function fileSummary(files: string[]): string | null {
  if (files.length === 0) return null;
  const basenames = files.map((f) => f.split("/").pop() ?? f);
  const shown = basenames.slice(0, 2).join(", ");
  return basenames.length > 2 ? `${shown} +${basenames.length - 2}` : shown;
}

function planWaypoint(step: Step, index: number): WaypointPlan {
  const w = labelWidth();
  const title = measureText(step.title, TYPE_SCALE.body, w, FONT.hand);
  const detail = step.detail ? clampLines(step.detail, TYPE_SCALE.small, w, DETAIL_LINES) : null;
  const filesText = fileSummary(step.files);
  const files = filesText ? measureText(filesText, TYPE_SCALE.small, w - METRICS.iconSize, FONT.code) : null;
  const verify = step.verify
    ? clampLines(step.verify, TYPE_SCALE.small, w - METRICS.iconSize, VERIFY_LINES)
    : null;

  let contentHeight = title.height;
  if (detail) contentHeight += 6 + detail.height;
  if (files) contentHeight += 6 + Math.max(METRICS.iconSize, files.height);
  if (verify) contentHeight += 6 + Math.max(METRICS.iconSize, verify.height);

  return { step, index, title, detail, filesText, files, verify, contentHeight };
}

/**
 * The Steps region: a journey path. Waypoints in sequence, connected by one
 * line, each with a number, a short title, and — only if they exist — a
 * detail, a compact file summary, and a verify caption, each capped to a
 * couple of short lines rather than left to wrap into a paragraph or forced
 * onto one line and chopped. A plan is a route, not a stack of index cards.
 */
export function layoutSteps(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = METRICS.framePadding;

  if (spec.steps.length === 0) {
    const height = 2 * pad + 24;
    builder.frame({
      key: "frame::steps",
      name: "Steps",
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
      height,
    });
    emptyNote(ctx, "steps", ctx.y + pad, "No steps in this plan.");
    return { width: ctx.width, height };
  }

  const plans = spec.steps.map(planWaypoint);
  const r = METRICS.waypointRadius;
  const journeyWidth = (plans.length - 1) * METRICS.stepPitch + 2 * r;
  const frameWidth = Math.max(ctx.width, journeyWidth + 2 * pad);
  const maxContentHeight = Math.max(...plans.map((p) => p.contentHeight));
  const laneY = ctx.y + pad + r;
  const frameHeight = pad + 2 * r + 20 + maxContentHeight + pad;

  const frame = builder.frame({
    key: "frame::steps",
    name: "Steps",
    x: ctx.x,
    y: ctx.y,
    width: frameWidth,
    height: frameHeight,
  });

  const startX = ctx.x + pad + r;
  const centerX = (i: number) => startX + i * METRICS.stepPitch;

  // the spine, drawn first so waypoints paint on top of it
  builder.path({
    key: "steps::spine",
    role: "decor",
    points: plans.map((_, i) => ({ x: centerX(i), y: laneY })),
    strokeColor: PALETTE.muted,
    strokeWidth: 2.5,
    endArrowhead: "triangle",
    frameId: frame.id,
  });

  const dots = new Map<string, ExcalidrawElement>();

  plans.forEach((plan, i) => {
    const x = centerX(i);
    const group = groupId(spec.id, `step::${plan.step.id}`);
    const shared = { frameId: frame.id, groupIds: [group] };

    const { container } = builder.card({
      key: `step::${plan.step.id}::dot`,
      role: "step",
      nodeId: plan.step.id,
      ordinal: plan.index,
      shape: "ellipse",
      x: x - r,
      y: laneY - r,
      width: r * 2,
      height: r * 2,
      text: String(i + 1),
      fontSize: TYPE_SCALE.heading,
      backgroundColor: PALETTE.bgWhite,
      strokeColor: PALETTE.ink,
      strokeWidth: 2.5,
      ...shared,
    });
    dots.set(plan.step.id, container);

    let cursor = laneY + r + 14;
    const w = labelWidth();

    const titleMeasure = centeredText(builder, {
      key: `step::${plan.step.id}::title`,
      role: "step-field",
      nodeId: plan.step.id,
      centerX: x,
      y: cursor,
      text: plan.step.title,
      maxWidth: w,
      fontSize: TYPE_SCALE.body,
      frameId: frame.id,
      groupIds: [group],
    });
    cursor += titleMeasure.height + 6;

    if (plan.detail) {
      centeredText(builder, {
        key: `step::${plan.step.id}::detail`,
        role: "step-field",
        nodeId: plan.step.id,
        centerX: x,
        y: cursor,
        text: plan.detail.text,
        maxWidth: w,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.muted,
        frameId: frame.id,
        groupIds: [group],
      });
      cursor += plan.detail.height + 6;
    }

    if (plan.filesText && plan.files) {
      const totalWidth = METRICS.iconSize + 5 + plan.files.width;
      const left = x - totalWidth / 2;
      fileGlyph(builder, {
        key: `step::${plan.step.id}::files-icon`,
        role: "step-field",
        nodeId: plan.step.id,
        x: left,
        y: cursor + 1,
        size: METRICS.iconSize,
        color: PALETTE.strokeBlue,
        frameId: frame.id,
        groupIds: [group],
      });
      builder.text({
        key: `step::${plan.step.id}::files-label`,
        role: "step-field",
        nodeId: plan.step.id,
        x: left + METRICS.iconSize + 5,
        y: cursor,
        text: plan.filesText,
        maxWidth: w - METRICS.iconSize,
        fontSize: TYPE_SCALE.small,
        fontFamily: FONT.code,
        color: PALETTE.strokeBlue,
        frameId: frame.id,
        groupIds: [group],
      });
      cursor += Math.max(METRICS.iconSize, plan.files.height) + 6;
    }

    if (plan.verify) {
      const totalWidth = METRICS.iconSize + 5 + plan.verify.width;
      const left = x - totalWidth / 2;
      checkGlyph(builder, {
        key: `step::${plan.step.id}::verify-icon`,
        role: "step-field",
        nodeId: plan.step.id,
        x: left,
        y: cursor + 1,
        size: METRICS.iconSize,
        frameId: frame.id,
        groupIds: [group],
      });
      builder.text({
        key: `step::${plan.step.id}::verify-label`,
        role: "step-field",
        nodeId: plan.step.id,
        x: left + METRICS.iconSize + 5,
        y: cursor,
        text: plan.verify.text,
        maxWidth: w - METRICS.iconSize,
        fontSize: TYPE_SCALE.small,
        color: PALETTE.strokeGreen,
        frameId: frame.id,
        groupIds: [group],
      });
    }
  });

  // extra dependency arrows only where they aren't already implied by the
  // spine — an out-of-sequence dependency is signal; the adjacent case is noise
  spec.steps.forEach((step, i) => {
    for (const dep of step.dependsOn) {
      const depIndex = spec.steps.findIndex((s) => s.id === dep);
      if (depIndex === i - 1) continue;
      const from = dots.get(dep);
      const to = dots.get(step.id);
      if (!from || !to) continue;
      builder.arrow({
        key: `step-dep::${dep}::${step.id}`,
        from,
        to,
        role: "decor",
        strokeColor: PALETTE.strokeViolet,
        strokeStyle: "dashed",
        frameId: frame.id,
        opacity: 70,
      });
    }
  });

  return { width: frameWidth, height: frameHeight };
}
