# progress — fix `corpus-emit-differential.ts` before it becomes a gate

Append-only, timestamped. Agent worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab7336c5da32f10ed`

---

## 2026-08-11 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab7336c5da32f10ed` (worktree, correct).
- `git rev-parse --show-toplevel` == pwd. `git status --short` clean.
- **Base correction:** the harness provisioned this worktree at `1bfa8544` (branch
  `worktree-agent-ab7336c5da32f10ed`), which is the PARENT of the brief commit `19157604`, so the
  BRIEF FILE WAS NOT PRESENT. `git merge --ff-only fix/differential-harness` fast-forwarded cleanly
  to `19157604`. No conflict, no rebase. Recording this because a future reader of the branch will
  see a merge that was actually a pure FF onto the brief.
- `bun install` OK (217 packages). `bun run pretest` OK (13 samples -> `samples/compilation-tests/dist/`).

## Maps consulted

- `.claude/maps/primary.map.md` (stamp `616688ea`, NOT an ancestor of this HEAD — treated as
  hypothesis per its own invariant 48). Load-bearing rows:
  - **invariant 41** — this script is the standing pre-land gate; `diff` exit 2 = NOT A VALID
    COMPARISON, distinct from 1 = differences found. The syntax half must stay a separate NODE
    subprocess. Confirms the brief's "do not invent a fourth reporting mode".
  - **invariant 51 / Key Facts "A PROBE IS CODE"** — `scripts/` is inside the review floor's
    code-bearing population on purpose, and **"prove the bite"** is stated there as a rule, not a
    nicety. Directly motivates the brief's A3.
  - Task-Shape Routing row "you are CHANGING ANYTHING under `compiler/src/codegen/`" — names the
    invocation shape this script is run under.

---

## THE HONEST FRAMING

Not "three bugs fixed". **This instrument reported wrong answers in three distinct ways, and nobody
noticed until three separate agents happened to trip over them on the same day — none of whom was
looking.** Two were found by adversarial reviewers on unrelated arcs; the third by an agent who
simply pointed `--compiler-root` at the shared main checkout. That is the number that matters before
dpa-025 promotes this to a standing gate: the defect-discovery rate for this file is
*incidental-only*, and its own test surface is zero (no test in `compiler/tests/` references it).

A fourth was found by this dispatch's own bite proof, in the fix for the first one (see A1-FP below).
That is four silent failure modes in one instrument in one day, and it is the argument for the whole
exercise.

---

## LOCI IN THE BRIEF — VERIFIED / CORRECTED

| Brief claim | Verdict |
|---|---|
| `resolveProjectRoot` is the compiler's root resolver and is what `nsId` keys off (**explicitly untraced, PA-asserted**) | **CORRECT.** `compiler/src/codegen/chunk-namespace.ts:108`. `nsId` -> `_state.token` <- `buildChunkNamespaceState` -> `chunkNamespaceToken(filePath, projectRoot)` -> `fnv1aHash(projectRelativeSourcePath(...))`. Consumer at `codegen/index.ts:1316`. |
| The walk starts from the source file | **IMPRECISE, and it matters.** It starts from `computeOutputBaseDir(cgSourcePaths)` (`api.js:2407`), which for a ONE-file compile is `dirname(resolve(src))` (`api.js:200`). `compileOne` only ever does one-file compiles, so `dirname(abs)` is faithful — but a harness that compiled several sources per process would need the common directory instead. Recorded at the call site. |
| `mkdir .git` is a valid remedy | **CORRECT, and non-obvious.** An EMPTY `.git` directory satisfies `resolveProjectRoot` (`existsSync`) while git itself rejects it as a repo and walks UP, so `gitRevision` keeps working. Verified both halves. |
| `:1150-1159` same-revision / unknown-revision guards are the shape to follow | **CORRECT**, followed. |
| exit 2 = NOT A VALID COMPARISON; do not invent a fourth reporting mode | **HONOURED.** Exit 0/1/2 unchanged. Flake/unverified state is a banner ANNOTATION on an existing verdict, not a new one. |
| DEFECT 2 is a concurrency race; "do not assume resource exhaustion — measure" | **MEASURED, and it did not reproduce** — see below. Partially root-caused anyway. |

