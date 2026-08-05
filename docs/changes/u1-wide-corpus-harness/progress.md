# progress — wide-corpus emit-differential harness (S322)

Append-only. Newest entries at the bottom.

---

## 2026-08-05 — startup

Startup verification (BRIEF §CRITICAL):

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa37b7fb669813451` — OK,
  matches the required `.../\.claude/worktrees/agent-` prefix.
- `git rev-parse --show-toplevel` = same path — OK.
- `git status --short` = empty — clean tree — OK.
- `bun install` — 217 packages installed — OK.
- `bun run pretest` — "Compiled 13 test samples -> samples/compilation-tests/dist/" — OK.
- Branch: `worktree-agent-aa37b7fb669813451`.

MAPS: `.claude/maps/primary.map.md` read in full FIRST per the brief. Task-Shape Routing sends
"build commands / CI stages / a gate decision" to `build.map.md` (stamp `b929b9c9`, declared
"deliberately older — zero CI/build-surface diff this window"). Load-bearing assessment recorded at
the end of this log.

NOTE — the brief was NOT present in this worktree at dispatch time. It exists only as an untracked
file in the main checkout (`docs/changes/u1-wide-corpus-harness/BRIEF.md`, created after this
worktree's base commit). Read from main (read-only), then re-materialised verbatim into this
worktree so the archive-at-dispatch-time protocol holds and a successor has it.

---

## 2026-08-05 — reconnaissance: the two PA-LOCATED-VERIFY hypotheses

### H1 — "artifact-diff.mjs may be deleted" → **WRONG, it survives and is TRACKED.**

`docs/changes/chunk-namespacing/artifact-diff.mjs`, 180 lines, landed in `1c5c2aee`
("chunk-namespacing BUG-6 accessor-rename — finish + land (closes #27) (#180)"). It is present in
this worktree and in every sibling worktree.

Read in full. Important correction to the brief's framing: **the file on disk is the FIXED version,
not the defective one.** Its own header documents the S282 defect and the fix:

> "The version shipped at `e3584cc5` was NOT [trustworthy]: `walk()` recursed but re-anchored
> `relative()` on the SUBdirectory, so nested files entered the set as bare basenames,
> `readFileSync` threw on them, and a `catch { continue; }` swallowed it. On a 115-file tree it
> compared 8 files and reported PASS."

So the "compared 8 of 115" defect is the `e3584cc5` version; the landed file already carries the
two designed-in defenses (walk keeps the ORIGINAL root; an unreadable file is a FINDING and a
zero-comparison run FAILS rather than passing vacuously).

**Ruling: SUPERSEDE, do not fold in.** Rationale — it is not a general harness and cannot become
one without destroying it. It is a *single-change-shaped* gate: `fold()` hardcodes the
chunk-namespace token regex, the `_scrml_cs_*` accessor rename, and the `_scrml_find_each_anchor`
call-shape change; `unwrapChunkScope()` hardcodes the BUG-6 prologue. All of that is deliberate
normalisation for ONE change and is worthless (actively misleading) for U1. It also compares two
pre-existing dist TREES — it has no corpus enumeration, no compile step, and no `node --check` at
all, which are three of the new tool's four jobs. Three good ideas are carried across rather than
the code: (a) never silently skip an unreadable artifact, (b) fail loudly on a zero-comparison run,
(c) detect duplicate relative paths collapsing in the walk set.

### H2 — "conformance/ 870 files, some may be fragments not compilable programs" → **REFINED.**

Shape (`find conformance -name '*.scrml' -type f`, 870):

| filename | count | role |
|---|---|---|
| `case.scrml` | **855** | the case ENTRY POINT — matches `docs/FACTS.md`'s published "conformance cases 855" exactly |
| `m.scrml` | 7 | auxiliary module, imported BY a `case.scrml` |
| `lib.scrml` | 2 | ditto |
| `a.scrml` | 2 | ditto |
| `x.scrml`, `y.scrml`, `helpers.scrml`, `channels.scrml` | 1 each | ditto |

855 + 15 = 870. Layout is `conformance/cases/<group>/<case>/case.scrml` (847 at that depth, 8 one
level deeper). Not fragments in the C-preprocessor sense — every one is a whole file — but the 15
auxiliaries are **imported modules, not entry points**, and a large share of the 855 are
deliberately-failing `-reject` fixtures.

**Ruling: compile all 870, classify none away.** This is exactly the case HARD REQ 5 exists for —
a compile failure is DATA. A `-reject` fixture failing on BOTH sides contributes nothing to the
delta; the same fixture failing on only ONE side is precisely the signal we are hunting. Narrowing
the corpus to "the 855 that look like entry points" would be the S282/S319 defect wearing a
justification. The manifest records the entry-point-vs-auxiliary classification as metadata so the
report can state it, but nothing is dropped from the measurement.

### Corpus counts — independently re-verified in this worktree

`examples` 71 · `samples` 877 · `conformance` 870 = **1818**. Matches the brief's VERIFIED claim.
`samples/` recursive breakdown: `compilation-tests` 805, top-level 30, `gauntlet-r14` 13,
`gauntlet-r13` 13, `gauntlet-r19` 6, `gauntlet-r18` 5, `gauntlet-r15` 3, `gauntlet-s19-phase4` 1,
`gauntlet-r11` 1. The narrow S319 glob saw the 30 top-level `examples` + the top-level slice of
`compilation-tests` only.

### The narrow script (`scripts/u1-corpus-emit.sh` in the U1 worktree) — read, 45 lines

Confirms the brief. Two additional defects worth carrying forward as design constraints:

1. It writes `.compile.stdout` / `.compile.stderr` **inside the per-source output dir** — so
   compiler diagnostics become indistinguishable from emitted artifacts to any downstream walk, and
   they embed absolute paths (non-deterministic across two checkouts at different paths). The new
   tool keeps outcome data OUT of the artifact tree.
2. `COMPILED=$((COMPILED + 1))` runs inside a function invoked in the main shell, which is fine
   here, but the counters are never cross-checked against an enumeration total — there is no `N of
   M` anywhere in its output. That is HARD REQ 1's origin.

---

## 2026-08-05 — Deliverable A: `scripts/corpus-emit-differential.ts`

### Pre-design probes (all executed, all in this worktree)

- Emit shape for one source: `<name>.client.js`, `<name>.css`, `<name>.html`, `<name>.server.js`,
  `scrml-runtime.<8-char-hash>.js`.
- **Emitted artifacts contain NO absolute-path leak.** `grep -rl "scrmlMaster"` and
  `grep -rlE "worktrees|/tmp/claude"` over a full emit both returned nothing. This is what lets
  artifacts be compared BYTE-EXACT with zero normalization across two checkouts at two different
  filesystem paths. Only the CONSOLE streams need normalizing.
- Compiler determinism: same source compiled twice into two different dirs, `diff -r` exit 0.
- `node --check` works on the emitted ESM (`import { SQL } from "bun"`) — node 22.20 auto-detects
  module syntax, so an `import` is not itself a check failure. Relevant to reading the base-side
  failures later: they are NOT CJS/ESM artifacts.
- Both revisions exist and `20a15c15` is an ancestor of `09e4d08c` (`git merge-base --is-ancestor`
  exit 0).
- Host headroom: 507 GB free, 22 CPUs, ~9 GB RAM available → concurrency 10 chosen (bun processes
  are the memory cost, not the CPU).

### Design notes worth carrying

- **Content-hash memo for `node --check`.** The shared runtime is emitted once per source — 1818
  byte-identical 132 KB copies per side. `node --check` is a pure function of file content, so
  identical sha256 ⇒ identical outcome. Every checkable artifact still gets a RECORDED result; the
  memo only avoids re-executing a provably identical computation, and the split is printed
  (`distinct contents actually executed` / `resolved from content-hash memo`) so it is auditable
  rather than invisible. This is a bound on WORK, never on the measurement.
- **`--reuse-artifacts`** re-hashes and re-checks an existing work tree without recompiling. It
  exists so the gate's own bite is cheap to prove (below) and so a check can be re-run without a
  full recompile.
- **Output-dir slug** is the source relpath with `/`→`~`, asserted collision-free at capture time.
  A naive nested-mirror layout would have let `a/b.scrml`'s output dir CONTAIN `a/b/c.scrml`'s.
- **Stream normalization folds exactly two things**: absolute paths (`<ROOT>`, `<OUT>`) and
  wall-clock (`in 295.5ms` → `in <MS>ms`), plus the content-addressed runtime filename and CRLF.
  Nothing else — every genuine text change stays visible.

### DETERMINISM — HARD REQ 7, VERIFIED

Two full capture runs over the unchanged `examples/` tree, into **two different work directories**
(so the `<OUT>` normalization is exercised, not bypassed):

```
$ bun scripts/corpus-emit-differential.ts capture --compiler-root . --label smoke \
    --work .../smoke-work   --manifest .../smoke.manifest.json  --roots examples
