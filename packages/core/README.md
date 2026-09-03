# gameplan-core

Spec schema, layout engine, and Excalidraw element builders for [gameplan](https://github.com/appriai/gameplan) —
agent plans and diagrams rendered as a live Excalidraw canvas.

This is a library package consumed by `gameplan-server` and `gameplan-cli`; it isn't meant to be
installed on its own unless you're building an alternative host for the plan/diagram spec.

It owns:
- Parsing and validating **PlanSpec** and **DiagramSpec** YAML (semantic — no coordinates)
- The layout engine that turns that intent into positioned Excalidraw elements
- A small, extensible diagram-layout catalogue (`graph`, `sequence`, ships built in)
- Parsing reviewer annotations back into a structured **FeedbackReport**

## Learn more

Full docs and the plan/diagram YAML spec: [github.com/appriai/gameplan](https://github.com/appriai/gameplan)