---

## DEFECT 1 — namespace anchor (HARD REQ 8)

**Mechanism reproduced from first principles**, not taken on report. Two trees holding byte-identical
sources, differing only in whether a project-root marker exists above them, emit
`// --- chunk cell scope (01t8u5va) ---` and `(002qn9lf)`. The harness's own resolution reproduces
those two tokens EXACTLY via the compiler-under-test's exported `chunkNamespaceToken`.

**Bite proof, both directions, at the final schema:**

- markerless reference tree vs worktree -> **exit 2**, `MISMATCH on 71 of 71 common sources`, banner
  `NOT A VALID COMPARISON — 91 difference(s) ... are UNTRUSTWORTHY`.
- `mkdir <reftree>/.git`, re-capture -> **exit 0**, `chunk-namespace anchor MATCH`,
  `artifact content diffs 0 of 488`.

**91 -> 0 on one `mkdir`** — the 1014 -> 0 shape at `examples` scale.

### A1-FP — the fix's OWN false positive, caught by its own bite proof

The first implementation compared a `prefixDigest` hashed over the WHOLE enumerated source list. Any
source-set change moves that digest, so **a legitimate corpus addition would have been reported as an
ANCHOR MISMATCH and refused** — on the most ordinary event in this repository (15 conformance cases
landed in a single window). Replaced by `prefixBySource`, compared over COMMON sources only. This is
the entry that most deserves to be read by whoever writes the next guard here: the refusal criterion
must be evaluated over the population it is a claim about.

---

## DEFECT 2 — phantom compile failures

### Root cause: PARTIAL. Stated as partial on purpose.

**The race did not reproduce.** Three full 1906-source captures on one revision — two at
`--concurrency 10`, one at `--concurrency 40` — compared per source on compile outcome, exit code,
both normalized streams, artifact SET and every artifact sha256: **zero differences, all three.**
Headline figures identical (1224 ok / 682 failed / 7383 emitted). Host had ~9GB available; measured
single-compile peak RSS ~120MB.

`compileOne` spawns independent processes with per-source output dirs, and the compiler writes to no
shared cache or fixed-name temp path (checked). So the remaining candidates are machine-state, not
program logic.

### What WAS root-caused (HARD REQ 10) — and it is cheap and structural

`Bun.spawn`'s `exited` resolves to **128+N for a signal death**. Measured:
`Bun.spawn(["bash","-c","kill -KILL $$"])` -> `exited: 137`, `exitCode: null`,
`signalCode: "SIGKILL"`. The harness read only `exited`, so **an OS-killed compiler was recorded as
`exitCode: 137, ok: false, stdout: "", stderr: ""` — indistinguishable from a source that
legitimately failed to compile.** `proc.signalCode` carries the distinction and was discarded.

One SIGKILL produces, in a single event, **a newly-FAILING source AND a diagnostic change (real
diagnostics become `""`) AND removed artifacts** — which is exactly the witnessed
"8 newly-failing, 8 diagnostic changes, 27 removed artifacts". That is a strong match, but it is a
match to a *signature*, not a reproduction, and it is recorded as such.

Fix splits the two kinds, because neither half is discretionary:
- **external kill** (SIGKILL/SIGTERM/...) -> no verdict was produced. Re-run SERIALLY after the pool
  drains. Killed again -> **UNMEASURED, capture self-check FAILS, no manifest.**
- **crash signal** (SIGSEGV/SIGABRT/...) -> the compiler crashed. A real and serious finding, kept,
  never retried, named at capture. An unlisted signal is treated as a crash (safe direction).

### Mitigation kept anyway (HARD REQ 9) — and why that is not belt-and-braces

Because the cause is NOT closed, a mitigation that does not depend on knowing the cause is the
correct shape, not a fallback from one.

**Bite proof — phantom caught:** injected the witnessed triple (exit 137, empty streams, artifacts
dropped) into one source. Result: `REPRODUCED 0 of 1`, `HARNESS FLAKES ... 1`, naming
`discarded finding(s): newly FAILING, diagnostic CODE change, artifact REMOVED`. Verdict
`NO DIFFERENCES ... [1 HARNESS FLAKE(S) DISCARDED — the harness, not the compiler]`, **exit 0**.

