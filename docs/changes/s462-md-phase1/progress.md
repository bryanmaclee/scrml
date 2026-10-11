# progress — s462-md-phase1

- [x] merged origin/main (already up to date at a9aa81eff)
- [x] BRIEF archived
- [x] read deep-dive, the five S462 rulings, SPEC §4.15/§4.17/§4.18.1a/§5.2/§7.4.2/§26.6/OQ-6/§34, stdlib idiom, shim + parity test
- [x] stdlib/md/index.scrml parser + tests (compiler/tests/unit/stdlib-md.test.js, 143 tests)
- [x] generated shim (scripts/gen-md-shim.ts) + compiler/tests/unit/stdlib-md-shim.test.js; the existing
      stdlib-shim-export-parity picks scrml:md up automatically (§1-3 exports, §4 enum shape, §6 async)
- [ ] SPEC §67 + SPEC-INDEX + §34 codes
- [ ] gates

## Design decisions (running)

### The shim is GENERATED from the scrml reader (F4: one reader)
The existing stdlib pattern is a HAND-WRITTEN JS shim mirroring the `.scrml` export list
(`compiler/runtime/stdlib/<name>.js`, api.js L101). For `scrml:md` a hand-written shim would be a
second md reader — exactly what F4 ("one md reader, written in scrml") rules out. impl#1's
`--mode library` compile emits a real ES module (exports, enums in the shim shape, `_scrml_g` from
`./_scrml/_global.js`). So `scripts/gen-md-shim.ts` compiles `stdlib/md/index.scrml` in library mode,
replaces the `_global.js` import with `const _scrml_g = globalThis;` (a shim is copied alone into
`_scrml/`), stamps the source sha-256 in a header, and writes `compiler/runtime/stdlib/md.js`.
`--check` regenerates and compares. The unit test pins (a) the stamped hash equals the current source
hash, (b) behavioural parity: a fresh library-mode compile of the scrml and the committed shim give
identical trees for the whole test corpus.

### Text slots (phase 2) — representable now, produced later
`MdInline.Slot(index)` is the text-only `${…}` atom (F1). Every attribute-valued string the reader
produces (link `dest`, image `src`/`alt`, `title`) is an `MdSeg[]` = `Lit(text) | Slot(index)`, so a
data-led URL (a slot inside a destination) is representable and phase 2 can route it to §5.2 rule 3.
The phase-1 reader takes a plain string and never produces a slot. Intended phase-2 algorithm: the
compiler hands the reader the literal segments with each `${…}` replaced by U+FFFC plus the list of
offsets that ARE atoms (so an author-typed U+FFFC is not an atom); the scanner treats an atom offset as
one letter for flanking (never a delimiter) and emits `Slot(n)` / `MdSeg.Slot(n)` where it lands.
Inside code spans and fences an atom is inert (`${` shown literally). Not built in phase 1.

### impl#1 findings while probing
- F-1: brace-less `if (c) a.push(x) else a.push(y)` drops the else branch entirely in emitted JS
  (library and program mode). `if (c) return a else return b` happens to survive. Silent miscompile.
  Not fixed here (out of scope); the md reader always braces.
- F-2: an index write into a LOCAL array (`xs[i] = v`) warns `E-ROUTE-001` (computed member access)
  in a pure library module with no routes — a route-inference false positive. Non-fatal (34 in md).
- F-3: a local named `use` (a scrml keyword) compiles to broken JS (`x = x -; let _scrml_tilde_5 = use`),
  caught only by the emit validator as E-CODEGEN-INVALID-LOGIC "compiler defect". Should be a
  parse-time reserved-word diagnostic.
- F-4: `out = out + match n { … }` (a match expression as a `+` operand) emits invalid JS
  (E-CODEGEN-INVALID-LOGIC). Worked around with a typed const.
- F-5: a top-level `const X: T[] = [ … ]` in a library module emits invalid JS (the annotation is not
  stripped). Worked around by dropping the annotation.
- F-6: a match subject typed only by a `for (const x of xs)` loop variable is E-TYPE-025 (asIs);
  `for (const x: T of xs)` is accepted syntax but does not type x. Worked around with an inner typed const.
- F-7: client-side `import { parse } from 'scrml:md'` is E-STDLIB-CLIENT-CHUNK-MISSING — a client stdlib
  import needs a runtime chunk (runtime-chunks.ts + runtime-template.js). That IS the phase-3 `of=`
  shipping work; phase 1 leaves it. Server-side import (shim copied to `_scrml/md.js`) works now, and
  phase 2's compile-time call can import the shim directly.

## Dedent: the briefed rule breaks the deep-dive's own layout (decision taken, surfaced)
The brief (and deep-dive §6f) say the dedent minimum COUNTS the closer's line. In the canonical layout
`<md>` and `</md>` sit at the same column and the content one level right (§6f: md at 8, content at 12).
Counting the closer gives min = 8, leaving every content line at 4 spaces — `## Title` at 4 spaces is
not a heading (ATX allows 0–3), a list marker at 4 is not a list. §6f's own text then claims the content
lands at column 0 ("the 3-space continuation of item 1"), which is only true if the closer does NOT
count. The closer's line can only change the minimum when it is LESS indented than the content — exactly
the harmful case — so counting it has no benefit for markdown (no indented code in the dialect, so
deliberate leading indentation is never wanted). Implemented: the closer's (blank) line is dropped and
not counted. Candidate question #1 for the PA / bryan.

## Conformance
The conformance corpus is program-level (codes + DOM). A program can only reach scrml:md from the client
after phase 3's runtime-chunk wiring (F-7), so the reader is covered by unit tests, per the brief's fallback.
