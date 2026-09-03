# gameplan-cli

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
npm install -g gameplan-cli
```

Install the Claude Code skill:

```bash
npx skills add appriai/gameplan
```

## Annotation protocol

| Reviewer does | Means |
|---|---|
| Green / red / yellow / blue sticky | approve / reject / question / add |
| Arrow from sticky to card | pins the note to that card |
| Drag a step waypoint | reorder |
| Scribble over a card | kill it |
| Edit text in place | rewrite it |

There is no auth. It's a local dev tool bound to the LAN for your team, not a deployed service.

## Learn more

Full docs, source, and the plan/diagram YAML spec: [github.com/appriai/gameplan](https://github.com/appriai/gameplan)
