# s415 — g-library-map-surface-unlowered-beyond-the-bracket-read

Append-only. Timestamps UTC.

## 2026-09-13T00:00Z — worktree verified, baseline measured

- Worktree `C:/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-a33b50cec2e3743a8`, clean, HEAD `9eb9eb24`.
- `bun install` done; puppeteer postinstall failed as expected; `node_modules/acorn` present.
- Maps read. `domain.map.md` §21.5/§44.7.1 (`rawFallbackReason` polarity inversion) and §59/§52
  (Part A `mapSetLoweringBoundaryOk`) are LOAD-BEARING for this task — they named both loci and the
  ruled trade. `primary.map.md` itself was not (self-declared `router-lag`).
- Baseline shape matrix REPRODUCED by execution (compile + import + call the emitted ES module),
  library mode, HEAD `9eb9eb24`. It REFINES the briefed matrix:
  - `m["k"]`  -> REFUSED `E-CODEGEN-INVALID-LOGIC` (as briefed)
  - `m.size`  -> exit 0, returns **`undefined`** — the ONLY silent-wrong member/method shape
  - every §59 METHOD call (`get/getOr/has/insert/remove/update/insertAll/keys/values/entries/
    sorted/sortedBy`, set `add/elements`) -> exit 0, then **TypeError at CALL time**
    (`… .getOr is not a function`). These are LOUD-LATE, not silent-wrong. The briefing recorded
    them only as "raw" and did not run them.
  - `construct` only -> correct (`<map>`), unaffected.
  - `param-size` (`fn probe(m) { return m.size }`) -> `undefined`; emit references no map runtime,
    so the guard is never consulted. Separate escape, as the briefing predicted.
  - `array-index-mapbearing` (`let m = [...]; return xs[0]`) -> REFUSED. The EXISTING guard already
    over-fires receiver-blind; that cost is pre-accepted precedent.
- NEW FINDING (not in the briefing): `emitAsyncLibraryFns` (emit-library.ts:~758) has **no map guard
  at all** — an async library fn with `return m["k"]` compiles exit 0 and emits `return m["k"];`.
  The one shape the guard exists for escapes it entirely when the fn is async.

NEXT: widen `containsIndexExpr` -> `containsUnloweredMapSurface` at the control-flow splicer.
BLOCKERS: none.

## 2026-09-13T01:20Z — fix landed at the briefed locus (`ccb784ad`)

- `containsIndexExpr` -> `containsUnloweredMapSurface`: detects `index`, the `.size` MEMBER, and a
  call whose callee property is in `MAP_SET_SURFACE_METHODS` (the §59 map table ∪ the set-native
  switch). Call site at the control-flow splicer updated. Receiver-blind, like the predicate it
  replaces; narrowed by the caller's `MAP_RUNTIME_REFERENCED` probe over the EMITTED bytes.
- Post-fix matrix re-measured by execution: all 16 shapes REFUSED `E-CODEGEN-INVALID-LOGIC`, no
  artifact written. `construct` / `xs.length` / map-free shapes unchanged.
- `tsc` over the gate's two roots: only the two pre-existing TS7016 implicit-any-module rows on
  this file and its sibling. No new diagnostics.

NEXT: the async splicer.

## 2026-09-13T01:50Z — async splicer guarded, separate commit (`948a35a9`)

- Same gate in `emitAsyncLibraryFns`, same `MAP_RUNTIME_REFERENCED` probe. The emit is now computed
  BEFORE the decision, so `foreignCrossingErrors` / `preparedStmtErrors` are snapshotted and
  truncated on discard — an error raised while lowering a body we throw away would be a phantom.
- async-index / async-size / async-getOr now all REFUSED.
- Kept in its own commit: it is a SEPARATE router from the briefed locus and should be revertable
  on its own.

## 2026-09-13T02:30Z — tests + mutation (`84c71be5`)

