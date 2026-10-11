# progress — s462-md-phase1

- [x] merged origin/main (already up to date at a9aa81eff)
- [x] BRIEF archived
- [x] read deep-dive, the five S462 rulings, SPEC §4.15/§4.17/§4.18.1a/§5.2/§7.4.2/§26.6/OQ-6/§34, stdlib idiom, shim + parity test
- [x] stdlib/md/index.scrml parser + tests (compiler/tests/unit/stdlib-md.test.js, 143 tests)
- [x] generated shim (scripts/gen-md-shim.ts) + compiler/tests/unit/stdlib-md-shim.test.js; the existing
      stdlib-shim-export-parity picks scrml:md up automatically (§1-3 exports, §4 enum shape, §6 async)
- [x] SPEC §67 + SPEC-INDEX + §34 codes (+ §4.15 row, §4.18.1a note, §5.2 rule-3 bullet, §26.6.5 note, OQ-6 annotation)
- [x] client chunk `stdlib-md` registered (stdlib-client-registry §1b forces every shim to be classified;
      the derived rule — no host reach, no credentials — makes md client-registered)
- [x] gates: pre-commit (35,036 tests at 0dc2a4f09, 0 fail) · unit+conformance after SPEC (27,852, 0 fail) ·
      tracking tier integration+lsp+commands (5,671, 0 fail) · browser-baseline --check PASS (first run: harness
      parser disagreement 49 vs 50, no verdict; rerun PASS) · s34-census --check-new PASS (30 rows) ·
      host-global-scan --check 0 violations · facts --check PASS (after --write: stdlib 21 -> 22) ·
      regen-spec-index --check OK · bootstrap-conformance --check current · gen-bootstrap-severity --check current ·
      snippet-gate 128/128 · corpus-compile-floor --check PASS · types-gate --check OK · gen-md-shim --check current ·
      stdlib-shim-export-parity (scrml:md §1-3/§4/§6) PASS · conflict-marker-gate PASS · delta-lint PASS

## Candidate questions for bryan / the PA (normative decisions the rulings did not cover)
Each is marked "(PA reading, s462-md-phase1)" in §67. Recommendation in brackets.
1. Dedent does NOT count the closer's line (deviates from the brief and deep-dive §6f wording; their
   own example needs it). [as implemented]
2. Second spellings of an IN construct are TEXT + lint, not accepted-with-lint: `_em_`/`__strong__`,
   `*`/`+` bullets, `1)`, `***`/`___`/`- - -`, `~~~`, a closing `#` run, two-space breaks, '…'/(…)
   titles, `<dest>`, pipe-less tables, single `~`. Read from F3 "one way to do it". [as implemented]
3. Lazy continuation is not scrml-md (W-MD-LAZY-CONTINUATION; the line starts a new paragraph). Keeps
   the parse local (block structure decided line by line). [as implemented]
4. Table rows must carry both outer pipes (W-MD-TABLE-PIPES). [as implemented]
5. `E-MD-URL-SCHEME`: a literal unadmitted scheme in a STATIC body is an error — stricter than §5.2's
   static-string rule (deep-dive §6d PA-decidable default). [yes]
6. `E-MD-IN-PHRASING`, no `<md inline>` variant in v1 (deep-dive §9 Q2). [error now; inline later if asked]
7. `<md of=>` accepts `string | not`; `not` renders an empty host (deep-dive §9 Q3). [yes]
8. `E-MD-OF-BODY` for `of=` plus a body. [yes]
9. Heading slugs are ASCII `[a-z0-9-]`; non-ASCII letters are dropped ("Café" -> "caf"), "section" when
   empty, page-wide dedupe including author `id=`s with -1/-2 (deep-dive §9 Q4: suffix, not error).
   [keep ASCII; alternative: keep Unicode letters like GitHub]
10. Atoms: inert inside code spans / fences; a constant-folded atom is still text-only; an atom is one
    letter for flanking; a literal prefix that proves the scheme admits a data-led URL at compile time.
    [yes]
11. Bounds are normative: linear time SHALL; 32 nesting; 32 open brackets; link-tail budget 4n+1024
    (deep-dive §9 Q8). [yes — every reader must read hostile input to the same tree]
12. W-MD codes are Warnings, reported only for static bodies (never for data). [yes]
13. The md shim is GENERATED (not hand-written) and the compiler registers a `stdlib-md` client chunk —
    two compiler-side touches (runtime-chunks.ts, runtime-template.js) beyond "the module". [yes; F4]
14. Size: the generated reader is 77 KB raw / 20 KB gzip under impl#1 codegen (deep-dive estimated
    3–6 KB). A phase-3 size target is open (the inlined `_scrml_structural_eq` + `==`-as-call lowering
    dominate). [set a target before phase 3 ships `of=`]
15. `</md>` matches case-insensitively, as `</pre>` does (§4.17). [yes]

## S239 review of 5590c52f6 — FIX round (done)
- MED-1 nested-list trailing blanks returned to the parent (outer looseness) · MED-2 §67.2 rewritten: `${`
  is taken (balanced extent) not parsed; a slot the reader places in code is restored to its exact source
  text and never parsed / scope-checked; unclosed `${` = E-MD-INTERP-UNCLOSED naming `<pre>`. Reader half
  LANDED (`parseSlots`, MdSlot, Slot(i) = caller's index); splitter + parse-after-placement = phase 2.
- L1 linear headingSlugs · L2 gen-md-shim --check in ci.yml gate job + scripts/git-hooks/pre-commit
  (the template; the LIVE hook in the shared .git/hooks is machine-local — reinstall via
  scripts/git-hooks/install.sh, a PA action, not done from a worktree) · L3 lints added (CommonMark's
  652: 323 exact / 328 linted / 1 silent = #144, the closed `language-` class, documented as intended) ·
  L4 CommonMark #280 · L5 lone CR · L6 §67.7 size corrected + known-gaps
  g-stdlib-client-chunks-not-minified-md-s462 (`_loadStdlibChunk` untouched) · L7 §67.9 wording now
  states block / inline / bracket bounds separately (inline keeps the INNER 32 levels).
- Candidate #9 settled by PA direction: slugs keep Unicode letters/marks/digits/`_` (github-slugger).
- Candidate #2 (second spellings as text) awaits bryan's Q22; behaviour unchanged.
- F-1 (brace-less else drop) is being fixed on another branch; untouched here.

## Out-of-scope gaps noticed (not fixed here)
- §4.17 still says "HTML entity-escaping … remains author responsibility"; Q21 (a) (raw bodies emitted
  with `<`/`>` encoded) is ruled but not in SPEC text, and (per the deep-dive) not built in impl#1.
- W-LINT-015 names `${ rawHtml(expr) }`, which exists nowhere (deep-dive PA action 2); with F2 ruled it
  should point at `<md of=…/>` and say scrml has no raw-HTML form.

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
