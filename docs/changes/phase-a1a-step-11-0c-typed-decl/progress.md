# Phase A1a Step 11.0c — typed-decl recognizer — Progress

Branch: `phase-a1a-step-11-0c-typed-decl`
Parent baseline HEAD: `a7dd96a` (Step 11.0b close: newline-as-statement-separator).
Test baseline: 8,864 pass / 43 skip / 0 fail / 8,907 across 439 files.

## Survey

[step-11-0c startup] Worktree clean. `pwd` / git toplevel match. `git log -7`
shows `a7dd96a compile(a1a-step-11-0b)` near HEAD — baseline parent matches
BRIEF expectation. `bun install` → 113 packages. `bun run pretest` → 12
samples compiled. `bun run test` first run flake (2 ECONNREFUSED), retry →
**8,864 pass / 43 skip / 0 fail / 8,907 across 439 files**. Confirmed
baseline. Branch `phase-a1a-step-11-0c-typed-decl` created.

[step-11-0c survey-locus] Located key call sites in
`compiler/src/ast-builder.js`:
- `tryParseStructuralDecl` at L2971 (Step 11.0a's compound-extension is at
  L3014-3114; the new typed-decl branch goes BETWEEN the compound branch
  and the existing markup-RHS / expression-RHS branches at L3116+).
- `scanStructuralDeclLookahead` at L3240 — pure lookahead. The closer at
  L3261 currently checks for `>` followed by `=` (Shape 1/2/3) OR `>`
  followed by `<` (Variant C compound). We need to add: `>` followed by
  `:` (typed-decl, Step 11.0c).
- `collectTypeAnnotation` at **L2671** — EXISTING type-expression sub-parser.
  Returns a STRING (raw type text). Used at 11+ call sites for typed `let`,
  `const`, `@NAME : T = init`, `function param : T`, etc. **Pattern is
  uniform: `typeAnnotation?: string` across the AST.**
- `collectExpr` at L1784 — RHS-collection helper. Already has `compoundBody`
  flag (Step 11.0a) at L1790 + boundary at L1993-2001. Step 11.0b ASI-NEWLINE
  branch at L1985-2030 — these are unaffected by 11.0c.

[step-11-0c survey-existing-typed-pattern] Verified that `state-decl` AST
nodes ALREADY carry `typeAnnotation` for the legacy `@NAME : T = init` form
(L3786, L3789). The probe `@count: number = 0` produces:
```
{name:"count", init:"0", shape:"plain", structuralForm:false,
 isConst:false, hasInitExpr:true, typeAnnotation:"number"}
```
So the `typeAnnotation` field is already a recognized state-decl property.
Step 11.0c just needs to populate it for the structural-form `<NAME>: T = init`
in addition to the legacy form.

[step-11-0c survey-types-decl] `compiler/src/types/ast.ts`
`ReactiveDeclNode` (L432-502) does NOT yet declare `typeAnnotation` — even
though the runtime parser sets it. The structurally-similar `LambdaParam`
interface (L1509-1515) declares `typeAnnotation?: string`. Step 11.0c will
add the field declaration to ReactiveDeclNode to match the runtime shape.

[step-11-0c survey-collectTypeAnnotation-shape] L2671-2713: the function
consumes from `:` onward, balancing parens, stopping at `=` (top-level) or
`,` (top-level) or EOF. Critically, it accepts `pattern(/.../)` style
refinement-type forms because `(` opens depth. So `string(pattern(/.../))`
will be collected as the raw string `"string(pattern(/.../))"` — A1b/A1c
own semantic interpretation. **No type-parser extension needed for 11.0c.**