- `compiler/tests/unit/g-library-map-surface-unlowered.test.js`, 42 tests.
- MUTATION, by file copy (never `git stash` — `refs/stash` is shared across worktrees here):
    pre-fix `emit-library.ts` from 9eb9eb24   -> 19 fail / 23 pass
    detection axis only reverted              -> 18 fail / 24 pass
    async guard only disabled                 ->  3 fail / 39 pass
    fix restored                              ->  0 fail / 42 pass
- Adjacent suites green: 122 pass across the 5 library/map/async files.

## 2026-09-13T03:30Z — corpus differential, with its control

- Instrument: `scripts/corpus-emit-differential.ts` (the repo tool, which has its own
  truncated-probe defenses). Base side = a fresh local CLONE checked out at `9eb9eb24` in the
  scratchpad; head = this worktree. Revisions verified DISTINCT
  (`9eb9eb24…` vs `84c71be5…`) — not a tree compared against itself.
- CONTROL FIRST: seeded `samples/s415-control/` (an `.size` library fn + a construct-only sibling)
  into BOTH trees. Result: **3 differences — 1 newly-failing source, 1 diagnostic CODE change,
  1 artifact removed**, and the construct-only sibling byte-identical. The instrument bites.
  Control dir removed from both trees afterwards.
- FULL RUN, 1,928 sources / 7,467 artifacts per side:
    source set delta 0 · compile-failure delta 0 new / 0 fixed · diagnostic CODE changes 0 ·
    artifact set delta 0/0 · artifact content diffs 0 of 7,467 · syntax delta 0 · load-context 0
  61 rows reported as "diagnostic TEXT-only". ⛑ NOT a behaviour change: every one is the two
  checkout ROOT PATHS leaking into diagnostic message bodies (the harness normalizes the stream
  against a backslash-spelled root; the messages carry the forward-slash spelling). Proven, not
  asserted: re-comparing both manifests with each side's own root scrubbed in BOTH slash
  spellings leaves **0 of 1,928** sources differing, and that script asserts its common-source
  count equals the full population before reporting the zero.
- DIRECTION: `newly-rejecting` on the affected shapes, `inert` over the real corpus.

## 2026-09-13T05:00Z — ⛔ FIX ROUND. The AST walk was wrong twice; both reproduced, both closed

⚠ THE CLAIM IN THE 03:30Z ENTRY — "all 16 shapes REFUSED" — IS RE-SCOPED. It was true
only for the STRAIGHT-LINE form. Corrected below.

Two findings came back from the adversarial pass. I reproduced both by execution before
changing anything.

**BLOCKING — the receiver-blind vocabulary refused valid programs.** `index` is a
syntactic FORM; `.size` / `.get` / `.add` / `.keys` / `.update` are ordinary
IDENTIFIERS, and `.size` is an ordinary struct field name. Measured at `9eb9eb24` vs
the 03:30Z head, each executed:

| valid program (all build a map too) | 9eb9eb24 | old head |
|---|---|---|
| `type Item:struct = { size: int }` … `it.size` | ran 42 OK | REFUSED |
| `o.get("a")` / `.add` / `.has` / `.keys` / `.entries` / `.values` / `.update` | all ran OK | all REFUSED |
| `xs[0]` beside a map literal | REFUSED (pre-existing over-fire) | REFUSED |

Nine valid programs newly refused, whole-MODULE, with a diagnostic telling their author
to report a compiler defect. My "precedent" defence was right in DIRECTION and wrong in
MAGNITUDE, and my own tests pinned only `.length` / `.reverse()` — names chosen not to
collide — so the suite pinned the free half of the trade and never exercised the cost.

**ALSO — 13 of 14 shapes escaped the guard inside a `match` arm.** A non-variant arm
result is carried as a STRING and re-parsed at emit time, so it is not a node under
`fn.body`. The AST walk structurally could not see it. Fingerprint: `return m . size;`.