**Bite proof — SWALLOW RISK, the one to watch.** A real codegen change was committed into a reference
checkout AND a phantom injected into a genuinely-quiet source in the same run:

```
RAN — 52 difference-bearing source(s), re-compiled SERIALLY (concurrency 1) on both compilers.
REPRODUCED : 51 of 52 — real differences, reported above
HARNESS FLAKES (did NOT reproduce; EXCLUDED from the findings total): 1
  ~ FLAKE: examples/01-hello.scrml
      discarded finding(s): newly FAILING, diagnostic CODE change, artifact REMOVED
VERDICT: 67 DIFFERENCE(S) ... [1 HARNESS FLAKE(S) DISCARDED]     exit 1
```

**51 real findings survived; exactly the injected phantom was discarded.** An earlier attempt put the
phantom on a source that ALSO carried a real artifact difference, and it was correctly classified
REPRODUCED rather than flaked — the asymmetric rule (ANY difference in ANY class keeps EVERY finding
for that source) working as designed. That failed attempt is better evidence than the successful one.

---

## DEFECT 3 — non-reproducible enumerated corpus (HARD REQ 11)

### PREMISE CORRECTION — the "exit 0" claim does not reproduce

The scope addition states the incident "exited **ZERO**" and frames it as a hollow gate that CI would
treat as PASS. **Measured against the ORIGINAL script from `main`**, with a synthesised 4-source set
delta:

```
$ bun <main's corpus-emit-differential.ts> diff --base <minus4> --head <full>
ORIGINAL SCRIPT EXIT CODE = 1
VERDICT: 4 DIFFERENCE(S)   over 1902 common sources of 1902 base / 1906 head enumerated
```

`srcDelta.onlyA.length + srcDelta.onlyB.length` was already folded into `findings`, and
`return findings === 0 ? 0 : 1` has **no path to 0** with a non-zero delta. The reported exit 0 was
almost certainly `$?` read from the last command of a pipeline (`| head`, `| tail`) — a trap this
dispatch hit twice itself. **The gate was not green on that run.**

The defect underneath is nonetheless real, and is what got fixed: **the report could not distinguish
a stray untracked file from a genuine corpus change.** Same number, opposite meaning.

### Why a bare source-SET delta must NOT be an incomparability

The scope addition asks for exactly that, and it would be wrong. A tracked corpus addition and an
untracked stray produce the **identical** delta shape, and tracked additions are routine here.
Refusing on the delta fires on the most ordinary event in the repository — the cry-wolf shape that
`primary.map.md` invariant 51 records as getting a guard **deleted**. git draws the line the delta
cannot: `git status --porcelain -uall --ignored=matching` over the selected roots, intersected with
the enumerated set.

**Tracked addition -> ordinary FINDING (exit 1). Untracked or dirty corpus -> REFUSAL (exit 2).**

**Bite proof, all three directions:**

| | Setup | Result |
|---|---|---|
| 1 BITES | one untracked `.scrml` in an enumerated root | **exit 2**, names `?? examples/zz-stray-untracked.scrml` |
| 2 CLEARS | stray removed, both sides clean | **exit 0**, `NO DIFFERENCES`, `corpus reproducibility base CLEAN` |
| 3 NO FALSE FIRE | the same extra source, but COMMITTED (tracked) in the base checkout | **exit 1**, `1 DIFFERENCE(S)`, `chunk-namespace anchor MATCH`, NOT incomparable |

Direction 3 doubles as the regression proof for A1-FP: differing source sets no longer trip the
anchor guard.

---

## NEW FINDING — inherited revision provenance (surfaced, partially closed)

`gitRevision` runs `git rev-parse HEAD` in `--compiler-root`, and **git walks UP**. A tree that is not
its own checkout — a `git archive` extraction under any repository — is therefore labelled with the
**enclosing repository's HEAD**. Measured: the extracted reference tree reported
`6dc7063b...`, the enclosing scratch repo's commit, with exit 0 and no complaint.