$ bun scripts/corpus-emit-differential.ts capture --compiler-root . --label smoke \
    --work .../smoke-work-B --manifest .../smokeB.manifest.json --roots examples
$ cmp .../smoke.manifest.json .../smokeB.manifest.json
cmp exit: 0 (0 = byte-identical)
```

---

## 2026-08-05 — PROVE THE BITE (all three, executed, output verbatim)

Setup: a real compiled tree for `examples/` (71 sources, 488 artifacts, 362 checkable). `R1` is the
clean `--reuse-artifacts` baseline manifest. Both sides of every bite diff are reuse-captured, so
the ONLY moving part is the artifact bytes.

### Bite 1 — the artifact diff bites

Perturb: `printf '\n// BITE-1 PERTURBATION\n' >> .../smoke-work/examples~02-counter/02-counter.client.js`
(+24 bytes), re-capture as `R2`, `diff R1 R2`:

```
   artifacts COMPARED (present on both sides, keyed by source+name): 488
     byte-identical : 487 of 488 compared
     DIFFERING      : 1 of 488 compared
   CONTENT DIFFERENCES, grouped by source (full list, no cap):
     examples/02-counter.scrml
       02-counter.client.js   3743 -> 3767 bytes   0aec0f4fc222 -> e84fba553d7f
