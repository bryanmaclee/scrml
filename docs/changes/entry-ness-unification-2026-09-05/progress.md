# progress — entry-ness-unification-2026-09-05

## Startup (verified by execution)
- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aec4d874cd0003ee3
- `git rev-parse --show-toplevel` == WORKTREE_ROOT; `git status` clean
- `git merge-base HEAD origin/main` == origin/main == b8f1e69fb39626b871afc93c572a1f067d40f684
- `bun install` OK (218 packages)
- `bun run pretest` OK — 13 samples compiled, 34 artifacts in samples/compilation-tests/dist/

## Brief discrepancy (minor, non-load-bearing)
The dispatch prompt says HEAD is `b8f1e69f`; the committed BRIEF.md body says HEAD `7e3eac37`.
BRIEF.md was authored pre-landing. Actual worktree base is b8f1e69f. Loci re-verified at b8f1e69f below.

## Findings before building

### F1. The maps are NOT load-bearing here (verified by execution — grep over `.claude/maps/`)
`hasProgramRoot|isPureModuleFile|isNonEntryPageFile|W-PROGRAM-001|PURE-CHANNEL-FILE` returns
**2 hits across all 13 map files**: `schema.map.md:240` (a bare `hasProgramRoot: boolean` field
listing) and `non-compliance.report.md:607` (naming a parked doc). **Task-Shape Routing has ZERO
rows for this surface.** Reported as a routing hole, not worked around.

### F2. SPEC §40.8 defines entry-ness as a BUILD fact, not an AST fact — this bounds the whole task
Verbatim, SPEC.md §40.8 first normative bullet:
> A scrml **application** SHALL declare its top-level `<program>` element exactly ONCE, in the
> application's **entry file**. The entry file is the file resolved by the build root (e.g.
> `app.scrml` in a single-file app, or the source root of the compilation).

Two separable statements. The second is load-bearing and cuts against the brief's framing:
**entry identity is defined by the build invocation, not by anything recoverable from one FileAST.**
`hasProgramRoot` is a *consequence* of a conforming entry, not its definition.

So the 11 sites are answering **two different questions**, and only one is a FileAST fact:
- **Q1 "which file of this compilation is the entry?"** — a build-set fact (SPEC: the build root).
- **Q2 "what shape is THIS file?"** — a per-file AST fact (pure-module / pure-channel / page / …).

A FileAST field can only ever record Q2. Recording Q2 once, correctly, and migrating the Q2
consumers is exactly this dispatch. Q1 needs a resolver over the file SET — that is the HELD
prod-root-fallback arc (fork b), scoped OUT here.

### F3. Consequence for the design call — build (ii), but named for SHAPE, not for "entry"
The brief's proposed variant set was `entry · pure-module · non-entry-page · pure-channel-module`.
Three of those four are file shapes; `entry` is the odd one out and encodes the exact conflation
this change exists to remove. Field is `fileShape`, and the program-bearing variant is named
`"program"` — "this file declares a top-level `<program>`", which is a fact the file itself carries.

### F4. `E-PROGRAM-002` is NOT implemented (verified by execution)
`grep -rn E-PROGRAM-002 compiler/src compiler/native-parser conformance` returns exactly ONE hit,
a reservation comment in `commands/select-request-onion.js:41`. SPEC §40.8 itself says
"(TBD — separate diagnostic; not part of Wave 1)". So rule A's `files.find(f => f.hasProgramRoot)`
is a FIRST-MATCH over a set whose uniqueness the compiler does not enforce.

### F5. Brief corrections — three loci are misfiled, one site is missing
- `auth-graph.ts:1163` (`isDeclInProgramScope`) is **NOT** entry-ness. It is a scope-containment
  check; `!fileAST.hasProgramRoot` is a fast-path early-out for "there is no `<program>` subtree to
  search". Migrating it would be WRONG. NOT migrated.
- `tool-program.ts` (`isLibraryShapedFile`) is filed under rule A but is actually a **rule-C hand
  copy** (pure-module + exports), i.e. a THIRD copy, not a `hasProgramRoot` consumer.