**THE REDESIGN — read the emitted bytes, scope to the receivers they NAME.** This file's
own discipline (`unmetRuntimeHelperRefs`, `unloweredScrmlSyntax`); the map guard was the
odd one out. The emit names its map locals (`let m = _scrml_map_from_entries(…)`), so
the receiver set comes free without re-deriving `mapCellBareName` — which was my stated
objection to receiver-awareness, and it does not apply to the byte-level form. Both
findings close with one move:

| group | 9eb9eb24 | old head | redesigned |
|---|---|---|---|
| straight-line read shapes refused | 1/16 | 16/16 | **16/16** |
| match-arm shapes refused | 1/14 | 1/14 | **14/14** |
| valid colliding programs that run correctly | 11/11 | 2/11 | **11/11** |

`\s*` around every token is load-bearing (it is what reaches the re-parsed arm). String
literal CONTENT is blanked before the scan; blanking cannot hide a read, because a read
is code, never literal content.

**DIRECTION CHANGE, stated not buried.** `xs[0]` beside a map literal was REFUSED at
`9eb9eb24` and now compiles — newly-ACCEPTING. Defensible only because the emission is
verified correct by EXECUTION (asserted as a returned value, not a clean compile).
Overall: `newly-rejecting` on the §59 read shapes, `newly-accepting` on that one
pre-existing over-fire, `inert` over the real corpus.

**RESIDUALS — measured, all pre-existing, all pinned as characterization tests.** The
receiver set is exactly "names this body binds to a map constructor", so a read whose
receiver is not in it escapes: a map arriving as a PARAMETER, a map returned by a PEER
call, and an ALIASED map (`let n = m; n.size`). All three still read silently
`undefined`. Closing any needs the receiver's TYPE — the §59-read-lowering question that
is filed separately. Two shapes I expected to escape and measured CAUGHT are pinned too,
so nobody fixes them twice: a parenthesised receiver `(m)["k"]` and an anonymous
`["k": 7].size`.

**MUTATION, re-run on the redesign** (file copy; the pre-existing s19 stash entry was
verified untouched afterwards):

    pre-fix emit-library.ts from 9eb9eb24   -> 36 fail / 35 pass
    control-flow guard disabled             -> 33 fail / 38 pass
    receiver scoping removed (the old bug)  -> 12 fail / 59 pass
    async-router guard disabled             ->  3 fail / 68 pass
    fix                                     ->  0 fail / 71 pass

The receiver-scoping mutation reddens exactly the false-rejection block — the half the
previous suite could not see. Adjacent suites: 108 pass across 7 library/map/async files.

**CORPUS DIFFERENTIAL, re-run, control first.** Controls widened to four sources, now
including a FALSE-REJECTION negative control (`unaffected-struct-size.scrml`):
**6 differences — 2 newly failing (straight-line `.size` AND match-arm `.size`),
2 diagnostic CODE changes, 2 artifacts removed**, while construct-only and struct-`.size`
stayed clean and byte-identical. Full run, base `9eb9eb24` vs head `d0cba317` (revisions
verified distinct), 1,928 sources / 7,467 artifacts: 0 newly failing / 0 newly passing,
0 diagnostic CODE changes, 0 artifact content diffs, 0 syntax delta. The 61 "text-only"
rows are the same checkout-path leak as before — root-scrubbed re-comparison over the
full population leaves 0 of 1,928.

⛔ **SUPERSEDED AT 07:00Z.** The residual claims in this entry are WRONG in one specific
way and the 07:00Z entry corrects them: "already silent-wrong at base" was asserted for a
whole receiver class, when it is true only for the `.size` FORM. Base REFUSED the aliased
BRACKET form, and scoping the bracket limb un-refused it. Read the 07:00Z entry.