VERDICT: 1 DIFFERENCE(S)   over 71 common sources ... and 488 compared artifacts
DIFF EXIT: 1
```

Exactly the perturbed file, attributed to exactly its source, byte delta exactly +24. **BITES.**

### Bite 2 — `node --check` bites

Append a syntax error to the same artifact
(`function BITE_2_SYNTAX_ERROR( {{{`), re-capture as `R3`, `diff R1 R3`:

```
   base: 0 FAILING of 362 checked of 362 checkable of 488 emitted
   head: 1 FAILING of 362 checked of 362 checkable of 488 emitted
   check-failure SET delta: 1 NEW in head, 0 FIXED in head (full lists, no cap):
     ! NEW failing in head : examples/02-counter.scrml :: 02-counter.client.js
         <OUT>/examples~02-counter/02-counter.client.js:99
         function BITE_2_SYNTAX_ERROR( {{{
                                        ^
         SyntaxError: Unexpected token '{'
   node --check delta        1 new / 0 fixed / 0 message-changed
(exit 1)
```

Non-zero delta, on the correct side, with the full message and the source named. **BITES.**

### Bite 1+2 restore leg

`cp` the backup back, re-capture as `R4`, `diff R1 R4`:

```
     byte-identical : 488 of 488 compared
     DIFFERING      : 0 of 488 compared
   check-failure SET delta: 0 NEW in head, 0 FIXED in head
VERDICT: NO DIFFERENCES   over 71 common sources of 71 base / 71 head enumerated
         and 488 compared artifacts
(exit 0)
```

**CLEAN.** So the gate is not stuck-on either.

### Bite 3 — enumeration bites

**(a) known count matches.** `find samples/gauntlet-r14 -name '*.scrml' -type f | wc -l` = 13.

```
$ ... capture --roots samples/gauntlet-r14 --expect-total 13
      samples/gauntlet-r14    13 of    13 total   (independent oracle: 13)
      TOTAL             13 of    13 total   (independent oracle: 13)
      cross-check   : AGREE (walk set == independent `find` set, both directions)
      expect-total  : MATCHED (13)
```

**(b) a deliberately-narrowed root is LOUD, not silently successful.** Same narrow root, asserted
against the real corpus total:

```
$ ... capture --roots samples/gauntlet-r14 --expect-total 1818
SELF-CHECK FAILED: --expect-total 1818 but enumerated 13 (difference -1805)
CAPTURE ABORTED: one or more self-checks failed. No manifest written.
(exit 1)
```

**(c) the diff layer refuses a narrowed side too** — `diff` of the 71-source `examples` manifest
against the 13-source narrow one:

```
FINDING [INCOMPARABLE] root sets differ: base [examples] vs head [samples/gauntlet-r14]
   examples       base    71 of    71    head     0 of    13   <-- DIFFERS
   source SET delta: 71 removed, 13 added (full lists, no cap):
     - REMOVED in head: examples/01-hello.scrml
     ... (all 71 + all 13 printed, no cap)
(exit 2 = not comparable)
```

**BITES on all three legs.** The S319 failure mode — a narrow population reporting a clean green —
is now three independent guards away: the `--expect-total` assertion, the independent-oracle
cross-check, and the diff-layer root-set/INCOMPARABLE check.

---

## 2026-08-05 — Deliverable B: base `20a15c15` vs U1 head `09e4d08c`

### Provisioning

Two `--detach` checkouts under the scratchpad (the live U1 worktree at
`.claude/worktrees/agent-a9c144ab82648e947` was NEVER touched — read-only inspection of its
`scripts/u1-corpus-emit.sh` only):

- `co-base-20a15c15` @ `20a15c15dfbb5af8d0630127f67ee81380032d29`
- `co-head-09e4d08c` @ `09e4d08cfbec4324ba8cc373e7537d1892444365`

`bun install` in each (217 packages, identical — `git diff --stat` shows no `package.json` /
`bun.lock` change between the two revisions, so the dependency tree is not a variable).

Change surface, `git diff --stat 20a15c15 09e4d08c`: 6 files under `compiler/src/codegen/`
(`emit-client.ts` +20, `emit-control-flow.ts` +90, `emit-expr.ts` +151, `emit-functions.ts` +29,
`emit-logic.ts` +24, `scheduling.ts` +55), one browser test, two docs, and the narrow
`scripts/u1-corpus-emit.sh`. **Zero corpus files touched** — so a non-zero source SET delta would
itself have been a finding.

### THE GATE BIT ON ITS FIRST REAL RUN — the brief's 1818 is not this comparison's population

```
$ ... capture --compiler-root .../co-base-20a15c15 --expect-total 1818
      examples          71 of  1816 total   (independent oracle: 71)
      samples          877 of  1816 total   (independent oracle: 877)
      conformance      868 of  1816 total   (independent oracle: 868)
      TOTAL           1816 of  1816 total   (independent oracle: 1816)
      cross-check   : AGREE (walk set == independent `find` set, both directions)
SELF-CHECK FAILED: --expect-total 1818 but enumerated 1816 (difference -2)
CAPTURE ABORTED: one or more self-checks failed. No manifest written.
```

**PA premise refinement (the brief's one VERIFIED item that needed narrowing).** `71 · 877 · 870 =
1818` is correct — **for `main`**. It is NOT correct for either revision under test. Both
`20a15c15` and `09e4d08c` carry **868** conformance sources, so the population for this comparison
is **1816**, identical on both sides.

Root cause, confirmed by `git diff --name-only 20a15c15 HEAD -- conformance examples samples`:

```
conformance/cases/reactive/reset-init-after-assignment-in-if-rt/case.scrml
conformance/cases/reactive/reset-init-after-assignment-in-if-rt/expected.json
conformance/cases/reactive/reset-init-after-assignment-rt/case.scrml
conformance/cases/reactive/reset-init-after-assignment-rt/expected.json
```

Those are PR #417's two §6.8 reset-init-thunk cases, which landed on `main` **after** the U1
branch's base. Independently re-verified with `find` on both checkouts: 868 and 868.

This is the harness doing exactly the job it was built for. The narrow S319 script would have
enumerated its 329 and said nothing.

### Result — capture, both sides, `--expect-total 1816`

Both sides, identical: enumerated **1816 of 1816** (oracle agrees, both directions), corpus shape
1801 entry + 15 auxiliary-module, compiled OK **1175 of 1816**, compile FAILED **641**, artifacts
emitted **6931** from 1785 of 1816 sources, checkable **4162 of 6931**, `node --check` executed
**4162 of 4162** (1937 distinct contents + 2225 memo-resolved), **FAILING 44**.

### THE HEADLINE — `node --check` delta is ZERO, not +2

```
-- NODE --CHECK ----------------------------------------------------------------------------
   base: 44 FAILING of 4162 checked of 4162 checkable of 6931 emitted
   head: 44 FAILING of 4162 checked of 4162 checkable of 6931 emitted
   check-failure SET delta: 0 NEW in head, 0 FIXED in head (full lists, no cap):
     (empty — the check-failure SET is identical on both sides)
   failures present on BOTH sides with a CHANGED message: 0 (full list, no cap):
     (empty)
```

**Base 44 reproduces the independent reviewer's base measurement EXACTLY. Head is 44, not 46.**

Characterisation of the 44 (identical set on both sides):

- **44 of 44 come from sources whose COMPILE FAILED.** Zero come from a source that compiled
  successfully. Computed from the manifests, both sides. Stated the other way round: across the
  whole 1816-source corpus, on BOTH revisions, **every source that compiles successfully emits
  syntactically valid JavaScript**. The 44 are partial artifacts written before the compiler
  errored out — the brief's "pre-existing garbage downstream of an already-failing compile" branch.
- By root: conformance 18, samples 26.
- By error: 9 `Unexpected token 'else'`, 3 each `'if'` / `'while'` / `'{'` / `Illegal break`,
  2 each `'>'` / `'.'` / `identifier 'is'` / `Invalid or unexpected token` / `Illegal continue`,
  4 duplicate-identifier, and singletons.
- **The 2 stranded-`await` failures are PRE-EXISTING and are negative fixtures**, present
  identically on both sides:
  - `conformance/cases/error/await-not-in-scrml/case.scrml :: case.client.js` — a fixture whose
    entire purpose is that `await` is not scrml.
  - `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-async-008.scrml ::
    phase1-fn-prohibition-async-008.client.js` — an `async`-fn-prohibition fixture.

  Both fail COMPILE on both sides. Neither is attributable to U1.

### Artifact differential — exactly 2 of 6931

```
     byte-identical : 6929 of 6931 compared
     DIFFERING      : 2 of 6931 compared
   artifact SET delta: 0 removed, 0 added
     samples/admin-panel.scrml
       admin-panel.client.js   39437 -> 39467 bytes   6580c81a3fa4 -> f84fdc2f3fc6
     samples/debate-async-dashboard-react-perspective.scrml
       debate-async-dashboard-react-perspective.client.js   26207 -> 26225 bytes  29b7e3bc7b0d -> 3223691d912f
```

Compile-outcome delta 0/0, diagnostic-code delta 0, diagnostic-text delta 0, artifact set delta
0/0.

**Both diffs are the U1 change doing exactly what it says.** `samples/admin-panel.scrml`, in
`_scrml_executeConfirm_44` (whose enclosing `async function` declaration is UNCHANGED — the diff
does not touch that line, so it was already async at base):

```
< (function() {
> await (async function() {
<   if (_scrml_tag_46 === "ResetPassword") { ... _scrml_fetch_doResetPassword_37(userId); }
>   if (_scrml_tag_46 === "ResetPassword") { ... await _scrml_fetch_doResetPassword_37(userId); }
```

Three client server-fn calls in `<match>` arm bodies gain `await`, and the arm-dispatch IIFE is
promoted `(function(){…})()` → `await (async function(){…})()`. The `debate-async-dashboard`
diff is the same shape with one call site (`let freshOrders = await _scrml_fetch_createOrder_21(...)`).

**These are BEHAVIOUR CHANGES and they are the intended ones — not noise.** Reading:
`_scrml_fetch_*` are the client-side fetch stubs for server fns; without the `await`, `freshOrders`
was a pending Promise being handed straight to `OrdersOp.Saved(...)` and rendered. That is the
class of bug U1 exists to fix.

**Head-side self-proof that the right compiler ran:** a stale/unloaded head codegen would have
produced ZERO artifact differences. Two artifacts differ, in exactly the shape the U1 diff
predicts, so `--compiler-root .../co-head-09e4d08c` genuinely exercised the changed
`compiler/src/codegen/*.ts`.

### Open question at this point — why 44 and not the reviewer's 46

Reproducing base 44 exactly, from a completely independent implementation, makes a methodology
difference on the head side unlikely. The economical hypothesis is that the reviewer measured an
EARLIER point on the branch — the U1 branch has 11 commits and `0c677fa3` ("docs(u1): record
implementation, full verification results") is the round-1 verification tip, with the F1/F2/F4/F5/F7
fixes landing in the three commits AFTER it. Probing that next.

---

## 2026-08-05 — the 46 REPRODUCED at the round-1 tip: the reviewer was right, and round 2-3 fixed it

Third checkout, `co-r1-0c677fa3` @ `0c677fa3` (round-1 verification tip), same corpus, same flags:

```
      enumerated 1816 · attempted 1816 · compiled 1175 · emitted 6931 · checked 4162
      FAILING       : 46 of 4162 checked
```

**46.** The reviewer's number, reproduced exactly, from an independent implementation.

### `diff base-20a15c15 -> r1-0c677fa3` — the two bundles, named

```
  node --check delta        2 new / 0 fixed / 0 message-changed
     ! NEW failing in head : samples/admin-panel.scrml :: admin-panel.client.js
     ! NEW failing in head : samples/debate-async-dashboard-react-perspective.scrml
                             :: debate-async-dashboard-react-perspective.client.js
         SyntaxError: await is only valid in async functions and the top level bodies of modules
  artifact content diffs    2 of 6931 compared
     samples/admin-panel.scrml :: admin-panel.client.js  39437 -> 38459
     samples/debate-async-dashboard-react-perspective.scrml :: ....client.js  26207 -> 25274
  diagnostic changes        1 code / 0 text-only
     samples/admin-panel.scrml   head gains E-CG-001
```

**These are STRANDED AWAITS — U1's dominant risk, realized.** At `0c677fa3` the emitter injected
`await` into a client `<match>` arm body but left the enclosing arm-dispatch IIFE as a plain
`(function(){…})()`. Whole-bundle `SyntaxError`. Two bundles DOA.

Two further round-1 defects the wide harness surfaced that a count-only gate would have missed:

- **`samples/admin-panel.scrml` gained `E-CG-001`** at r1 — the §14.8.9 protected-DB-column-cannot-
  reach-the-client-bundle SECURITY floor. A codegen change perturbing that diagnostic is notable
  even transiently.
- Both artifacts SHRANK at r1 (-978 and -933 bytes), i.e. round-1 was dropping ~1 KB of client code,
  not just mis-emitting an `await`.

### `diff r1-0c677fa3 -> head-09e4d08c` — round 2-3 closed all of it

```
  node --check delta        0 new / 2 FIXED / 0 message-changed
  diagnostic changes        1 code / 0 text-only     (E-CG-001 goes away again)
  artifact content diffs    2 of 6931 compared        (back up to 39467 / 26225)
```

Attributable to `a9a4133d` — *"fix(u1-F1): client match IIFE goes async when an arm body actually
emitted an await — ROOT fix"*. At head the shape is `await (async function(){…})()` inside an
enclosing `async function` that was ALREADY async at base (the declaration line is not in the diff).
Both bundles pass `node --check`.

**So the reviewer's 44 → 46 was a REAL, CORRECTLY-MEASURED regression against the round-1 state, and
it is FIXED at `09e4d08c`.** Nothing about the reviewer's measurement was wrong; it simply predates
the fix.

---

## 2026-08-05 — THE CAVEAT THAT MATTERS MORE THAN THE VERDICT

Both sources that show ANY artifact difference at head **fail to compile on all three revisions**:

```
base  samples/admin-panel.scrml                              exit=1 ok=false  E-TYPE-025, E-WHITESPACE-001, ...
base  samples/debate-async-dashboard-react-perspective.scrml exit=1 ok=false  E-SQL-004, E-TYPE-025, ...
r1    (same two)                                             exit=1 ok=false
head  (same two)                                             exit=1 ok=false
```

They are best-effort PARTIAL emissions from an already-failing compile.

Therefore: **across the entire 1816-source corpus, U1 produces ZERO output difference on any source
that compiles successfully.** 1175 sources compile clean on both sides and every one of their 6931
artifacts is byte-identical.

Cross-checked directly against the emitted trees: `grep -rl "await (async function" work-head`
returns 5 files — 3 are `.server.js` under `examples/23-trucking-dispatch/**` which are BYTE-IDENTICAL
at base (that is the pre-existing SERVER-side auto-await, untouched), and the only 2 client-side
occurrences are the two broken samples.

**Read this correctly.** The wide-corpus run proves ABSENCE OF REGRESSION. It cannot prove PRESENCE
OF FIX, because the corpus contains no compiling exemplar of the shape U1 changes. The U1 progress
log's own warning about the 708-bundle corpus ("contains zero `setTimeout(`, and zero instances of
every shape in rounds 2-3") turns out to apply to the WIDE corpus as well — widening 329 → 1816
moved the artifact-diff count from 0 to 2, and both of those 2 are on broken sources.

Presence-of-fix evidence for U1 is its own `browser-u1-client-server-fn-await.test.js` (199 lines,
R26 runtime proof, executes the bundle) — a different KIND of evidence, and it should be weighted as
such rather than folded into "wide-corpus green".

### Secondary observation, out of scope, surfaced not actioned

**The compiler emits artifacts for sources whose compile FAILED.** 1785 of 1816 sources emitted
artifacts but only 1175 compiled OK — so roughly 610 sources leave partial, sometimes
syntactically-invalid JS in the `-o` directory while the CLI exits 1. Every one of the 44 baseline
`node --check` failures is such a file. This is a pre-existing property of both revisions, not a U1
finding, and it is why a raw `node --check` count over a corpus is a misleading gate unless it is
joined against compile outcome. Recorded for PA to rule on; NOT actioned here.

### VERDICT

**Is U1's round-2/3 state wide-corpus clean? YES — with the caveat above.**

Over 1816 sources / 6931 artifacts per side, `20a15c15` → `09e4d08c`:

| axis | result |
|---|---|
| sources enumerated | 1816 both sides, SET delta 0 |
| compile-outcome SET delta | **0 newly failing, 0 newly passing** |
| diagnostic-code delta | **0** |
| diagnostic-text delta | **0** |
| artifact SET delta | **0 added, 0 removed** |
| artifact content diffs | **2 of 6931** — both the intended change, both on non-compiling sources |
| `node --check` | base 44, head 44, **SET delta 0 in both directions** |

No regression on any axis. The round-1 regression the reviewer found is real and is fixed.
The residual risk is not correctness-of-change but ABSENCE-OF-COVERAGE.

---

## MAPS — load-bearing assessment (brief asks explicitly)

**Not load-bearing for this task.** `.claude/maps/primary.map.md` was read in full first as mandated.
Its Task-Shape Routing has no row for corpus/differential tooling; the nearest ("build commands / CI
stages / a gate decision" → `build.map.md`, stamp `b929b9c9`, self-declared "deliberately older,
zero CI/build-surface diff") would not have helped, because this dispatch ADDS a script rather than
touching CI. Two map facts were mildly confirmatory rather than directive: invariant 31/35 describe
the `scheduling.ts` auto-await choke point that U1 extends, which made the two observed artifact
diffs legible on sight; and the currency warning ("treat any map line as a verify-against-source
hypothesis") was the correct posture and is why the corpus counts were re-derived rather than taken
from `FACTS.md`. Everything load-bearing here came from executing against the tree.

---
---

# FIX ROUND — S239 adversarial pass, items H1-H9 + the C7 correction

Two independent review lenses ran on `e4666062`. Lens 2 wrote its own driver, swept four revisions,
and reproduced every figure (1816/1816, 6931 artifacts, 44/44/46, both byte sizes, base→r1 = the two
named bundles). C1-C5 CONFIRMED; the `a9a4133d` attribution CONFIRMED **causally**. What follows is
about the tool's ability to go RED, plus one framing error of mine that was refuted.

## H1 — `node --check` was BLIND to a top-level stranded await. CONFIRMED, and it was the big one.

Verified here before touching anything:

```
$ printf 'const x = 1;\nawait fetch("/y");\n' > tla.js
$ node --check tla.js                                     -> exit 0   (PASSES)
$ node -e 'new (require("vm").Script)(<same bytes>)'      -> SyntaxError:
              await is only valid in async functions and the top level bodies of modules
$ grep -o '<script[^>]*>' 02-counter.html
              <script src="scrml-runtime.01ouojs1.js">
              <script src="02-counter.client.js">          <- NO type="module"
```

Node resolves a bare `.js` by module-syntax auto-detection; the compiler ships client bundles and
the shared runtime as CLASSIC SCRIPTS. So the syntax half was certifying bundles that cannot load.
U1's round-1 regression happened to be an await inside a non-async IIFE, which fails under every
goggle — the TOP-LEVEL placement of the same defect class was invisible, and would have produced a
report identical in shape to the one I filed.

**A third fact, found the hard way and load-bearing:**

```
$ bun  -e 'new (require("node:vm").Script)("await f();")'   -> NO THROW
$ node -e 'new (require("vm").Script)("await f();")'        -> SyntaxError
```

**Bun's `vm.Script` does not reject a top-level await.** Doing the goggles in-process under Bun —
the obvious implementation — would have produced a guard that cannot fail. The checker is therefore
a separate NODE process (`scripts/corpus-check-goggles.js`), batched so correctness costs no spawn
per artifact.

**Fix shipped:** every checkable artifact is parsed under BOTH `vm.Script` (classic) and
`vm.SourceTextModule` (module). Each artifact's load context is DERIVED from the `<script src>` tags
in its own output dir's HTML, and the goggle it is actually loaded under is the headline
(`effective`); both raw goggles are reported so a load-context flip cannot hide. `node --check` is
removed and the file header forbids reintroducing it.

## H2/H3/H4/H5/H6/H7/H8/H9 — all confirmed and fixed

- **H2** vacuity floor on the syntax half: `syntaxChecked == 0 && artifactsCheckable > 0` ⇒
  INCOMPARABLE, exit 2. Previously `--no-syntax-check` on both sides exited 0, green, having
  measured nothing — defect #3 from this file's own header, reproduced structurally.
- **H3** manifest now records `checkContext {method, nodeVersion, work}` and `diff` refuses two
  sides measured under different contexts. Note the fix is stronger than recording: `vm.Script` /
  `vm.SourceTextModule` read the source text and nothing else, so the ambient `package.json`
  `"type"` input that made this exploitable is **gone by construction**.
- **H4** strict arg parsing — names whitelisted per mode, value-flags require a value, bool-flags
  reject one, repeats rejected, and the expect-total assertion ALWAYS prints its status.
- **H5** memo key is `(sha256, ext)`. See the measurement below — the premise was real for
  `node --check` and is now structurally void.
- **H6** `diff` asserts `base.revision !== head.revision` (`--allow-same-revision` to opt in) and
  refuses a `"<unknown>"` revision.
- **H7** `--reuse-artifacts` no longer fabricates compile success. It derived `ok` from
  `existsSync(outDir)` while `compileOne` unconditionally created that dir, so a real capture's
  60/71 became 71/71 on reuse. Now uniformly `ok:false, exitCode:-1`, the manifest carries
  `reuseArtifacts: true`, and `diff` refuses compile conclusions without `--allow-reuse-manifest`.
- **H8** `DEFAULT_ROOTS` gains `stdlib/` and `benchmarks/`. **Chose BOTH options the review
  offered**: widen the defaults AND print the excluded population. Rationale — `stdlib/` is shipped
  scrml and `benchmarks/` holds the most app-shaped programs in the repo, so they belong in a
  default corpus; `docs/` (illustrative snippets), `compiler/native-parser/` (deliberately malformed
  fixtures) and `handOffs/` (session artifacts) do not, but their exclusion must be a VISIBLE
  decision rather than an invisible default. Capture now prints
  `EXCLUDED: 453 *.scrml ... compiler 123, dashboard 1, docs 282, handOffs 47`.
  **This widening paid for itself immediately — see the new finding at the end.**
- **H9** the VERDICT banner reads `NOT A VALID COMPARISON` on an incomparable run and is written to
  BOTH streams. A stdout-only log can no longer read green.

## BITE PROOFS — all nine, executed, verbatim

### H1 — the top-level stranded await. THE control matters as much as the bite.

Injected `await _scrml_fetch_something();` at top level of a real emitted bundle.

**Control — what the OLD gate says about these exact bytes:**
```
$ node --check .../02-counter.client.js
OLD GATE (node --check) exit: 0  <-- 0 means the old gate PASSES a DOA bundle
```

**The fixed gate:**
```
   base: 0 FAILING (effective) ...        head: 1 FAILING (effective) ...
   [EFFECTIVE — the goggle each artifact is actually loaded under]  base 0 failing, head 1 failing
     ! NEW failing in head : examples/02-counter.scrml :: 02-counter.client.js
         await is only valid in async functions and the top level bodies of modules
   [SCRIPT goggle applied to ALL artifacts]   base 155 failing, head 156 failing   -> 1 NEW
   [MODULE goggle applied to ALL artifacts]   base 0 failing, head 0 failing       -> 0 NEW
```

The MODULE row reproduces the old gate's blindness directly beside the correct answer. **BITES.**

Restore → `VERDICT: NO DIFFERENCES`, 488 of 488 byte-identical, 0 syntax delta, exit 0. **CLEAN.**

### H2 + H9 — vacuous syntax half
`--no-syntax-check` on both sides, then diff, **reading stdout only**:
```
$ bun ... diff ... 2>/dev/null | grep VERDICT
VERDICT: NOT A VALID COMPARISON — 0 difference(s) reported below are UNTRUSTWORTHY ...
```
**BITES** — and the banner itself carries the dissent, not just the exit code.

### H3 — differing check context
Forged a manifest with `checkContext.nodeVersion = v18.0.0`:
```
FINDING [INCOMPARABLE] the two sides were syntax-checked under DIFFERENT contexts:
    base: ... node v22.20.0
    head: ... node v18.0.0
  A context difference can manufacture an entire failure-set delta in either direction.
```
**BITES.**

### H4 — silent disarm, all four cases the review named
```
--expect-total   (trailing) -> ERROR: --expect-total requires a value (got end of arguments)   exit 2
--expect-totals 1818        -> ERROR: unknown flag --expect-totals for mode "capture"          exit 2
--roooots examples          -> ERROR: unknown flag --roooots for mode "capture"                exit 2
(flag absent)               -> "expect-total  : NOT ASSERTED — no --expect-total given, so the
                                enumerated count is unverified against any external expectation"
```
**BITES on all four.**

### H5 — the memo purity premise
Identical bytes (`import x from "y"; await x();`) written as `twin.cjs` and `twin.mjs`:
```
$ node --check twin.cjs  -> REAL exit 1   (FAIL)
$ node --check twin.mjs  -> REAL exit 0   (PASS)
```
**The review is right: `node --check` is NOT a pure function of content, and 53% of the old U1
syntax verdict was memo-resolved on that false premise.**

Under the new goggles, the same twins:
```
cjs: script {ok:false, "Cannot use import statement outside a module"}, module {ok:true}
mjs: script {ok:false, "Cannot use import statement outside a module"}, module {ok:true}
```
**Identical.** The verdict is now extension-INDEPENDENT by construction, which supersedes the
memo-key concern rather than merely mitigating it. The key still includes `ext` as defence in depth
(and `loadedAs` genuinely does consult the extension for `.cjs`).

### H6 + H7 — same command, both fired
```
FINDING [INCOMPARABLE] both sides are the SAME revision (33c601db...). A revision compared
  against itself is clean by construction and proves nothing.
FINDING [INCOMPARABLE] base manifest was captured with --reuse-artifacts, so its compile
  outcomes were never measured.
```
**BOTH BITE.**

### H8 — the excluded population is now printed
```
      EXCLUDED      : 453 *.scrml source(s) exist outside the selected roots and are NOT measured
                      compiler 123, dashboard 1, docs 282, handOffs 47
```

---

# THE RE-RUN — base `20a15c15` vs head `09e4d08c`, fixed tool, widened corpus

Fresh checkouts, `bun install` in each. Population re-derived independently: 1816 + `stdlib` 53 +
`benchmarks` 7 = **1876**, asserted via `--expect-total 1876`, matched on both sides, oracle agrees.

| axis | base `20a15c15` | head `09e4d08c` | DELTA |
|---|---|---|---|
| sources enumerated | 1876 of 1876 | 1876 of 1876 | **0** (same SET) |
| compiled OK | 1205 of 1876 | 1205 of 1876 | **0 newly failing / 0 newly passing** |
| diagnostics | — | — | **0 code / 0 text-only** |
| artifacts emitted | 7248 | 7248 | **0 added / 0 removed** |
| artifact content | — | — | **2 of 7248** |
| syntax — EFFECTIVE goggle | **66** of 4335 | **66** of 4335 | **0 new / 0 fixed** |
| syntax — script goggle on all | 621 | 621 | **0 new / 0 fixed** |
| syntax — module goggle on all | 64 | 64 | **0 new / 0 fixed** |
| load-context changes | — | — | **0** |
| bare `_scrml_fetch_*` sites (clean sources) | **150** of 472 in 103 sources | **150** of 472 | **0** |

**ANSWER TO THE QUESTION ASKED: YES — 44/44 and the 2-artifact result survive contact with
classic-script goggles.**

The two artifact diffs are byte-for-byte the same two as before:
```
     samples/admin-panel.scrml
       admin-panel.client.js   39437 -> 39467 bytes   6580c81a3fa4 -> f84fdc2f3fc6
     samples/debate-async-dashboard-react-perspective.scrml
       debate-async-dashboard-react-perspective.client.js   26207 -> 26225   29b7e3bc7b0d -> 3223691d912f
```

The ABSOLUTE syntax number moved 44 → 66. That is the H1 hole plus the H8 widening, **not** a
regression: 22 additional real failures that `node --check` was structurally unable to see. The
DELTA — the thing that gates the landing — is **zero on every axis, under every goggle.**

## NEW FINDING the widened corpus surfaced (pre-existing, NOT U1, NOT fixed here)

Of the 66 effective failures, **65 come from sources whose compile FAILED. Exactly one does not:**

```
stdlib/compiler/module-resolver.scrml :: module-resolver.client.js
    Cannot use 'import.meta' outside a module
```

A **cleanly-compiling** stdlib source emits a client bundle that uses `import.meta`, while the
emitted HTML loads it as a classic `<script src>`. That bundle is dead on arrival in a browser.
Present IDENTICALLY on both sides, so it is not attributable to U1 and it does not affect the
landing decision — but it is a real defect that was invisible to the old gate on two counts at once
(wrong goggle AND `stdlib/` outside the corpus). Surfaced for PA to route; **not actioned** here,
per the no-compiler-source constraint.

## C7 — MY CONCLUSION WAS WRONG. Corrected.

I wrote that the run "cannot prove presence of fix, because the corpus contains no compiling
exemplar of the shape." **The premises hold; the stated reason is FALSE, and I am retracting it.**

Lens 2 extracted U1's own three runtime-test fixtures to standalone `.scrml`: all three compile
cleanly (rc=0) and U1 fires on all three. It then inventoried `_scrml_fetch_*` call sites across the
cleanly-compiling corpus and found **bare (unawaited) call sites that are unambiguous instances of
U1's target bug in sources that compile cleanly on all four revisions** — e.g.
`examples/19-lin-token.scrml:107`, `const ticket = _scrml_fetch_mintTicket_12(...)` in an **async**
host, consumed by `redeem(ticket, …)`, with a sibling call on the very next line that IS awaited;
and `samples/.../phase1-function-with-sql-002.scrml:55`, `await (_scrml_fetch_loadUsers_3().length)`
— verbatim the precedence bug `isAwaitedClientServerFnCall`'s own doc-comment cites as its reason to
exist.

**This harness now reproduces that measurement itself** (the metric was added this round rather than
left to a one-off script): **150 bare call sites of 472 total across 103 cleanly-compiling sources,
byte-identical base→head, delta 0.** (My rule counts more sites than lens 2's 49-of-148-across-70 —
different counting rule and a wider corpus — but the conclusion is identical and it is the DELTA
that matters: **zero**.)

**The accurate statement, replacing my C7:**

> U1 introduces **no regression** — zero delta on every axis over 1876 sources and 7248 artifacts,
> under classic-script goggles. It **fixes the shapes its own tests cover** (verified causally at
> `a9a4133d`: r1→head is 0 new / 2 FIXED). And it **does not reach the instances of its target bug
> already sitting in `examples/` and `samples/` today** — 150 bare client server-fn call sites in
> cleanly-compiling sources, unchanged.

Zero-diff-on-compiling-sources is therefore **not** absence of coverage. It is U1's gate not reaching
the emitter paths the corpus's exemplars use (CPS/failable-fn wrapper, module top-level init,
markup-interpolation lift). That is a scoping fact about U1, not a blind spot in the measurement —
and it is the difference between "we learned nothing" and "we learned the fix is narrower than the
bug." A future reader must not land U1 believing the wide run was merely uninformative.

## Also recorded, from lens 2

`d7c85591` and `09e4d08c` (the F5/F4/F7 fixes) produce **zero** corpus-observable output change —
those fixes are entirely unexercised by the wide corpus. The only corpus-visible movement on the
whole branch is F1 (`a9a4133d`), which fixes the two bundles round-1 broke.