[step-11-0c survey-failure-shapes] Probe (`_probe_step11_0c.mjs`) confirms 5
distinct failure shapes today (all fall through to html-fragment):
1. `<count>: number = 0` → 1 html-fragment, 0 state-decls
2. `<userInfo>: UserInfo = ("alice", 30, true)` → 1 html-fragment
3. `<phase>: Phase = .Idle` → 1 html-fragment (note: bare-variant)
4. `const <doubled>: number = @count * 2` → 1 html-fragment
5. `<email>: string(pattern(/.../)) req = <input/>` → 1 html-fragment
Regression baseline: `<count> = 0` (untyped) → 1 state-decl, 0 fragments.
Legacy already-typed `@count: number = 0` → 1 state-decl with
typeAnnotation:"number".

[step-11-0c survey-acorn-tuple-and-bare-variant] Acorn behaviour probes:
- `("alice", 30, true)` → `SequenceExpression` (acceptable as ExprNode).
- `.Idle` → acorn parse error. `safeParseExprToNode` produces an
  `escape-hatch` node with `estreeType:"ParseError"` + `raw:".Idle"` per
  L1759-1762 fallback. This is acceptable: Step 11.0c collects the form,
  A1b's bare-variant resolver (M9) handles the resolution.

[step-11-0c survey-tokenization] `:` tokenizes as a standalone PUNCT in
logic context. The html-fragment output of probe 1 contains `< count > :
number = 0` with `:` clearly separated, confirming PUNCT classification.
No tokenizer changes needed.

[step-11-0c survey-step-11-0a-interaction] Compound-recognition at
`scanStructuralDeclLookahead` L3261-3303 fires when `>` is followed by `<`
(sibling decl OR `</` close). Typed-decl fires when `>` is followed by
`:`. **Zero overlap** — these are mutually exclusive token shapes. The
lookahead structure naturally orders them: the existing `>` + `<`
compound branch at L3273-3291 stays as-is; we add a new `>` + `:` typed
branch at the same level. Both precede the existing `>` + `=` Shape 1/2/3
fallthrough at L3292.

[step-11-0c survey-step-11-0b-interaction] Step 11.0b's ASI-NEWLINE
boundary at L1985-2021 calls `scanStructuralDeclLookahead` to confirm a
state-decl shape opener at start-of-newline. The lookahead only returns
non-null for state-decl shapes — including our new typed-decl shape. So
top-level RHS that contains `... \n <typed>: T = ...` will correctly
break at the typed opener as a sibling state-decl, since the lookahead
will recognize it. **Free generalization** — no extra wiring needed.

[step-11-0c survey-validators-vs-typed] One disambiguation point: the
existing scanLookahead loop iterates IDENT/KEYWORD tokens between IDENT
and `>` to collect validators. Validators always live BEFORE `>`. Type
annotation always lives AFTER `>` (between `>` and `=`). They are
positionally disjoint — no parser conflict. The brief's example
`<email>: string(pattern(/.../)) req = <input/>` has `req` AFTER the
type annotation and BEFORE `=` — but per probe of refinement-type, the
`req` falls inside `collectTypeAnnotation`'s collection range (no
top-level `=` until after `req`). Need to verify: does collectTypeAnnotation
consume `req` as part of the type, or does the BRIEF's syntax require
attrs-before-colon (i.e. `<email req length(...)>: string(pattern(/.../)) =
<input/>`)?

[step-11-0c survey-spec-§5-attrs-vs-typed] SPEC §5/§6.2 examples:
- `<userName req length(>=2)> = <input/>` (Shape 2: attrs BEFORE `>`)
- `<count>: number = 0` (Shape 1 typed: type AFTER `>`)
The brief at line 19 shows `<email>: string(pattern(/.../)) req = <input/>` —
i.e., type-then-attrs AFTER `>`, before `=`. This is unusual: most spec
examples place validators BEFORE `>` (inside the angle-bracket attr list).
The brief's example is one valid form per §53 (refinement type predicates),
but the placement of `req` after the type annotation is unusual.

