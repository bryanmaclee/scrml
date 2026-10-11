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
