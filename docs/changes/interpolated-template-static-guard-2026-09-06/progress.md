# progress — interpolated-template-static-guard-2026-09-06

Append-only. Timestamps UTC.

## 2026-09-06T19:0x — startup gate

- WORKTREE_ROOT `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1c6c0c47022f809f`
- base asserted: `merge-base HEAD origin/main` == `origin/main` == `eb3fe5c19302532ddd24a8d8421fb175893015dc`
- `bun install` OK (218 pkgs). `bun run pretest` run PLAINLY from worktree CWD; artifacts verified
  present in `samples/compilation-tests/dist/` (13 samples).
- BRIEF fetched from `scope/s404-template-static-guard`.

## MAPS — NOT LOAD-BEARING (measured)

`grep -n "inferExprType|53\.4|E-CONTRACT-001|BOUNDARY|isStaticTemplateLit|literal-type-only|extractInitLiteral"`
over `.claude/maps/*.md`: **ZERO hits** for `isStaticTemplateLit`, `literal-type-only`,
`extractInitLiteral`, `E-CONTRACT-001`, `§53.4`. The only adjacent routing row is
`primary.map.md:679` (`W-TYPE-031-UNPROVEN` / `inferExprType`) which routes to the `asIs`/`unknown`
split, a different question. This is the map's OWN documented failure mode: watermark `499eecce`,
and the router "lags the SESSION'S OWN WORK" (its S402 banner says so verbatim). The defect was
introduced by #873, past the watermark.

## LIMB REPRODUCTION — both limbs reproduce on HEAD

- limb A (`<full>: string(.length <= 8) = \`${@first} ${@last}\``): exit 0, **0** `E-CONTRACT-001-RT`.
- limb B (`<s>: string(.length >= 5) = \`${@a} world here\``): hard error
  `E-CONTRACT-001: ... Value  does not satisfy the predicate` (empty value).

## TRUE-BASE FLIP — done by FILE COPY (no `git stash`, no second worktree)

`git diff --stat 499eecce origin/main -- compiler/src compiler/native-parser stdlib scripts` is
exactly **2 compile-path files** (`expression-parser.ts`, `type-system.ts`) plus a non-compile-path
script. So copying those two files from `499eecce` reconstructs the true base faithfully.
Restored with `git checkout --` afterwards; tree verified clean.

Base results:
- limb A: exit 0, **2** guards — BUT the guarded value is `` `` ``:
  `const _scrml__scrml_chk_full_2 = \`\`;` then `if (!((_scrml__scrml_chk_full_2.length <= 8)))`.
- limb B: exit 0, **2** guards — `const _scrml__scrml_chk_s_2 = \`\`;` then
  `if (!((_scrml__scrml_chk_s_2.length >= 5)))` -> **0 >= 5 is FALSE -> the page THROWS at load.**

## ⚑ THE BRIEF'S PREMISE IS FALSIFIED AT THE ARTIFACT LEVEL

The brief says limb A puts "a 22-character value ... in a `<= 8` predicate with nothing checking
it". **The value is not 22 characters. It is the empty string, at BOTH base and HEAD.** The
interpolation is destroyed upstream of the type system. Base's 2 guards are VACUOUS
(`"".length <= 8`). Limb B's base "clean compile" ships a page that throws
`E-CONTRACT-001-RT` on first paint (invariant-67 shape: clean compile, dead page).

## ROOT — LOCATED BY EXECUTION, upstream of the briefed locus

`splitBlocks` (`compiler/src/block-splitter.js:893`) has **no back-tick-template tracking outside a
`frame.type === "meta"` context** (the only tracking is at `:2790`). At FILE TOP LEVEL a back-tick
template's `${...}` is therefore consumed as a LOGIC-BLOCK opener. Measured, limb A:

```
text  : "<first>: string = \"Bartholomew\"\n<last>: string = \"Vanderbilt\"\n<full>: string(.length <= 8) = `"
logic : "${@first}"
text  : " "
logic : "${@last}"
text  : "`\n\n"
markup: "<program>..."
```

The state-decl init reassembles to `` `` ``. Confirmed downstream by instrumenting
`type-system.ts` at the predicated reactive-decl site:

```
[S404] react name= full init= "``" initExpr= {"kind":"lit","raw":"``","value":"","litType":"template"} sourceInfo= {"kind":"literal","value":""}
```

So `isStaticTemplateLit`'s (raw,value) aliasing IS a real hole, but it is NOT why limb A/B fail:
by the time the expression parser runs, the template is **genuinely** single-quasi-empty. Carrying
an interpolation flag on `LitExpr` alone therefore **cannot** fix either limb.

Inside `<program>` markup the splitter keeps the block whole — which is why #873's `let`-form
tests passed. The `let` form has its own separate defect: `let g: string(.length<=8) =
\`${@first} ${@last}\`` emits the guard with the template raw copied VERBATIM, `@` sigils unlowered,
producing `E-CODEGEN-INVALID-LOGIC` at both base and HEAD.