This is not cosmetic: `revision` is what the same-revision guard keys off, so a wrong-but-plausible
revision **defeats that guard silently**. It also means the 1014-diff incident's reference side was
probably labelled with a revision it never had.

Partially closed: `diff` now prints, for any side that is not its own git checkout, that its recorded
revision is INHERITED and that the same-revision guard cannot see through it. **Not fully closed** —
the `revision` field itself is still populated with the wrong value. See gap text below.

---

## GAP TEXT (docs/known-gaps.md is OFF LIMITS — contended; hand this to whoever owns it)

**`g-emit-differential-revision-inherited-from-enclosing-repo`** — MED, open.
`scripts/corpus-emit-differential.ts` `gitRevision()` runs `git rev-parse HEAD` with
`cwd: --compiler-root`; git walks up, so a compiler root that is not its own git toplevel is recorded
with the ENCLOSING repository's HEAD. The `revision` field feeds the same-revision INCOMPARABLE guard,
so a capture pair can defeat that guard while carrying provenance neither side has. Partially
mitigated at S339 by a diff-time NOTE keyed on `corpusCleanliness.isOwnGitCheckout`; the field itself
is still wrong. Remediation: record `revisionIsOwn: boolean` beside `revision` and either refuse or
substitute `<inherited from PATH>`.

**`g-emit-differential-mass-phantom-exceeds-reverify-cap`** — LOW, open, BY DESIGN.
HARD REQ 9 declines all-or-nothing above `--reverify-limit` (default 300) because a partial
re-verification that reads like a complete one is the truncated-probe shape. A MASS phantom event
(hundreds of compiles killed at once) therefore exceeds the cap and is reported UNVERIFIED. The banner
says so; that is the honest floor, not coverage. Stated in-source at `DEFAULT_REVERIFY_LIMIT`.

**`g-emit-differential-has-no-test-surface`** — MED, open.
Nothing in `compiler/tests/` references this script; every defect in it to date was found
incidentally. It is `scripts/`, which invariant 51 places inside the review floor's CODE-BEARING
population on purpose. Four silent failure modes surfaced in one day. Before it becomes a standing
gate it wants unit tests over the pure functions (`anchorMismatches`, `sourceDifferences`,
`artifactKey`, `parseArgs`, the porcelain parse in `measureCorpusCleanliness`).

---

## VERIFICATION

- **Pre-commit gate** (unit + integration + conformance) ran on every code commit:
  **28670 pass / 86 skip / 0 fail.** Zero failures, unchanged throughout.
- **Full `bun run test`** (adds browser/happy-dom): the failure set is **not stable across identical
  runs** — 53, then 49, then 51, on the same tree. The differing entries are browser/happy-dom and
  corpus-audit tests, and **both remaining differences pass in isolation**
  (`flagship-hos-engine-under-if.browser.test.js` 7 pass / 0 fail;
  `parser-conformance-corpus.test.js` 1015 pass / 0 fail).
- Two of the first run's extras were `benchmarks/todomvc/dist/` failures — **that gitignored dist is
  created BY the first run**, so run #1 fails what run #2 passes. ENV-GAP, the S209/S250 shape.
- **No test in `compiler/tests/` references this script**, and this dispatch's delta is that one file
  plus these two docs (`git diff --name-only 19157604..HEAD`). Nothing imported by a test changed.
- **Determinism control survives:** two independent clean captures of the same revision diff to
  `NO DIFFERENCES`, exit 0.

---

# ROUND 2 — S239 returned DO-NOT-LAND, and it was right

## F1 — MY OWN FIX WAS THE WORST DEFECT IN THE FILE

**HARD REQ 9 converted 66 measured real differences into "harness flakes" and turned exit 1 into
exit 0 — by default, in the canonical arrangement this change is being promoted into.**

```
capture base  ->  git checkout <head> in the SAME tree  ->  capture head  ->  diff
```

leaves `base.compilerRoot === head.compilerRoot`, so `reverifyDelta` re-compiled BOTH sides with
ONE compiler. Nothing can differ, so everything was discarded. **Measured against my own previous
commit `356d3bbe`:**

