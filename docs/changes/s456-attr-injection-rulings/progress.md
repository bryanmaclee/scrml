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

## U3 — evidence after c0cf5d61f

- Pre-commit gate (unit + integration + conformance): 31771 pass / 0 fail.
- Corpus differential (`corpus-emit-differential`, base 20ce26bf5 vs head, roots
  examples,samples,conformance,stdlib,benchmarks): 2413 common sources; compile-failure delta 0/0;
  diagnostic CODE changes 0; 1460 text-only = the capture directory name only (all 2413 compile
  records identical after `.tmp/base`→`.tmp/head` substitution); artifact content diffs 0 of 11837;
  syntax delta 0. +4 sources = the new conformance cases (3 neg exit 1, 1 pos exit 0).
- Conformance 1338/1388 (+4 PASS, 50 xfail unchanged). Browser baseline `--check` PASS (48 names).
- Gates: types-gate OK (unchanged), s34-census --check-new PASS, regen-spec-index --check OK,
  facts --check OK, state --check OK.

## U4 — S239 review round of 93b36665a (DO-NOT-LAND) — fixes

- F1 (HIGH, reproduced: `<Lnk u="javascript:go('${@nm}')"/>` through `href="${u}"`, and Outer→Inner,
  exit 0 + interpolated setAttribute). Root confirmed: VP-3 skipped `path#Name` spans and the CE def
  check only saw `href="${u}"`. Fix: VP-3 post-CE judges EVERY markup node, i.e. the substituted value
  at every expansion depth (nested expansion happens in walkAndExpand before VP-3). Anchor: CE stamps
  `_expansionSiteSpan` (call site) on expanded roots; the walker keeps the OUTERMOST real call site.
  Def-check dedupe: the def check stamps `_execSinkReportedAtDef` on the attr it refused;
  `substituteProps` copies attrs with `{...attr}`, so expanded copies skip. Two instances = two reports.
- F2 (MED, reproduced: both `^{ emit(…) }` shapes exit 0). Fix: `runExecutableSinkCheck` re-run in
  api.js right after ME (ME is the last stage that adds markup; DG/tenant/CG only read) over
  `metaFiles` (the AST CG consumes). meta-eval stamps `_metaEmitSiteSpan` (the `^{}` block) on
  spliced nodes for the anchor.
- Dedupe (api.js): every refusal carries `attrSinkKey` (own span + name). Pre-CG stages dedupe on
  key+reported span; the CG `<each>` backstop is dropped when its attribute was refused anywhere.
- F3a: event test = browser-executed handler names (HTML GlobalEventHandlers / WindowEventHandlers /
  DocumentAndElementEventHandlers + other specs' partials + Document + non-standard implemented) +
  `onwebkit|onmoz|onms` prefix + `on:`/`onserver:`/`onclient:`. Not `eventNameForAttr`'s any-`on…`:
  that function decides UNQUOTED handler wiring; a quoted value is never wired by scrml (always
  setAttribute / static HTML), so the browser's executed set is the safety boundary.
- F3b: complete raster `data:image/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)` with
  `;`/`,` before the first `${`, on src/srcset/imagesrcset/poster → admitted. F3c: + ftp, sms.
- F4: filed g-svg-animation-and-meta-refresh-url-sinks-s456 (LOW).
- prev(93b36665a)/head: f1 exit0/0 refusals → exit1/2; f2 exit0/0 → exit1/2; F3 controls exit1/6 →
  exit0/0; svg+xml + ononline exit1/2 → exit1/2.
- Conformance +3 (component-prop-substituted-neg, meta-emit-neg, non-handler-and-raster-data-pos):
  1341/1391. flogence: base 20ce26bf5 vs head byte-identical.
- Corpus differential (base 20ce26bf5 full-tree archive vs head; the tool marks it INCOMPARABLE only
  because the archive has no git revision): 2413 common sources — 0 compile-record changes after
  path normalization (0 newly refused); 11837 artifacts compared, 0 content changes (2 differ only in
  a relative import path to the base archive's root). +7 sources = the conformance cases.
- Gates: types OK (unchanged), s34-census --check-new PASS, spec-index / facts / state --check OK.

## U5 — S239 round 2 of a592fee37 (DO-NOT-LAND) — N1

- N1 (HIGH, Chromium 148): the F3a browser-handler NAME list missed 19 Chromium handlers (SVG
  `onbegin` / `onend` run on load). Inverted: any `on…` name (lowercased, length > 2) is a handler
  EXCEPT the closed exact-name list `NON_EVENT_ON_WORDS` = `one`, `online`, `onboarding` (no DOM event
  is named `e` / `line` / `boarding`; exact match, so `onerror` / `onended` stay handlers).
  `BROWSER_EVENT_HANDLER_ATTRS` deleted (nothing else used it).
- a592fee37 → head: N1 probe (onbegin/onend/onrepeat + 7 dispatch-run names + onClick + ONCLICK2):
  exit 1, 1 refusal → exit 1, 12 refusals. Exemptions (one/online/onboarding/ONE): exit 0 both.
- Conformance 1341/1391; types/census/spec-index/facts/state OK.
- Corpus differential (base 20ce26bf5 archive vs head, path-normalized): 2413 common sources, 0 exit-code
  changes, 0 compile-record changes, 11837 artifacts, 0 content diffs. flogence: byte-identical.
