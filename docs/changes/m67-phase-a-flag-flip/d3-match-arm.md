# M6.7-D3 — FIX-NATIVE: the match-arm `=>` expression family — `:>` colon-arrow separator (dominant cluster sub-form)

Worktree:    /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a03bc182fa5a32427
Branch:      worktree-agent-a03bc182fa5a32427
Startup pwd: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a03bc182fa5a32427
Base HEAD:   003ee3a8 (S127 close; D1/D2/C1/C2 absorbed. main is +2 docs-only commits — D4 STOP-report b40ab415 + s128-open b5bb8cfd — neither touches native-parser source, so this worktree's parser source == main's.)

Maps consulted: primary.map.md (full) + Task-Shape Routing "Native-parser bug fix" row
(structure/schema/domain/test maps). **Load-bearing finding:** the map's standing warning
("treat ALL native-parser map content as hypothesis to verify against source") was the correct
posture and was load-bearing — it steered me to re-derive the match production from current source
rather than trust the stale "D3 = `:>` transition-arm" label. The line-level locus
(parseMatchArm / isArmArrowAt in parse-expr.js) came from Grep on the live source, not the maps;
the bridge architecture (rawArms string reconstruction) came from reading translate-expr.js directly.

## VERDICT (one line)
The match cluster is N distinct sub-bugs (seven). This unit fixes the DOMINANT — the `:>`
colon-arrow match-arm separator (12 of 24 cluster files, 47 corpus NSBH fires) — and files the
other six as named follow-on units. Mirrors the D1 STOP-and-split precedent.

## Phase 0 — ROOT-CAUSE CONFIRMATION (the label was imprecise a 6th time; pinned empirically)