```
REPRODUCED : 0 of 51
HARNESS FLAKES (did NOT reproduce; EXCLUDED from the findings total): 51
VERDICT: 1 DIFFERENCE(S) ... [51 HARNESS FLAKE(S) DISCARDED]
```

66 real content differences across 51 sources, gone. With equal source sets it reads
`NO DIFFERENCES` / exit 0.

**Say it plainly: on `origin/main` a shared or stale compiler root is harmless, because there is no
re-verification. My fix made it fatal, on by default.** Every prior failure mode in this instrument
produced a suspicious NUMBER a reader might question. This one produced a **clean bill of health.**
It is the only one that turns RED into GREEN.

**And my swallow-risk bite proof passed for a reason worth keeping:** I tested it in a TWO-WORKTREE
arrangement, where the roots differ and re-verification genuinely re-measures. The bite lives in the
ONE-CHECKOUT arrangement. The test was right about the mechanism and wrong about the deployment —
oracle blindness, on the instrument built to fix instrument blindness. **That is the second time in
this arc a fix of mine was caught by a bite proof rather than by reasoning, and both times the bite
proof was aimed slightly wrong.**

### Fix — three preconditions, the third is the actual guarantee

1. identical compiler roots -> decline (one tree cannot hold two revisions)
2. root no longer at its captured revision (`gitRevision` vs `m.revision`) -> decline
3. **CANARY** — re-compile an AGREED-ON source per side and require it to reproduce that side's own
   manifest. Only this sees an **uncommitted** mutation after capture, which leaves both the
   revision and the root-distinctness intact. That is the reviewer's second reproducer.

**The canary must use a CONTROL, never an implicated source.** My first cut used `implicated[0]`,
which is exactly backwards — a genuine phantom IS a source whose manifest disagrees with a
re-compile, so the canary would have disarmed re-verification precisely when it was about to be
useful. Caught by re-running the anti-swallow proof, not by reading.

### Departure from the reviewed recommendation: DECLINE, not REFUSE

The review asked for exit 2. I decline re-verification instead and report the differences as
measured (exit 1). **Reason: the two manifests are self-contained valid measurements, and the
single-checkout workflow produces a legitimate pair. Refusing it would refuse a VALID COMPARISON —
the same defect class as the whole-corpus prefix digest that refused legitimate corpus additions
earlier in this same arc (A1-FP).** Declining returns the run to exactly main's behaviour with the
banner stating the delta went unchecked, so there is no false green and no workflow is broken. The
block is marked in-source as the one place to change if the project prefers hard refusal.

### Bite proof

| | Result |
|---|---|
| pre-fix, single checkout | `1 DIFFERENCE(S)`, **51 of 51 real findings discarded as flakes** |
| post-fix, single checkout | `67 DIFFERENCE(S)`, `[DELTA NOT RE-VERIFIED — 51 unchecked]`, **all 66 content diffs intact**, exit 1 |
| post-fix, two intact roots (control) | `RAN over 51 — 51 reproduced, 0 flakes` — re-verification still works |
| post-fix, one root mutated UNCOMMITTED | canary fires, names `examples/02-counter.scrml` and `artifact CONTENT: 02-counter.client.js`, all 67 differences preserved |
| post-fix, anti-swallow re-proof (two roots + injected phantom) | `51 of 52 reproduced, 1 FLAKE` — flake detection survives the new gate |

## F2 — `.trim()` corrupted porcelain; the most common dirty shape was the one that escaped

Worktree-modified entries are `" M path"` with a **leading space**. Trimming the whole buffer ate it
on the FIRST line only, which then parsed as code `"M "` / path `"xamples/01-hello.scrml"`, missed
the intersection, and was dropped. Untracked (`??`), ignored (`!!`) and staged (`M `/`A `) have no
leading space — **which is exactly why my bite proof, built on an untracked file, passed over it.**

Measured, 2 modified + 1 untracked: **pre-fix `1 untracked, 1 modified`; post-fix `1 untracked, 2
modified`.** The alphabetically-first modified source was lost every time.

## F3-F9