## 2026-09-06 — LANDED

### d81f5951 — fix: carry template interpolation on `LitExpr`

`LitExpr.hasInterpolation` (`compiler/src/types/ast.ts`), stamped by BOTH
`TemplateLiteral` branches of `esTreeToExprNode` from `quasis.length`, by the
`Literal` arm from a real scan of `raw` for an UNESCAPED `${` (new exported
`rawTemplateHasInterpolation`), and by the NATIVE pipeline's
`translate-expr.js:translateTemplateLit` from `exprs.length`.
`isStaticTemplateLit` now READS the flag; absent, it scans `raw` — never the
`(raw, value)` reconstruction.

Plus the LOW item: `extractInitLiteral`'s back-tick branch now requires the
BODY to carry no unescaped back-tick, so `` `abc` + `de` `` is `arithmetic`
rather than an 11-character literal. Kept in place rather than moved below the
arithmetic test, because that test is a bare `/[+*\/]/` over the whole string
and would misclassify the legitimate static template `` `a + b` ``.

⚑ NATIVE-PARSER PARITY WAS PART OF THE CHANGE. A new `LitExpr` field stamped
only by the LIVE pipeline is a MISSING-FIELD divergence; the within-node parity
canary caught it on the first commit attempt (`examples/08-chat.scrml`, raw 62
vs allow 61, residual 1). The allowlist is NOT bumped — the divergence is
removed. `translate-expr.scrml` is 121 lines against the `.js`'s 1317 and has
no `translateTemplateLit` at all (feature-stale; nothing to mirror into).

### 37d15647 — test: the three-form x two-direction matrix

`compiler/tests/unit/template-literal-interpolation-classification.test.js`,
22 tests in four layers. Two groups PIN A DEFECT and say so in their names
(state-cell form; `const` boundary limb) — they assert what the compiler does
TODAY and SHALL FAIL when either root is fixed.

Bite verified by EXECUTION, not inspection:
  * against true base `499eecce`: **15 of 22 FAIL**.
  * against `origin/main` with ONLY the `extractInitLiteral` half reverted:
    **exactly 1 fails**, the concatenated-template case.

## VERIFICATION — all executed

| gate | result |
|---|---|
| corpus emit differential, 1920 sources / 7427 artifacts | **NO DIFFERENCES** — 0 content diffs, 0 diagnostic code or text changes, 0 guards added, 0 guards removed, 0 newly failing/passing compiles, 0 load-context changes |
| R26 empirical — 4 `gauntlet-r25/dev-*.scrml` | **byte-identical** base vs fix: same exit codes, same error-code sets, same artifact sha256s |
| gate suite (unit+integration+conformance) | before **23312 pass / 0 fail**, after **23334 pass / 0 fail** (+22 = exactly the new file) |
| browser + lsp + commands | **1247 pass / 48 fail on BOTH sides** — pre-existing, zero delta; not in the pre-commit gate command |
| `types:check` | 12 pre-existing TS7016/TS2352 diagnostics on clean HEAD too; unchanged |
| within-node parity canary | 1016 pass / 0 fail |

⚑ BOTH A/B SIDES CAPTURED FROM THE SAME DIRECTORY. A differing
`--compiler-root` path moves the §47 chunk-namespace hash and manufactures a
phantom diff in every artifact — the first run reported **1027 differing
artifacts, all byte-length-identical**, purely from the path.

## MEASURED MIGRATION

| population | count |
|---|---|
| `.scrml` files in tree (excl. native-parser mirrors) | 2481 |
| files containing an interpolated back-tick template | 238 |
| decl inits that ARE an interpolated template | 37 (examples 20 · stdlib 7 · docs 7 · samples 3) |
| **interpolated template meeting a PREDICATED annotation** | **7 — and all 7 are the widening's own probe fixtures under `docs/changes/type-enforcement-two-wins-2026-09-06/probe-fixtures/`. REAL-corpus count is 0.** |
| **top-level structural state cell with an interpolated template init** | **0** |

All 37 real uses are INDENTED — inside `fn` bodies, `${…}` logic blocks or
markup — where the splitter keeps the block whole. That is why the root below
has zero corpus incidence, and (per the reverse-ouroboros rule) zero incidence
is a blast-radius measurement, not evidence that adopters do not want the shape.

## OPEN — NOT FIXED, SURFACED (three, all verified by execution)