**⚠ ONE REQUIREMENT I BROKE AND AM STATING RATHER THAN QUIETLY DROPPING: the async-router
closure is no longer revertable by `git revert 948a35a9`.** The redesign rewrote the same
line (the call changed from `MAP_RUNTIME_REFERENCED.test(emitted) &&
containsUnloweredMapSurface(fn.body)` to `unloweredMapSurfaceReads(emitted)`), so the
reverse patch does not apply — verified with `git apply --reverse --check`, exit 1.

It is still independently removable, and this is the exact removal — ONE `if` block in
`emitAsyncLibraryFns`:

    if (unloweredMapSurfaceReads(emitted).length > 0) {
      foreignCrossingErrors.length = foreignMark;
      preparedStmtErrors.length = preparedMark;
      continue;
    }

Deleting it restores the pre-S415 async behaviour exactly and nothing else: measured by
disabling that condition alone -> 3 fail / 68 pass, and the three failures are precisely
the three async negatives. The surrounding emit-then-decide restructure (`const emitted =
…` plus the two `…Mark` snapshots) is INERT once the block is gone — the emit is computed
and pushed exactly as the original inline `outLines.push(emitLibraryFnMember(…))` did —
so it can be left in place or tidied, with no behaviour either way.


## 2026-09-13T07:00Z — ⛔ SECOND FIX ROUND. Round 2 introduced a HIGH; the axis is now SPLIT

**THE HIGH, reproduced by execution before touching anything.** Round 2 scoped the whole
surface to named map receivers, and that un-refused a bracket class base caught:

    export fn probe() -> int { let m = ["k": 7]; let n = m; return n["k"] }
    base 9eb9eb24 : E-CODEGEN-INVALID-LOGIC, no artifact
    round-2 head  : exit 0, emits `return n["k"]`, runs -> undefined   (§59.6 requires 7)

**WHY MY OWN SUITE COULD NOT CATCH IT, which is the part worth keeping.** Every residual
test wrote `return n.size` where `return n["k"]` would have caught it, and the comment
claimed the whole receiver class "was ALREADY silent-wrong before any of this". That is
true for the `.size` form and FALSE for the bracket form. A mutant cannot kill a
behaviour the suite never expresses — the gap was in what the tests SAID, not in how hard
they pushed.

**THE ROOT, and it explains why each round flipped the error to the other side.** `[` is
a syntactic FORM; `.size` and the method names are ordinary IDENTIFIERS. One policy over
both halves fails in one direction or the other:

| round | policy | failure mode |
|---|---|---|
| 1 | receiver-BLIND over both | false REJECTIONS — nine valid programs refused |
| 2 | receiver-SCOPED over both | false ACCEPTANCES — the HIGH above |
| 3 | **split** | blind for the bracket, scoped for the identifiers |

Limb 1 is base's `containsIndexExpr`, restored unchanged and gated exactly as base gated
it. Limb 2 is the byte scan, now carrying `.size` + the method vocabulary, plus a
name-scoped bracket that exists ONLY to reach a `match` arm (carried as a STRING, so no
AST node exists) — being name-scoped it cannot add a false rejection. This drops the
`xs[0]` un-refusal, which was a volunteered widening and not a requirement.

**Finding A — holes reproduced against base-correct executions:**

| case | base | round-2 head | now |
|---|---|---|---|
| `o.m.size` with a local `m` (leading `\b` matched after a dot) | ran 5 OK | REFUSED | ran 5 OK |
| `o.m.get("a")` — same cause | ran "G:a" OK | REFUSED | ran "G:a" OK |
| `let z = f(["k": 7]); z.size` (runtime as an ARGUMENT conferred map-hood) | ran | REFUSED | ran |
| `xs.map((m) => m.size)` shadowing a map local | ran [3] OK | REFUSED | **still REFUSED** |
| `o.size` on a plain identifier param | ran 9 OK | ran 9 OK | ran 9 OK |

