import type { FeedbackReport } from "gameplan-core";

/**
 * Render feedback as text an agent can act on directly.
 *
 * The audience here is a model reading stdout, so the format leads with what
 * changed and names the spec node ids to edit — not element ids, which mean
 * nothing outside the canvas.
 */
export function formatReport(
  report: FeedbackReport,
  meta: { submittedAt?: number | null; submittedBy?: string[] } = {},
): string {
  const lines: string[] = [];

  lines.push(`Plan: ${report.planId}  (revision ${report.revision})`);
  if (meta.submittedAt) {
    const who = meta.submittedBy?.length ? ` by ${meta.submittedBy.join(", ")}` : "";
    lines.push(`Submitted ${new Date(meta.submittedAt).toLocaleString()}${who}`);
  }
  lines.push("");

  if (report.empty) {
    lines.push("No changes on the canvas — the plan was left exactly as rendered.");
    return lines.join("\n");
  }

  if (report.removals.length > 0) {
    lines.push("REMOVE — reviewers struck these out:");
    for (const r of report.removals) {
      const how = r.reason === "struck" ? "scribbled over" : "deleted";
      lines.push(`  · ${r.role} "${r.nodeId}"  (${how})`);
    }
    lines.push("");
  }

  if (report.reorders.length > 0) {
    for (const r of report.reorders) {
      lines.push(`REORDER — ${r.region} were dragged into a new order:`);
      lines.push(`  was:  ${r.previous.join(" → ")}`);
      lines.push(`  now:  ${r.order.join(" → ")}`);
      lines.push("");
    }
  }

  if (report.rewrites.length > 0) {
    lines.push("REWRITE — text edited in place:");
    for (const r of report.rewrites) {
      lines.push(`  · ${r.role} "${r.nodeId}"`);
      lines.push(`      was: ${r.before}`);
      lines.push(`      now: ${r.after}`);
    }
    lines.push("");
  }

  if (report.comments.length > 0) {
    const order = ["reject", "add", "question", "approve"] as const;
    const grouped = new Map<string, typeof report.comments>();
    for (const c of report.comments) {
      const list = grouped.get(c.intent) ?? [];
      list.push(c);
      grouped.set(c.intent, list);
    }
    for (const intent of order) {
      const list = grouped.get(intent);
      if (!list?.length) continue;
      lines.push(`${intent.toUpperCase()} — ${list.length} note(s):`);
      for (const c of list) {
        const target = c.anchor.nodeId
          ? `${c.anchor.role} "${c.anchor.nodeId}"`
          : c.anchor.role === "frame"
            ? "the whole region"
            : "unanchored";
        const confidence = c.anchor.via === "proximity" ? " (inferred by position)" : "";
        const author = c.author ? ` — ${c.author}` : "";
        lines.push(`  · on ${target}${confidence}${author}`);
        for (const line of c.text.split("\n")) lines.push(`      ${line}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "Apply these to the spec, bump `revision`, and re-render. " +
      "Anything you disagree with, say so rather than silently dropping it.",
  );
  return lines.join("\n").trimEnd();
}