**Decision:** in 11.0c, accept BOTH placements:
  - validators-before-`>`: standard Shape 2 path. Type annotation comes
    after `>` if `:` follows. (`<email req>: string = <input/>`).
  - validators-after-type-annotation: per BRIEF example (`<email>: string(pattern(/.../)) req = <input/>`).
    `collectTypeAnnotation` will consume `string(pattern(/.../))` (stops at
    `req` as IDENT-not-KEYWORD-PUNCT? Let me re-check). Actually
    collectTypeAnnotation's stop conditions are `=` (top-level), `,`
    (top-level), EOF. It does NOT stop at IDENTs. So `req` would be
    consumed AS PART OF the type annotation string —
    `"string(pattern(/.../)) req"`. This would be wrong semantically but
    A1b owns parsing. For 11.0c we accept it as a raw string;
    re-decomposition is A1b's problem.

  Or: prefer the canonical placement (validators-before-`>`) and document
  the brief's example as a syntax variation that lands as one big
  typeAnnotation string for now. A1b can re-split.

  **Pragmatic decision:** Implement the simple `>:` recognizer; let
  collectTypeAnnotation collect through to `=`. The brief's
  validators-after-type form will produce a typeAnnotation string that
  includes the trailing validators. A1b owns interpretation. Document
  this in §6 of progress.

[step-11-0c survey-discount-9-status] **NOT discount #9.** Despite the BRIEF's
"9× confirmed locus" framing, survey reveals genuine source change required:
  - `scanStructuralDeclLookahead` needs a NEW `>:` branch to return
    a `typedDecl: true` flag (akin to `compoundBody: true`).
  - `tryParseStructuralDecl` needs to call `collectTypeAnnotation` after
    consuming through `>`, then expect `=` and proceed.
  - There IS a substantial reuse — `collectTypeAnnotation` exists and is
    fully fit for purpose, including refinement-type form acceptance via
    paren-depth tracking. So the depth-of-reuse IS unusually high — but
    not zero new code (~25-30 LOC for the recognizer + types update).
  - Memorial flips and tests are pure additive work.

**Comparison vs Step 11.0a (~127 LOC) and Step 11.0b (~30 LOC): 11.0c
should land closer to 11.0b — ~25-30 LOC source + types + tests.**

[step-11-0c survey-design-summary]
- **Touchpoint:** `scanStructuralDeclLookahead` L3261 (closer block). Add
  new branch BETWEEN the compound `>` + `<` branch (L3273) and the
  fallback `>` + `=` branch (L3292). New branch detects `>` + `:` and
  returns `{compoundBody:false, typedDecl:true, consumeUntil:i+scanIdx+1}`
  (consume through `>` only — caller handles `:` and onward).
- **`tryParseStructuralDecl` L3014:** AFTER existing compound branch
  (L3027-3114), BEFORE the markup-RHS detection (L3125), check
  `scan.typedDecl`. If set:
    1. peek must be `:`.
    2. Call `collectTypeAnnotation()` — consumes `:` then balanced type expr.
    3. Expect `=`. If not, decline (restore cursor) — fallthrough to
       existing paths.
    4. Consume `=`, then proceed with markup-RHS / expression-RHS
       collection (Shape 1/2/3 dispatch unchanged).
    5. Set `typeAnnotation` on the produced state-decl AST node.
- **AST shape:** `state-decl.typeAnnotation: string | null`. Mutually
  inclusive with all 3 RHS shapes — typed plain (1), typed Shape 2 (2),
  typed derived (3). Set on whichever node the dispatch returns.
- **`isConst` interaction:** Shape 3 typed (`const <doubled>: number =
  @count * 2`) — `isConst === true` is forwarded by caller. Recognizer
  proceeds normally; resulting state-decl has shape:"derived",
  isConst:true, typeAnnotation set.
- **Variant C compound interaction:** the compound `>` + `<` branch in
  scanLookahead requires `validators.length === 0` and only fires on
  `>` + `<` shape, NOT `>` + `:`. So compound and typed branches are
  mutually exclusive at the lookahead level. **No interaction.**
- **Refinement-type acceptance:** `collectTypeAnnotation` already handles
  `string(pattern(/.../))` via paren-depth balance. Verified by
  reading L2678-2693. **Free.**
