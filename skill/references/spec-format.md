# PlanSpec reference

The spec is the only thing you author. Layout, colour, ids, geometry and z-order all belong to
the renderer. If you find yourself wanting to control placement, that's a renderer change, not
a spec field.

Validation runs locally before anything touches the server, so a malformed spec fails fast with
line-level messages.

## Top level

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Required. Stable slug, `[A-Za-z0-9_-]+`. Re-rendering with the same id updates the same canvas. |
| `title` | string | — | Required. Shown in the Goal frame and the app's title bar. |
| `goal` | string | — | Required. One paragraph: what changes and why. |
| `revision` | int | `1` | Bump on every re-render so reviewers can see they're looking at something new. |
| `successCriteria` | string[] | `[]` | Rendered as a checklist. |
| `forks` | Fork[] | `[]` | Decision points. |
| `surface` | SurfaceNode[] | `[]` | Files and their relationships. |
| `steps` | Step[] | `[]` | Execution order. |
| `risks` | Risk[] | `[]` | What could go wrong. |
| `outOfScope` | string[] | `[]` | What you are deliberately not doing. |
| `diagrams` | PlanDiagram[] | `[]` | Supporting pictures — architecture, a request sequence. See below. |

## Step

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Required, unique among steps. |
| `title` | string | — | Required. Short imperative phrase. |
| `detail` | string | — | One or two sentences. Longer belongs in `verify` or a fork. |
| `files` | string[] | `[]` | Paths, shown in code type on the card. Long paths are truncated head-first, keeping the filename. |
| `verify` | string | — | How you'll know this step worked. Reviewers catch weak verification fast. |
| `dependsOn` | string[] | `[]` | Other step ids. Drawn as arrows. Sequence alone is already implied by numbering, so only add real dependencies. |

## Fork

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Required, unique among forks. |
| `question` | string | — | Required. Phrase as a question. |
| `atStep` | string | — | Optional step id this decision belongs to. |
| `options` | ForkOption[] | — | Required, at least two, **exactly one** with `chosen: true`. |

ForkOption: `id`, `label`, `rationale` (all required), `chosen` (default `false`).

The chosen option renders solid and filled; rejected options render dashed and dimmed with
their rationale still legible. That contrast is the whole reason the section exists.

## SurfaceNode

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Required, unique among surface nodes. |
| `path` | string | — | Required. Repo-relative path. |
| `kind` | enum | `modified` | `new` (green) · `modified` (blue) · `read` (grey) · `untouched` (outline). |
| `note` | string | — | Why this file is involved. |
| `dependsOn` | string[] | `[]` | Other surface ids; laid out left-to-right by dagre. |

## Risk

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Required, unique among risks. |
| `text` | string | — | Required. The failure mode, concretely. |
| `severity` | enum | `med` | `low` · `med` · `high`. Drives colour. |
| `mitigation` | string | — | What you'd do about it. |

## PlanDiagram

An entry in `diagrams`. Identical to a standalone diagram from
`references/diagram-format.md` — every `graph` and `sequence` field applies —
except it has **no `revision`**: the plan around it owns that.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Required, unique among the plan's diagrams. Also namespaces its nodes in feedback, so a comment reads `diagram-node "request-path:limiter"`. |
| `title` | string | Required. Becomes the frame name. |
| `note` | string | Optional one-line subtitle. |
| `layout` | `graph` \| `sequence` | Required. Selects the layout from the catalogue. |
| …rest | — | Per layout: `nodes`/`edges`/`clusters`/`direction`, or `actors`/`messages`. |

Two diagrams in one plan may reuse node ids freely — `api` in one and `api` in
another stay distinct, both on the canvas and in feedback.

Rendered between the Goal and Steps frames: a plan's diagram is orientation, so
it comes before what we intend to do to the system. A plan with no diagrams
renders no frame and no gap.

Default to including one — see SKILL.md for the handful of cases where a plan
genuinely doesn't need a diagram.

## Validation rules

Beyond types:

- ids are unique **within** each collection, not across them — the step `limiter` and the file
  `limiter` are a good pairing, not a clash.
- Every `dependsOn` must name an existing id in the same collection.
- `fork.atStep` must name an existing step.
- Every fork needs ≥2 options and exactly one `chosen`.
- Diagram ids are unique within the plan, and each diagram's own edges/messages
  must reference nodes/actors it declares. Errors name the diagram:
  `diagram "request-path": edges[0] references unknown node "ghost"`.

## Canvas regions

Rendered top to bottom, in reading order, each in a named Excalidraw frame. The canvas is
illustration-led — a journey map, not a stack of index cards:

1. **Goal** — flag icon, title, goal, success criteria
2. **Diagrams** — one frame per entry in `diagrams`, if any. Orientation before intent.
3. **Steps** — numbered waypoints on one connected path, left to right, each with a short
   title plus a file glyph and a checkmark caption. Grouped, so dragging a waypoint moves the
   whole step — that drag is the reorder signal.
4. **Decision forks** — a diamond fanning into one lane per option. The chosen lane is solid
   and bold, landing on a filled dot; rejected lanes are dashed and faded, landing on hollow
   ones, with their rationale still readable.
5. **Code surface** — dagre-laid dependency graph of icon-and-filename nodes, coloured by kind
6. **Risks & out of scope** — each risk led by a severity-coloured warning triangle

**Legend** sits to the right of the stack. It documents both halves of the contract: how to
*read* the visual language (waypoint, diamond, solid vs. dashed lane, the icons) and how to
*write* on it (the sticky colour protocol), for whoever opens the link cold.

Captions wrap to two or three short lines and only ellipsize if they genuinely don't fit — the
full text always stays in this spec, so write the sentence you mean rather than pre-truncating
it. Filenames are the exception: they're identifiers, kept to one line.

Empty sections render an explicit note ("No branch points — this plan has one obvious path")
rather than a silent gap, so a reviewer can tell the difference between "nothing to say" and
"forgot to fill this in".
