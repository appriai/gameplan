---
name: gameplan
description: |
  Present an implementation plan as an interactive Excalidraw canvas that the user and their
  team can annotate, instead of a wall of Markdown. Renders the plan's decision forks, ordered
  steps, code surface and risks onto a live shared canvas, then reads the reviewers'
  annotations back as structured feedback. Also draws freestyle diagrams — architecture,
  data flow, sequence-of-calls — as their own standalone canvas, independent of any plan.
  Use this whenever the user wants to review, align on, or sign off an approach before
  execution — "plan this", "show me the approach first", "let me review before you start",
  "check with the team", "what are the options here" — or when they ask for a plan on the
  canvas, a visual plan, or mention gameplan or Excalidraw for planning. Also use when the user
  wants to sketch or draw a system diagram, architecture diagram, or sequence diagram for an
  agent to produce — "draw the architecture", "diagram this flow", "sketch how X talks to Y".
  Do NOT use for tasks small enough to just do.
---

# Gameplan

Turn a plan — or a freestyle diagram — into a canvas the user can argue with.

A Markdown plan hides the thing that most needs review: the trajectories you *didn't* take.
Gameplan renders decision forks, steps, blast radius and risks as a live Excalidraw canvas,
lets humans mark it up in the colours they already brainstorm in, and hands you their marks
back as structured feedback keyed to your own spec.

The same canvas, collaboration and read-back also work for a **diagram** that isn't reviewing a
plan at all — a system architecture, a data flow, a sequence of calls. `gameplan draw` renders
one at its own URL, independent of any plan. See "Freestyle diagrams" below.

## The loop

1. **Research first.** Read the code. A canvas full of guesses wastes reviewer attention more
   than a text plan does, because it looks authoritative.
2. **Write a spec** — a `PlanSpec` YAML file. Never hand-write Excalidraw JSON or coordinates;
   the renderer owns layout entirely.
3. **Render**: `gameplan render <spec>.plan.yaml`. Give the user *both* printed URLs — the
   localhost one for them, the LAN one for their team.
4. **Wait**: `gameplan wait <plan-id>`. Blocks until a reviewer presses "Send to agent", then
   prints their feedback. This is a real handoff, not a poll — don't guess that silence means
   approval.
5. **Revise**: edit the spec, bump `revision`, `gameplan render` again. Same plan id updates
   the same canvas in place and preserves every sticky note already on it.
6. **Execute** once the user says go.

## Writing the spec

Seven sections. Fill the ones that carry signal; leave the rest empty rather than padding them
— except `diagrams`, which is worth reaching for by default (see below).

```yaml
id: rate-limiting          # stable slug — reusing it updates the same canvas
title: Add rate limiting to the public API
revision: 1                # bump on every re-render
goal: >
  One paragraph. What changes for the user, and why now.

successCriteria:           # how we'll know it worked
  - A key over its quota gets 429 with a Retry-After header

forks:                     # the highest-value section — see below
  - id: store
    question: Where does the counter state live?
    atStep: limiter        # optional
    options:
      - id: redis
        label: Redis, sliding window
        chosen: true       # exactly one per fork
        rationale: Already in the stack; accurate enough; survives restart.
      - id: in-memory
        label: In-process memory
        rationale: Zero infra, but wrong the moment we run two instances.

surface:                   # blast radius
  - id: limiter
    path: src/ratelimit/limiter.ts
    kind: new              # new | modified | read | untouched
    note: Sliding-window counter
    dependsOn: [config]

steps:                     # execution order
  - id: limiter
    title: Sliding-window limiter
    detail: Redis sorted-set window, returns remaining budget and reset time.
    files: [src/ratelimit/limiter.ts]
    verify: Integration test against real Redis hits the boundary exactly
    dependsOn: [config]

risks:
  - id: redis-latency
    text: A slow Redis adds latency to every request, not just limited ones.
    severity: high         # low | med | high
    mitigation: Hard 5ms timeout, fail open, alert on the failure metric

outOfScope:                # the assumptions most worth catching early
  - Per-route limits — the config shape allows it later
```

Ids are scoped per section, so the step `limiter` and the file `limiter` can share a name.

### Forks are the point

Every plan has branch points where you picked one path over another. In a text plan those
alternatives evaporate and the reader only sees your conclusion. Put them in `forks`:

- Add a fork wherever you made a judgement call a competent reviewer could disagree with —
  storage choice, sync vs async, extend vs rewrite, where a check belongs.
- Give every option an honest `rationale`, including the rejected ones. "Zero infra and
  fastest, but wrong the moment we run two instances" tells the reviewer you understood the
  trade-off. "Not suitable" tells them nothing.
- A plan with no forks is a claim that nothing was debatable. Sometimes true — usually not.

Two to four forks is a normal plan. If you have none, say so explicitly rather than inventing
filler.

### Diagrams inside a plan

