# S397 — fail-closed `~` codegen floor — progress

Append-only. Newest section last.

---

## STEP 1 — THE GATING CENSUS (run BEFORE any code change)

### Method

Not a `grep` over a pre-existing `dist/`. `dist/` is populated by `scripts/compile-test-samples.sh`,
which compiles **13** of the 2,383 corpus `.scrml` files — measuring it would have answered a
different question than the obligation asks (the wrong-referent class).

Instead: a purpose-built probe that imports `compileScrml` from `compiler/src/api.js` and compiles
**every** `.scrml` in the worktree with `write:false`, then counts the literal marker `~ orphaned`
across **all four emitted artifact fields** (`html`, `css`, `clientJs`, `serverJs`) — not just
`clientJs`, so a server-mode orphan could not hide.

```
find <worktree> -name '*.scrml' -type f -not -path '*/node_modules/*' -not -path '*/.git/*'
  -> 2383 files
per file: compileScrml({inputFiles:[f], write:false}) ; count occurrences of "~ orphaned"
          in each of html/css/clientJs/serverJs
```

Run **twice**, under two different process partitionings, because the compiler carries
module-level state (`_currentUserAmbientActive`, `_sessionProjectionActive`, …) and a
single-process sweep could in principle have its results perturbed by leakage:

- (a) one process, all 2,383 files in one sorted pass
- (b) eight independent processes over `split -n l/8` chunks

**Both runs returned the identical hit set.** Compile-status vector also identical:
`clean=1654 with_errors=728 crashed=1`.

### Result — 2 source files, 4 emission sites

| # | source file | artifact | sites |
|---|---|---|---|
| 1 | `conformance/cases/control-flow/ctrl-027-arm-body-tilde-read-and-recovery-pos/case.scrml` | `clientJs` | **3** |
| 2 | `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-lift-061.scrml` | `clientJs` | **1** |

Nothing in `html`, `css` or `serverJs`. Nothing anywhere else in 2,383 files.

**This is within the brief's gate** ("expected order of magnitude: small") — 2 files is not
materially more than 1, so the arc proceeds rather than stopping.

### ⚑ BUT THE BRIEF NAMED THE WRONG SITE — premise correction

The brief states the one known genuine site is
`samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-as-expr-tilde-partial-012.scrml`
(a §17.6.6 partial-`if`). **It is not a site.** Compiled in a fresh process at base
`8d3c7936`, that file emits **zero** occurrences of the marker. Verified twice (single-process
sweep, chunked sweep) plus a third targeted single-file compile.

What it actually emits is a *different* fail-open defect, and naming it matters because a future
reader will otherwise assume this arc covered it:

```js
let cond = true;
if (cond) {
  let _scrml_tilde_3 = 5;      // block-scoped INSIDE the if
}
let dbl = _scrml_tilde_3 * 2;  // ReferenceError at run time — never in scope here
```

The `~` **did** resolve to a slot (`_scrml_tilde_3`), so `emitIdent` never reaches the fallback.
The slot is simply emitted in a scope the read cannot see. That is a lexical-scope defect in the
partial-`if` lowering, **not** an unresolved-slot defect, and this arc's floor does not and cannot
catch it — `node --check` passes, compile is exit 0, zero diagnostics, and it dies at run time.
Filed here as a finding; **not fixed**, per the arc's hard scope fence.