1. **ROOT — `splitBlocks` has no back-tick tracking outside a `meta` frame.**
   `compiler/src/block-splitter.js`; the only tracking is at `:2790`, gated
   `frame.type === "meta"`. At file top level a template's `${…}` is consumed
   as a LOGIC-BLOCK opener, the initializer reassembles to ``, and the orphaned
   segments emit as bare `_scrml_reactive_get(...)` statements. Pre-existing at
   `499eecce`. **NOT FIXED — it is a §3.1 context-grid design question**
   (does a back-tick shield `${` in the top-level default-logic body, and what
   about back-ticks in markup prose?) and SPEC has no normative sentence for
   the `${` opener. The precedent that WOULD govern it is **§44.8**, which
   already requires the `?{` scanner to "respect template-literal boundaries"
   after the regex form produced *silent data loss* — "Per S49, silent-bad-output
   is unacceptable". Same class, different opener, no rule.
2. **The `const` form has no §53.4 BOUNDARY limb at all.** MEASURED at
   `499eecce` AND at HEAD: `const s: T(pred) = <non-static>` emits **0** guards
   for an interpolated template AND for a plain ident; the sibling `let` emits
   2. Its STATIC limb works (`const s: string(.length>=5) = "hi"` fires
   E-CONTRACT-001). Pre-existing, not a regression, pinned by a test.
3. **The `let` boundary guard does not lower `@` sigils inside a template.**
   `let g: string(.length<=8) = \`${@first} ${@last}\`` copies the template raw
   VERBATIM into the guard temp, emitting
   `const _scrml__scrml_chk_g_2 = \`${@first} ${@last}\`;` and failing
   `E-CODEGEN-INVALID-LOGIC`. LOUD, and identical at base and HEAD. Non-reactive
   interpolation (`${a}`) is fine — this is specific to a reactive `@cell`.

## CORRECTION TO THE BRIEF'S PREMISE

Limb A does NOT change runtime semantics. `@full` is `""` at base AND at HEAD —
the value is destroyed by (1) before the type system ever sees it, so base's
2 guards were VACUOUS (`"".length <= 8`). Limb B's base "clean compile" ships a
page that THROWS `E-CONTRACT-001-RT` on first paint (`"".length >= 5` is false)
— invariant-67 shape: clean compile, dead page. HEAD's compile-time error is
strictly better than that, though its message is confusing. **What #873 really
did was remove a guard that had been accidentally masking a pre-existing
data-loss bug.** Restoring the guard without fixing (1) would restore the mask.

## 2026-09-06 — S239 ADVERSARIAL REVIEW ROUND (1 HIGH / 3 MED / 2 LOW)

All six addressed. Every finding was REPRODUCED BY EXECUTION before being
touched, and attributed to a side by running the same probe at `origin/main` —
not inferred from the diff.

### ba800603 — HIGH: native `value` was `raw`, delimiters included

`translateTemplateLit` built its node as `makeLit(raw, raw, …)`. Confirmed by
execution on this branch BEFORE the fix:

```
NODE:     {"raw":"`abc`","value":"`abc`","litType":"template","hasInterpolation":false}
CLASSIFY: {"kind":"literal","value":"`abc`"}      // 5 chars; the value is 3
```

and at `origin/main` the same node classified `literal-type-only` — safe, but
safe for a reason nobody chose (the old reconstruction test
``raw === "`" + value + "`"`` can never match once `value` carries the
backticks). Carrying `hasInterpolation` removed that accidental fall-through,
so a corrupt value would have gone straight into the STATIC zone.

FIXED by mirroring the live `TemplateLiteral` arm: `value` is the concatenated
COOKED body when there is no interpolation, `""` when there is. The `cooked` was
already threaded through every quasi (`lex-in-template.js:scanTemplateChunk`
resolves escapes and excludes both delimiters; `parse-expr.js:4021` stores it) —
nothing new had to be computed.

Verified end to end through `nativeParseFile`:
`` `abc` `` -> "abc" · `` `` `` -> "" · `` `a\nb` `` -> "a\nb" (3 chars, real
newline) · `` `${a} …` `` -> "" + `literal-type-only`.

⚑ MY FIRST PROBE OF THIS WAS THE WRONG REFERENT and reported `value: ""` for
every case. Hand-built `TemplateLit` nodes carry no `cooked`, so they cannot
tell a fixed translator from a broken one. The tests drive the REAL parser.

### d89b7d66 — MED 2/3/4 + LOW 5/6: one scanner replaces two `startsWith` pairs

| finding | origin/main | prev commit | verdict |
|---|---|---|---|
| F3 escaped-dollar template | DISAGREE | DISAGREE | pre-existing |
| F2 nested template in interp | AGREE | DISAGREE | **I INTRODUCED IT** |
| F4 concatenated quoted strings | DISAGREE | DISAGREE | pre-existing |
| F5 escaped back-tick, un-cooked | DISAGREE | DISAGREE | pre-existing |
| concatenated TEMPLATES | DISAGREE | AGREE | fixed by prev commit |

