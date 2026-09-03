# gameplan-server

The sync server for [gameplan](https://github.com/appriai/gameplan) — Fastify + WebSocket, the
plan/diagram scene store, disk persistence, and the review handoff API. Also serves the
`gameplan-web` canvas UI as static assets.

This package is started automatically by `gameplan-cli`; you don't need to run it directly
unless you're embedding gameplan in something else.

```bash
gameplan-server   # or: node dist/main.js
```

Config: `GAMEPLAN_PORT` (3939), `GAMEPLAN_HOST` (0.0.0.0), `GAMEPLAN_DATA` (`.gameplan`).

There is no auth. It's a local dev tool bound to the LAN for your team, not a deployed service.

## Learn more

Full docs and source: [github.com/appriai/gameplan](https://github.com/appriai/gameplan)
