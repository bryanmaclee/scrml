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

## WHAT WAS NOT DONE

- `docs/known-gaps.md` untouched (contended). Gap text above.
- DEFECT 2 not fully root-caused; not reproducible on this host. Stated as partial in-source.
- `revision` provenance annotated, not corrected.
- No unit tests added for this script (out of dispatch scope; filed as gap above).
