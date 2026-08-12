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
- For a reviewer outside your LAN entirely, use `--tunnel` — see below — rather than reaching
  for `ngrok`/`cloudflared` by hand.

## Sharing beyond the LAN with `--tunnel`

`gameplan render/draw/open --tunnel`, or `gameplan tunnel [id]` against an already-running
server, opens a Cloudflare **quick tunnel**: an account-less, unauthenticated
`https://<random-words>.trycloudflare.com` URL that proxies straight to your local server.
Requires `cloudflared` on PATH (`apt install cloudflared`, `brew install cloudflared`, or
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

- **There's no auth in front of it.** The random hostname is the only thing protecting whatever
  plan or diagram it's serving — anyone with the link has full read/write access, same as a
  local reviewer. Treat the link like you'd treat a paste of the plan's contents: fine for a
  quick review with someone specific, not for anything sensitive or long-lived.
- The tunnel is a separate process from the gameplan server; it does **not** stop on its own.
  Run `gameplan tunnel stop` when you're done, or `gameplan stop` (which tears down both).
  `gameplan status` shows whether one is currently up.
- **The tunnel process must not inherit a pipe back to the CLI.** If you're modifying
  `packages/cli/src/tunnel.ts`, keep `cloudflared`'s stderr redirected to a real file
  (`.gameplan/tunnel.log`), not `stdio: "pipe"`. A piped stream's read end lives in the CLI
  process, which exits immediately after printing the URL — the next time `cloudflared` writes
  a log line, it gets SIGPIPE'd and the "running" tunnel is actually already dead. This exact
  bug shipped once; the fix is the log-file redirect plus polling that file for the URL.
- If `--tunnel` reports a URL but it 530s, the tunnel died after starting — check
  `.gameplan/tunnel.log` for why (usually the local server isn't actually up on the port
  `cloudflared` was pointed at).

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

## Plans and diagrams with the same id

A plan and a diagram can use the same `id` string without colliding — they're stored under
separate namespaces (`.gameplan/<id>/` for plans, `.gameplan/diagrams/<id>/` for diagrams) and
served at different paths (`/p/<id>` vs `/d/<id>`). `gameplan wait` / `feedback` / `open` check
the plan namespace first, so if you deliberately gave a diagram the same id as a plan, address
it by its full URL instead of relying on auto-detection.
