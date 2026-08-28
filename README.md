# Gameplan

Agent plans as a live Excalidraw canvas your team can argue with.

A Markdown plan buries the thing that most needs review: the trajectories the agent *didn't*
take. Gameplan renders decision forks, ordered steps, blast radius and risks onto a shared
canvas, lets humans mark it up in colours they already brainstorm in, and hands the agent those
marks back as structured feedback keyed to its own spec.

```
gameplan render plan.yaml --open   # agent renders; prints a local URL and a LAN URL
                                   # humans annotate, then press "Send to agent"
gameplan wait rate-limiting        # agent blocks, then gets structured feedback
```

A plan can also carry its own diagrams, in a `diagrams:` array — rendered between the goal and
the steps. If the change has a shape at all, draw it: the reviewer hasn't just read the code
and a picture of where the change lands is what they need before they can judge the steps.

Freestyle diagrams — not a plan review, just "draw this" — get their own standalone canvas:

```
gameplan draw architecture.yaml --open   # own URL (/d/<id>), same collab + annotation protocol
```

For a reviewer outside your LAN, add `--tunnel` (needs `cloudflared` on PATH) to get a public
`*.trycloudflare.com` URL. It's unauthenticated — anyone with the link can edit — so it's opt-in
per command, not automatic, and `gameplan tunnel stop` (or `gameplan stop`) tears it down; it
does not expire on its own.

## Install

```bash
npm install
npm run build
npm link -w gameplan-cli    # puts `gameplan` on PATH
```

Install the Claude Code skill:

```bash
ln -s "$PWD/skill" ~/.claude/skills/gameplan
```

## How it works

| Package | Role |
|---|---|
| `gameplan-core` | Spec schema, layout engine, Excalidraw element builders, feedback parser |
| `gameplan-server` | Fastify + WebSocket, scene store, disk persistence, the review handoff |
| `gameplan-web` | Vite + React + Excalidraw client with live cursors and an annotation palette |
| `gameplan-cli` | The `gameplan` command; autostarts the server |

The agent writes a **PlanSpec** (or, for a freestyle diagram, a **DiagramSpec**) — semantic
YAML, no coordinates. The layout engine owns geometry, because models describe intent well and
place geometry badly. Diagrams pick a layout from a small, extensible **catalogue** —
`graph` (dagre, with optional clustering) and `sequence` (actor lifelines) ship built in; a new
kind is a module in `packages/core/src/diagrams/` plus one registration call, not a rewrite.

Every generated element carries `customData.gameplan`, so the split between "what the agent
drew" and "what a human did to it" is exact rather than heuristic. That's what makes read-back
reliable, and what lets a re-render replace the whole plan while leaving every sticky note
where it was put.

Realtime sync is element-level last-write-wins on `version` — the same rule Excalidraw's own
collaboration uses.

## Annotation protocol

| Reviewer does | Means |
|---|---|
| Green / red / yellow / blue sticky | approve / reject / question / add |
| Arrow from sticky to card | pins the note to that card |
| Drag a step waypoint | reorder |
| Scribble over a card | kill it |
| Edit text in place | rewrite it |

## Development

```bash
npm test                      # tests across core and server
npm run dev                   # Vite dev server on :5173, proxying the API on :3939
node packages/server/dist/main.js   # run the server in the foreground
```

Config: `GAMEPLAN_PORT` (3939), `GAMEPLAN_HOST` (0.0.0.0), `GAMEPLAN_DATA` (`.gameplan`).

There is no auth. It's a local dev tool bound to the LAN for your team, not a deployed service.

Text metrics are measured from the real fonts and pinned by test — see
[`scripts/calibrate.md`](scripts/calibrate.md) before touching `metrics.ts`.
