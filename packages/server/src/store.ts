import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseFeedback,
  parseSpecYaml,
  parseDiagramYaml,
  renderPlan,
  renderDiagram,
  type DiagramSpec,
  type ExcalidrawElement,
  type ExcalidrawScene,
  type FeedbackReport,
  type PlanSpec,
  type Snapshot,
} from "gameplan-core";

export interface Submission {
  at: number;
  by: string[];
  report: FeedbackReport;
}

export interface DocState<TSpec> {
  id: string;
  spec: TSpec;
  specYaml: string;
  /** authoritative element set, keyed by id */
  elements: Map<string, ExcalidrawElement>;
  snapshot: Snapshot;
  submissions: Submission[];
  updatedAt: number;
}

export type PlanState = DocState<PlanSpec>;

/**
 * Last-write-wins reconciliation, matching Excalidraw's own collaboration
 * rule: higher `version` wins, ties broken by the lower `versionNonce`. Two
 * clients that saw the same edits therefore converge on the same element
 * without any coordination between them.
 */
export function reconcile(
  local: ExcalidrawElement | undefined,
  remote: ExcalidrawElement,
): ExcalidrawElement {
  if (!local) return remote;
  if (remote.version > local.version) return remote;
  if (remote.version < local.version) return local;
  return remote.versionNonce < local.versionNonce ? remote : local;
}

/**
 * Order elements the way Excalidraw does: plain codepoint comparison of the
 * fractional index.
 *
 * `localeCompare` is wrong here. Indices run a0…a9, aA…aZ, aa…az, b00…, and
 * locale collation treats case and digits differently from codepoint order —
 * enough to reorder the regions and, worse, to sort a frame after its own
 * children, which paints the frame on top of the cards it contains.
 */
