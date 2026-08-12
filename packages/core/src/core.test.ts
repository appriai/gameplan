import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSpec, parseSpecYaml, SpecError } from "./spec.js";
import { renderPlan, type Snapshot } from "./render.js";
import { parseFeedback } from "./feedback.js";
import { createIndexGenerator, elementId } from "./ids.js";
import { measureLine, measureText, truncatePath, wrapText } from "./text.js";
import { FONT, PALETTE } from "./theme.js";
import type { ExcalidrawElement, ExcalidrawScene } from "./excalidraw.js";

const EXAMPLE = fileURLToPath(
  new URL("../../../examples/rate-limiting.plan.yaml", import.meta.url),
);

function loadExample() {
  return parseSpecYaml(readFileSync(EXAMPLE, "utf8"));
}

const FIXED_NOW = 1_700_000_000_000;

describe("spec", () => {
  it("accepts the example plan", () => {
    const spec = loadExample();
    expect(spec.steps).toHaveLength(5);
    expect(spec.forks).toHaveLength(2);
  });

  it("scopes ids per collection", () => {
    const spec = parseSpec({
      id: "p",
      title: "t",
      goal: "g",
      steps: [{ id: "limiter", title: "build it" }],
      surface: [{ id: "limiter", path: "src/limiter.ts" }],
    });
    expect(spec.steps[0]!.id).toBe("limiter");
  });

  it("rejects duplicate ids within one collection", () => {
    expect(() =>
      parseSpec({
        id: "p",
        title: "t",
        goal: "g",
        steps: [
          { id: "a", title: "one" },
          { id: "a", title: "two" },
        ],
      }),
    ).toThrow(SpecError);
  });

  it("rejects a fork without exactly one chosen option", () => {
    expect(() =>
      parseSpec({
        id: "p",
        title: "t",
        goal: "g",
        forks: [
          {
            id: "f",
            question: "which?",
            options: [
              { id: "a", label: "A", rationale: "r" },
              { id: "b", label: "B", rationale: "r" },
            ],
          },
        ],
      }),
    ).toThrow(/exactly one option/);
  });

  it("rejects dangling dependsOn references", () => {
    expect(() =>
      parseSpec({
        id: "p",
        title: "t",
        goal: "g",
        steps: [{ id: "a", title: "one", dependsOn: ["ghost"] }],
      }),
    ).toThrow(/unknown step "ghost"/);
  });
});

describe("ids", () => {
  it("is deterministic across calls", () => {
    expect(elementId("plan", "step::a")).toBe(elementId("plan", "step::a"));
    expect(elementId("plan", "step::a")).not.toBe(elementId("plan", "step::b"));
    expect(elementId("plan", "step::a")).toHaveLength(21);
  });

  it("generates strictly ascending fractional indices", () => {
    const next = createIndexGenerator();
    const keys = Array.from({ length: 200 }, () => next());
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("a0");
  });
});

