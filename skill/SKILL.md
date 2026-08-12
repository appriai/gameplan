---
name: gameplan
description: |
  Present an implementation plan as an interactive Excalidraw canvas that the user and their
  team can annotate, instead of a wall of Markdown. Renders the plan's decision forks, ordered
  steps, code surface and risks onto a live shared canvas, then reads the reviewers'
  annotations back as structured feedback.
  Use this whenever the user wants to review, align on, or sign off an approach before
  execution — "plan this", "show me the approach first", "let me review before you start",
  "check with the team", "what are the options here" — or when they ask for a plan on the
  canvas, a visual plan, or mention gameplan or Excalidraw for planning.
  Do NOT use for tasks small enough to just do, or for diagrams unrelated to planning work.
---

# Gameplan

Turn a plan into a canvas the user can argue with.

A Markdown plan hides the thing that most needs review: the trajectories you *didn't* take.
Gameplan renders decision forks, steps, blast radius and risks as a live Excalidraw canvas,
lets humans mark it up in the colours they already brainstorm in, and hands you their marks
back as structured feedback keyed to your own spec.

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

Six sections. Fill the ones that carry signal; leave the rest empty rather than padding them.

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
gameplan render <spec.yaml> [--open]   render; prints local + LAN URLs
gameplan wait <plan-id> [--timeout s]  block until reviewers submit (default 1800s)
gameplan feedback <plan-id> [--json]   read the canvas now, without waiting
gameplan list                          plans on the server
gameplan status | stop                 server lifecycle
```

The server autostarts on first use and keeps running, so the URL stays live while the humans
take their time. Plans persist in `.gameplan/` in the working directory.

## Details

- `references/spec-format.md` — every field, defaults, validation rules
- `references/annotation-protocol.md` — what reviewers do on the canvas and how it's parsed
- `references/troubleshooting.md` — server, port, render and sync problems
