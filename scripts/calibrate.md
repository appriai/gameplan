# Recalibrating text metrics

`packages/core/src/metrics.ts` holds advance widths measured from the real fonts. They matter:
the renderer wraps text in Node, where the fonts don't exist, but Excalidraw lays it out in the
browser with Excalifont loaded. Underestimate by a few percent per character and lines run past
the edge of their card, where they're silently clipped.

Regenerate when Excalidraw changes its bundled fonts, or when the calibration test in
`packages/core/src/core.test.ts` starts failing.

## Procedure

1. Serve a plan and open it: `gameplan render examples/rate-limiting.plan.yaml --open`
2. In the browser devtools console, run:

```js
(async () => {
  await document.fonts.ready;
  await document.fonts.load("20px Excalifont");
  await document.fonts.load("20px Cascadia");
  const measure = (family) => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `20px ${family}`;
    const chars =
      " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" +
      ".,:;!|()[]{}-/\\_@%#*+=<>?~^&$'`\"✓✗→☐…•";
    const out = {};
    for (const ch of chars) out[ch] = +(ctx.measureText(ch).width / 20).toFixed(3);
    // if this drifts far from 1.0, per-character summing is no longer valid
    const s = "the quick brown fox jumps over the lazy dog";
    const summed = [...s].reduce((a, c) => a + (out[c] ?? 0.53), 0);
    return { widths: out, kerningRatio: +(ctx.measureText(s).width / 20 / summed).toFixed(4) };
  };
  console.log(JSON.stringify({ hand: measure("Excalifont"), code: measure("Cascadia") }, null, 1));
})();
```

3. Paste the `hand.widths` values into `HAND_WIDTHS`, and `code`'s single repeated value into
   `CODE_ADVANCE` (Cascadia is monospace, so every glyph measures the same).
4. Update the ground-truth strings in the `"measures within 5% of the real fonts"` test with
   fresh `ctx.measureText(...).width` values at their stated sizes.
5. `npm test` — both the 5% accuracy test and the never-underestimate test must pass.

## If kerningRatio drifts

The measured ratio was 0.999, meaning a string's width equals the sum of its characters'
advances. If a future font kerns meaningfully, that assumption breaks and per-character summing
will underestimate. Raise `SAFETY` in the short term; measure whole strings in the long term.

## Why not just use the browser

Rendering happens in the CLI and the server, neither of which has a DOM. Shipping headless
Chrome to measure text would be a heavy dependency for a table that changes about as often as
Excalidraw changes fonts.