- **Bare-variant inference:** `<phase>: Phase = .Idle` — `.Idle` is
  collected as RHS expr-string by collectExpr (init = ".Idle");
  safeParseExprToNode produces escape-hatch ExprNode (acorn rejects
  bare-variant). **Acceptable for 11.0c — A1b owns resolution.**
- **Tier 3 positional:** `<userInfo>: UserInfo = ("alice", 30, true)` —
  collectExpr collects `( "alice" , 30 , true )`; acorn parses as
  SequenceExpression. **Acceptable for 11.0c — A1b/Tier-3-typer owns
  positional interpretation.**

## Plan

1. Edit `scanStructuralDeclLookahead` at L3261: add `>` + `:` branch
   returning `{typedDecl:true}` flag. Validators may be present
   (validators-before-`>` form) — typed-decl is compatible.
2. Edit `tryParseStructuralDecl` at L3014: insert typed-decl branch
   AFTER compound (L3027-3114), BEFORE existing markup-RHS detection
   (L3125). Branch:
     - Verify peek is `:`. If not → decline (restore cursor).
     - Call `collectTypeAnnotation()`. If null → decline.
     - Expect `=`. If not → decline.
     - Consume `=`. Proceed with markup-RHS / expression-RHS collection
       (existing dispatch, lines 3125+).
     - Annotate produced state-decl AST node with `typeAnnotation`.
3. Update `compiler/src/types/ast.ts` `ReactiveDeclNode`: add
   `typeAnnotation?: string` field.
4. Add ~7-10 NEW positive cases to
   `compiler/tests/integration/parse-shapes-v0next.test.js` in a new
   `A1a Step 11.0c — typed-decl recognizer` describe block:
   - §S11C.1 number-typed Shape 1
   - §S11C.2 string-typed Shape 1
   - §S11C.3 bare-variant inference
   - §S11C.4 Tier 3 positional
   - §S11C.5 derived typed (Shape 3)
   - §S11C.6 Shape 2 typed + refinement + validator
   - §S11C.7 untyped regression (typeAnnotation absent)
5. Flip 2 anti-test memorials (`§K11.X-D3a` and `§K11.X-D3b`) in
   `kickstarter-v2-smoke.test.js` to positive assertions; rename to
   `§K11.3A` and `§K11.3A-b`. Update top-of-file divergence comment block.
6. Anti-html-fragment guard on every positive case.
7. Run pre-commit + bun test → confirm 0 regressions + delta ~+8-10 pass.

## Implementation log

[step-11-0c impl-recognizer] Edit `scanStructuralDeclLookahead` at L3261:
add `>:` branch returning `{typedDecl:true}` flag with consumeUntil set
to past `>` only (caller handles `:` + type-expr + `=`). Branch placed
BETWEEN compound `>+<` branch and the existing `>+=` Shape-1/2/3 branch.
Validators are forwarded normally — typed-decl is compatible with
validators-before-`>`.

Edit `tryParseStructuralDecl` at L3115: insert typed-decl branch AFTER
compound (L3014-3114), BEFORE existing markup-RHS detection. Branch:
  1. Confirm peek is `:` (defensive — scanLookahead asserted).
  2. Call `collectTypeAnnotation()` (REUSED from L2671). Decline if null.
  3. Expect `=`. Decline if not present.
  4. Consume `=`. Fall through to standard markup-RHS / expression-RHS
     dispatch.
The local `typeAnnotation` var is propagated to BOTH return paths
(markup-RHS path L3174 → renderSpec node; expression-RHS path L3232+).

Net change so far: ~50 LOC source edits in ast-builder.js (no other
files yet). NO call-site mods needed — fix is universal.

