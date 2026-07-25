# chunk-namespacing fixtures

`wide/` — a purpose-built COLLIDING two-page app. `pages/alpha.scrml` and
`pages/beta.scrml` are the same source (only a string literal differs), so their
AST node ids AND their cell names collide exactly, across a wide feature surface
(cells, a typed enum, a `fn`, an event handler, an `<each>`, a `<match>`).

This shape is mandatory and is not decorative. A corpus sweep will FALSE-GREEN:

- `docs/website` has no cross-file `.scrml` deps, so the changed code never
  fires there at all;
- `examples/23-trucking-dispatch` does not collide BY LUCK — its pages differ in
  node count, so the per-file ids happen to miss.

Drive it with `docs/changes/chunk-namespacing/collision-scan.mjs`, which
enumerates the unit-scoped token surface of two coexisting chunks (top-level
declarations, cell-store keys, renderer-registry keys, in-outlet HTML markers)
and reports the intersection. A non-empty intersection is a runtime clobber.

```sh
bun run compiler/bin/scrml.js compile compiler/tests/fixtures/chunk-namespacing/wide -o /tmp/wide
bun docs/changes/chunk-namespacing/collision-scan.mjs /tmp/wide alpha beta
```