- **F3** (anchor models one INPUT, compiler uses the whole compile UNIT) — my ⚠ was real and
  understated, and the docstring asserted fidelity the compiler does not have. **Claim corrected
  in-source** with the falsifying case and the exact conditions to re-check. Latent: needs a nested
  marker AND a cross-directory import; neither exists under the default roots.
- **F4** — the signal retry re-compiled into the killed process's output dir, so partial output
  survived. **I removed a "removed artifacts" phantom and installed an "artifact ADDED" phantom on
  the same event.** `compileOne` now always starts from an empty dir.
- **F5** — env-kill asymmetry now prints a stderr warning naming why a resource regression hides
  behind a successful retry. Still not a finding: host-dependent, and counting it would make the
  verdict depend on machine load.
- **F6** — `?? ""` turned an ABSENT anchor measurement into a verified MATCH, contradicting
  `resolverAvailable`'s own rule. Absence is now a mismatch.
- **F7** — `--ignored=traditional` replaces `matching` (44 vs 3 lines over the default roots; 0
  ignored `.scrml` today, so this is prophylactic).
- **F8** — flag NAMES were strict while VALUES were not; `--reverify-limit abc` -> NaN silently
  removed the all-or-nothing cap. Integer validation on all three numeric flags.
- **F9** — `loadContextChanged` was printed as a finding and never counted, **on this branch AND on
  main**; now counted and flake-filtered. `fxSourceDelta` stays uncounted deliberately: it derives
  from artifact text, so a moved split already appears as a content difference.
- **F10** — the fields added at `47e75cce` are covered by the later 3->4 bump; no v3 manifest was
  ever published. Round 2 adds no manifest fields, so no further bump.

## ROUND 2 REGRESSION SWEEP (all previously-proven bites re-run at the final commit)

| check | want | got |
|---|---|---|
| self-diff determinism control | 0 | **0** |
| A1 anchor mismatch | 2 | **2** |
| A1 anchor fixed (`mkdir .git`) | 0 | **0** |
| D3 dirty corpus | 2 | **2** |
| D3 tracked corpus addition (no false fire) | 1, zero INCOMPARABLE | **1, zero** |
| A2 anti-swallow (two roots + phantom) | flake discarded, real kept | **51 reproduced, 1 flake** |

## GAP TEXT — ROUND 2 ADDITIONS

**`g-emit-differential-anchor-models-input-not-unit`** — MED, open, LATENT.
`resolveNamespaceAnchor` walks from `dirname(entrySource)`; the compiler walks from
`computeOutputBaseDir(cgSourcePaths)` — the common ancestor of every file in the compile UNIT. One
input is not one unit: an import pulls a second file in, and a probe importing `../lib/m.scrml` made
the compiler anchor on the common ancestor (`fnv1a("pages/case.scrml")`) while the model anchored on
the entry dir (`fnv1a("case.scrml")`). Cannot fire until a corpus root contains BOTH a nested
`scrml.toml`/`.git` AND a cross-directory `.scrml` import; then it disarms HARD REQ 8 silently by
comparing two prefixes equal to each other and wrong about the compiler. Remediation: resolve each
source's compile unit, or have the harness ask the compiler for the token directly.

**`g-emit-differential-no-reverify-in-single-checkout`** — LOW, open, BY DESIGN.
HARD REQ 9.1 declines re-verification whenever both sides share a compiler root, which is the
canonical single-checkout workflow — so the phantom filter is unavailable exactly where the workflow
is most convenient. Remediation: materialise each revision into a temp tree (`git archive` + a
project-root marker, since DEFECT 1 bites an extracted tree) and re-verify against those.

**`g-emit-differential-env-kill-asymmetry-uncounted`** — LOW, open, BY DESIGN. See F5.

---

# ROUND 3 — the default was wrong, not the guards

## OPERATIONAL NOTE, READ THIS FIRST

**`--no-reverify` removes every false green this arc found, and until round 3 it was the only safe
way to gate on this file.** It is verified as such. If you want the phantom filter, you need round
3's inversion; if you want a gate you can trust with the least machinery, pass `--no-reverify` and
accept that a harness phantom reports as a finding.