[step-11-0c impl-probe-pass] Probe (`_probe_step11_0c.mjs`) confirms 12
of 12 cases produce expected AST shape:
  - 5 brief examples (typed Shape 1/2/3, Tier 3 positional, refinement-type)
  - Bare-variant `.Idle` collected as init=".Idle" (escape-hatch ExprNode)
  - 4 regression baselines preserved (untyped, legacy @-form, etc.)
  - Newline-separator interaction (Step 11.0b) — 2 typed decls coexist
  - Validators-before-colon (`<email req>: string = <input/>`)
  - Validator-after-type — collectTypeAnnotation absorbs trailing IDENT
    into typeAnnotation string (A1b decomposes)
  - Nested compound + typed children — children inherit typed-decl
    recognition from parent's recursive parse

[step-11-0c impl-test-status] After source change, full bun test:
**8,862 pass / 43 skip / 2 fail / 8,907 across 439 files**. The 2 fails
are EXACTLY the 2 anti-test memorials (`§K11.X-D3a`, `§K11.X-D3b`) that
predicted typed-decl falls through to html-fragment. Now the recognizer
fires; assertions become invalid. Memorial flip ready.

[step-11-0c impl-flip-memorials] Flipped both anti-test memorials in
`kickstarter-v2-smoke.test.js`:
  - `§K11.X-D3a` → renamed to `§K11.3A`. Old: assert `decls.length === 0`
    + fragment includes ": number". New: assert 1 state-decl with
    name="count", init="0", typeAnnotation="number", shape="plain",
    structuralForm:true, isConst:false. Anti-html-fragment guards on
    `<count>` and `: number`.
  - `§K11.X-D3b` → renamed to `§K11.3A-b`. Old: assert decls.length === 0.
    New: assert 1 state-decl with name="userInfo", init contains "alice"
    + "30" + "true" (tuple form), typeAnnotation="UserInfo".
    Anti-html-fragment guards on `<userInfo>` and `: UserInfo`.
  - Top-of-file divergence comment block: §K11.X-DIVERGENCE-3 marked
    RESOLVED with full description; section-header comment renamed
    K11.X-DIVERGENCE-3 → K11.3A.

After flip: kickstarter smoke 23/23 pass; full bun test 8864/8907 pass
(no delta because flipped tests stay 1:1).

[step-11-0c impl-types-update] Edit `compiler/src/types/ast.ts`
`ReactiveDeclNode` interface: added `typeAnnotation?: string` field with
~20-line doc comment listing all 6 populating decl forms (typed Shape
1/2/3 + Tier 3 positional + bare-variant + legacy `@`-form). String-form
representation matches LambdaParam.typeAnnotation and the legacy
`@NAME : T = init` runtime usage at L3786/3789. **No mutation of
runtime behaviour** — purely declares the field that the runtime parser
already populates.

[step-11-0c impl-new-positive-cases] Added 10 new typed-decl-specific
tests at the end of `parse-shapes-v0next.test.js` in a new
`A1a Step 11.0c — typed-decl recognizer` describe block:
  - §S11C.1: number-typed Shape 1 (`<count>: number = 0`)
  - §S11C.2: string-typed Shape 1 (`<name>: string = ""`)
  - §S11C.3: bare-variant inference (`<phase>: Phase = .Idle`) per §14.10
  - §S11C.4: Tier 3 positional sugar
    (`<userInfo>: UserInfo = ("alice", 30, true)`) per §14.11
  - §S11C.5: typed Shape 3 derived
    (`const <doubled>: number = @count * 2`)
  - §S11C.6: refinement-typed Shape 2
    (`<email>: string(pattern(/.../)) = <input/>`) per §53
  - §S11C.7: REGRESSION — untyped `<count> = 0` produces NO typeAnnotation
  - §S11C.8: validators-before-`>` + typed
    (`<email req>: string = <input/>`)
  - §S11C.9: newline-separator + typed-decls (Step 11.0b free
    generalization — 3 typed decls separate cleanly)
  - §S11C.10: compound parent + typed children — children carry
    typeAnnotation via Step 11.0a recursion

Every positive case fires `assertNoHtmlFragmentMatching` per BRIEF §5
DoD §6.

