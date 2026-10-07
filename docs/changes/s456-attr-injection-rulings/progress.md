# progress — s456-attr-injection-rulings

- [start] base 20ce26bf5; bun install + pretest OK.

## U1 — Phase 0 (measured at base 20ce26bf5)

Compiled: `corpus-emit-differential capture` (roots examples,samples,conformance,stdlib,benchmarks —
includes examples/22-multifile + examples/23-trucking-dispatch): enumerated 2413, compiled 1445,
emitted 11837. Plus flogence `src/` (read-only copy @ eb05dd5 + graph-read.scrml + flogence.db):
exit 0.

| shape | sources (grep, all roots + compiler/tests + flogence) | compiled artifacts |
|---|---|---|
| quoted `on…="…${…}"` (any case, `"` or `'`) | 0 | 0 template `setAttribute("on…", \`…\`)`, 0 `data-scrml-attr-tpl-on…` |
| `srcdoc="…${…}"` | 0 | 0 |
| URL attr with `${…}` (any prefix) | 20 occurrences / 17 files | 22 template `setAttribute` |
| …of which scheme-led | 1: `examples/12-snippets-slots.scrml` `href="mailto:${u.email}"` | 1 (`mailto:`) |
| …relative path prefix (`/…`) | 17 | 19 |
| …prefix empty (`href="${x}"` / `src="${x}"`) | 3 | 2 `src` |
| flogence | 0 of every shape | 0 |

Decision point: a literal "any scheme" reading of ruling (2) would newly refuse
`examples/12-snippets-slots.scrml` (`mailto:`). Rule as built admits a fixed SAFE scheme
(`http`/`https`/`mailto`/`tel`) and refuses every other literal scheme (fail closed) — the ruling's
purpose clause is "so a `javascript:` URL cannot be built from data", and a literal safe scheme
cannot be changed by the interpolation after its `:`. Newly refused non-test programs: 0 → proceed.