export function byFractionalIndex(
  a: { index: string | null },
  b: { index: string | null },
): number {
  const left = a.index ?? "";
  const right = b.index ?? "";
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export interface DocStoreOptions<TSpec> {
  parseYaml: (source: string) => TSpec;
  render: (spec: TSpec) => { scene: ExcalidrawScene; snapshot: Snapshot };
  getId: (spec: TSpec) => string;
  getRevision: (spec: TSpec) => number;
  getTitle: (spec: TSpec) => string;
}

/**
 * Persistence, reconciliation and the review handoff — for whatever kind of
 * document a spec renders into. Plans and diagrams share every one of these
 * concerns (a scene to merge edits into, a spec.yaml to survive a restart, a
 * "send to agent" handoff); only how a spec turns into elements differs,
 * which is exactly what `options.render` isolates.
 */
export class DocStore<TSpec> {
  private readonly docs = new Map<string, DocState<TSpec>>();
  private readonly writeTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly dataDir: string,
    private readonly options: DocStoreOptions<TSpec>,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = await readdir(this.dataDir);
    } catch {
      return;
    }
    for (const id of entries) {
      try {
        await this.load(id);
      } catch {
        // a half-written directory shouldn't stop the server booting
      }
    }
  }

  private dir(id: string): string {
    return join(this.dataDir, id);
  }

  private async load(id: string): Promise<void> {
    const dir = this.dir(id);
    const specPath = join(dir, "spec.yaml");
    const scenePath = join(dir, "scene.excalidraw");
    const snapshotPath = join(dir, "snapshot.json");
    if (!existsSync(specPath) || !existsSync(scenePath) || !existsSync(snapshotPath)) {
      return;
    }

    const specYaml = await readFile(specPath, "utf8");
    const spec = this.options.parseYaml(specYaml);
    const scene = JSON.parse(await readFile(scenePath, "utf8")) as ExcalidrawScene;
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;

    let submissions: Submission[] = [];
    const submissionsPath = join(dir, "submissions.json");
    if (existsSync(submissionsPath)) {
      submissions = JSON.parse(await readFile(submissionsPath, "utf8")) as Submission[];
    }

    this.docs.set(this.options.getId(spec), {
      id: this.options.getId(spec),
      spec,
      specYaml,
      elements: new Map(scene.elements.map((el) => [el.id, el])),
      snapshot,
      submissions,
      updatedAt: Date.now(),
    });
  }

  list(): { id: string; title: string; revision: number; updatedAt: number }[] {
    return [...this.docs.values()]
      .map((d) => ({
        id: d.id,
        title: this.options.getTitle(d.spec),
        revision: this.options.getRevision(d.spec),
        updatedAt: d.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): DocState<TSpec> | undefined {
    return this.docs.get(id);
  }

  /**
   * Render a spec, replacing any previous revision.
   *
   * Human annotations survive: everything without `customData.gameplan` is
   * carried over verbatim. Re-rendering a revised spec must not silently
   * throw away the feedback that prompted the revision.
   */
  render(specYaml: string): DocState<TSpec> {
    const spec = this.options.parseYaml(specYaml);
    const id = this.options.getId(spec);
    const existing = this.docs.get(id);

    const carriedOver: ExcalidrawElement[] = [];
    if (existing) {
      for (const el of existing.elements.values()) {
        if (!el.customData?.gameplan) carriedOver.push(el);
      }
    }

    const { scene, snapshot } = this.options.render(spec);
    const elements = new Map<string, ExcalidrawElement>();
    for (const el of scene.elements) elements.set(el.id, el);
    for (const el of carriedOver) elements.set(el.id, el);

    const state: DocState<TSpec> = {
      id,
      spec,
      specYaml,
      elements,
      snapshot,
      submissions: existing?.submissions ?? [],
      updatedAt: Date.now(),
    };
    this.docs.set(id, state);
    this.schedulePersist(id);
    return state;
  }

  /** Merge inbound elements, returning only those that actually changed. */
  applyElements(id: string, incoming: ExcalidrawElement[]): ExcalidrawElement[] {
    const doc = this.docs.get(id);
    if (!doc) return [];

    const accepted: ExcalidrawElement[] = [];
    for (const remote of incoming) {
      const local = doc.elements.get(remote.id);
      const winner = reconcile(local, remote);
      if (winner === local) continue;
      doc.elements.set(remote.id, winner);
      accepted.push(winner);
    }
    if (accepted.length > 0) {
      doc.updatedAt = Date.now();
      this.schedulePersist(id);
    }
    return accepted;
  }

  scene(id: string): ExcalidrawScene | undefined {
    const doc = this.docs.get(id);
    if (!doc) return undefined;
    return {
      type: "excalidraw",
      version: 2,
      source: "gameplan",
      elements: [...doc.elements.values()].sort(byFractionalIndex),
      appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
      files: {},
    };
  }

  feedback(id: string): FeedbackReport | undefined {
    const doc = this.docs.get(id);
    const scene = this.scene(id);
    if (!doc || !scene) return undefined;
    return parseFeedback(scene, doc.snapshot);
  }

  /** Record an explicit "Send to agent" handoff. */
  submit(id: string, by: string[]): Submission | undefined {
    const doc = this.docs.get(id);
    const report = this.feedback(id);
    if (!doc || !report) return undefined;
    const submission: Submission = { at: Date.now(), by, report };
    doc.submissions.push(submission);
    this.schedulePersist(id);
    return submission;
  }

  latestSubmission(id: string): Submission | undefined {
    const doc = this.docs.get(id);
    if (!doc || doc.submissions.length === 0) return undefined;
    return doc.submissions[doc.submissions.length - 1];
  }

  delete(id: string): boolean {
    const timer = this.writeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(id);
    }
    return this.docs.delete(id);
  }

  /** Debounced so a burst of drag events doesn't turn into a burst of writes. */
  private schedulePersist(id: string): void {
    const existing = this.writeTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.writeTimers.delete(id);
      void this.persist(id);
    }, 500);
    timer.unref?.();
    this.writeTimers.set(id, timer);
  }

  async persist(id: string): Promise<void> {
    const doc = this.docs.get(id);
    const scene = this.scene(id);
    if (!doc || !scene) return;
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeFile(join(dir, "spec.yaml"), doc.specYaml, "utf8"),
      writeFile(join(dir, "scene.excalidraw"), JSON.stringify(scene, null, 2), "utf8"),
      writeFile(join(dir, "snapshot.json"), JSON.stringify(doc.snapshot), "utf8"),
      writeFile(join(dir, "submissions.json"), JSON.stringify(doc.submissions, null, 2), "utf8"),
    ]);
  }

  async flush(): Promise<void> {
    for (const [id, timer] of this.writeTimers) {
      clearTimeout(timer);
      this.writeTimers.delete(id);
      await this.persist(id);
    }
  }
}

const PLAN_OPTIONS: DocStoreOptions<PlanSpec> = {
  parseYaml: parseSpecYaml,
  render: renderPlan,
  getId: (s) => s.id,
  getRevision: (s) => s.revision,
  getTitle: (s) => s.title,
};

const DIAGRAM_OPTIONS: DocStoreOptions<DiagramSpec> = {
  parseYaml: parseDiagramYaml,
  render: renderDiagram,
  getId: (s) => s.id,
  getRevision: (s) => s.revision,
  getTitle: (s) => s.title,
};

/** Kept as a subclass, not just a type alias, so `new PlanStore(dataDir)` still works everywhere it already did. */
export class PlanStore extends DocStore<PlanSpec> {
  constructor(dataDir: string) {
    super(dataDir, PLAN_OPTIONS);
  }
}

export class DiagramStore extends DocStore<DiagramSpec> {
  constructor(dataDir: string) {
    super(dataDir, DIAGRAM_OPTIONS);
  }
}