- **`codegen/index.ts` non-entry-page detection is a FOURTH hand copy the brief does not list** —
  it re-derives `isNonEntryPageFile` inline and cites `ast-builder.js line 12222`, a line number
  that is ~7.7k lines stale (the real site is the `isNonEntryPageFile` const).

### F6. Baseline W-PROGRAM-001 (verified by execution, in-process TAB)
customer-events 1 · dispatch-board 1 · driver-events 1 · load-events 1 · app.scrml 0 · 30-validated-form 0

### F7. Interaction with a parked decision (docs/pinned-discussions/w-program-001-warning-scope.md)
That doc parks *path-based suppression for `samples/compilation-tests/`* and says
"**No compiler change authorized**". That is a DIFFERENT question from this one. This change
implements a SPEC-mandated shape recognition (§38.12.6 "The compiler SHALL recognize this pattern
automatically"); it does not implement, and must not be read as implementing, the parked option.

## VERIFICATION RESULTS (all `verified by execution`)

### V1. Census — before/after
Probe: `docs/changes/entry-ness-unification-2026-09-05/rulecensus.ts` (repointed from the held
branch; worktree root is now an ARGUMENT, and R2/R3 replicate the PRE-CHANGE local consts verbatim
so "before" is measured, not remembered).

**Flagship `examples/23-trucking-dispatch` (36 files):**
| | before | after |
|---|---|---|
| files whose shape NO rule recognized (→ W-PROGRAM-001) | 4 (all four `channels/*.scrml`) | **0** |
| W-PROGRAM-001 fires | 4 | **0** |
| `hasProgramRoot` vs `fileShape === "program"` | — | **AGREE** (both: `["app.scrml"]`) |
| fileShape histogram | — | program 1 · pure-channel 4 · pure-module 11 · non-entry-page 20 |

`examples/22-multifile`: 0 unrecognized before and after; program 1 · pure-module 2.

**`<program>`-less single-document SPA: classified `bare-markup`, W-PROGRAM-001 STILL FIRES — and
that is the correct answer, not a residual failure.** See F2/R1 below.

### V2. W-PROGRAM-001, two-sided
- SUPPRESSED 1→0: the four flagship `channels/*.scrml` (+ the 5th corpus pure-channel file,
  `docs/changes/s385-channel-cell-match-arm-scope/repro/chan.scrml`).
- STILL FIRES 1: a wrapper-less `<h1>`/`<p>` document; a file with a channel AND loose page markup
  (so the suppression did not become "any file containing a channel"); an empty file.
- Structural: for every member of `FILE_SHAPES`, `suppressed == (shape !== "bare-markup")`.

Corpus-wide fileShape histogram (examples+samples+stdlib+docs+benchmarks, 1301 parsed):
program 620 · **bare-markup 420** · pure-module 134 · non-entry-page 122 · pure-channel 5.
⚑ The 420 are dominated by `samples/compilation-tests/` fragments — the population of the PARKED
decision (`docs/pinned-discussions/w-program-001-warning-scope.md`, "No compiler change
authorized"). This change does NOT touch them; they still warn. That boundary is deliberate.

### V3. Corpus emit differential — ARTIFACT-INERT, PROVEN
Both sides captured at the SAME `--compiler-root` (my worktree), flipping source by FILE COPY, so
the path-derived-token false-diff cannot occur.

```
VERDICT: 24 DIFFERENCE(S)  over 1920 common sources  and 7427 compared artifacts
  source set delta          0
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        24 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7427 compared      <-- artifact-inert
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  load-context changes      0
  bare server-fn sites      base 144 / head 144 (delta 0)
```

⚑ The FIRST run printed `VERDICT: NOT A VALID COMPARISON`. The reason is NOT the path hazard the
brief warned about — it is the harness's SAME-REVISION guard, which fired because a file-copy flip
leaves `git rev-parse HEAD` identical on both captures. `--allow-same-revision` is the harness's own
documented opt-in for exactly this deliberate self-diff. The enumeration / hashing / syntax halves
ran identically on both sides either way; only the revision metadata matched.

**All 24 diagnostic changes are W-PROGRAM-001 disappearing, and the set is fully accounted for:**
- 8 `conformance/cases/channel/**` sources
- 4 `examples/23-trucking-dispatch/channels/*.scrml`
- 12 `examples/23-trucking-dispatch/pages/**` — these are the pages that IMPORT a channel. Verified:
  `grep -l "channels/" pages/*/*.scrml` returns exactly 12, exactly those. The dep's diagnostic is
  attributed to the importing source's compile.

**Skipped populations (reported per the brief):**
- 681 of 1920 sources FAIL to compile — identical failure SET on both sides (0 newly failing / 0
  newly passing). Pre-existing; the harness's own docs say failures are DATA.
- 33 of 1920 sources emit no artifacts (1887 emit).
- **2,972 of 7,427 artifacts are NOT syntax-checkable** (4455 checkable) — non-JS output.
- 64 of 4455 fail under the goggle they are actually loaded under — identical both sides.

### V4. Suite + conformance + types
- **`bun run test`** (1450 files, incl. browser + commands): **31,039 pass / 53 fail** on the head.
  Base measured the same way by flipping all touched files to `b8f1e69f` by FILE COPY:
  **53 fail**, and with the `[NNms]` timing suffixes stripped the two failing sets are
  **byte-identical**. Zero newly-failing. (The 53 are dominated by happy-dom browser + dev-server
  timing cases; per the brief, `compiler/tests/commands/` green-ness is not a signal either way.)
- **Full pre-commit gate** (the blocking suite): **29,743 tests / 1,313 files — PASSED.**
- **Conformance corpus**: `bun test ./conformance/conformance-corpus.test.js` — **898 pass / 0 fail.**
- **within-node parity canary**: 1016/1016 pass; MISSING-FIELD **30,892 — identical to base.**
- **`bun run types`**: exit 0 both sides. 238 diagnostics at base -> **239** at head. The one added
  diagnostic is `codegen/index.ts :: TS7016 :: Could not find a declaration file for module
  '../library-shape.js'`. ⚑ SURFACED, NOT SILENTLY ABSORBED: this is the
  importing-an-untyped-`.js`-from-a-`.ts` class, which already has ~12 instances **including the
  identical one for this exact module from `tool-program.ts`**. The gate's HARD signal (9 LIVE
  exhaustive-switch `never` failures) is unchanged. I did NOT fix it by adding a `.d.ts`:
  `find compiler/src -name '*.d.ts'` returns **0 files**, so that would introduce the repo's first
  `.d.ts` convention on a dispatch about entry-ness — silent scope expansion. Flagging for a call.

### V5. R26 — empirical recompile of real adopter source on the post-fix baseline
`bun run compiler/src/cli.js compile examples/23-trucking-dispatch` — **exit 0, 36 files, 69 `.js`
artifacts.**
- **Symptom grep**: `grep -c W-PROGRAM-001` on the compile log -> **0**.
- **Syntax, both goggles** (per `scripts/corpus-check-goggles.js`: `node --check` is blind to a
  stranded top-level `await`, so classic-script AND module parses are both run):
  **0 module-goggle failures; 0 `.client.js` failures under either goggle.** The 32 script-goggle
  hits are all ES modules read under the wrong goggle — 25 `.server.js` + 7 `_scrml/*.js` stdlib —
  and the corpus differential shows that set is byte-identical to base (script 659/659, module 62/62).

### V6. The native (M5) pipeline gets `fileShape` for free — measured
`nativeParseFile` output has no `fileShape` (correct — it is not stamped in either parser), and
`computeFileShape` at the PRECG seam yields `pure-channel` / `program` / `non-entry-page` /
`pure-module` on the same four files the live path does. **Zero native-parser edits, zero `.scrml`
mirror edits, zero allowlist growth.** This is the payoff of stamping at PRECG rather than in the TAB.

---

# FIX ROUND (independent adversarial review — 6 findings, 5 actioned)

## F1 (MEDIUM) — the census manufactured a favourable delta. FIXED.
`rulecensus.ts` R2 dropped `|| isForeignLangLibDecl(n)` from the pre-change
`isPureModuleFile`, while a comment claimed it replicated it "verbatim". I inherited
the omission from the held branch's probe and then wrote the claim over the top
without checking it — which is worse than inheriting it.

REPRODUCED on `conformance/cases/foreign`: `legacy "unrecognized shape -> WARN" (7)`
vs `now fires (0)` — a phantom 7-file improvement, while the same output's histogram
showed all 8 non-program files as `pure-module`, already suppressed at base.

| census | before fix | after fix |
|---|---|---|
| `conformance/cases/foreign` legacy-warn vs now | **7 vs 0 (phantom)** | **0 vs 0 (honest)** |
| flagship legacy-warn vs now | 4 vs 0 | **4 vs 0 (unchanged — genuine)** |

The flagship survived only because it contains no `<foreign lang>` decls.

## F3 (LOW/MED) — CE staleness. DISPOSITION: RE-STAMP. Real, measured.
`component-expander.ts` rebuilt the FileAST as `{ ...ast, nodes: phase2Nodes }` —
carrying the PRE-CE `fileShape` while replacing `nodes`. Every consumer
(`tool-program.ts` via `emit-server.ts`/`emit-tool.ts`/2 codegen sites, plus
`codegen/index.ts:getFileShape`) runs POST-CE.

Measured by instrumenting CE to log pre/post shape:
- `examples/` + `conformance/cases/channel`: **26 CE invocations, ZERO divergence.**
  Nothing shipped was wrong.
- The adversarial shape the corpus lacks DOES flip. A top-level channel-alias mount
  (`${ import { "presence" as presence } from './chan.scrml' }` + `<presence/>`)
  logs **`bare-markup -> pure-channel`** across CE, at exit 0 — CHX inlines the alias
  as a `<channel>` node, which is a shape-class change.

Latent hazard, not a live break; now closed by construction. Every consumer wants the
post-CE answer; the one pre-CE reader (W5a) reads at PRECG and never sees this object.
The misleading "cannot disagree" comments in `ast-builder.js` + `compute-pgo-flags.ts`
are corrected to scope the guarantee to that seam.

⚑ `runCEFile` has a **no-op early return** for a file with nothing to expand; it returns
the original `ast` with `nodes` untouched, so there is no staleness on that path. The
regression test therefore uses a component-bearing fixture ON PURPOSE — a fixture taking
the early return passes with the fix REMOVED. Verified the test bites by deleting the
fix line and watching it go red.

## F5 (LOW) — two hand-synced lists. FIXED by single-sourcing, not by an assertion test.
`FILE_SHAPES` + `export type FileShape` were two copies. Now ONE definition in
`types/ast.ts` (`Object.freeze([...] as const)` + `(typeof FILE_SHAPES)[number]`), with
`library-shape.js` RE-EXPORTING the same frozen object.

⚑ Direction is forced and I measured it. Deriving from `library-shape.js` — the obvious
direction — would SILENTLY COLLAPSE the union to `any`, since that module is untyped from
TS's side (the standing TS7016). Proven the union is real:
`const bad: FileShape = "entry"` under `@ts-expect-error` produces NO tsc output (directive
satisfied); flipping it to a valid member produces `TS2578: Unused '@ts-expect-error'`.
Only possible if the type genuinely rejects non-members.
Test pins **identity** (`toBe`), not equality — `toEqual` would pass against a pasted duplicate.

## F2 (LOW) — `getFileShape` lacked the tolerance it claimed. FIXED.
`getHasProgramRoot` reads both nesting levels; `getFileShape` collapsed to
`f?.ast ?? f`. On the mixed shape the fallback got `hasProgramRoot === false` and could
answer `non-entry-page` for a `<program>`-bearing file. Fixed by REUSING
`getHasProgramRoot` rather than re-deriving the read — same anti-hand-copy discipline,
applied to the helper. §9 pins the mechanism.

## F4 (LOW) — W5a asymmetry. FIXED.
The one migrated site reading `fileShape` bare. `isLibraryShape(undefined, …)` is false,
so an unstamped AST would degrade library auto-detect to `mode: 'browser'` — an emit-shape
change with no diagnostic. Fallback added; unreachable today, insurance against a PRECG
reorder.

## F6 — no action, agreed. TS7016 stays surfaced (now 240; I added a third `.ts` importer
of `library-shape.js`). Fixing it means inventing the repo's first `.d.ts`; that is bryan's call.

