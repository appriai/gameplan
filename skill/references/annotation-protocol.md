# Annotation protocol

How reviewers talk back, and how those marks become structured feedback.

The split between "what the agent drew" and "what a human did to it" is exact, not heuristic:
every generated element carries `customData.gameplan`. Anything without that tag is human.
Heuristics only start once we know something is human-authored, and are limited to deciding
what it refers to.

## What reviewers do

| Action | Meaning | Parsed as |
|---|---|---|
| Drop a **green** sticky | approve, this must happen | `APPROVE` comment |
| Drop a **red** sticky | reject, drop or rethink this | `REJECT` comment |
| Drop a **yellow** sticky | question, unclear to me | `QUESTION` comment |
| Drop a **blue** sticky | this is missing | `ADD` comment |
| Drag an arrow sticky → card | pins the note to that card | anchor `via: arrow` |
| Drag a step card elsewhere | reorder the steps | `REORDER` |
| Scribble over a card | kill it | `REMOVE`, reason `struck` |
| Delete a card | drop it entirely | `REMOVE`, reason `deleted` |
| Edit text in place | rewrite it | `REWRITE` |
| Press **Send to agent** | hand it all over | resolves `gameplan wait` |

The palette in the app's top bar drops correctly-coloured stickies stamped with the reviewer's
intent and name, so nobody has to remember hex codes. A hand-drawn sticky still works — intent
falls back to background colour, then stroke colour, then `question`.

## Anchoring

A comment is matched to what it refers to, in this order:

1. **arrow** — an arrow bound from the sticky to a generated card. Unambiguous; always wins.
2. **containment** — the sticky's centre sits inside a card's bounds.
3. **proximity** — nearest card centre within 360px. Reported as `(inferred by position)`.
4. **frame** — inside a region frame but near no card. A comment about the whole region.
5. **none** — floating in space.

Proximity is a guess. When feedback is marked inferred, read the note's text before acting on
the anchor.

## Thresholds

| Rule | Value | Why |
|---|---|---|
| Move counts as a reorder | > 8px | Below that it's a nudge while selecting |
| Scribble counts as a strike | > 40% of the card's area | A stroke that merely crosses a card isn't a verdict |
| Proximity radius | 360px | Roughly one card plus one gutter |

Reorder is re-derived from geometry — rows top to bottom, cards left to right within a row —
and only reported if the resulting order differs from what was rendered.

## Re-rendering preserves annotations

`gameplan render` with the same plan id replaces every generated element and carries over every
human one verbatim. Stickies stay where they were put. This matters: re-rendering a revised
plan must not throw away the feedback that prompted the revision.

Element ids are derived deterministically from the plan id and the node's logical key, so a
step card keeps the same id across revisions and the annotations anchored to it stay anchored.

## What isn't detected

Being explicit about the edges, so you don't over-read a report:

- Moving a **fork option**, **surface node** or **risk** card is not a reorder signal. Only
  steps have a meaningful order.
- Drawing an arrow between two generated cards isn't interpreted as a new dependency.
- Changing a card's colour isn't a signal. Use a sticky.
- An empty sticky is ignored, not treated as an unexplained objection.