describe("text", () => {
  it("wraps to the requested width", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 16, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, 16, 1000).width).toBeLessThanOrEqual(125);
    }
  });

  it("honours explicit newlines", () => {
    expect(wrapText("a\nb", 16, 500)).toEqual(["a", "b"]);
  });

  it("breaks words that cannot fit at all", () => {
    const lines = wrapText("supercalifragilisticexpialidocious", 16, 60);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("keeps the informative tail when truncating paths", () => {
    const out = truncatePath("src/very/deep/nested/module/handler.ts", 12, 90);
    expect(out.endsWith("handler.ts")).toBe(true);
    expect(out.startsWith("…")).toBe(true);
  });

  /**
   * Ground truth: `canvas.measureText` against the real fonts, captured from a
   * browser running Excalidraw 0.18.1. If these drift, text will clip inside
   * cards — regenerate per scripts/calibrate.md rather than loosening them.
   */
  it("measures within 5% of the real fonts", () => {
    const samples: [number, string, number, number][] = [
      [FONT.hand, "1.  Sliding-window limiter", 20, 231.44],
      [FONT.hand, "Redis sorted-set window, returns remaining budget and reset time.", 16, 519.59],
      [FONT.hand, "Zero infra and fastest, but wrong the moment we run more than one", 16, 537.54],
      [FONT.hand, "✓  Integration test against a real Redis hits the boundary exactly", 12, 395.61],
      [FONT.hand, "Add rate limiting to the public API", 28, 473.76],
      [FONT.code, "src/http/middleware/rateLimit.ts", 12, 225],
      [FONT.code, "src/ratelimit/limiter.ts", 16, 225],
    ];
    for (const [family, text, size, expected] of samples) {
      const actual = measureLine(text, size, family);
      const error = Math.abs(actual - expected) / expected;
      expect(error, `${text.slice(0, 30)} — got ${actual.toFixed(1)}, real ${expected}`).toBeLessThan(0.05);
    }
  });

  it("never underestimates, so text cannot overflow its card", () => {
    // clipping is the failure that matters; wrapping a hair early is invisible
    const samples: [number, string, number, number][] = [
      [FONT.hand, "1.  Sliding-window limiter", 20, 231.44],
      [FONT.hand, "Add rate limiting to the public API", 28, 473.76],
      [FONT.code, "src/http/middleware/rateLimit.ts", 12, 225],
    ];
    for (const [family, text, size, real] of samples) {
      expect(measureLine(text, size, family)).toBeGreaterThanOrEqual(real);
    }
  });

  it("reports height as lines * fontSize * lineHeight", () => {
    const m = measureText("one\ntwo\nthree", 20, 500);
    expect(m.lines).toHaveLength(3);
    expect(m.height).toBe(Math.ceil(3 * 20 * 1.25));
  });
});