## FIX-ROUND RE-VERIFICATION (all `verified by execution`)
- **Census flagship**: 4 -> 0, `hasProgramRoot` vs `fileShape==="program"` AGREE.
  histogram program 1 / pure-channel 4 / pure-module 11 / non-entry-page 20.
- **Census `conformance/cases/foreign`**: **0 vs 0** (was the lie: 7 vs 0).
- **Artifact-inertness RE-PROVEN through the fix round** (base `b8f1e69f`, same
  `--compiler-root`; corpus sources provably untouched by `git diff --name-only`):
  **`artifact content diffs 0 of 7427`**, 24 diagnostic-only changes, 0 syntax delta,
  0 load-context changes. The CE re-stamp moved no emit.
- **Parity canary**: 1016/1016; aggregate **98,830**, MISSING-FIELD **30,892**, 1012 files
  — byte-identical to base.
- **Conformance**: **898 tests pass / 0 fail = 897 cases + 1 non-emptiness guard**
  (`test("corpus is non-empty (cases loaded)")`). The coordinator's 897 counts CASES; my
  898 counts TESTS. Both correct under a different base; stated both ways deliberately.
- **`bun run test`**: 53 failing, **set byte-identical to base** with timings stripped.
- **types gate**: exit 0, 239 -> 240 (the one added is the agreed F6 class).
- **Unit tests**: 30/30 in `file-shape-classification.test.js`.

