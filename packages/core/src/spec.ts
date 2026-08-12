import { z } from "zod";
import { parse as parseYaml } from "yaml";

/**
 * The PlanSpec is the *only* thing an agent authors. It is deliberately
 * semantic: no coordinates, no colors, no Excalidraw JSON. Layout is this
 * package's job, because models place geometry badly and describe intent well.
 */

const nodeId = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, "ids must be alphanumeric with - or _");

export const SurfaceKind = z.enum(["new", "modified", "read", "untouched"]);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

export const Severity = z.enum(["low", "med", "high"]);
export type Severity = z.infer<typeof Severity>;

export const SurfaceNode = z.object({
  id: nodeId,
  path: z.string().min(1),
  kind: SurfaceKind.default("modified"),
  note: z.string().optional(),
  /** ids of other surface nodes this one depends on; drawn as arrows */
  dependsOn: z.array(nodeId).default([]),
});
export type SurfaceNode = z.infer<typeof SurfaceNode>;

export const Step = z.object({
  id: nodeId,
  title: z.string().min(1),
  detail: z.string().optional(),
  /** file paths touched; shown on the card so blast radius is visible */
  files: z.array(z.string()).default([]),
  /** how you'll know this step worked */
  verify: z.string().optional(),
  dependsOn: z.array(nodeId).default([]),
});
export type Step = z.infer<typeof Step>;

export const ForkOption = z.object({
  id: nodeId,
  label: z.string().min(1),
  rationale: z.string().min(1),
  chosen: z.boolean().default(false),
});
export type ForkOption = z.infer<typeof ForkOption>;

export const Fork = z
  .object({
    id: nodeId,
    question: z.string().min(1),
    /** optional step id this decision belongs to */
    atStep: nodeId.optional(),
    options: z.array(ForkOption).min(2, "a fork needs at least two options"),
  })
  .refine((f) => f.options.filter((o) => o.chosen).length === 1, {
    message: "exactly one option must be marked chosen",
    path: ["options"],
  });
export type Fork = z.infer<typeof Fork>;

export const Risk = z.object({
  id: nodeId,
  text: z.string().min(1),
  severity: Severity.default("med"),
  /** what we'd do about it */
  mitigation: z.string().optional(),
});
export type Risk = z.infer<typeof Risk>;

export const PlanSpec = z.object({
  id: nodeId,
  title: z.string().min(1),
  goal: z.string().min(1),
  successCriteria: z.array(z.string()).default([]),
  surface: z.array(SurfaceNode).default([]),
  steps: z.array(Step).default([]),
  forks: z.array(Fork).default([]),
  risks: z.array(Risk).default([]),
  outOfScope: z.array(z.string()).default([]),
  /** bumped by the agent on each revision; shown on the canvas */
  revision: z.number().int().nonnegative().default(1),
});
export type PlanSpec = z.infer<typeof PlanSpec>;

export class SpecError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "SpecError";
  }
}

/** Cross-field checks zod can't express cheaply: dangling id references. */
function checkReferences(spec: PlanSpec): string[] {
  const issues: string[] = [];
  const stepIds = new Set(spec.steps.map((s) => s.id));
  const surfaceIds = new Set(spec.surface.map((s) => s.id));

  // ids are scoped per collection: a step and a surface node may share a name,
  // and usually should — `limiter` the step builds `limiter` the file
  const collections: [string, { id: string }[]][] = [
    ["step", spec.steps],
    ["surface", spec.surface],
    ["fork", spec.forks],
    ["risk", spec.risks],
  ];
  for (const [label, list] of collections) {
    const seen = new Set<string>();
    for (const node of list) {
      if (seen.has(node.id)) issues.push(`duplicate ${label} id "${node.id}"`);
      seen.add(node.id);
    }
  }
  for (const fork of spec.forks) {
    const seen = new Set<string>();
    for (const option of fork.options) {
      if (seen.has(option.id)) {
        issues.push(`duplicate option id "${option.id}" in fork "${fork.id}"`);
      }
      seen.add(option.id);
    }
  }

  for (const step of spec.steps) {
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        issues.push(`step "${step.id}" dependsOn unknown step "${dep}"`);
      }
    }
  }
  for (const node of spec.surface) {
    for (const dep of node.dependsOn) {
      if (!surfaceIds.has(dep)) {
        issues.push(`surface "${node.id}" dependsOn unknown surface "${dep}"`);
      }
    }
  }
  for (const fork of spec.forks) {
    if (fork.atStep && !stepIds.has(fork.atStep)) {
      issues.push(`fork "${fork.id}" atStep references unknown step "${fork.atStep}"`);
    }
  }
  return issues;
}

export function parseSpec(input: unknown): PlanSpec {
  const result = PlanSpec.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new SpecError(`invalid plan spec:\n  ${issues.join("\n  ")}`, issues);
  }
  const refIssues = checkReferences(result.data);
  if (refIssues.length > 0) {
    throw new SpecError(
      `invalid plan spec:\n  ${refIssues.join("\n  ")}`,
      refIssues,
    );
  }
  return result.data;
}

export function parseSpecYaml(source: string): PlanSpec {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (err) {
    throw new SpecError(
      `could not parse YAML: ${(err as Error).message}`,
      [(err as Error).message],
    );
  }
  return parseSpec(doc);
}