## WHAT ROUND 2 GOT WRONG

Round 2 closed the three *arrangements* F1 was found in. It did not close F1. Four more independent
routes reached **exit 0 over real recorded differences with every precondition intact and green**:

```
VERDICT: NO DIFFERENCES … [1 HARNESS FLAKE(S) DISCARDED]   EXIT=0
roots distinct ✓   revisions match ✓   canary reproduced ✓
```

They were not four bugs in the guards. **They were one bug in the default**, which is exactly why
three rounds of point-fixes did not converge.

## THE INVERSION (`FLAKE_DEMOTION_RULE`)

> **A difference that does not reproduce is an `errored`, NOT a flake. Discarding one requires an
> AFFIRMATIVE POSITIVE SIGNAL.**

Every defect in this arc rode the implication `did not reproduce ⇒ discard ⇒ exit 0`. A
non-reproduction is the ABSENCE of evidence, and it is at least as consistent with *"the
re-verification could not measure"* as with *"the capture was a phantom"* — the former being
likelier, since re-verification runs later on a machine whose state has moved.

Demotion now requires **naming the corrupt capture**: exactly one side's recorded outcome must be
contradicted by re-compiling that side, while the other's is reproduced exactly. `flaked` carries
`corruptSide`, because a demotion that cannot say which measurement was wrong is a guess. Everything
else — both reproduce, neither reproduces, a killed re-compile, a determinism run, a dirty oracle —
is `errored`, the finding **stands and is counted**.

**The instrument may now fail in exactly one direction: false RED.** A flake reported as a finding
costs a human five minutes. A finding discarded as a flake is a silent miscompile shipped under a
clean bill of health.

## G1-G9

- **G1 — the canary is RETIRED, not replaced.** It sampled ONE source from `controls` — *"common
  sources with no difference"* — a population selected for being **insensitive** to the two
  compilers disagreeing. `implicated[0]` was backwards; `controls[0]` is anti-correlated with
  detection power, which is not the same thing as correct, and I defended it with 40 lines
  containing no power argument. The per-source affirmative rule re-compiles **both sides of every
  implicated source** against its own recorded outcome: same check, full coverage, maximal relevance.
- **G2 — an externally-killed re-compile is `errored`, never flaked.** Two SIGKILLed re-compiles are
  byte-identical (`ok:false`, 137, empty, no artifacts), so the old rule read "0 differences" and
  discarded the finding — **under exactly the memory pressure DEFECT 2 was pinned to.** The
  re-verification's most likely failure mode was silently converting real findings into flakes.
- **G3 — a manifest recording a dirty corpus is no longer an oracle.** Nothing read
  `corpusCleanliness`, which the manifest already carried and which names the sources.
  `--allow-dirty-corpus` permits the COMPARISON; it does not make a dirty tree an oracle.
- **G4 — a determinism run never demotes.** Harness nondeterminism IS a "did not reproduce" event,
  so the flake filter was subtracting precisely the signal a self-diff is commissioned to find.
- **G5 — `git status -z`.** C-quoting turned `café.scrml` into `"benchmarks/caf\303\251.scrml"`; the
  old unquoting left six literal characters, the path missed the intersection and was dropped, so
  HARD REQ 11 did not fire on a genuinely non-reproducible corpus. Rename/copy records now consume
  their origin field.
- **G6 — the provenance string was FALSE.** It said `--ignored=matching` while the code ran
  `--ignored=traditional`, and it persisted into every manifest and printed at capture — in the
  instrument whose thesis is that provenance strings must be true. Now rendered from the argv that
  actually runs. **Never hand-write a command you also execute.**
- **G7 — `Number("") === 0`**, so `--reverify-limit ""` was accepted as the "no cap" sentinel: the
  F8 defect class surviving inside the helper written to close it.
- **G8 — `fxSourceDelta` and the headline `BARE delta` are flake-filtered.** A demoted flake drove
  `BARE delta: -7` — the file's own auto-await trend metric reading a phantom's shadow.