[step-11-0c impl-full-test-run] `bun run test` after all changes:
**8,874 pass / 43 skip / 0 fail / 8,917 across 439 files**. Delta
from baseline 8,864 → 8,874 = **+10 pass**. Composition:
  - 2 anti-test memorials FLIPPED (count stayed at 23 in kickstarter
    smoke — in-place edit, not new). The flipped tests now have 5-7
    additional positive assertions (typeAnnotation, shape, init,
    structuralForm, anti-html-fragment guards × 2).
  - 10 NEW positive cases added (S11C.1-S11C.10 in parse-shapes).
  - 0 regressions, 0 fails, 43 skip stable.

Within BRIEF target of +7-10 pass + memorial flips (at the high end).

## Final summary

**Files modified (1 source + 1 types + 2 tests):**
  - `compiler/src/ast-builder.js` — `scanStructuralDeclLookahead` `>:`
    branch (~13 LOC), `tryParseStructuralDecl` typed-decl handling
    (~30 LOC), typeAnnotation propagation in 2 return paths (~5 LOC).
    Net: ~48 LOC source change.
  - `compiler/src/types/ast.ts` — `ReactiveDeclNode.typeAnnotation`
    field added (~22 LOC with doc comment).
  - `compiler/tests/integration/kickstarter-v2-smoke.test.js` — 2
    anti-test memorials flipped to positive assertions (renamed
    §K11.X-D3a/D3b → §K11.3A/3A-b); top-of-file divergence comment
    block updated; section header renamed.
  - `compiler/tests/integration/parse-shapes-v0next.test.js` — 10 new
    positive cases (S11C.1-S11C.10) in a new §S11C describe block.
  - `docs/changes/phase-a1a-step-11-0c-typed-decl/progress.md` —
    survey + implementation log + final summary.

**Tier classification:** T2 (single-subsystem, parser-internal, behavior
change tied to AST shape — adds `typeAnnotation` field on structural-
form state-decls).

**Survey verdict — depth-of-survey discount #9 status:** **NOT a
Discount #9.** Survey confirmed the recognizer extension genuinely
needed source code; the existing parser had ZERO `>:` handling for the
structural form. HOWEVER, the depth of REUSE was unusually high:
`collectTypeAnnotation()` (existing helper at L2671) handles
refinement-type forms via paren-depth tracking — no extension needed.
The `typeAnnotation` field was already a recognized state-decl runtime
property (set by the legacy `@NAME : T = init` path at L3789), so types
update was purely declarative. Net: ~48 LOC source change vs Step
11.0a's ~127 LOC — **substantially leaner due to the reuse**.

**Refinement-type form decision (BRIEF §3 question 4):** Option (a)
full collection in 11.0c. The existing `collectTypeAnnotation` helper
already handles `string(pattern(/.../))` via paren-depth. Refinement
predicates land in the typeAnnotation string verbatim;
A1b/A1c decompose. **Reuse 100%, zero new collection logic.**

**Tier 3 positional sugar (BRIEF §3 question 5):** Acorn parses
`("alice", 30, true)` as `SequenceExpression` — verified via probe.
Acceptable as ExprNode; A1b's typed-compound resolver interprets
positionally per §14.11.

**Bare-variant inference (BRIEF §3 question 6):** Acorn rejects
standalone `.Idle` — `safeParseExprToNode` produces an `escape-hatch`
ExprNode with `raw: ".Idle"` per the existing fallback at L1759-1762.
A1b's bare-variant inference (M9) handles the resolution.

**Step 11 anti-test flipping:** All 2 `TODO[step-11.0c]` anti-test
memorials flipped cleanly. Renaming followed: `§K11.X-D3a` →
`§K11.3A`, `§K11.X-D3b` → `§K11.3A-b`. Sectioning updated from
"DEFERRED" to "RECOGNIZED". TODO[step-11.0c] markers in the file are
now ZERO. **All 4 dispatch-listed `TODO[step-11.0c]` mentions resolved**
(2 anti-test memorials + 1 head-comment + 1 section-header comment).

