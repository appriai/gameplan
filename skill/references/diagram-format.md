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

The `layout` field selects which algorithm in the catalogue lays it out. Two ship today:

| `layout` | Use for | Reads like |
|---|---|---|
| `graph` | Architecture, dependency graphs, data flow, call graphs | Boxes and arrows, auto-laid-out by dagre |
| `sequence` | A specific interaction over time — a request's path through a system | Actor columns, messages flowing down through time |

If neither fits — a state machine, an ER diagram — say so rather than forcing a `graph` to
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
