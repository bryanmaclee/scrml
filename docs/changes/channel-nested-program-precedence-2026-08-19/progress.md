# progress — channel-nested-program-precedence-2026-08-19

Append-only. Timestamps are local (America/Denver).

## 2026-08-19 — startup

- WORKTREE_ROOT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa275a59028d3e6d4
- `git rev-parse --show-toplevel` == WORKTREE_ROOT. Tree clean at start.
- `git merge-base HEAD origin/main` = 3b5eed4465fdc92702098bba0049a1e3dce9f4ce
- `git rev-parse origin/main`        = 3b5eed4465fdc92702098bba0049a1e3dce9f4ce  => base assertion HOLDS.
- branch = worktree-agent-aa275a59028d3e6d4
- `bun install` ok (217 packages). `bun run pretest` ok (13 test samples compiled).
- BRIEF.md recovered from origin/bank/s353-three-rulings.

## 2026-08-19 — maps

- Read `.claude/maps/primary.map.md` Task-Shape Routing IN FULL. **There is no routing row for
  symbol-table / placement-diagnostic work.** Nearest rows: "a diagnostic code — ANY code, any
  prefix" -> error.map.md, and structure.map.md for file layout.
- LOAD-BEARING (error.map.md:348 + :276): `E-CHANNEL-INSIDE-PAGE` was **CATALOGED-BUT-NEVER-WIRED
  until S301 (#286)** — a `<channel>` inside a `<page>` compiled clean and wired PROGRAM-scoped,
  and a Wave-1 code comment asserting it fired kept anyone from re-checking. Generalised lesson:
  "a §34 row is not evidence of a fire site; `grep -rn` is." Directly relevant: this dispatch must
  verify fire sites by execution, not by reading.
- structure.map.md:140 names `symbol-table.ts` as the SOLE fire site for `E-CHANNEL-INSIDE-PAGE`
  (`:9377+`). error.generated.md:45 names `symbol-table.ts:9186` for `E-CHANNEL-OUTSIDE-PROGRAM`.
- Invariant 55 (regex over source text in a post-AST stage needs a justification or the structural
  route) flagged as potentially relevant to the `fileHasProgram` pre-scan — to be checked.

## 2026-08-19 — Rule 4 governing-sentence gate

All four sentences read IN FULL and confirmed verbatim. **Line numbers have DRIFTED from the BRIEF**
(SPEC grew since the gap entry was written); content is identical.

- BRIEF said §38 preamble `:20659` — actual **`:21076`**.
- BRIEF said §40 `:22395` — actual **`:22814`**.
- BRIEF said §4.12.1 `:724` — actual **`:724`** (exact).
- BRIEF said §4.12.1 `:718` — actual **`:718`** (exact).

No content contradiction. Proceeding.

Supporting sentence found while reading (not in the BRIEF), SPEC.md:35548 — §58:
"`story=` is not a `<page>` attribute. A `<page>` (§40.8) is not a separate compilation unit — it
shares the application `<program>` scope — so a per-`<program>` build story does not extend to it."
This is SPEC drawing the same distinction the ruling rests on, from the opposite side: `<page>`
shares the `<program>` scope; a nested `<program>` does NOT.

## 2026-08-19 — locus verification (PA-LOCATED-VERIFY)

**HELD.** `compiler/src/symbol-table.ts`, `walkChannelPlacement`. The BRIEF's contract-note range
`:9416`-`:9451` is exact. The fire pair is at `:10035` / `:10045`:

    if (isChannelMarkup && pageDepth >= 1)                            -> fireChannelInsidePage(...)
    else if (isChannelMarkup && programDepth === 0 && fileHasProgram) -> fireChannelOutsideProgram(...)

Depth computation at `:10057`-`:10058`:

    const childProgramDepth = tag === "program" ? programDepth + 1 : programDepth;
    const childPageDepth    = tag === "page"    ? pageDepth + 1    : pageDepth;

`hasProgramElement` (`:9918`) is a STRUCTURAL AST walk, not a source-text regex — invariant 55 does
NOT apply.

## 2026-08-19 — pre-fix empirical probe (execute, don't grep)

Ran a 7-case probe through `splitBlocks` -> `buildAST` -> `runSYM`. Verbatim pre-fix results:

| case | shape | pre-fix SYM |
|---|---|---|
| A | `<program>` > `<page>` > `<program name=w>` > `<channel>` | **E-CHANNEL-INSIDE-PAGE** (the ruled-wrong fire) |
| B | `<page>` > `<program name=w>` > `<channel>` (route file)   | **E-CHANNEL-INSIDE-PAGE** |
| C | `<program>` > `<page>` > `<channel>` (genuine page-nested) | E-CHANNEL-INSIDE-PAGE (must STAY) |
| D | `<program>` > `<channel>` sibling of `<page>` (canonical)  | (none) |
| E | `<program>` > `<page>` > `<program w>` > `<page>` > `<channel>` | E-CHANNEL-INSIDE-PAGE (must STAY: page inside the fresh scope) |
| F | `<program>` > `<program w>` > `<channel>` (no page)        | (none) — already accepted |
| G | file-top `<channel>` + a program-in-page elsewhere         | E-CHANNEL-OUTSIDE-PROGRAM |

TAB parses A/B/E without error — the nested-`<program>`-inside-`<page>` shape is genuinely
constructible, so this is a live mis-fire, not a shape the parser rejects first.

## 2026-08-19 — migration measurement (MY OWN NUMBER, not the BRIEF's)

Walked EVERY `.scrml` in the worktree (skipping node_modules/.git/dist/.claude), building the real
AST and classifying every `<channel>` by the walker's own ancestor semantics.

    .scrml files walked : 2362   (== `git ls-files '*.scrml' | wc -l` = 2362, exact)
      parsed ok         : 2362
      parse failed      : 0
    <channel> nodes     : 53

    PLACEMENT POPULATIONS          pre-fix -> post-fix
      REJECT E-CHANNEL-INSIDE-PAGE      1 -> 1
      REJECT E-CHANNEL-OUTSIDE-PROGRAM  1 -> 1
      ACCEPT canonical (in <program>)  41 -> 41
      ACCEPT dispensed (PURE-CHANNEL)  10 -> 10

The BRIEF's S239 figure was 2260 files / 0 page-nested channels. **My number is 2362 files and
ONE page-nested channel** — and it is `conformance/cases/channel/inside-page/case.scrml`, the
deliberate NEGATIVE fixture for the diagnostic itself. Zero in adopter / example / sample / stdlib
code. That fixture is `<program>` > `<page>` > `<channel>` with NO intervening `<program>`, so it
is the arm that must keep rejecting; it is unmoved by the fix.

**Nested-`<program>`-inside-`<page>` channels in the corpus: ZERO.** Blast radius of the
newly-accepting direction is zero, measured, not assumed.

## 2026-08-19 — fix implemented

`compiler/src/symbol-table.ts`, `walkChannelPlacement`, one behavioural line:

    const childPageDepth =
      tag === "program" ? 0
      : tag === "page" ? pageDepth + 1
      : pageDepth;

Post-fix probe (same 7 cases as the pre-fix run above):

| case | pre-fix | post-fix |
|---|---|---|
| A `<program>` > `<page>` > `<program w>` > `<channel>` | E-CHANNEL-INSIDE-PAGE | **(none)** |
| B `<page>` > `<program w>` > `<channel>`               | E-CHANNEL-INSIDE-PAGE | **(none)** |
| C `<program>` > `<page>` > `<channel>`                 | E-CHANNEL-INSIDE-PAGE | E-CHANNEL-INSIDE-PAGE |
| D canonical sibling                                    | (none) | (none) |
| E re-page inside nested program                        | E-CHANNEL-INSIDE-PAGE | E-CHANNEL-INSIDE-PAGE |
| F nested program, no page                              | (none) | (none) |
| G file-top channel                                     | E-CHANNEL-OUTSIDE-PROGRAM | E-CHANNEL-OUTSIDE-PROGRAM |

## 2026-08-19 — the `fileHasProgram` adjacent hole: ALREADY CORRECT, and why

The pre-scan does NOT need to become per-scope. The argument is structural, not empirical:

1. Arm (b) is guarded by `programDepth === 0`. Every node that can consume `fileHasProgram`
   therefore has NO `<program>` ancestor, so its innermost enclosing compilation unit IS the file.
   "Does my scope contain a `<program>`" and "does the FILE contain a `<program>`" are the same
   question over the same subtree for exactly the reachable set.
2. Symmetrically the reset can never promote a node INTO arm (b): every node whose `pageDepth` the
   reset rewrites was reached by descending a `<program>`, hence has `programDepth >= 1`. The two
   arms are separated by a predicate the reset cannot cross.

Not left to assertion — pinned by four §B19.14 PRE-SCAN tests, one of which (the file whose ONLY
`<program>` is nested inside a `<page>`) is the sole test in the entire B19 suite that catches
adversarial mutant 3.

## 2026-08-19 — bite proofs

**ACCEPT arm — 8 of the new tests FAIL against the pre-fix compiler.** Verbatim excerpt:

    error: expect(received).toHaveLength(expected)
    Expected length: 0
    Received length: 1
    (fail) §B19.14 ... > ENTRY-FILE: `<program>` > `<page>` > nested `<program>` > `<channel>` — ACCEPTED
    (fail) §B19.14 ... > ROUTE-FILE: top-level `<page>` > nested `<program>` > `<channel>` — ACCEPTED
    (fail) §B19.14 ... > the reset is an ANCESTOR reset — intermediate markup ...
    (fail) §B19.14 ... > intermediate markup INSIDE the nested `<program>` too — still ACCEPTED
    (fail) §B19.14 ... > TWO channels in one nested `<program>` — both accepted, zero diagnostics
    (fail) §B19.14 ... > MIXED file — one page-nested channel REJECTS while its sibling is ACCEPTED
    (fail) §B19.14 ... > the reset does not leak to a LATER sibling `<page>` subtree
    (fail) §B19.14 ... > PRE-SCAN — a channel nested in a `<program>` never reaches arm (b) ...
     43 pass / 8 fail   (pre-fix)   ->   52 pass / 0 fail   (post-fix)

**REJECT arm — cannot bite a fix by construction** (it pins behaviour that must NOT change), so it
was proven against FOUR adversarial mutants instead:

| mutant | what it gets wrong | caught by |
|---|---|---|
| 1 — accept any channel at `programDepth >= 1` (the over-wide reading of "reverse the precedence") | drops the `<page>` fence entirely | 4 new + 6 existing §B19.12 |
| 2 — `childPageDepth = 0` unconditionally (page counter deleted) | same, plus route files | 5 new |
| 3 — pre-scan made "per-scope" by not descending `<page>` | re-admits the canonical-violation shape silently | **exactly 1 new test, and NOTHING else in the suite** |
| 4 — `&& fileHasProgram` dropped from arm (b) | kills the PURE-CHANNEL-FILE dispensation | 1 new |
| 5 — reset INVERTED (`<program>` arms instead of clears) | fires on canonical placement | 2 new |

Every one of the 17 new tests bites at least one wrong implementation, except one deliberate cheap
companion ("same shape WITH a top-level `<program>`") kept as a complement to the sharp case.

**Conformance** `channel/in-nested-program-inside-page`. Pre-fix, verbatim:

    FAIL  channel/in-nested-program-inside-page
            forbidden codes present: ["E-CHANNEL-INSIDE-PAGE"]
            emitted: ["E-CHANNEL-INSIDE-PAGE"]
    conformance (impl#1): 883/884 cases pass, 1 FAILED

Post-fix: `PASS`, `conformance (impl#1): 884/884 cases pass`.

## 2026-08-19 — population counts

- **Newly ACCEPTS:** the nested-`<program>` placement site — `<page>` > `<program>` > `<channel>`,
  at any `<page>`/`<program>` nesting depth and behind any intermediate markup. Corpus instances: 0.
- **Still REJECTS:** `E-CHANNEL-INSIDE-PAGE` on 1 corpus site (the conformance reject fixture) and
  every genuinely page-nested shape; `E-CHANNEL-OUTSIDE-PROGRAM` on 1 corpus site.
- **Unchanged ACCEPTS:** 41 canonical in-`<program>` + 10 PURE-CHANNEL-FILE dispensed.
- Pre-fix -> post-fix over all 53 corpus channels: 1->1 / 1->1 / 41->41 / 10->10. Zero corpus delta.

## 2026-08-19 — SPEC §38.1 amendment

Added invariant **1a** (nested-`<program>` placement scope) + a qualifying clause on invariant 1,
with inline Rule 4b provenance. **Confined to §38.1** per the dispatch bar (10 insertions, 1
deletion, all inside §38.1).

## 2026-08-19 — BLOCKER: pre-commit hook cannot pass (ENVIRONMENT, not the change)

`git commit` of the code half is REFUSED by the pre-commit hook. Cause verified BY EXECUTION of the
hook's own command, not inferred:

    $ bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance \
        compiler/tests/*.test.js --bail
    (fail) fs.watch reload (watch: true) > registers watchers when watch:true

That test is PRE-EXISTING RED on this machine at the unmodified base commit (measured at session
start, before any edit). Root cause, measured:

    $ bun -e '... fs.watch("/tmp/wtest.txt") ...'
    fs.watch THREW: EMFILE: too many open files

    /proc/sys/fs/inotify/max_user_instances = 128
    in use system-wide                       = 123
    held by leaked `scrml dev` test servers  = 76   (84 processes, aged 1h20m .. 31h)

The leaked processes are `compiler/bin/scrml.js dev /tmp/scrml-dev-throw-*` servers spawned by
PRIOR dispatches' tests (e.g. worktree `agent-a3748d68a1d807f9c`) that never tore them down. They
exhaust the per-user inotify instance pool, so `_startWatcher` (`compiler/runtime/stdlib/mcp.js:211`)
throws and swallows, `_watchers` stays empty, and the assertion `watcherCount === 3` sees 0.

Remediation attempted and DENIED: reaping the >2h-old leaked servers was blocked by the tool
classifier. Not worked around. `--no-verify` and a `core.hooksPath` override are both forbidden by
the dispatch brief and neither is authorized.

**Nothing is lost.** The complete code half is committed as
`docs/changes/channel-nested-program-precedence-2026-08-19/code-half.patch.txt` (570 lines, verified to
apply). Once the inotify pool is freed, the code half lands with:

    git apply docs/changes/channel-nested-program-precedence-2026-08-19/code-half.patch.txt  # if unstaged
    git add compiler/src/symbol-table.ts compiler/tests/unit/channel-placement-shared-b19.test.js \
            conformance/cases/channel/in-nested-program-inside-page/
    git commit   # hook will now pass

## 2026-08-19 — test baselines (gate subset, no --bail)

    BEFORE : 28776 pass / 86 skip / 1 todo / 2 fail
    AFTER  : 28793 pass / 86 skip / 1 todo / 2 fail

+17 pass == exactly the 17 new §B19.14 tests. The 2 failures are the same two pre-existing
EMFILE-caused `fs.watch` tests in both runs. ZERO new failures.
Conformance: 883/883 before -> 884/884 after.

## 2026-08-19 — final state

Working tree holds the complete, verified change (6 files, 7 diffs). All of it is captured in
`code-half.patch.txt`, which is COMMITTED and PUSHED, so nothing is at risk from a worktree sweep.

    M compiler/SPEC-INDEX.md          (regenerated)
    M compiler/SPEC.md                (§38.1 invariant 1a + qualifying clause)
    M compiler/src/symbol-table.ts    (the fix + contract notes)
    M compiler/tests/unit/channel-placement-shared-b19.test.js  (§B19.14, 17 tests)
    M docs/FACTS.md                   (regenerated)
    ? conformance/cases/channel/in-nested-program-inside-page/  (new case, 2 files)

Final green: §B19.14 52 pass / 0 fail in the B19 file; conformance 884/884.
`fs.watch` re-probed at wrap: still `EMFILE`. Code commit remains operator-gated.

DEFERRED, surfaced not fixed:
1. `compiler/tests/unit/mcp-runtime-helpers.test.js` asserts `watcherCount === 3` and
   `getCurrentVariant("e2")` unconditionally, with no guard for an environment where `fs.watch` is
   unavailable. Because `_startWatcher` swallows the throw by design, the test cannot distinguish
   "watcher registration is broken" from "the OS refused a watcher" — so it turns a machine-level
   resource condition into a suite-wide `--bail` stop that blocks every code commit on the machine.
   That is arguably a test-robustness bug, but fixing it is outside this brief and a guard could
   mask a real regression, so it is surfaced rather than changed.
2. The 84 leaked `scrml dev` throwaway-fixture servers are a test-teardown leak in whatever spawns
   `/tmp/scrml-dev-throw-*`. They accumulate across dispatches and will re-block the machine.
3. §38 preamble (`SPEC.md:21076`), §38.2's normative list (`SPEC.md:21164`) and §40.8
   (`SPEC.md:22814`) still carry the FLAT "Channels SHALL NOT live inside `<page>`" sentence. The
   new §38.1 invariant 1a states explicitly that all three are read subject to it, but the
   mechanical restatement sync was NOT performed: the dispatch bars edits to any SPEC section other
   than §38.1 while sibling agents are live. Hand to a follow-up.