- **G9 — REVERTED; the reviewer is right.** `loadedAs` is derived by `deriveLoadContexts` from the
  emitted HTML's bytes, so a load-context change implies an HTML content difference or an
  artifact-set difference, both already counted. Counting it could only double-count, and it
  contradicted the sibling rationale that leaves `fxSourceDelta` uncounted. Both are printed,
  neither counted, one argument.

## THE TEST SURFACE — asserted EXIT CODES, and its bite is proven

`compiler/tests/integration/corpus-emit-differential-exit-codes.test.js` — **16 asserted exit codes
across the refuse / decline / demote branches**, synthesised from ONE real capture over the smallest
corpus root in the tree (`benchmarks/todomvc`, one source). **Runs in ~1.3s.**

Not unit tests, and deliberately so: **every one of the nine defects was a question about which
BRANCH a real manifest pair takes**, and the failure mode is exit 0, which nothing else in the tree
would notice. Unit tests over the pure helpers would have caught none of them.

**Its bite is measured, not asserted.** The F1 case, run against the pre-inversion script
(`356d3bbe`), reproduces the false green exactly:

```
PRE-INVERSION (356d3bbe)   exit 0   VERDICT: NO DIFFERENCES ... [1 HARNESS FLAKE(S) DISCARDED]
HEAD                       exit 1   VERDICT: 4 DIFFERENCE(S) ... [DELTA NOT RE-VERIFIED]
```

A rig for a gate whose failure mode is exit 0 has to be shown to produce a non-zero exit on a green
predecessor. This one is.

## ROUND 3 REGRESSION SWEEP (all prior bites, at the final commit)

| check | want | got |
|---|---|---|
| self-diff determinism control | 0 | **0** |
| A1 anchor mismatch | 2 | **2** |
| A1 anchor fixed (`mkdir .git`) | 0 | **0** |
| D3 dirty corpus | 2 | **2** |
| D3 tracked corpus addition (no false fire) | 1 | **1** |
| anti-swallow (two roots + phantom) | real kept, phantom demoted | **51 reproduced, 1 DEMOTED (names HEAD as corrupt), 0 not-cleared** |
| exit-code rig | 16 pass | **16 pass, 0 fail, 1.3s** |

## THE THING TO CARRY OUT OF THIS ARC

Nine silent failure modes in one instrument, found across three adversarial rounds. **Three of them
were introduced BY fixes for the previous two**, and each survived a hand-written bite proof that
was aimed at the right mechanism in the wrong deployment. The pattern is not carelessness; it is
that **a bite proof written by the same person who wrote the fix inherits that person's model of
where the fix runs.** The exit-code rig is the structural answer, and the reason it is worth more
than the nine individual fixes is that it does not depend on anyone's model being right.

## WHAT WAS NOT DONE

- `docs/known-gaps.md` untouched (contended). Gap text above.
- DEFECT 2 not fully root-caused; not reproducible on this host. Stated as partial in-source.
- `revision` provenance annotated, not corrected.
- No unit tests added for this script (out of dispatch scope; filed as gap above). **Round 2 raises
  this from a nice-to-have to the main outstanding risk: F1 was introduced BY a fix, survived a
  bite proof aimed at the right mechanism in the wrong deployment, and was caught only by an
  adversarial read. Five of the six defects this arc found in the re-verification path were found
  by executing it in an arrangement nobody had tried, not by reasoning about it.**
- F3's anchor is corrected in DOCUMENTATION only; the model still differs from the compiler in a
  case the corpus cannot currently reach.
- **Round 3:** the exit-code rig covers the refuse/decline branches and the two demote outcomes it
  can reach without a second checkout. **The FLAKE-vs-ERRORED branches that need two genuinely
  distinct compilers are covered only by the manual proofs recorded above**, not by the rig. Closing
  that needs a fixture pair of two tiny checkouts; the rig is structured to take them.
- **G2's killed-re-compile branch is verified by construction and by reading, not by an executed
  SIGKILL during re-verification.** The capture-side equivalent WAS executed (`Bun.spawn` resolves
  `exited` to 137 with `signalCode: "SIGKILL"`). Forcing a kill inside the re-verification window is
  the one assertion in this arc I could not stage.
