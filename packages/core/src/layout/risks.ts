import { groupId } from "../ids.js";
import { warningTriangle } from "../icons.js";
import { clampLines, measureText } from "../text.js";
import { METRICS, PALETTE, RISK_STYLE, TYPE_SCALE } from "../theme.js";
import type { Risk } from "../spec.js";
import { COLUMNS, columnX, contentWidth, type RegionCtx, type RegionResult } from "./common.js";

const INNER = METRICS.cardWidth - 2 * METRICS.cardPadding;
const HEADLINE_LINES = 3;
const MITIGATION_LINES = 3;

interface RiskPlan {
  risk: Risk;
  index: number;
  headline: ReturnType<typeof clampLines>;
  mitigation: ReturnType<typeof clampLines> | null;
  height: number;
}

function planRisk(risk: Risk, index: number): RiskPlan {
  const headline = clampLines(risk.text, TYPE_SCALE.body, INNER, HEADLINE_LINES);
  const mitigation = risk.mitigation
    ? clampLines(`→ ${risk.mitigation}`, TYPE_SCALE.small, INNER, MITIGATION_LINES)
    : null;

  let height = METRICS.cardPadding + METRICS.riskIconSize + 8 + headline.height;
  if (mitigation) height += 4 + mitigation.height;
  height += METRICS.cardPadding;

  return { risk, index, headline, mitigation, height };
}

/**
 * Risks and out-of-scope. A warning triangle carries the severity colour at
 * a glance; the risk text gets real room to read — up to three lines — since
 * a risk that's been trimmed to a fragment doesn't tell a reviewer anything.
 */
export function layoutRisks(ctx: RegionCtx): RegionResult {
  const { builder, spec } = ctx;
  const pad = METRICS.framePadding;
  const inner = contentWidth(ctx.width);

  const plans = spec.risks.map(planRisk);
  const rows: RiskPlan[][] = [];
  for (let i = 0; i < plans.length; i += COLUMNS) rows.push(plans.slice(i, i + COLUMNS));
  const rowHeights = rows.map((row) => Math.max(...row.map((p) => p.height)));

  const scopeLines = spec.outOfScope;
  const scopeLabel = measureText("Explicitly out of scope", TYPE_SCALE.small, inner);

  let contentHeight =
    rowHeights.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1) * METRICS.cardGap;
  if (plans.length === 0) {
    contentHeight += measureText("No risks flagged.", TYPE_SCALE.body, inner).height;
  }
  if (scopeLines.length > 0) {
    contentHeight += (plans.length > 0 ? 28 : 20) + scopeLabel.height + 8;
    for (const item of scopeLines) {
      contentHeight += measureText(`✕  ${item}`, TYPE_SCALE.body, inner - 16).height + 6;
    }
  }

  const frameHeight = contentHeight + 2 * pad;
  const frame = builder.frame({
    key: "frame::risks",
    name: "Risks & out of scope",
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: frameHeight,
  });

  let cursor = ctx.y + pad;

  if (plans.length === 0) {
    const el = builder.text({
      key: "risks::empty",
      role: "decor",
      x: ctx.x + pad,
      y: cursor,
      text: "No risks flagged.",
      maxWidth: inner,
      fontSize: TYPE_SCALE.body,
      color: "#868e96",
      frameId: frame.id,
    });
    cursor += el.height;
  }

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex]!;
    row.forEach((plan, colIndex) => {
      const x = columnX(ctx.x, colIndex);
      const style = RISK_STYLE[plan.risk.severity];
      const group = groupId(spec.id, `risk::${plan.risk.id}`);
      const shared = { frameId: frame.id, groupIds: [group] };

      builder.rect({
        key: `risk::${plan.risk.id}`,
        role: "risk",
        nodeId: plan.risk.id,
        ordinal: plan.index,
        x,
        y: cursor,
        width: METRICS.cardWidth,
        height: rowHeight,
        strokeColor: style.stroke,
        backgroundColor: style.background,
        strokeWidth: 1.5,
        ...shared,
      });

      const iconX = x + METRICS.cardPadding;
      const iconY = cursor + METRICS.cardPadding;
      warningTriangle(builder, {
        key: `risk::${plan.risk.id}::icon`,
        role: "risk",
        nodeId: plan.risk.id,
        x: iconX,
        y: iconY,
        size: METRICS.riskIconSize,
        color: style.stroke,
        background: style.background,
        ...shared,
      });
      builder.text({
        key: `risk::${plan.risk.id}::severity`,
        role: "risk",
        nodeId: plan.risk.id,
        x: iconX + METRICS.riskIconSize + 8,
        y: iconY + (METRICS.riskIconSize - TYPE_SCALE.small) / 2,
        text: plan.risk.severity.toUpperCase(),
        maxWidth: INNER,
        fontSize: TYPE_SCALE.small,
        color: style.stroke,
        frameId: frame.id,
        groupIds: [group],
      });

      let inner2 = iconY + METRICS.riskIconSize + 8;
      builder.text({
        key: `risk::${plan.risk.id}::text`,
        role: "risk",
        nodeId: plan.risk.id,
        x: x + METRICS.cardPadding,
        y: inner2,
        text: plan.headline.text,
        maxWidth: INNER,
        fontSize: TYPE_SCALE.body,
        frameId: frame.id,
        groupIds: [group],
      });
      inner2 += plan.headline.height;

      if (plan.mitigation) {
        inner2 += 4;
        builder.text({
          key: `risk::${plan.risk.id}::mitigation`,
          role: "risk",
          nodeId: plan.risk.id,
          x: x + METRICS.cardPadding,
          y: inner2,
          text: plan.mitigation.text,
          maxWidth: INNER,
          fontSize: TYPE_SCALE.small,
          color: PALETTE.muted,
          frameId: frame.id,
          groupIds: [group],
        });
      }
    });
    cursor += rowHeight + METRICS.cardGap;
  });
  if (rows.length > 0) cursor -= METRICS.cardGap;

  if (scopeLines.length > 0) {
    cursor += plans.length > 0 ? 28 : 20;
    const label = builder.text({
      key: "scope::label",
      role: "decor",
      x: ctx.x + pad,
      y: cursor,
      text: "Explicitly out of scope",
      maxWidth: inner,
      fontSize: TYPE_SCALE.small,
      color: "#868e96",
      frameId: frame.id,
    });
    cursor += label.height + 8;

    spec.outOfScope.forEach((item, i) => {
      const el = builder.text({
        key: `scope::${i}`,
        role: "out-of-scope",
        nodeId: `out-of-scope-${i}`,
        ordinal: i,
        x: ctx.x + pad + 16,
        y: cursor,
        text: `✕  ${item}`,
        maxWidth: inner - 16,
        fontSize: TYPE_SCALE.body,
        color: PALETTE.muted,
        frameId: frame.id,
      });
      cursor += el.height + 6;
    });
  }

  return { width: ctx.width, height: frameHeight };
}