---

# ROUND 3 (re-review — 6 findings: 4 fixed, 2 filed)

## F1 (MEDIUM, real gate regression) — FIXED
`bun run types:check` is the BLOCKING gate; `bun run types` is advisory and exits 0 either way, which
is why round 2 missed this. Measured at three points rather than trusting the split:

| | NEW | exit |
|---|---|---|
| base `b8f1e69f` (source flipped by `git checkout`) | **12** | 1 |
| branch before this round | 14 | 1 |
| branch after | **12** | 1 |

The two added were `codegen/index.ts` + `component-expander.ts` TS7016 on untyped `library-shape.js`.
Both baselined; the file already carried the byte-identical diagnostic for `tool-program.ts`.
Diff is 4 insertions / 2 deletions (2 entries in sorted position + the two header counts
226/140 -> 228/142). **NEW sets at base and at HEAD are now byte-identical — this branch contributes
ZERO diagnostics to the gate**, and `library-shape` appears 0 times in the output.

⚑ **EXIT 0 WAS ASKED FOR AND IS NOT REACHABLE; I did not manufacture it.** The gate is ALREADY red on
`origin/main` with those same 12. Reaching 0 would mean baselining 12 unrelated pre-existing
diagnostics under cover of this PR — silently absorbing another arc's debt and erasing the signal
that `g-types-check-baseline-never-refreshed-for-ast-if-chain` exists to carry. Deliberately NOT run
with `--write`, which would have done exactly that.

