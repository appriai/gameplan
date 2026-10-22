import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import {
  PanelsDiagram,
  SpecError,
  parseFeedback,
  renderDiagram,
} from "gameplan-core";
import { DiagramStore } from "./store.js";

const legacyShapes = [
  { name: "layout fields beside panels", top: {
    layout: "graph", direction: "LR", nodes: [{ id: "ignored", label: "Ignored" }],
    edges: [], clusters: [], actors: [], messages: [],
  }, panel: {} },
  { name: "style beside panels", top: { style: "clean" }, panel: {} },
  { name: "panel revision", top: {}, panel: { revision: 3 } },
  { name: "title panel id", top: {}, panel: { id: "title" } },
  { name: "note panel id", top: {}, panel: { id: "note" } },
];

const stores: DiagramStore[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("saved diagram compatibility", () => {
  it.each(legacyShapes)("restores $name without losing review state", async ({ top, panel }) => {
    const dataDir = await mkdtemp(join(tmpdir(), "gameplan-store-"));
    directories.push(dataDir);
    const input = {
      id: "saved-diagram", title: "Saved diagram", revision: 1, ...top,
      panels: [{ id: "arch", title: "Architecture", layout: "graph", nodes: [{ id: "api", label: "API" }], ...panel }],
    };
    // The previous parser accepted these fields through the panels schema.
    const spec = PanelsDiagram.parse(input);
    const { scene, snapshot } = renderDiagram(spec, { now: 1 });
    const node = scene.elements.find((el) => el.type === "rectangle")!;
    const annotation = { ...node, id: "human-note", customData: undefined };
    scene.elements.push(annotation);
    const submissions = [{ at: 2, by: ["Reviewer"], report: parseFeedback(scene, snapshot) }];
    const specYaml = stringify(input);
    const docDir = join(dataDir, input.id);
    await mkdir(docDir);
    await Promise.all([
      writeFile(join(docDir, "spec.yaml"), specYaml),
      writeFile(join(docDir, "scene.excalidraw"), JSON.stringify(scene)),
      writeFile(join(docDir, "snapshot.json"), JSON.stringify(snapshot)),
      writeFile(join(docDir, "submissions.json"), JSON.stringify(submissions)),
    ]);

    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new DiagramStore(dataDir);
    stores.push(store);
    await store.init();
    expect(store.list().map((doc) => doc.id)).toEqual([input.id]);
    expect(store.get(input.id)?.snapshot).toEqual(snapshot);
    expect(store.get(input.id)?.submissions).toEqual(submissions);
    expect(store.get(input.id)?.specYaml).toBe(specYaml);
    expect(store.scene(input.id)?.elements.find((el) => el.id === annotation.id)).toEqual(annotation);
    expect(warnings).toHaveBeenCalledOnce();
    expect(warnings.mock.calls.flat().join(" ")).toContain(input.id);
    expect(await readFile(join(docDir, "spec.yaml"), "utf8")).toBe(specYaml);

    // Compatibility applies only to loading: submitting the old YAML still fails.
    expect(() => store.render(specYaml)).toThrow(SpecError);
    expect(store.get(input.id)?.specYaml).toBe(specYaml);

    const correctedYaml = stringify({
      ...spec, revision: 2, panels: spec.panels.map((entry) => ({ ...entry, id: "arch" })),
    });
    store.render(correctedYaml);
    await store.flush();
    warnings.mockClear();
    const restarted = new DiagramStore(dataDir);
    stores.push(restarted);
    await restarted.init();
    expect(restarted.get(input.id)?.spec.revision).toBe(2);
    expect(restarted.scene(input.id)?.elements.find((el) => el.id === annotation.id)).toEqual(annotation);
    expect(restarted.get(input.id)?.submissions).toEqual(submissions);
    expect(warnings).not.toHaveBeenCalled();
  });

  it("reports an invalid saved spec without preventing other diagrams from loading", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gameplan-store-"));
    directories.push(dataDir);
    const original = new DiagramStore(dataDir);
    stores.push(original);
    const validYaml = stringify({
      id: "valid", title: "Valid", panels: [{
        id: "arch", title: "Architecture", layout: "graph", nodes: [{ id: "api", label: "API" }],
      }],
    });
    original.render(validYaml);
    await original.flush();
    const invalidDir = join(dataDir, "invalid");
    await mkdir(invalidDir);
    await Promise.all([
      writeFile(join(invalidDir, "spec.yaml"), stringify({
        id: "invalid", title: "Invalid", layout: "graph", panels: [{
          id: "arch", title: "Architecture", layout: "graph", nodes: [{ id: "api", label: "API" }],
          edges: [{ from: "api", to: "missing" }],
        }],
      })),
      writeFile(join(invalidDir, "scene.excalidraw"), "{}"),
      writeFile(join(invalidDir, "snapshot.json"), "{}"),
    ]);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const restarted = new DiagramStore(dataDir);
    stores.push(restarted);
    await restarted.init();
    expect(restarted.list().map((doc) => doc.id)).toEqual(["valid"]);
    expect(restarted.get("invalid")).toBeUndefined();
    expect(warnings).toHaveBeenCalledOnce();
    const diagnostic = warnings.mock.calls.flat().join(" ");
    expect(diagnostic).toContain("invalid");
    expect(diagnostic).toContain("missing");
  });
});
