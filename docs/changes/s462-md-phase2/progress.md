# progress — s462-md-phase2

- [x] merged origin/main (already up to date at 37e50e881)
- [x] BRIEF archived
- [x] read SPEC §67, phase-1 progress, rulings Q21/F1-F4/Q22, deep-dive §7
- [x] splitter: md body production + slots (`scanMdSlots`) — block-splitter.js
- [x] compile-time hook (generated shim) + diag mapping — md-lower.ts
- [x] lowering + slots + emitters (static HTML, if=, each, match, component, SSR rows; lift/markup-value refused)
- [x] SPEC §67 (status, Q22, attrs, placement, ids, of=) + §34 rows + SPEC-INDEX + FACTS
- [x] known-gaps: g-bootstrap-md-static-owed-s462, g-md-in-phrasing-through-wrapper-s462,
      g-md-heading-ids-match-arm-codegen-reparse-s462, g-md-in-logic-markup-s462
- [x] tests: unit, happy-dom, Chromium, SSR integration, 15 conformance cases
- [x] dog-food: samples/md-article-browser-language.scrml

## Design

**Where the hook lives.** `compiler/src/md-lower.ts`, called from `ast-builder.js` `buildBlock` (markup
case) for a block named `md` (lowercase-first, so never a component). It imports `parseSlots`, `dedent`,
`headingSlugs` and the `MdBlock` / `MdInline` constructors from the GENERATED shim
`compiler/runtime/stdlib/md.js` — one reader (F4). No TS md parsing anywhere.

**Slots.** BS (`scanMdSlots`) finds the body end first (the first `</md>`, case-insensitive), then takes
each `${` extent by a small lexer (strings ending at a line end, template literals with nested `${`,
`//` and block comments, brace depth) bounded by the body end. TAB replaces each closed slot with one
U+FFFC (map1: s1 offset → file offset), runs the reader's `dedent` (map2 replays the dedent line rule
from its outputs; verified equal to the reader's text, else positions fall back to the body start),
then hands `parseSlots` the U+FFFC offsets that ARE slots (an author-typed U+FFFC is not). After
placement: an inline `Slot(i)` → `buildMdSlotNode` re-splits the slot's exact source inside a synthetic
`<span>` and builds it with `buildBlock` (ordinary reactive `${}` logic node, spans moved to the real
file position); an `MdSeg.Slot` in a destination / title / alt → an expression attribute
`[lit, (slot), lit].join("")` (one evaluation per slot, `not` joins as ""), so a URL attribute takes the
existing §5.2 rule 3 guard; code slots were restored to source text by the reader and are never parsed.

**Diagnostic positions.** A reader diag offset → map2 → file offset → line/col counted inside the
`<md>` block's raw. Errors carry `baseMessage` and the md codes are in SUBPARSE_FORWARDED_CODES, so an
`<md>` in an `<each>` row / `<match>` arm keeps its diagnostics.

**Text.** A lowered text node: `value` = HTML-encoded (`& < > " $`) — every HTML-string sink is safe as
is and no sink can find a `${` in it; `_mdText` = plain text for DOM sinks (emit-each, emit-lift, SSR
rows). Adjacent runs are merged into one node.

**Re-parse routing.** The frozen native parser has no `<md>`: CE (`sourceNeedsLiveFallback`),
emit-match arm bodies and emit-engine shorthand markup route an `<md>`-bearing source to BS + TAB. A
`const C = <…>` component holding an `<md>` takes its raw verbatim from the logic block
(`mdComponentVerbatimRaw`), and the CE masks `<md>` elements from `normalizeTokenizedRaw`.

**Heading ids.** Each heading stores its own slug (`headingSlugs` over the heading alone); the page-wide
dedupe is `headingSlugs` over synthetic headings whose text is the slug (a fixed point of the rule),
run after TAB and again after CE (component instances).

## Decisions the rulings did not cover (marked "PA reading, s462-md-phase2" in §67)
1. `if=` / `else-if=` / `else` / `show=` on `<md>` are admitted (render gates, nothing enters the host).
2. `<md of=…/>` before phase 3 → `E-MD-OF-NOMINAL` (new code; the E-WASM-NOMINAL precedent).
3. A data-led destination whose literal prefix already commits to an unadmitted scheme
   (`[x](javascript:${y})`) is E-MD-URL-SCHEME at compile time.