### Step 1 — Re-measured the CURRENT corpus NSBH residual (post-D1/D2/C1/C2)
Drove the full 1001-file `.scrml` corpus through `nativeParseFile` at HEAD `003ee3a8`
(scratch-d3/phase0-corpus.mjs). **NSBH = 293 fires across 110 files** — matches the d4 re-measure
exactly. Classified by FIRST error code per file: E-EXPR-MATCH-ARROW 13 + E-EXPR-MATCH-PATTERN 11
= the 24-file match cluster (this unit's scope).

### Step 2 — Decomposed the 24 files by ARM SUB-FORM (scratch-d3/classify-subform.mjs + probe-forms.mjs)
The "match-arm" bucket is not one gap — it is SEVEN distinct native parse gaps:

| sub-form | files | example | first-code |
|---|---:|---|---|
| **`:>` colon-arrow** (THIS UNIT) | **12** | `.North :> "up"` | MATCH-ARROW (11) + MATCH-PATTERN (1 cascade) |
| literal-arm (string/number/bool) | 5 | `"Monday" => …`, `0 -> …` | MATCH-PATTERN |
| `given n` binding pattern | 3 | `given n -> handle(n)` | MATCH-PATTERN |
| `\|` alternation pattern | 1 | `.Red \| .Purple => true` | MATCH-ARROW |
| guard clause `if` | 1 | `.Circle(r) if r > 0 => r` | MATCH-ARROW |
| `not` standalone pattern | 1 | `not => "absent"` | MATCH-PATTERN |
| same-line space-separated arms | 1 | `match @s { .A => "a" .B => "b" }` | MATCH-PATTERN |

### Step 3 — Pinned the `:>` divergence against the live/Acorn oracle
The native lexer lexes `:>` as an ADJACENT `Colon` + `GreaterThan` pair (lex-in-code.js:800-809 —
the colon lexer maximal-munches only `::` → DoubleColon; it has no `:>` arm). `parseMatchArm`
(parse-expr.js) recognised only `=>` (Arrow token) and `->` (isArrowAliasAhead — Minus+GreaterThan),
so every `:>` arm fell to `recordError("E-EXPR-MATCH-ARROW", …)` on the Colon token, stranding the
cursor → cascading to `no statement begins here` at the statement loop. `:>` is the DOMINANT corpus
match-arm arrow (12/24).

### Step 4 — Confirmed parity-COMPLETENESS (live ACCEPTS `:>`), not corpus-stale
- The live tokenizer lexes `:>` as a first-class operator (tokenizer.ts:1054).
- ast-builder's `isArmArrow` treats `=>` / `:>` / `->` identically (ast-builder.js:1587, 2498) —
  the arrow flavour is NORMALISED AWAY.
- Empirically (scratch-d3/probe-live.mjs): the LIVE pipeline (splitBlocks + buildAST) accepts ALL
  eight probed sub-forms with zero errors. And `match d { .North :> "up" … }` produces a
  BYTE-IDENTICAL `match-expr` AST to the `=>` form (modulo span/id) — verified.
Therefore native matching `:>` is parity-completeness for a form live already accepts; no
bounded-JS-subset line is crossed.

### Which of the 3 match surfaces was in scope
(a) JS-style `match expr {}` value-return EXPRESSION (parse-expr) — **YES, this is the locus.**
(b) block-form `<match for=Type>` structural markup — not in scope (different locus, already handled).
(c) legacy `<machine>` transition arms — not in scope.
The E-EXPR-MATCH-* codes fire only on surface (a), as the brief hypothesised.

## STOP CONDITION HIT — condition (b)
The bucket is N distinct sub-bugs. Per the brief: *"fix the dominant, file the rest as named
follow-ons (mirror the D1 STOP-and-split)."* Fixed the dominant `:>` (12/24). Did NOT attempt the
other six — they are genuinely separate parse paths (separator-level vs pattern-level vs
separator-list-level), each with its own oracle and risk surface. No corpus-stale STOP (live
accepts all). No codegen/block-form STOP (the locus is parse-expr, as predicted).

## THE FIX (compiler/native-parser/parse-expr.js only)
Mirrors the existing `->` recomposition (isArrowAliasAhead). Three surgical edits:
1. `parseMatchArm` — new `:>` branch (after `=>`, before `->`): `isColonArrowAliasAhead` →
   advance Colon + GreaterThan, `separator = ":>"`.
2. `isColonArrowAliasAhead` (NEW, exported) — adjacency check `Colon` then `GreaterThan` with
   `c.span.end === g.span.start`. Mirrors isArrowAliasAhead exactly.
3. `isArmArrowAt` — new `Colon`+`GreaterThan` branch so the newline-as-separator boundary detector
   (peekStartsArmPattern / isAtArmBoundary) recognises multi-line `:>` arm bodies.

Scoped strictly to match-arm parsing: `isColonArrowAliasAhead` is called only from `parseMatchArm`;
`isArmArrowAt` only from `peekStartsArmPattern`; both are reachable only inside `parseMatchExpr`.
A type-annotation `:` or a general comparison `>` is untouched. The native→live bridge
(translate-expr.js `reconstructMatchArm`) already normalises the separator to canonical `=>` in the
`rawArms` string — so the bridged `match-expr` shape is UNCHANGED; no bridge edit needed.

## MANDATORY GATES (numbers; baseline captured in this worktree)
1. **Strict-pass canary EXACT — HELD at 964** (≥964 gate PASSES). Full histogram before == after:
   {EXACT:964, LIVE-DEGENERATE:12, GAP-state-block:1, LIVE-PHANTOM:1, DEFERRAL-test-block:21,
   LIVE-HOIST-MISCLASSIFY:2}; 1000/1001 strict-pass; parser-conformance-corpus 1019 pass / 0 fail.
   No EXACT fixture dropped (the `:>` files were already DEFERRAL/gap, not strict-pass-eligible;
   the fix improved their within-node parity without flipping them to/from EXACT).
2. **Within-node canary + allowlist regen — SAME COMMIT (2f7b34f8), test GREEN.** 1005 pass / 0 fail.
   TARGETED regen — exactly 6 fixtures moved (the files containing `:>` arms): test-008-test-enum,
   phase2-match-colon-arrow-024, rust-state-machine(r11), admin-panel, todo-list, kanban-r11; all
   other entries byte-identical. Corpus aggregate 95264 -> 95223 (-41 total).
   Per-class corpus deltas: KIND-NAME -12, MISSING-FIELD -31, EXTRA-FIELD -93, COUNT-LENGTH -29
   (all CONTENT classes DOWN = improvement: real match-arm subtrees replace error fragments);
   FIELD-SHAPE +8 + SPAN-COORD +116 (cosmetic span-coord noise on the newly-parsed subtrees —
   acceptable per the D1 precedent). Content-class net = -157 (improvement); no content regression.
3. **Full `bun run test` — 21362 pass / 174 skip / 1 todo / 0 fail / 781 files** (two consecutive
   stable runs; an earlier 2-fail was a transient network flake unrelated to this parser-only change
   — re-ran clean twice, exit 0). Pre-commit hook (browser-excluded) green on every commit.
4. **New unit test — LOAD-BEARING.** `compiler/tests/unit/m67-d3-match-arm-parse.test.js`:
   25 pass / 0 fail WITH the fix; **13 fail / 12 pass against the pre-fix parser** (parent 52d4f94a)
   — the 13 `:>`-specific native-parse + NSBH + bridge assertions fail pre-fix; the 12 that pass are
   the live-oracle acceptance cases (live always accepted `:>`) + the `=>`/`->` baselines + the
   type-annotation guard. Proven load-bearing.
5. **Corpus NSBH impact:** **293/110 -> 246/99 (-47 fires, -11 files).** E-EXPR-MATCH-ARROW
   first-error 13 -> 2 (the 2 residual = `|` alternation + `if` guard — follow-on units, not `:>`).
   E-EXPR-MATCH-PATTERN 11 -> 12 (the +1 is match-colon-arrow.scrml whose `:>` arm-1 now parses,
   advancing the cursor to its deeper `not` pattern at L13 — a cascade-collapse-reveals-next-layer
   effect, exactly as D1->D2 showed; NOT a regression). Spot-check: todo-list.scrml now parses with
   0 native errors; test-008 down to a single informational I-NATIVE-BLOCK-DROPPED.

## NAMED FOLLOW-ON UNITS (the residual match sub-forms — filed, NOT fixed)
Re-measure each after the prior lands (cascades collapse). Recommended slicing (dominant first):
- **M6.7-D3a  literal match arms** (`"str"` / `0` / `true|false` arm patterns, §18.16) — ~5 files +
  surfaces under match-colon-arrow & the s19-phase3 fixtures. Live accepts (§18.16 normative);
  native parseMatchArmPattern has no literal-arm branch. Clean, well-bounded; strongest next candidate.
- **M6.7-D3b  `given n` binding-pattern arm** — 3 files (s19 phase2/phase3 fixtures). Native pattern
  parser has no `given`-arm branch; pairs naturally with the D7 `given` reactive-param unit.
- **M6.7-D3c  `not` standalone arm-pattern** (§42 absence) — 1 file (match-as-expression). Native
  peekStartsArmPattern handles `not …` only as a guarded prefix, not as a standalone arm pattern.
- **M6.7-D3d  `|` alternation arm-pattern** (`.A | .B => …`) — 1 file. Native has no alternation in
  the arm-pattern grammar; the `|` is read as a bitwise-or in the body.
- **M6.7-D3e  arm guard clause `if`** (`.Circle(r) if r > 0 => r`) — 1 file. Native has no
  post-pattern guard slot.
- **M6.7-D3f  same-line space-separated arms** (`match s { .A => "a" .B => "b" }`) — 1 file
  (match-001-nested-with-call). Native arm-list loop separates on `,`/`;`/newline only; a same-line
  space boundary after a string/expr body is not recognised. Narrowest; lowest priority.
(The await/async/throw/try-NOT-IN-SCRML triggers among these fixtures are DELIBERATE native
rejections live ALSO makes — NOT fix units.)

## FILES TOUCHED
- compiler/native-parser/parse-expr.js                                  (the fix — 3 edits)
- compiler/tests/parser-conformance-within-node-allowlist.json          (targeted regen, SAME COMMIT)
- compiler/tests/unit/m67-d3-match-arm-parse.test.js                     (NEW, 25 load-bearing tests)
- docs/changes/m67-phase-a-flag-flip/d3-match-arm.md                     (this doc)
- docs/changes/m67-phase-a-flag-flip/progress.md                         (D3 section appended)
- scratch-d3/*.mjs                                                       (phase-0 probes; committed as trail)
NO `compiler/src/codegen/` change (codegen is parser-agnostic — correctly untouched).
NO `.scrml` self-host mirror change (D1/D2 precedent: edit the runtime `.js` artifact only).

## COMMIT SHAs (this worktree branch)
- 52d4f94a  WIP(M6.7-D3): start + phase-0 corpus probes
- 2f7b34f8  fix(M6.7-D3): native parseMatchArm accepts `:>` colon-arrow separator (§18.2)  [+ allowlist regen, same commit]
- f1a4ffc6  test(M6.7-D3): load-bearing native+bridge parity for `:>` match arms
- (this commit) docs(M6.7-D3): d3 deliverable doc + progress

## PA ACTION REQUESTED
- File the six D3a–D3f follow-on units in the M6.7 flip ledger (D3a literal-arms is the strongest next slice).
- Note the residual MATCH-ARROW first-error (2 files) is now ONLY `|` alternation + `if` guard (D3d/D3e).

## Tags
#m6-7-d3 #native-parser #parse-expr #match-arm #colon-arrow #parity-completeness
#no-statement-begins-here #within-node-canary #strict-pass-canary #phase-0-root-cause
#stop-and-split #scrml-flip

## Links
- [d1-arrow-callarg.md](./d1-arrow-callarg.md)
- [d2-server-function.md](./d2-server-function.md)
- [d4-object-literal.md](./d4-object-literal.md)
- [c2-codegen-output.md](./c2-codegen-output.md)
- [parse-expr.js](../../../compiler/native-parser/parse-expr.js)
- [translate-expr.js](../../../compiler/native-parser/translate-expr.js)
- [m67-d3 test](../../../compiler/tests/unit/m67-d3-match-arm-parse.test.js)
- [within-node allowlist](../../../compiler/tests/parser-conformance-within-node-allowlist.json)
- [parser-conformance-corpus.test.js](../../../compiler/tests/parser-conformance-corpus.test.js)
- [primary.map.md](../../../.claude/maps/primary.map.md)