A plan can carry supporting pictures in a `diagrams:` array — same drawing
vocabulary as `gameplan draw`, rendered as their own frames between the goal and
the steps, versioned by the plan:

```yaml
diagrams:
  - id: request-path
    title: Where the limiter sits in the request path
    layout: graph            # or: sequence
    direction: LR
    note: Dashed box is what this plan adds.
    clusters:
      - id: added
        label: added by this plan
    nodes:
      - id: limiter
        label: Rate-limit middleware
        icon: file
        color: green
        cluster: added
    edges:
      - from: gateway
        to: limiter
```

**Default to drawing one.** You have just read the code; the reviewer probably
hasn't, and almost certainly doesn't hold the system in their head as precisely
as you do right now. A picture of where your change lands is the cheapest way to
close that gap, and it's the thing a reviewer needs *before* they can judge the
steps. When you're unsure whether a plan warrants a diagram, include it.

Reach for one whenever the plan:

- inserts something into an existing request or data path — *where* it sits is
  usually the most debatable thing in the plan;
- changes how components talk: a new hop, a moved boundary, a reversed
  dependency, a new store;
- touches a part of the system the reviewer may not know well;
- has a fork about placement or topology. Draw the shape the chosen option
  produces, so the fork's rationale has something concrete to point at.

Two diagrams — today's shape and the shape after — are often clearer than one
annotated hybrid, and they cost the reviewer very little.

Leave it out only when it would genuinely add nothing:

- **The change has no shape.** Tweaking a constant, tightening validation,
  renaming a symbol, editing copy — there's no path or boundary to draw.
- **It would restate `surface`.** A box-per-file graph next to the code-surface
  region is the same information twice.
- **It would be the directory tree.** Folder structure isn't architecture.

Those are the exceptions. If none of them clearly applies, draw the diagram.

## Freestyle diagrams

Not every picture is a plan review. When the user wants a system explained or sketched —
architecture, data flow, a specific request's path through the code — that's a **diagram**, not
a plan: `gameplan draw <diagram.yaml>` renders it at its own URL (`/d/<id>`), with the same
sticky-note review protocol but none of the Goal/Steps/Forks structure.

```yaml
id: system-architecture
title: How auth fits into the system
layout: graph              # or: sequence
direction: LR
nodes:
  - id: gateway
    label: API gateway
    icon: file
    color: blue
edges:
  - from: gateway
    to: auth-api
```

Same rule as a plan spec: structure in, no coordinates — dagre (for `graph`) or a time-ordered
lane layout (for `sequence`) owns the geometry. Full field reference, both layout kinds, and how
to add a new layout kind to the catalogue: `references/diagram-format.md`.

`gameplan wait` / `gameplan feedback` / `gameplan open` all accept a diagram id exactly like a
plan id — the CLI checks which one it is, so you never need to say.

## Reading feedback

`gameplan wait` and `gameplan feedback` print feedback keyed to **your spec's node ids**:

- **REMOVE** — a card was deleted or scribbled out. Drop that step/risk/option.
- **REORDER** — step waypoints were dragged. Use the new order.
- **REWRITE** — text was edited in place. Take their words.
- **REJECT / ADD / QUESTION / APPROVE** — sticky notes, each anchored to a card.

Notes marked `(inferred by position)` were matched to the nearest card by proximity, not by an
explicit arrow — treat that anchor as a guess and re-read the note's text before acting.

Apply the feedback, then say what you changed. If you disagree with a note, say so and why —
silently ignoring a reviewer's objection is worse than pushing back on it.

## Commands

```
gameplan render <spec.yaml> [--open] [--tunnel]   render a plan; prints local + LAN URLs
gameplan draw <diagram.yaml> [--open] [--tunnel]  draw a freestyle diagram, own URL
gameplan wait <id> [--timeout s]         block until reviewers submit (default 1800s)
gameplan feedback <id> [--json]          read the canvas now, without waiting
gameplan list                            plans and diagrams on the server
gameplan tunnel [id] | tunnel stop       share publicly via Cloudflare, or stop sharing
gameplan status | stop                   server (and tunnel) lifecycle
```

The server autostarts on first use and keeps running, so the URL stays live while the humans
take their time. Plans and diagrams persist under `.gameplan/` in the working directory.

`--tunnel` reaches beyond the LAN — an unauthenticated `*.trycloudflare.com` URL anyone with the
link can view and edit. Reach for it only when a reviewer genuinely isn't on the LAN, and tell
the user you're about to expose the canvas publicly before you do. `gameplan tunnel stop` (or
`gameplan stop`) when the review is done; it doesn't close itself.

## Details

- `references/spec-format.md` — every plan field, defaults, validation rules
- `references/diagram-format.md` — the `graph` and `sequence` layout kinds, and how to add another
- `references/annotation-protocol.md` — what reviewers do on the canvas and how it's parsed
- `references/troubleshooting.md` — server, port, render and sync problems