4. `<md>` in `lift` markup / a markup value → `E-MD-IN-LOGIC-NOMINAL` (new code). Found by testing: the
   markup-value path compiled at exit 0 and rendered `<md>**yes**</md>`.
5. E-MD-IN-PHRASING checks the direct parent element only (gap filed).
6. Heading ids in an `<each>` row repeat per row (as an author `id=` in a row template does).
7. A slot in static HTML renders through the existing `<span data-scrml-logic>` binding site (§7.4.2).
   That span is not in the §67.6 table; it carries no content attribute and is the interpolation, not md
   output. (In `<each>` rows a slot is a bare text node.)

## Findings outside scope (not fixed)
- Before the verbatim-raw fix, a `${ const C = <section …><md>### Card …` component (inside an explicit
  `${}` block) reached the CE with `### ` gone and its blank lines collapsed. Ordinary component text in
  the program-body form keeps `#` (`<div>\n### three</div>` renders `### three`), so this was not
  pursued as a separate gap; `<md>` bodies no longer depend on the tokenized form.
- host-global-scan reported "a shard failed" once under memory pressure (other suites running); see
  gates.

## S465 resume — fix round 1 (cloud, AUTO)
- 2026-10-12T01:25Z reset to wip/s464-md-phase2 @ bc9e44455; archived BRIEF-resume-S465.md (9585c8180);
  applied + committed the S462 salvage patch verbatim (68f5cb369: MED-A provenance, MED-C SSR md attrs).
- 2026-10-12T01:40Z MED-A verified by execution: with the type-system hunk reverted, the salvage's test
  fails (4× E-TYPE-026 on `<md>` prose / `<pre>` / `<code>`); with it, passes. §18.9 row "Markup context
  (direct) — E-TYPE-026" fits a plain markup body; an `<md>` body is not markup context (§67.2 text-mode
  production), so prose there is text; a `<div>` body line `match x {` still reports E-TYPE-026.
- 2026-10-12T01:45Z MED-C (SSR data-led md attrs) verified: its test fails with the hunk reverted.
- 2026-10-12T01:55Z MED-B: the brief's example (`` `${x}` `` in a code span) does NOT reproduce — it
  renders verbatim in static HTML, `<each>` rows (client + SSR), `<match>` arms, `if=` and components.
  The swallow that does reproduce: a quote inside a code-span slot that reaches its line end unclosed
  (`` `${"}` `` then a `}` on a later line). The scanner ended the string at the line end and kept
  going, so the slot ran through the code span's closing backtick to the later `}`; the reader placed
  it in prose, the prose was parsed as an expression and vanished (E-CTX-001). Fix (block-splitter
  `mdSlotExtent`): an unterminated quote is a lexing failure → the `${` is unclosed →
  E-MD-INTERP-UNCLOSED (names `<pre>`). §67.4 decides the rendering: "the slot is restored to its exact
  source text, so `${…}` is shown literally". SPEC §67.2 sentence added (PA reading, MED-B).
  Tests: unit (4), conformance md/interp-unclosed-quote-in-code-span, Chromium case.
- 2026-10-12T02:05Z Chromium: Playwright's expected headless build (1223) is not installed in this
  container; ran md-static-chromium-s462 against /opt/pw-browsers/chromium_headless_shell-1194 via a
  scratch copy with `executablePath` — 4/4 pass (closed set, URL guard, heading ids, MED-B).
- 2026-10-12T02:50Z merged origin/main 41af4153a (#1405, docs-only; no conflicts; master-list.md == main).
- 2026-10-12T05:10Z gates on the merged head: pre-commit 35091 pass / 11 fail / 132 skip — the 11 are the
  container's env set (dev-db-no-side-file ×5, promote-safety-harness ×1, headless-serve-bind-host ×1,
  identical on origin/main) plus load flakes (tenant-floor-project-set ×3, parser-conformance-corpus ×1;
  both pass on a solo re-run). lsp+commands: 11 fail, identical set on origin/main. browser-baseline
  --check: 1 NEW name (each-alias-in-lifted-markup nested-each, a leaked "JSON Parse error bad" console
  error from another file) — identical on origin/main, passes solo; not re-recorded. s34-census
  --check-new, host-global-scan, facts, spec-index, bootstrap-conformance (regenerated), severity,
  state, types-gate, snippet-gate, corpus-compile-floor, gen-md-shim, conflict-marker, delta-lint: PASS.