`scanSingleStringLiteral` + `cookOneEscape` + `skipNestedLiteral` replace both
defective branches. All 10 probe rows now AGREE between the fallback and the
structured classifier. F6: the helper no longer orphans `extractInitLiteral`'s
doc block — everything sits above it.

### ⚑ THE BITE FIGURE I REPORTED LAST ROUND WAS BACKWARDS

I said "15 of 22 fail at true base". The PA measured 7 fail / 15 pass and was
right: the 15 that PASS at base are the pinning tests for the two deferred
roots, and they pass BY DESIGN. Restated correctly for the current file:

| reference | result |
|---|---|
| `origin/main` (eb3fe5c) | **22 fail / 24 pass** of 46 |
| `ba800603` (native fixed, scanner not) | **11 fail / 35 pass** — isolates the scanner |
| current HEAD | **46 pass / 0 fail** |

The 24 that pass at `origin/main` are the pinning tests plus the fallback rows
that were already correct there. A bite figure is the count that goes RED, and
stating its complement reads as a much stronger gate than was actually built.

### POPULATION COUNT owed by finding 2 — MEASURED, and the answer is bigger than the question

Instrumented `extractInitLiteral` itself and compiled all 1920 corpus sources
(a source-text grep cannot tell which declarations carry a parsed `initExpr`
and so never reach the fallback at all):

```
total calls                          : 278
non-string args                      : 0
non-empty string args                : 0
DISTINCT non-empty args              : 0
RAW distinct args                    : [""]
args stopped by hasUnescapedBacktick : 0   <- finding 2's population
```

**The only argument `extractInitLiteral` ever receives across the whole corpus
is the empty string.** Finding 2's narrowed population is 0 — but so is the
population of every other branch. ⚑ NEW FINDING: the entire fallback classifier
is INERT on the corpus. All four findings on it are correctness-of-the-
instrument issues, not live miscompiles, and the "SHALL agree" invariant its
docstring declares was enforced by nothing until the 15-row table added here.

### REACHABILITY OF THE HIGH — measured, and it QUALIFIES the artifact gate

Instrumented `translateTemplateLit` and compiled all 1920 sources:
**0 translations, 0 sources reached it.** The instrument is proven working (it
fires on a direct `nativeParseFile` call: 1 hit, `{"raw":"`abc`","cooked":"abc"}`).

I made THREE attempts to construct a reaching case on the emit path — two
component shapes and a `^{}` meta-emit — and all three failed for unrelated
reasons before reaching the translator (E-COMPONENT-035 twice; E-META-EVAL-001
once). So the reviewer's reachability claim — "reachable through a component
body re-parse (`component-expander.ts:1189`) and a `^{}` meta-emit
(`meta-eval.ts:397`)" — is **RELAYED-UNVERIFIED. I could not reproduce it and I
decline to certify it.** What IS established: the path is not flag-gated
(`reparseSynthesizedFile` calls native unless `sourceNeedsLiveFallback`), and
`sourceNeedsLiveFallback` routes only INTERPOLATED templates to the live parser,
so static templates would take it.

⚑ CONSEQUENCE THE ARTIFACT GATE CANNOT SPEAK TO: the corpus emit differential
is **BLIND to the native fix by construction** — it measures a path that is
never taken. Its NO-DIFFERENCES verdict must NOT be read as evidence the native
fix is safe on the emit path. The evidence that the fix is right is the
unit-level execution plus the parity canary.

### VERIFICATION — all executed, this round

| gate | result |
|---|---|
| corpus emit differential, 1920 sources / 7427 artifacts, same directory both sides | **NO DIFFERENCES** — 0 content diffs, 0 diagnostic changes, 0 guards added/removed, 0 newly failing/passing |
| gate suite (unit+integration+conformance) | before **23312 / 0 fail**, after **23358 / 0 fail** (+46 = exactly the test file) |
| browser + lsp + commands | **1247 pass / 48 fail on BOTH sides** — pre-existing, zero delta |
| within-node parity canary | **1016 pass / 0 fail**; FIELD-SHAPE **10,768 -> 10,722 (-46)** |
| the arc's test file | **46 pass / 0 fail** |

⚑ REPORTED, NOT FIXED — the canary cannot see an improvement.
`subtractAllowlist` (`within-node-classifier.ts:512`) clamps with
`r > 0 ? r : 0`, so a raw count falling BELOW its allowlist row yields residual
0 and passes silently — while `parser-conformance-within-node.test.js`'s own
header claims an improvement surfaces as a signal requiring the row to be
updated downward in the same landing. It does not surface. My -46 is invisible
to the gate, and the allowlist ratchets in one direction only.