## F3 (LOW/MED) — FIXED. One guard, whole class immunized.
`classifyFileShape` never inspected `nodes` for a top-level `<program>` — it trusted the
`hasProgramRoot` PARAMETER absolutely. Guard added after the markup filter.

**DEAD on every correctly-paired call, by construction**: the TAB derives `hasProgramRoot` as exactly
`nodes.some(n => n.kind === "markup" && n.tag === "program")`, so a program node means the early
return already fired. Behaviour-preserving, not a widening. Pinned both ways in §9.

**Does it close F2 and F4?** — **NARROWS F2, does NOT close it. Does NOTHING for F4.**
- F2 is a LEVEL MISMATCH, not a `hasProgramRoot` error. The guard immunizes the `<program>` case
  specifically; for every non-program shape the fallback would still classify the wrong node list.
  Fixed separately, below.
- F4 is a SEAM/TIMING defect (pre-CE classification feeding a TAB diagnostic). Orthogonal — the guard
  neither helps nor hurts it.

## F2 (LOW) — FIXED. Same defect as round 2's, one file over.
`tool-program.ts:isLibraryShapedFile` read `fileShape`/`hasProgramRoot`/`exports` from `f.ast ?? f`
while taking the NODE LIST from `getToolNodes()`, which prefers the OUTER `f.nodes`. On
`{ filePath, ast: {...}, nodes: [...] }` it classified the outer node list against the inner flags.
Now ONE object is resolved — using `getToolNodes`'s own outer-first precedence, so WHICH nodes win is
unchanged — and every field is read from it. **Verified the §10 test bites**: restoring the old
two-level read turns it red at 33/1.