- Corpus differential (examples, samples, conformance, stdlib, gauntlet-r25; ../giti and ../flogence are
  not cloned here): 0 newly failing, 0 newly passing, 0 diagnostic-code changes; 165 differing artifacts
  and 4 gauntlet diagnostic texts all differ ONLY by the checkout path (base built from a nested
  worktree) — 0 real emit changes. 17 added sources = this branch's 16 md cases + the dog-food sample.

## S465 — fix round 2 (cloud, AUTO; review S239 of 3e3991c3)
- 2026-10-12T05:00Z reset to wip/s464-md-phase2 @ 3e3991c37; archived BRIEF-fix-round-2-S465.md (f6283feeb).
- Finding 1 (MED) reproduced: probe f_each_lit emitted `textContent = _scrml_g.String(t)`. Root cause is
  NOT md-specific: a component body re-parsed through the legacy BS+TAB path (`sourceNeedsLiveFallback`:
  `<md>`, a template literal, `<each>`/`<match>`, …) builds bare-exprs that carry source text in `expr`
  beside `exprNode`; CE `substitutePropsInLogicStmt` "bare-expr" substituted only `exprNode`, and
  emit-each's row value path reads a non-empty `expr` first ("LEGACY path stays byte-identical"). The
  same defect reproduced without `<md>`: `${`[${t}]`}` in a component used in an `<each>` row. Fix
  (component-expander.ts): when the tree changes, `expr` is re-derived from the substituted tree. The
  native-bridge shape (`expr: ""`) is untouched. An `<md>` ATTRIBUTE slot already worked (attr path).
  Tests (all fail with the CE hunk reverted): happy-dom ×6 (literal, row-bound + rows update + hostile
  value is text, two slots, heading + list item, nested component, template-literal twin); Chromium ×1
  (headless_shell-1194 via a scratch executablePath copy; also fails reverted); conformance
  md/component-text-slot-in-each.
- Finding 2 (LOW): `mdSlotExtent` now asks the logic tokenizer about each `/` in a slot's code
  (`mdRegexLiteralEnd`: `tokenizeLogic` over the frame's code from its `${` to the line end, a NUL
  sentinel telling a literal closed at the line end from an unclosed one). One reader: the tokenizer's
  `isRegexContext` + `readRegex`. A closed regex is skipped whole; division stays division; MED-B's
  unterminated-quote rule is unchanged (a regex earlier in the slot does not excuse a later bad quote).
  Probe q_md now emits exactly what the `<p>` twin emits. Tests: unit ×3 (fail reverted), conformance
  md/slot-regex-literal-quote.
- Found while pinning F2 (pre-existing, not md, not fixed — out of scope): in an `<each>`/`<match>` body,
  `skipDollarBrace` (the raw-body scanner) reads a quote inside a regex as a string, so
  `<li>${ @.t.replace(/'/g, "") }</li>` in a row fails E-CTX-001/003 (loud). Gap filed:
  g-raw-body-skip-dollar-brace-regex-quote-s465.
- Finding 3 (record only): "Write `${` to open a slot and `}` to close it." in `<md>` prose is one slot
  (the backtick inside the slot opens a template literal) — consistent with §67.2's token-depth extent.
  Gap filed: g-md-prose-backtick-dollar-brace-one-slot-s465 (prov=review:s465-md). No SPEC sentence
  added or changed this round.
- Gates (see report): pre-commit 32859 pass / 10 fail / 132 skip — the 10 are the brief's env-only set
  (dev-db-no-side-file ×5, promote-safety-harness ×1, headless-serve-bind-host ×1, tenant-floor-project-set
  ×3 — passes 24/24 solo). FACTS + bootstrap-conformance regenerated (+2 md cases only).
