# Troubleshooting

## The spec won't render

`gameplan render` validates locally before contacting the server, so errors come back with the
offending path:

```
invalid plan spec:
  forks.0.options: exactly one option must be marked chosen
  step "rollout" dependsOn unknown step "deploy"
```

Common causes:

- **`exactly one option must be marked chosen`** — every fork needs one and only one
  `chosen: true`. A fork where nothing is chosen isn't a decision, it's an open question; put
  it in `risks` or ask the user instead.
- **`dependsOn unknown step`** — ids are scoped per collection. A step can only depend on a
  step, a surface node only on a surface node.
- **`duplicate step id`** — unique within a collection. Across collections is fine.

## The server

```
gameplan status          # is it up, on which pid, with how many plans
gameplan stop            # SIGTERM it
```

- **`server build not found`** — run `npm run build` in the gameplan repo. The CLI resolves the
  server through the package graph, so it needs `packages/server/dist` to exist.
- **Port in use** — `gameplan render --port 4040`, or set `GAMEPLAN_PORT`. Every subsequent
  command needs the same port.
- **`server did not become healthy within 15s`** — start it in the foreground to see why:
  `node packages/server/dist/main.js`.

The server autostarts detached on first use and outlives the CLI process on purpose, so the
review URL stays alive while humans take their time.

## Teammates can't open the LAN URL

`gameplan render` prints a best-guess LAN address, preferring real interfaces over container
bridges. It can still guess wrong.

- Check the address is on the same network as your reviewers: `ip addr` / `ifconfig`.
- Inside Docker or a devcontainer, the printed IP is usually the container's, not the host's.
  Publish the port (`-p 3939:3939`) and hand out the host's address instead.
- Remote reviewers need a tunnel — `cloudflared tunnel --url http://localhost:3939` or
  `ngrok http 3939`. There is no auth on the server; it's a local dev tool, so don't leave a
  tunnel open longer than the review.

## The canvas is empty or stuck

- **"connecting…" that never goes live** — the WebSocket can't reach `/ws`. Behind a reverse
  proxy, make sure it forwards Upgrade headers.
- **"reconnecting…"** — the client retries with backoff up to 8s and re-syncs the full scene on
  reconnect. Nothing is lost; the server holds the authoritative copy.
- **A reviewer's edits didn't show up for others** — edits flush ~120ms after the last change.
  If one client is genuinely diverged, reloading pulls the authoritative scene.

## Feedback isn't what the reviewer meant

- **`(inferred by position)`** — the note was matched to the nearest card by proximity, not by
  an explicit arrow. Read the note text before trusting the anchor; if it matters, ask the
  reviewer to drag an arrow from the sticky to the card.
- **A note came back with no anchor** — it was floating more than 360px from any card. Still
  reported; treat it as a comment on the plan as a whole.
- **A comment is missing entirely** — empty stickies are ignored by design. If a reviewer drew
  a shape but never typed in it, there's nothing to report.
- **An expected reorder is missing** — only *step* cards carry order. Moving a fork option,
  risk or surface node is not a signal.

## Re-rendering

Same `id` updates the same canvas in place, pushes it live to everyone watching, and keeps
every human annotation. Bump `revision` so reviewers can see the plan changed.

Element ids are derived deterministically from the plan id and each node's logical key, so
annotations anchored to a step stay anchored across revisions — as long as you don't rename the
step's `id`. Renaming an id orphans the notes attached to it.