Fixes: `(?<![.\w$])` instead of `\b`; the map constructor must be the initializer HEAD,
not merely present in it. **The shadowing case is NOT closed** — it needs SCOPE, not
text. Pinned as a characterization and stated as a known false rejection. Dropping a name
whenever it is re-bound anywhere would un-guard a real top-level `m.size` in the same fn:
a rare false rejection traded for a rare WRONG ANSWER, the one direction this file has
ruled against.

⛑ **TWO CORRECTIONS TO THE REVIEW BRIEF, measured rather than inferred, because they
change which cases are regressions:**

- **Base refused the ALIAS bracket ONLY.** The PEER-call and PARAMETER bracket receivers
  ran `undefined` at base too. Base's guard is gated on the map runtime appearing in THIS
  fn's emit, and such a fn lowers no literal of its own, so base never consulted it
  either. They are **pre-existing, not regressions**, and are pinned as such.
  Requirement 1 asked for them to REFUSE; doing that would mean dropping that
  reachability gate and refusing every `xs[0]` in every map-free library fn. I did not do
  it, and say so rather than reporting the requirement met.
- **An ALIASED bracket read INSIDE a match arm escapes both limbs** — also base behaviour
  (measured: base ran `undefined`). It is the intersection of the two limbs' blind spots.
  Pinned as a characterization, not asserted as a refusal: closing it needs a THIRD
  policy over the same surface, and the instruction not to add one is right.

**RESIDUAL CLAIMS, RE-STATED PER FORM** (the distinction that made the HIGH invisible):

| receiver | `.size` form | BRACKET form |
|---|---|---|
| alias (`let n = m`) | base `undefined` -> head `undefined` — pre-existing | base **REFUSED** -> head **REFUSED** — limb 1 |
| peer call (`let q = mk()`) | base `undefined` -> head `undefined` — pre-existing | base `undefined` -> head `undefined` — pre-existing |
| parameter (`fn f(m)`) | base `undefined` -> head `undefined` — pre-existing | base `undefined` -> head `undefined` — pre-existing |
| alias INSIDE a match arm | base `undefined` -> head `undefined` | base `undefined` -> head `undefined` |

**MUTATION, re-run** (file copy; pre-existing s19 stash entry verified untouched):

    pre-fix emit-library.ts from 9eb9eb24        -> 35 fail / 43 pass
    limb 1 removed (the round-2 regression)      ->  2 fail / 76 pass   <- now killed
    `(?<![.\w$])` reverted to `\b`               ->  2 fail / 76 pass
    bindRe loosened to "anywhere in initializer" ->  1 fail / 77 pass
    async-router guard disabled                  ->  3 fail / 75 pass
    fix                                          ->  0 fail / 78 pass

Adjacent suites: 128 pass across 8 library/map/async files.

**CORPUS DIFFERENTIAL, re-run, control first.** Controls widened to six, covering both
limbs and both false-rejection classes. Base `9eb9eb24` vs head `441285d2`, revisions
verified distinct.

- CONTROL: **6 differences — 2 newly failing** (`affected-size`, `affected-matcharm`),
  2 diagnostic CODE changes, 2 artifacts removed. `affected-alias-bracket` failed on BOTH
  sides, which is base parity restored and exactly the point. The three negative controls
  — construct-only, struct `.size`, and `o.m.size` — stayed clean and byte-identical
  (0 of 3 artifact content diffs).
- FULL RUN, 1,928 sources / 7,467 artifacts: **0 newly failing / 0 newly passing,
  0 diagnostic CODE changes, 0 artifact content diffs, 0 syntax delta, 0 load-context
  changes.** The 61 "text-only" rows are the same checkout-path leak; root-scrubbed
  re-comparison over the full population leaves **0 of 1,928**.

**DIRECTION, final:** `newly-rejecting` on the §59 `.size`/method surface and on the
match-arm forms; `inert` over the real corpus; **no newly-accepting limb remains** — the
`xs[0]` un-refusal introduced in round 2 is gone.

Match-arm closure and async-router closure both retained and re-verified.