**Self-host parity:** N/A for this step — no codegen change. The
typeAnnotation field is collected only; A1b/A1c phases consume.
Existing samples that don't use typed structural decls compile
identically.

**Path-discipline near-misses:** None. All Reads/Writes/Edits used
absolute paths under
`/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a04a8f96af0741df1/...`.
Two `_probe_*.mjs` files were created in worktree root for AST shape
verification, then deleted before any commit included them.

## Branch + commit hygiene

WIP commits on `phase-a1a-step-11-0c-typed-decl`:
  - `2664297` — WIP: survey notes
  - `f176b70` — WIP: typed-decl recognizer + types + flip K11.X-D3 memorials
  - `4c50506` — WIP: tests — 10 §S11C cases (typed Shape 1/2/3 + Tier 3 + refinement)
  - (final) — compile(a1a-step-11-0c): typed-decl recognizer

## Step-11 close-out — divergence resolution status

After Step 11.0c, all three Step 11 K11.X-DIVERGENCE divergences are
RESOLVED:
  - §K11.X-DIVERGENCE-1 (Variant C compound) — RESOLVED Step 11.0a → §K11.1A
  - §K11.X-DIVERGENCE-2 (newline-separator) — RESOLVED Step 11.0b → §K11.2A
  - §K11.X-DIVERGENCE-3 (typed-decl + Tier 3 positional) — RESOLVED Step 11.0c → §K11.3A

The kickstarter v2 §3 corpus now parses to clean state-decl AST nodes
end-to-end. All `TODO[step-11.0a/b/c]` markers in
`kickstarter-v2-smoke.test.js` are flipped (zero remaining anti-test
memorials for step-11 sub-steps).

A1a Phase-A continues with: A1b (resolver/typer), A1c (codegen). The
typed-decl AST shape produced here (state-decl with `typeAnnotation`
field) is the input contract for both downstream phases.

## Tags

#phase-a1a #step-11-0c #typed-decl #M9-bare-variant-inference
#tier-3-positional #parser-only #t2 #not-discount-9 #flipped-anti-tests
#step-11-escalation #kickstarter-v2-§3 #spec-§6.2 #spec-§14.10
#spec-§14.11 #spec-§53 #refinement-type

## Links

- Brief: `docs/changes/phase-a1a-step-11-0c-typed-decl/BRIEF.md`
- Step 11 escalation context:
  `docs/changes/phase-a1a-step-11-compound-render-smoke/progress.md`
  lines 105-213
- Step 11.0a predecessor:
  `docs/changes/phase-a1a-step-11-0a-compound-recognizer/progress.md`
- Step 11.0b predecessor:
  `docs/changes/phase-a1a-step-11-0b-newline-separator/progress.md`
- AST contract §1.1:
  `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md`
  lines 18-46
- SPEC §6.2 (three RHS shapes):
  `compiler/SPEC.md` lines 1764-1825
- SPEC §6.3.3 Tier 3 typed compound positional sugar:
  `compiler/SPEC.md` lines 1865-1891
- SPEC §14.10 bare-variant inference:
  `compiler/SPEC.md` (M9 §14.10)
- SPEC §14.11 positional binding:
  `compiler/SPEC.md` lines 7173-7208
- SPEC §53 refinement-type predicates:
  `compiler/SPEC.md` lines 22622-23295
- Touchpoint — recognizer extension:
  `compiler/src/ast-builder.js` `tryParseStructuralDecl` typed-decl
  branch at L3115; `scanStructuralDeclLookahead` `>:` branch at L3293.
- Touchpoint — type-expr collector REUSE:
  `compiler/src/ast-builder.js` `collectTypeAnnotation` at L2671.
- Touchpoint — types:
  `compiler/src/types/ast.ts` `ReactiveDeclNode.typeAnnotation`
- Tests flipped:
  `compiler/tests/integration/kickstarter-v2-smoke.test.js`
  §K11.3A + §K11.3A-b
- Tests added:
  `compiler/tests/integration/parse-shapes-v0next.test.js`
  §S11C.1-§S11C.10
