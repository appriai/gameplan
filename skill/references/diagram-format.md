# DiagramSpec reference

A diagram is not a plan review — it's "draw this": a system, a data flow, a sequence of
calls. Same rule as PlanSpec: you write structure, the renderer owns geometry. Render with
`gameplan draw <diagram.yaml>`, which gives it its own URL (`/d/<id>`), independent of any
plan.

Everything on this page — both layout kinds, every field — applies equally to a diagram
embedded in a plan's `diagrams:` array. The only difference is the envelope: a `PlanDiagram`
has no `revision` of its own, since the plan around it owns that. See
`references/spec-format.md`'s `PlanDiagram` section for the embedded shape, and SKILL.md's
"Diagrams inside a plan" for when to reach for one.

## Choosing a layout kind

The `layout` field selects which algorithm in the catalogue lays it out. Three ship today:

| `layout` | Use for | Reads like |
|---|---|---|
| `graph` | Architecture, dependency graphs, data flow, call graphs | Boxes and arrows, auto-laid-out by dagre |
| `flowchart` | A procedure or decision flow — what happens, in what order, and where it branches | Ovals, boxes and decision diamonds, hand-drawn |
| `sequence` | A specific interaction over time — a request's path through a system | Actor columns, messages flowing down through time |

If none fits — a state machine, an ER diagram — say so rather than forcing a `graph` to
look like something it isn't. The catalogue is meant to grow; see "Adding a layout kind" below.

## `graph`

```yaml
id: system-architecture       # stable slug — reusing it updates the same diagram
title: How auth fits into the system
layout: graph
direction: LR                 # LR reads like a pipeline; TB reads like a hierarchy
note: Optional subtitle under the title.

clusters:                     # optional — a labelled boundary around a group of nodes
  - id: auth-service
    label: auth-service (own repo)

nodes:
  - id: gateway
    label: API gateway
    icon: file                # file | warning | flag | check | cross | none
    color: blue                # ink | green | blue | red | yellow | violet | grey
    note: Terminates TLS, routes by path
  - id: auth-api
    label: auth-api
    icon: file
    color: blue
    cluster: auth-service      # id of a cluster above

edges:
  - from: gateway
    to: auth-api
    label: optional edge label
    style: solid                # solid | dashed
```

Ids are scoped per collection — a node and a cluster can share an id space concern only with
each other, not across sections.

Icon vocabulary is deliberately small: `file` for a system/service/store, `warning` for
something risky, `flag` for a goal/destination, `check` for a verified/done state, `cross` for
something removed or rejected, `none` for a plain box. Colour carries the rest of the meaning —
`green` for new/healthy, `red` for risk, `blue` for a normal service, `grey` for out-of-band or
read-only.

## `flowchart`

```yaml
id: deploy-flow
title: Deploying a release
layout: flowchart
direction: TB                 # TB reads like a procedure (default); LR suits a wide, shallow flow
style: sketch                 # sketch (default): rough strokes, pencil hatching | clean: crisp, solid

nodes:
  - id: start
    label: Merge to main
    shape: terminator         # terminator (oval: start/end) | process (box, default) | decision (diamond)
  - id: green
    label: Tests pass?
    shape: decision
  - id: fix
    label: Fix the failing test
    color: red                # optional — defaults: terminator green, process blue, decision yellow

edges:
  - from: green
    to: fix
    label: "no"               # a decision's branch; quote yes/no so YAML keeps them as strings
  - from: fix
    to: build
    label: retry
    style: dashed             # solid | dashed
```

Reach for `flowchart` over `graph` when the reader follows a path through it — steps, a
question, a branch — rather than surveying a system. Phrase decisions as questions and label
every edge leaving one. Unambiguous forward edges are drawn straight; parallel branches retain
separate routes and labels. An edge back to an earlier step is routed around the steps in between,
so loops ("retry", "try again") read naturally.

Labels wrap to at most three lines inside their shape — keep them to a few words. See
`examples/deploy.flowchart.yaml`.

## `sequence`

```yaml
id: login-flow
title: Login request, happy path
layout: sequence
note: What actually happens between "submit" and the cookie landing.

actors:
  - id: client
    label: Browser
  - id: api
    label: auth-api

messages:                     # rendered top-to-bottom in array order — that order *is* the timeline
  - from: client
    to: api
    label: POST /login
    style: call                # call | return | async
  - from: api
    to: client
    label: 200 OK
    style: return
  - from: api
    to: api                    # from === to renders as a small self-loop
    label: bcrypt compare
```

At least two actors, at least one message. `style: return` renders dashed — use it for the
response leg of a call, not just anything flowing "backward".

## Multiple panels

To show more than one layout on one canvas — say the architecture (`graph`) and a request's
path through it (`sequence`) — replace the top-level `layout` with a `panels:` array. Each panel
is a full diagram body (`id`, `title`, optional `note`, `layout`, and that layout's fields), drawn
as its own titled frame, all at one `/d/<id>` URL:

```yaml
id: checkout
title: Checkout
panels:
  - id: architecture
    title: Architecture
    layout: graph
    nodes: [...]
  - id: purchase
    title: One purchase, end to end
    layout: sequence
    actors: [...]
    messages: [...]
```

Use `panels:` *instead of* a top-level `layout` — mixing the two is rejected, and so is a `revision` on a panel (set it at the top level). Panel ids must be unique and can't be `title` or `note`, which name the diagram's own header; node/actor ids only need to be unique within their panel. Feedback
namespaces them by panel, e.g. `architecture:api`. A single-layout diagram is still valid
as-is. See `examples/checkout.diagram.yaml`.

For a panels diagram, set `style` inside each flowchart panel, not at the top level;
top-level layout fields, including `style`, are rejected alongside `panels:`.

These checks are strict for new renders. Previously accepted saved diagrams still load with
their existing scenes, annotations, snapshots, and review submissions unchanged. Startup warns
with the diagram id and validation issues; correct the source YAML before re-rendering.
Other invalid saved documents are skipped with a warning instead of silently disappearing.

## Reviewing a diagram

Same protocol as a plan: the colour-coded sticky palette, drag an arrow to pin a note to a
specific node or cluster, scribble to strike something out, "Send to agent" to hand it back.
`gameplan wait` / `gameplan feedback` work on a diagram id exactly like a plan id — the CLI
checks which one it is, so you don't need to say. There's no step order to reorder and no forks
to accept/reject; comments, removals and rewrites all still apply.

## Adding a layout kind

The catalogue lives in `packages/core/src/diagrams/`. A new kind is: a module exporting a
function shaped like `(spec, builder, ctx) => { width, height }` that draws into the shared
`SceneBuilder`, a `registerDiagramLayout("name", fn)` call in `diagrams/render.ts`, and a new
branch in `DiagramSpec`'s discriminated union in `diagram.ts`. Nothing else in the render or
review path needs to change — the CLI, server routes, and web client are all layout-agnostic.