describe("render", () => {
  it("produces a structurally valid scene", () => {
    const { scene } = renderPlan(loadExample(), { now: FIXED_NOW });
    const ids = new Set(scene.elements.map((e) => e.id));
    expect(ids.size).toBe(scene.elements.length);

    for (const el of scene.elements) {
      for (const bound of el.boundElements ?? []) expect(ids.has(bound.id)).toBe(true);
      if (el.frameId) expect(ids.has(el.frameId)).toBe(true);
      if ("containerId" in el && el.containerId) {
        expect(ids.has(el.containerId as string)).toBe(true);
      }
      if ("startBinding" in el && el.startBinding) {
        expect(ids.has((el.startBinding as { elementId: string }).elementId)).toBe(true);
      }
    }
  });

  it("orders elements by ascending fractional index", () => {
    const { scene } = renderPlan(loadExample(), { now: FIXED_NOW });
    const indices = scene.elements.map((e) => e.index!);
    expect([...indices].sort()).toEqual(indices);
  });

  it("draws frames before their children so cards stay on top", () => {
    const { scene } = renderPlan(loadExample(), { now: FIXED_NOW });
    for (const el of scene.elements) {
      if (!el.frameId) continue;
      const frameAt = scene.elements.findIndex((e) => e.id === el.frameId);
      const childAt = scene.elements.findIndex((e) => e.id === el.id);
      expect(frameAt).toBeLessThan(childAt);
    }
  });

  it("is byte-identical for an unchanged spec", () => {
    const a = renderPlan(loadExample(), { now: FIXED_NOW });
    const b = renderPlan(loadExample(), { now: FIXED_NOW });
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
  });

  it("keeps element ids stable when unrelated content changes", () => {
    const spec = loadExample();
    const before = renderPlan(spec, { now: FIXED_NOW });
    const mutated = { ...spec, risks: spec.risks.slice(0, 1) };
    const after = renderPlan(mutated, { now: FIXED_NOW });

    const stepId = (r: typeof before) =>
      r.scene.elements.find(
        (e) => e.customData?.gameplan?.role === "step" && e.customData.gameplan.nodeId === "limiter",
      )!.id;
    expect(stepId(after)).toBe(stepId(before));
  });

  it("tags every generated element with plan metadata", () => {
    const { scene } = renderPlan(loadExample(), { now: FIXED_NOW });
    for (const el of scene.elements) {
      expect(el.customData?.gameplan?.planId).toBe("rate-limiting");
    }
  });

  it("marks exactly one fork option as chosen per fork", () => {
    const { scene } = renderPlan(loadExample(), { now: FIXED_NOW });
    const chosen = scene.elements.filter(
      (e) =>
        e.customData?.gameplan?.role === "fork-option" &&
        e.type === "rectangle" &&
        e.backgroundColor === PALETTE.bgGreen,
    );
    expect(chosen).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- feedback

function annotate(
  scene: ExcalidrawScene,
  overrides: Partial<ExcalidrawElement> & { id: string },
): ExcalidrawElement {
  const base: ExcalidrawElement = {
    id: overrides.id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    angle: 0,
    strokeColor: PALETTE.ink,
    backgroundColor: PALETTE.transparent,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "zz",
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: FIXED_NOW,
    link: null,
    locked: false,
  };
  return { ...base, ...overrides } as ExcalidrawElement;
}

function stepCard(scene: ExcalidrawScene, nodeId: string): ExcalidrawElement {
  return scene.elements.find(
    (e) =>
      e.customData?.gameplan?.role === "step" &&
      e.customData.gameplan.nodeId === nodeId &&
      e.type === "rectangle",
  )!;
}

describe("feedback", () => {
  function base(): { scene: ExcalidrawScene; snapshot: Snapshot } {
    const { scene, snapshot } = renderPlan(loadExample(), { now: FIXED_NOW });
    return { scene: structuredClone(scene), snapshot };
  }

  it("reports nothing for an untouched canvas", () => {
    const { scene, snapshot } = base();
    const report = parseFeedback(scene, snapshot);
    expect(report.empty).toBe(true);
  });

  it("reads intent from the sticky's background colour", () => {
    const { scene, snapshot } = base();
    const card = stepCard(scene, "degrade");
    scene.elements.push(
      annotate(scene, {
        id: "note-1",
        x: card.x + 10,
        y: card.y + 10,
        width: 80,
        height: 40,
        backgroundColor: PALETTE.bgRed,
      }),
      annotate(scene, {
        id: "note-1-text",
        type: "text",
        x: card.x + 12,
        y: card.y + 12,
        text: "fail-open is a security decision, not a detail",
        originalText: "fail-open is a security decision, not a detail",
        containerId: "note-1",
        fontSize: 16,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        autoResize: false,
        lineHeight: 1.25,
      } as Partial<ExcalidrawElement> & { id: string }),
    );

    const report = parseFeedback(scene, snapshot);
    expect(report.comments).toHaveLength(1);
    expect(report.comments[0]!.intent).toBe("reject");
    expect(report.comments[0]!.anchor.nodeId).toBe("degrade");
    expect(report.comments[0]!.anchor.via).toBe("containment");
  });

  it("prefers stamped annotation metadata over colour", () => {
    const { scene, snapshot } = base();
    const card = stepCard(scene, "rollout");
    scene.elements.push(
      annotate(scene, {
        id: "note-2",
        type: "text",
        x: card.x + 20,
        y: card.y + 20,
        width: 100,
        height: 20,
        text: "ship it",
        originalText: "ship it",
        containerId: null,
        fontSize: 16,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        autoResize: false,
        lineHeight: 1.25,
        backgroundColor: PALETTE.bgRed,
        customData: {
          gameplanAnnotation: {
            v: 1,
            kind: "annotation",
            intent: "approve",
            author: "Sam",
            createdAt: FIXED_NOW,
          },
        },
      } as Partial<ExcalidrawElement> & { id: string }),
    );

    const report = parseFeedback(scene, snapshot);
    expect(report.comments[0]!.intent).toBe("approve");
    expect(report.comments[0]!.author).toBe("Sam");
  });

  it("detects a deleted step card", () => {
    const { scene, snapshot } = base();
    const card = stepCard(scene, "rollout");
    scene.elements = scene.elements.filter((e) => e.id !== card.id);

    const report = parseFeedback(scene, snapshot);
    expect(report.removals).toContainEqual({
      role: "step",
      nodeId: "rollout",
      reason: "deleted",
    });
  });

  it("treats a scribble covering a card as a strike", () => {
    const { scene, snapshot } = base();
    const card = stepCard(scene, "degrade");
    scene.elements.push(
      annotate(scene, {
        id: "scribble",
        type: "freedraw",
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
        points: [
          [0, 0],
          [card.width, card.height],
        ],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: null,
      } as Partial<ExcalidrawElement> & { id: string }),
    );

    const report = parseFeedback(scene, snapshot);
    expect(report.removals).toContainEqual({
      role: "step",
      nodeId: "degrade",
      reason: "struck",
    });
  });

  it("detects reordering from dragged cards", () => {
    const { scene, snapshot } = base();
    const first = stepCard(scene, "config");
    const second = stepCard(scene, "limiter");
    const firstX = first.x;
    first.x = second.x;
    second.x = firstX;

    const report = parseFeedback(scene, snapshot);
    expect(report.reorders).toHaveLength(1);
    expect(report.reorders[0]!.order.slice(0, 2)).toEqual(["limiter", "config"]);
    expect(report.reorders[0]!.previous.slice(0, 2)).toEqual(["config", "limiter"]);
  });

  it("ignores sub-threshold nudges", () => {
    const { scene, snapshot } = base();
    stepCard(scene, "config").x += 3;
    expect(parseFeedback(scene, snapshot).reorders).toHaveLength(0);
  });

  it("detects in-place text rewrites", () => {
    const { scene, snapshot } = base();
    const title = scene.elements.find(
      (e) =>
        e.customData?.gameplan?.role === "step-field" &&
        e.customData.gameplan.nodeId === "config" &&
        "originalText" in e &&
        (e as { originalText: string }).originalText.includes("Quota"),
    )! as ExcalidrawElement & { originalText: string; text: string };

    title.originalText = "1.  Quota configuration, hot-reloaded";
    const report = parseFeedback(scene, snapshot);
    expect(report.rewrites).toHaveLength(1);
    expect(report.rewrites[0]!.nodeId).toBe("config");
    expect(report.rewrites[0]!.after).toContain("hot-reloaded");
  });

  it("does not match a note across region boundaries", () => {
    const { scene, snapshot } = base();
    const goalFrame = scene.elements.find(
      (e) => e.type === "frame" && (e as { name?: string }).name?.startsWith("Goal"),
    )!;
    // bottom-right of the Goal frame: geometrically closer to the first Steps
    // card than to anything inside Goal
    scene.elements.push(
      annotate(scene, {
        id: "goal-note",
        type: "text",
        x: goalFrame.x + goalFrame.width - 120,
        y: goalFrame.y + goalFrame.height - 30,
        width: 100,
        height: 20,
        text: "is this the right goal at all?",
        originalText: "is this the right goal at all?",
        containerId: null,
        fontSize: 16,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        autoResize: false,
        lineHeight: 1.25,
        backgroundColor: PALETTE.bgYellow,
      } as Partial<ExcalidrawElement> & { id: string }),
    );

    const comment = parseFeedback(scene, snapshot).comments.find((c) =>
      c.text.includes("right goal"),
    )!;
    expect(comment.anchor.role).not.toBe("step");
  });

  it("anchors via an arrow drawn from the sticky to a card", () => {
    const { scene, snapshot } = base();
    const card = stepCard(scene, "middleware");
    // sticky placed far away, so proximity would pick the wrong card
    scene.elements.push(
      annotate(scene, {
        id: "far-note",
        type: "text",
        x: card.x + 3000,
        y: card.y + 3000,
        width: 120,
        height: 20,
        text: "which status code exactly?",
        originalText: "which status code exactly?",
        containerId: null,
        fontSize: 16,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        autoResize: false,
        lineHeight: 1.25,
        backgroundColor: PALETTE.bgYellow,
      } as Partial<ExcalidrawElement> & { id: string }),
      annotate(scene, {
        id: "far-arrow",
        type: "arrow",
        x: card.x + 3000,
        y: card.y + 3000,
        points: [
          [0, 0],
          [-3000, -3000],
        ],
        lastCommittedPoint: null,
        startBinding: { elementId: "far-note", focus: 0, gap: 4 },
        endBinding: { elementId: card.id, focus: 0, gap: 4 },
        startArrowhead: null,
        endArrowhead: "arrow",
        elbowed: false,
      } as Partial<ExcalidrawElement> & { id: string }),
    );

    const report = parseFeedback(scene, snapshot);
    const comment = report.comments.find((c) => c.text.includes("status code"))!;
    expect(comment.anchor.via).toBe("arrow");
    expect(comment.anchor.nodeId).toBe("middleware");
  });
});