## F6 (INFO, judgement call) — MY READ: RESTORE the old polarity.
Legacy `isPureModuleFile` was `every`-shaped (`nodes.every(n => n && …)`), so a nullish top-level node
made it FALSE and the warning FIRED. My `filter` dropped nullish entries, so such a file became
`pure-module` and was SUPPRESSED — an unremarked polarity inversion in a diff claiming behaviour
preservation.

Restored, **per-branch rather than as a blanket gate**, because the two legacy predicates genuinely
differ: `isNonEntryPageFile` was `some`-shaped and nullish-TOLERANT. So `<page>` is now evaluated
BEFORE the nullish gate (order vs `pure-module` is immaterial — mutually exclusive), and the
`every`-shaped branches (`pure-module`, `pure-channel`) sit after it.

Chose restore over document-as-intentional not because the shape is reachable — it almost certainly
is not — but because a nullish top-level node means a MALFORMED node list, and this classifier's
organising principle is that `"bare-markup"` is the RESIDUAL so an unrecognised shape WARNS. Getting
more permissive on precisely the input we understand least is that principle backwards. §11 pins
polarity against transcriptions of BOTH legacy predicates rather than against remembered behaviour.

## F4 (MED) — FILED, not fixed.
`g-w-program-001-classifies-pre-CE-so-a-channel-alias-mount-still-gets-self-defeating-advice`.
Reproduced: a top-level channel-alias mount logs `bare-markup -> pure-channel` across CE at exit 0, so
it still gets "wrap your file in `<program>`" — which §38.1 turns into `E-CHANNEL-OUTSIDE-PROGRAM`.
The four flagship files declare channels DIRECTLY, classify `pure-channel` at TAB time, and ARE fixed;
only the alias-mount shape remains. Not chased: every other consumer reads post-CE and was fixed by the
CE re-stamp, but `W-PROGRAM-001` is structurally a TAB-time diagnostic, and relocating it is its own
arc that should be ruled alongside the parked `w-program-001-warning-scope.md` question.

## F5 (LOW/INFO) — FILED.
`g-self-host-ast-scrml-w-program-001-has-no-shape-suppression-at-all`. `compiler/self-host/ast.scrml`
fires from a bare `if (!hasProgramRoot)` with zero suppression — three shapes behind, now four.
Pre-existing drift, NOT a regression: this arc never touched the file. Per pa.md B4 self-host is
deferred post-v1.0.0. The entry states explicitly that `native-parser/collect-hoisted.js` is CLEAN
(computes `hasProgramRoot` only; its one `W-PROGRAM-001` mention is a comment; no emission site) so
there is **no live/native divergence** — recorded so the next reader does not re-derive it.

Also supplied the measurement `g-types-check-baseline-never-refreshed-for-ast-if-chain` explicitly
asked for and labelled RELAYED-UNVERIFIED: base is **12 NEW**, not "~9", and the class is wider than
`ast-if-chain.js`, so the proposed single `.d.ts` cannot zero it.

Counts regenerated via `bun scripts/state.ts --write`: MED 211 -> 212, LOW 89 -> 90.

