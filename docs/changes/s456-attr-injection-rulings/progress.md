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

## U2 — build (one commit: code + tests + SPEC + gaps)

- NEW `compiler/src/attr-injection-sink.ts` — the ONE reader: `classifyInterpolatedAttrSink(name, value)`
  (event-handler: any `on…` name, case-insensitive, fail closed — moved from emit-each's local
  `isEventHandlerAttrName`; `srcdoc`; URL-valued attribute set (HTML attribute index + obsolete
  URL attrs + `xlink:href`/`xml:base`) with `readLiteralUrlScheme` over the literal prefix before the
  first `${`: leading C0/space stripped, tab/LF/CR removed, `ALPHA *(ALPHA/DIGIT/+/-/.)` before `:`
  with no `/?#` first, lowercased; `\`/`&` before the scheme ends = unprovable → refused; safe set
  http/https/mailto/tel).
- Refusal points: VP-3 (`validators/attribute-interpolation.ts`, post-CE, `walkEveryMarkupNode` —
  generic deep walk, because `walkFileAst` does not descend `bodyChildren`) and the component expander
  (`parseComponentDef` — a component body is raw text until CE re-parses it, and prop substitution into
  a quoted attribute is textual, so VP-3 never sees `${label}`). VP-3 skips nodes whose span file is a
  re-parsed component body (`path#Name`). emit-each's row check now calls the same reader (backstop);
  api.js `collectErrors` drops a second E-ATTR-INTERP-EXECUTABLE at the same span (each rows otherwise
  reported twice: VP-3 + backstop).
- New code E-ATTR-INTERP-EXECUTABLE (§34 row) instead of E-CG-003: E-CG-003 means "codegen cannot
  lower a node kind" (a compiler-side refusal at CG); this is an author error decided before codegen.
- Probe (base 20ce26bf5 vs head), 19 shapes × 8 positions (top, component prop, component reactive,
  slot, each row, engine state-child, match arm, for…lift): every executable shape INTERP→refused
  (component-prop base was static — CE substituted the literal); every control unchanged.
- Found + filed (not fixed): data-supplied scheme (`href="${url}"`, and `href=${@u}`);
  component prop in a quoted attr renders the argument's SOURCE TEXT (`hi @nm`); top-level vs row
  backslash decoding diverges; `href=@cell` renders the cell NAME statically.
- Pre-existing: a VP-3 error still writes the artifact (same for E-CHANNEL-007) — the §2.2.1 S451
  impl#1 divergence.
- flogence `src/` head vs base: exit 0 both; every common output byte-identical.
- `bun run test`: 34149 pass / 53 fail → after P3-FOLLOW fix (my helper name contained
  `isComponent`), remaining fails = the 48-name browser FAILURE-BASELINE + TodoMVC ×2 (dist not
  compiled, env) + 2 that pass in isolation (esm-script-tag NEGATIVE control, detector-validation S426).