The two axes the brief warned about conflating (bucket D's *reads with no antecedent expression
statement* vs the fallback's *unresolved slots*) have a **third** neighbour: *resolved slot emitted
out of scope*. All three look identical in the source and are distinct in the output.

### Site 2 is not what its filename suggests either

`phase2-while-lift-061.scrml` is a §49.6 `while`+`lift` accumulator. The brief (via PA's correction
of the measurement dispatch) says the accumulator role "codegen RESOLVES correctly
(`let _tN = []`, `.push` per lift, `return _tN`)". **For this shape it does not.** Measured:

```js
let i = 0;
let result = null /* ~ orphaned — codegen-fallback */;
```

The entire nested `${ while (i < 3) { lift i * 10; i = i + 1 } }` block is **absent from the
output** — no `_tN`, no `.push`, no loop — and so is the `log(result.length)` that followed it.
So the accumulator lowering is correct for the shapes PA checked, and this shape is not one of
them. That is why the census had to be run output-side rather than reasoned from the role.

### Incidental (not this arc's scope, recorded so it is not re-discovered)

- `samples/gauntlet-s19-phase4/nested-comments.scrml` — `Maximum call stack size exceeded` at
  compile. 1 of 2,383. Byte-identical to base; pre-existing; not touched.

### Maps — routing-hole confirmation

Read `.claude/maps/primary.map.md` first per the brief. **The predicted routing hole holds.**
Across all 13 map files there is not one row about the `~` orphan fallback or the §32 `~` surface
as a construct. Every `orphan` hit in the maps is either the map-stamp orphaned-SHA hazard or
`E-OUTLET-OUTSIDE-SHELL`. `domain.map.md` does carry substantial `~` material, but all of it is
about the **`emit-logic.ts` tilde *result var*** for value-form `if`/`match` arms (rows on
`_emitValueFormSugarArm`, `emitIfExprAltChain`, `tildeContext.var` rebinding) — the resolved-slot
machinery, i.e. precisely the axis that is *not* the fallback. The maps were load-bearing only in
the negative sense: they routed to `emit-logic.ts`, and the fallback is in `emit-expr.ts`.

---

## STEP 2 — THE MINT: `E-CG-TILDE-UNRESOLVED`

### The name, and why this one

`E-CG-` is §34's established **codegen-stage** family prefix (§47) — `E-CG-001`/`002`/`003`/`006`/
`010`-`016`/`018`. Using it answers "which stage owns this condition" from the code itself, which is
the exact property the S397 ruling protects. `TILDE` keeps the code greppable alongside
`E-TILDE-001`/`002` without JOINING that family: a reader grepping `TILDE` finds all three; a reader
grepping `^E-TILDE-` correctly finds only the two type-system rows. `-UNRESOLVED` names the condition
codegen actually observed (no slot at this read), not a claim about initialization.

Checked before choosing: nothing in `compiler/src`, `scripts/`, or `conformance/` matches `E-CG-`
against a numeric-suffix pattern, so a named suffix in this family breaks no tooling. (One thing it
DOES interact with is recorded under DEFERRED below.)

**Not `E-TILDE-003`.** Even a sibling number in that family muddies stage ownership, and the two
codes are not the same claim: `E-TILDE-001` asserts a PROVEN-uninitialized read; this asserts only
that codegen had no slot — strictly weaker and stage-local. The emitted message says so in as many
words and claims nothing about the type system, because the type system checked nothing.

### The wiring, and why it is not `ctx.errors`

`EmitExprContext.errors` is optional and was **measured `undefined`** at all four live orphan sites
(probe: log `ctx.errors` at the fallback, compile both census files — `undefined`, `mode=client`,
4/4). The diagnostic therefore accumulates in a module-level sink in `emit-expr.ts`, the pattern
`_sessionValueUseErrors` (same function) and emit-server's `_foreignCrossingErrors` already
establish.

Lifecycle is deliberately WIDER than the session sink's. Reset ONCE at the top of `runCG`; drained
**twice**:

1. in the per-file loop's `finally` — the tool and library emit paths each leave the iteration by
   their own `continue`, so a drain at the loop's last statement would collect the browser path only
   and silently lose the other two;
2. immediately before `runCG` returns — per-page shell composition and the §40.9.7 route splitter
   both re-enter expression emission after the loop closes.

Each `CGError` carries its own span, so the drain point decides WHEN diagnostics are collected, not
which file they blame.

### §34 obligations, all discharged

- Catalog row at severity **Error**, landing with the implementation.
- `provenance: ruling:user-voice-scrml.md S397 "mint the code"` — the convention §17.6.10 already
  uses.
- Emitter provenance that RESOLVES: `` `compiler/src/codegen/emit-expr.ts` `emitIdent` `` +
  `` `compiler/src/codegen/index.ts` `runCG` ``. `bun scripts/s34-census.ts --check-new` -> **PASS**.
- A §47.7 summary row too, so the two listings of the `E-CG-` family agree. A row present in one
  listing and absent from the other is the internal-contradiction defect the map set has already had
  to correct four times.
- §34 census: **PINNED 343 -> 344**.

---

## STEP 3 — CONFORMANCE FALLOUT. FIVE PINS, NOT ONE.

The brief named one pin and predicted four more rows would be unaffected. Running rather than
reading found **five** pins, and **two of them were positive assertions the brief did not mention**.

### (1) `ctrl-027-arm-body-tilde-read-and-recovery-pos` — SPLIT, nothing deleted

Predicted by the brief. Three of its five functions read an orphaned `~`, so under the floor the
whole case fails to compile and all five assertions die — `#out-lift-tilde`'s `text: ""` pin cannot
survive on the positive side in ANY form, because a rejected program has no DOM to anchor.

**What was done:** the three `~`-reading functions were moved **VERBATIM** into a new
`ctrl-028-arm-body-tilde-read-orphan-neg`. `ctrl-027` keeps the two functions with no `~`
(`bindlessRecoveryInArm` -> `#out-recovery`, `liftLiteralInArm` -> `#out-lift-literal`).

**Why, per §62.2:** the corpus IS the versioned language contract, so every source shape ctrl-027
ever carried is still in the corpus — none edited, none dropped. Only which side of the pos/neg
boundary each sits on changed, and that boundary is exactly what S397 moved. The information content
is preserved and **sharpened**: `text: ""` said only "something rendered nothing", while the neg case
names the code, its severity and its exact cardinality. Both rationales carry the full history so the
next reader sees which contract these shapes used to satisfy.

### (2) `ctrl-028-arm-body-tilde-read-orphan-neg` — NEW. The proof the code bites.

Asserts three ways, because `codes` alone is set-valued and would pass on a single fire, hiding a
pre-scan regression that resolved two of the three reads:

```
codes:      ["E-CG-TILDE-UNRESOLVED"]
severity:   { "E-CG-TILDE-UNRESOLVED": "error" }
codeCounts: { "E-CG-TILDE-UNRESOLVED": 3 }
notCodes:   ["E-CODEGEN-INVALID-LOGIC", "E-TILDE-001", "E-TILDE-002"]
```

`E-CODEGEN-INVALID-LOGIC` is in `notCodes` deliberately: the placeholder emitted alongside the error
is syntactically valid JS on purpose, so this diagnostic is never buried under the §2.2.1 acorn
gate's generic "compiler defect" framing.

**PROVEN BY FLIPPING.** With the push neutered and the fail-open return restored — sink and drain
wiring left intact, so a red result could not be an import break — the case goes red on all three
assertions and **nothing else in the suite moves**:

```
FAIL  control-flow/ctrl-028-arm-body-tilde-read-orphan-neg
        missing required codes: ["E-CG-TILDE-UNRESOLVED"]
        emitted: ["E-DG-002","W-PROGRAM-001"]
        severity: code 'E-CG-TILDE-UNRESOLVED' did not fire (expected severity error)
        codeCounts: code 'E-CG-TILDE-UNRESOLVED' fired 0 time(s), expected exactly 3
conformance (impl#1): 896/897 cases pass, 1 FAILED
```

### (3) ⚑ `compiler/tests/integration/tilde-snapshot-codegen-fix.test.js:180` — NOT IN THE BRIEF

`expect(clientJs).toMatch(/null \/\* ~ orphaned/)` — a POSITIVE assertion that the marker MUST be
emitted. It did not appear in the census because its source is a string literal inside the test, not
a corpus `.scrml` file. Re-scoped to assert the error fires, that the message names the codegen
condition, and that it does not borrow E-TILDE-001's framing. The ORIGINAL HU-5 Q-W35-1 bug it
guards — a raw `~` sigil reaching a JS expression position — is still guarded, unchanged. The file's
header narrative, which described the fallback as "the fix", is corrected in place rather than left
asserting a falsehood about the current tree.

### (4) ⚑ `compiler/tests/unit/g-bare-expr-in-if-arm-rebinds-tilde-context.test.js:381` — NOT IN THE BRIEF

`expect(body).toMatch(/_scrml_record_\d+\(null \/\* ~ orphaned/)` — the unit-tier twin of ctrl-027's
pin, also positive. The brief said this file's rows assert ABSENCE and should be unaffected; the
instruction to verify rather than assume was the right call, and the premise was incomplete.
Re-scoped. **Its clauses (1) and (3) are byte-identical** — those are the dpa-040 boundary pins (the
enclosing statement is not dragged into accumulator mode; the WRITE half stays fixed), and S397 does
not touch them. Only clause (2), what happens to the READ once no slot exists, changed.

### (5) The four ABSENCE rows — VERIFIED, then HARDENED

They pass, as the brief predicted. But they pass **vacuously**: they assert
`not.toContain("~ orphaned")` on a string that no longer exists anywhere in the compiler, so each
would now pass whether or not the read orphaned. That is a silent degradation of four assertions.
Each now ALSO asserts `errors.filter(e => e.code === "E-CG-TILDE-UNRESOLVED")` is empty — what they
always meant, and strictly stronger. The string check is kept alongside so a re-introduced fail-open
fallback is still caught.

---

## STEP 4 — THE CORPUS DIFFERENTIAL

Per-file diagnostic codes + sha256 of every emitted artifact, captured over all 2,383 files at base
`8d3c7936` and again on the build, 8 parallel chunks each. **Exactly two files differ, and both are
named:**

| file | what changed | why |
|---|---|---|
| `conformance/cases/control-flow/ctrl-027-...-pos/case.scrml` | artifact hashes only; `codes` `[]` -> `[]` | **I edited the source** (the split). Still compiles clean. Not a behaviour change. |
| `samples/.../gauntlet-s19-phase2-control-flow/phase2-while-lift-061.scrml` | `codes` `[]` -> `["E-CG-TILDE-UNRESOLVED"]` | **The one genuine migration.** Source byte-identical; the behaviour changed. This is the newly-rejecting site. |

Nothing else in 2,383 files moved — no artifact hash, no code, no warning. `ctrl-028` is absent from
both captures because the file list was built before it existed; its behaviour is separately
characterized by the conformance suite (fires 3x, proven by the flip).

### The migrated site: symptom, not disease

`phase2-while-lift-061.expected.json` carried `expectedOutcome:"clean"` and its author's own note:
*"Unclear whether outer or inner `${}` is canonical."* Updated to `"error"` /
`["E-CG-TILDE-UNRESOLVED"]` — leaving a stale "clean" on disk would be exactly the rot the §34
provenance resolver exists to stop.

⚑ **But the orphan there was a SYMPTOM.** At base the emitted clientJs was:

```js
let i = 0;
let result = null /* ~ orphaned — codegen-fallback */;
```

The entire nested `${ while (i < 3) { lift i * 10; i = i + 1 } }` block is **absent from the
output**, and so is the `log(result.length)` that followed it. No loop, no `_tN = []`, no `.push`.
So the §49.6 accumulator lowering PA's review believed covers this role does **not** cover the
nested-`${}` form — it drops the block. Recorded in the expectation file and in DEFERRED below;
**deliberately not fixed** (out of this arc's fence).

---

## GATES

| gate | result |
|---|---|
| Census reported before any code change | YES — commit `f9b448e3`, sources untouched at that point |
| Corpus differential vs `origin/main` | 2 files, both named above; the only behaviour change is the 1 migrated site |
| Suite (unit + integration + conformance) | base **23203 pass / 0 fail**; build **23204 pass / 0 fail** |
| Conformance | base **896/896**; build **897/897** |
| Browser tier (R26) | base **47 fail**, build **47 fail**, sets **IDENTICAL** — `comm -13` = **0** |
| `-neg` case proven to bite | YES — flipped, went red on all three assertions, nothing else moved |
| §34.0 gate | PASS (2 new rows, provenance resolves) |
| types-gate | 10 diagnostics, byte-identical base vs build — zero added |
| `test.failing` | none added |
| `git stash` | never used — base/build flips done by `git checkout <path>` + a directory move |
| bare `pkill -f` | never used |
| `--no-verify` | never used; both code commits ran the full hook |

## DEFERRED — surfaced, not closed (all out of this arc's fence)

1. **The diagnostic's span resolves to 1:1.** The `~` ident nodes carry byte offsets (`start:9`,
   `start:9`, `start:633`) but `line`/`col` are 1/1, so the CLI renders all three at the top of the
   `${` block. Two of the three also share `start:9` — the ident appears to carry an enclosing span
   rather than its own. Upstream span quality, not something the floor can fix; naming it rather
   than shipping it quietly.
2. **§49.6 accumulator lowering drops a nested `${ while ... lift ... }` block entirely** (see the
   migrated site above). The `~` orphan was masking it. This is the higher-severity finding of the
   two.
3. **`scripts/gauntlet-s19-verify.mjs` cannot see any named diagnostic code.** Its extractor
   requires a NUMERIC suffix, so `E-CG-TILDE-UNRESOLVED`, `E-CODEGEN-INVALID-LOGIC`,
   `E-FN-ARROW-BODY`, `E-SESSION-VALUE` and every other named code are invisible to it. Not gated
   anywhere, so nothing is red; widening it would change verdicts across 221+ gauntlet files and
   belongs in its own arc.
4. **Artifacts are written even when codegen errors fire.** The CLI exits 1 and prints
   `FAILED — 3 errors`, but `orphan.client.js` still lands on disk. Only the §2.2.1 acorn emit gate
   short-circuits writes. Pre-existing and general to all codegen errors (E-CG-006 etc.), not
   introduced here — but it does mean "fail-closed" is true at the process level and not at the
   filesystem level.
5. **`samples/gauntlet-s19-phase4/nested-comments.scrml` crashes the compiler** with
   `Maximum call stack size exceeded`. 1 of 2,383, byte-identical to base, pre-existing.
6. **`phase2-if-as-expr-tilde-partial-012.scrml` emits a block-scoped slot read from outside its
   block** — a run-time `ReferenceError` from a clean compile (see the census section). Distinct
   from both the unresolved-slot axis and bucket D's axis. Not touched.

---

# FIX ROUND (post-S239 review) — three false claims struck, one span defect partly fixed

Rebased onto `326ecde3` (peter's #831) before re-running anything. My delta touches none of
`docs/known-gaps.md` · `docs/changelog.md` · `hand-off.md` · `handOffs/` · `docs/pr-reviews.md`.

⚑ **The pattern in all three findings is the same, and it is worth naming: I MEASURED each of these
truths and wrote them into this file's DEFERRED list, then left the contradicting claim standing in
the code comment and the §34 row.** Filing a defect is not the same as retracting the claim it
falsifies. A reader reaches the comment, not the progress doc.

## FINDING 3 — "the build fails, so the placeholder never ships" was FALSE. Struck.

**Reproduced independently of the reviewer:** `scrml compile` on the three-orphan file exits **1**,
prints `FAILED — 3 errors`, and still writes `orphan.client.js`, `orphan.html` and the runtime.
`api.js` gates the write phase only on `emitGateFailed` (the §2.2.1 acorn gate).

**What the two claims say now:**

- `emit-expr.ts` — the claim is struck and replaced with the reproduced behaviour, stated as a
  limit: *"fail-closed holds at the PROCESS level (non-zero exit), not at the FILESYSTEM level. Any
  pipeline that keys off the exit status is protected; one that keys off 'did an artifact appear' is
  not."* The comment also records that gating writes is deliberately NOT done here.
- `SPEC.md` §34 row — same correction in normative voice, with the reproduction named:
  *"exits non-zero and reports `FAILED`, **and the emitted artifacts are still written to disk** with
  the placeholder in them."*

The surviving half of the original comment — that the placeholder is valid JS so the diagnostic is
not buried under `E-CODEGEN-INVALID-LOGIC` — is kept, with a note that it stands on its own and never
depended on the false claim above it.

⚑ **NEW, AND NOT MINE TO EDIT:** the identical "build fails, so it never ships" reasoning appears at
**three other sites in `emit-expr.ts`** — the `E-SESSION-VALUE` placeholder (~`:1361`) and two
leak-guard comments (~`:3774`, `:3797`). It is wrong in all three for the same reason. Left alone
because they are other codes' text; recorded here so the class is visible rather than just my
instance of it.

### ⇢ GAP FILED FOR YOU TO LAND (do not let me edit `docs/known-gaps.md`)

```
g-codegen-fatal-error-still-writes-artifacts
  severity: HIGH
  A codegen error that is FATAL (non-zero exit, `FAILED — N errors`) does NOT prevent the
  emitted artifacts from being written. `api.js` gates the write phase solely on
  `emitGateFailed` — the §2.2.1 acorn emit-gate — so a build that fails on any `E-CG-*`
  code still leaves `<base>.client.js`, `<base>.html` and the runtime on disk.
  REPRODUCED (S397): `scrml compile <three-orphan file> -o <dir>` exits 1 and writes
  `case.client.js` containing THREE placeholder sites that bind `null`. A deploy step
  keyed on artifact presence rather than exit status therefore ships a page built from a
  failed compile.
  Locus: `compiler/src/api.js` — the `if (write && outputDir)` block and its
  `emitGateFailed` short-circuit; `hasPriorFatalError` suppresses further diagnostics but
  does not stop the write.
  Blast radius: every `E-CG-*` code, not just E-CG-TILDE-UNRESOLVED. Fixing it is a
  behaviour change across the family and needs its own measured pass — which is exactly
  why S397 struck the CLAIM instead of changing the behaviour.
  Not-fixed-by: S397 (the arc lands the `~` floor only; bryan ruled the mint, not a
  write-gating change).
```

## FINDING 2 — `ctrl-028` pinned an invariant the emitter does not implement. Rationale rewritten.

**Reproduced.** A `server fn` whose body contains ONE `record(~)`, called by a sibling `server fn`,
produces **TWO byte-identical errors at the same span** (`start:9`) — the body is emitted twice, once
as the HTTP route handler and once as the in-process peer callable. One source read, two diagnostics.

So the emitter's rule is **once per EMISSION**, not once per read. The old rationale asserted
*"EXACTLY THREE TIMES — once per read"*, which is a law the compiler does not implement, in a corpus
that §62.2 makes the versioned contract.

**`codeCounts: 3` is KEPT**, because 3 is what this case genuinely produces — every function in it is
client-only, so nothing triggers a second emission. The rationale now says *why* it is 3 rather than
implying a per-read law, and carries an explicit **do not generalise / do not copy this into a
server-classified case, it will read 2N there, correctly**. The pin stays because `codes` and
`notCodes` are set-valued and would pass on a single fire, hiding a pre-scan regression that resolved
two of the three reads — `codeCounts` is the only assertion here that can see a missed read.

### ⇢ GAP FILED FOR YOU TO LAND

```
g-cg-diagnostic-fires-once-per-emission-not-once-per-source-read
  severity: MED
  `emitIdent` pushes a diagnostic each time it LOWERS an offending construct, so a body
  codegen emits more than once yields N identical diagnostics for ONE source read — same
  code, same message, same `span.start`. REPRODUCED (S397): a `server fn` with a single
  orphaned `record(~)`, called by a sibling `server fn`, emits E-CG-TILDE-UNRESOLVED
  TWICE (route handler + in-process peer callable). The author sees one mistake reported
  twice with no way to tell it is one mistake.
  Candidate fix: dedupe the sink by (`code`, `span.file`, `span.start`) at drain time, so
  one source position yields one diagnostic however many times its body is emitted.
  ⚑ NOT a local fix: cardinality is an observable contract. `conformance/run.ts` supports
  `codeCounts`, and any case pinning a count on a code that shares this emission path
  would move. Needs its own measured pass over the corpus (which codes, which cases,
  what the counts become) before the dedupe lands.
  Scope note: this is a property of the CG emission path generally, NOT of
  E-CG-TILDE-UNRESOLVED specifically — that code is merely the first one with a
  cardinality pin sharp enough to expose it.
  Not-fixed-by: S397 (changing cardinality is a behaviour change; the arc mints the code).
```

## FINDING 1 — the span fix WAS cheap. Done, and its limits stated.

**It was cheap**, because the machinery already existed and `runCG` already drives it: `log-loc.ts`
keeps a per-file source registry with a cached `LineIndex`, registered before every file's emission
for §20.6 `log()` resolution. It only ever projected to a `"basename:line"` STRING, which a
diagnostic cannot use. Added `resolveSpanLineCol(span) -> {line, col} | null` beside it — same
registry, same index, same cache, one binary search — and `_tildeDiagSpan` in `emit-expr.ts` now
builds the diagnostic span through it.

**Also fixed the `?? { start: 0, end: 0 }` fallback.** That span carried no `file`, and the formatter
emits no `-->` frame at all for a file-less span, so the diagnostic printed with no location
whatsoever. `span.file` is now carried through even when the offset will not resolve.

**MEASURED, and this is a PARTIAL fix — the residual is upstream and I am not claiming otherwise.**
On the three-orphan file, reads live at source lines 10, 23 and 32:

| read | before | after | verdict |
|---|---|---|---|
| `record(~)` line 10 | `1:1` | `2:7` | real frame, **wrong line** |
| `record(~)` line 23 | `1:1` | `2:7` | real frame, **wrong line** |
| `lift ~` line 32 | `1:1` | **`32:13`** | **correct** — frames the offending statement |

So: 1 of 3 now points exactly at the offending statement; the other 2 point at a real-but-wrong line
where all three previously said `1:1` with a `${`-opener frame. The residual two carry an ENCLOSING
node's byte OFFSET (both `start:9`, which is the `<n>` declaration), and no line/col resolution can
repair a wrong offset. Degrades honestly: an unresolvable offset now OMITS line/col rather than
asserting a confident `1:1`.

**The comment at `index.ts` that this finding falsified is corrected.** It claimed *"Each CGError
carries its own source span, so draining once for the whole loop attributes every diagnostic
correctly."* It now says the FILE attribution is sound, the within-file position is not, states the
measured 1-of-3 result, and ends **"Do not restore the stronger claim."**

### ⇢ GAP FILED FOR YOU TO LAND

```
g-expr-span-line-col-hardcoded-and-ident-carries-enclosing-offset
  severity: MED
  TWO defects, one symptom (a diagnostic that cannot be located):
  (a) `spanFromEstree` (`compiler/src/expression-parser.ts`) HARD-CODES `line: 1, col: 1`
      on every span it builds — the line it can see is relative to the re-parsed
      expression fragment, not the file. Only `start`/`end` are true source coordinates.
      Any diagnostic that trusts `span.line` reports 1:1 for every site in the file.
      `log-loc.ts` has documented this since §20.6 and worked around it for `log()`;
      S397 added `resolveSpanLineCol` and did the same for E-CG-TILDE-UNRESOLVED. Every
      OTHER consumer of an ExprSpan's line/col is still exposed. The real fix is to
      resolve line/col at span CONSTRUCTION rather than per-consumer.
  (b) Some `~` ident nodes carry an ENCLOSING node's byte offset rather than their own:
      two `record(~)` reads at source lines 10 and 23 BOTH report `start:9` (the `<n>`
      declaration on line 2). MEASURED S397. (a) is worked around; (b) is not fixable
      downstream, because the offset itself is wrong.
  Effect after the S397 partial: 1 of 3 orphan reads frames the exact offending
  statement, 2 of 3 frame a real-but-wrong line. Before it, 3 of 3 said 1:1.
  Note: `?? { start: 0, end: 0 }` fallback spans carry no `file`, and the CLI formatter
  emits NO `-->` frame for a file-less span. S397 fixed that at its own site only.
```

## RE-RUN AFTER THE FIX ROUND

| gate | result |
|---|---|
| Base | rebased onto `326ecde3`; `merge-base HEAD origin/main` == `origin/main` |
| §34.0 gate | PASS (provenance resolves) |
| `tilde-snapshot-codegen-fix.test.js` | 3 pass / 0 fail |
| `g-bare-expr-in-if-arm-rebinds-tilde-context.test.js` | 19 pass / 0 fail |
| Conformance | 897/897 |
| `-neg` still bites | YES — re-flipped after the fix round; red on all three assertions, nothing else moved |
| Suite (unit + integration + conformance) | 23204 pass / 0 fail |
| types-gate | 10 pre-existing, byte-identical base vs build — zero added |

DEFERRED items 1 and 4 in the section above are now SUPERSEDED by the two gaps filed here (they were
the same findings, filed but with the contradicting claims left standing). Item 4's "pre-existing and
general" framing was right; what was wrong was leaving the comment and the §34 row asserting the
opposite.