## ROUND-3 RE-VERIFICATION (all `verified by execution`)
- **types:check**: 14 NEW -> **12 NEW**, zero `library-shape` mentions, NEW set == base's.
- **Census flagship**: 4 -> 0; histogram program 1 / pure-channel 4 / pure-module 11 / non-entry-page 20.
- **Census `conformance/cases/foreign`**: **0 vs 0**.
- **Artifact-inertness re-proven** (base `b8f1e69f`, same `--compiler-root`, corpus provably
  untouched): **`artifact content diffs 0 of 7427`**, 24 diagnostic-only, 0 syntax delta, 0
  load-context changes. The guard + polarity restore moved no emit.
- **Parity canary**: 1016/1016; aggregate **98,830**, MISSING-FIELD **30,892** — byte-identical to base.
- **`bun run test`**: 53 failing, set **byte-identical to base**.
- **Conformance**: 898 tests / 0 fail (897 cases + the non-emptiness guard).
- **Unit**: 38/38.

---

# ROUND 4 (two documentation fixes — comments only, no behaviour)

## A — the `@typedef` was a second hand-listed copy of the closed set
It sat **nine lines under this module's own banner** saying *"Do not paste a second literal list
here: that is the drift this change exists to remove, one layer up."* The same defect class the arc
removed four times over, inside the file that declares the rule.

Not cosmetic: a sixth member in `FILE_SHAPES` would leave that union stale, so
`classifyFileShape`'s `@returns` and `isRecognizedNonEntryShape`'s `@param` would type-check JS
callers against the OLD set while the runtime array carried six — and §1's identity test compares the
runtime arrays only, so it stays green straight through it.

Now `@typedef {import("./types/ast.ts").FileShape} FileShape`. The per-variant prose above it is
KEPT and relabelled: it documents what each variant MEANS, it is not a second declaration.

**Verified the import resolves rather than silently collapsing to `any`** — the same trap checked
when the union was first derived. A JS probe assigning `"entry"` to the imported typedef yields:
`TS2322: Type '"entry"' is not assignable to type '"program" | "pure-module" | "pure-channel" |
"non-entry-page" | "bare-markup"'`. **tsc printing the full five-member union is the proof.**

Also dropped the `/** @type {readonly string[]} */` on the `export … from` specifier — JSDoc cannot
annotate a re-export, so it read as a contract and enforced nothing. Replaced with a line comment
saying why it is absent, so it is not "helpfully" restored.

## B — the header stated a fact the code contradicts
It claimed `ast-builder.js` *"computes `fileShape` ONCE and records it on the FileAST"*. It does not:
`fileShape` is a local `const` feeding only the W-PROGRAM-001 gate, and the `const ast = {…}` literal
has no such key. The header contradicted `compute-pgo-flags.ts`'s docstring AND the unit test
asserting `ast.fileShape` is `undefined` after `buildAST` — in the document meant to be this
surface's single source of truth.

The failure it invited: a consumer reads the header, writes `buildAST(...).ast.fileShape` from an LSP
or `commands/` path that never runs api.js's PRECG loop, gets `undefined`, and degrades silently
wherever the field is read bare — exactly the hazard W5a carried until round 2 gave it a fallback.

Header now says the TAB **ASKS** and does **NOT** record, names both stamp sites (PRECG + the CE
re-stamp), states the `undefined` is BY DESIGN, and tells such a caller to classify explicitly or
read with a fallback.

## ROUND-4 VERIFICATION (all `verified by execution`)
- **`types:check`**: exit 1, **12 NEW**, `library-shape` mentions **0** — output **byte-identical to
  round 3**, so the JSDoc changed nothing the gate sees.
- **Unit**: 38/38.
- **Emit differential** (base `b8f1e69f`, same `--compiler-root`, corpus provably untouched):
  **`artifact content diffs 0 of 7427`**, 24 diagnostic-only, 0 syntax delta, 0 load-context changes.
  JSDoc cannot move emit; confirmed on the record rather than assumed.
- **Runtime sanity**: the module still loads and classifies through the real pipeline
  (`load-events.scrml` → `pure-channel`, `app.scrml` → `program`).
