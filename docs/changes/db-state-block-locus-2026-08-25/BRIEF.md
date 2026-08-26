# BRIEF — ruling 1: logic at a `<db>`/state-block locus is REFUSED, not linted

change-id: db-state-block-locus-2026-08-25
dispatched: S375-bryan, 2026-08-25
base: `origin/main` @ `592dccf7`
RULED: bryan, S375 — *"your recs all 4"*, adopting limb **(b)** with its stated grounds. Direction is
settled; this is execution, not deliberation. **Do not re-open the fork.**
DONE-PROBE: `bun compiler/bin/scrml.js compile docs/changes/db-state-block-locus-2026-08-25/repro.scrml --output-dir /tmp/dbprobe 2>&1 | grep -q 'E-STATE-BLOCK-BARE-WRITE-DECL' && echo PASS || echo FAIL`

---

## The defect, PA-VERIFIED on `main` before this brief was written

```scrml
<program db="./app.db">
<schema>
  items { id: integer primary key, name: text }
</schema>
<db src="sqlite:./app.db" tables="items">
  on mount { loadDashboard() }
</db>
function loadDashboard() { }
<div>hello</div>
</program>
```

**Compiles at exit 0. Zero diagnostics.** `on mount { loadDashboard() }` appears in the emitted HTML
**as literal page text**, and `loadDashboard` is defined in the client bundle and **never invoked**.

SPEC says `<db>` / `<state>` bodies are **NOT** default-logic-mode loci — a state-block body is markup
context. So the author's initialization silently never runs and the page shows them the source of it.

## The ruling, and why — so you do not re-derive or argue it

**Limb (b): promote this locus to the already-reserved `E-STATE-BLOCK-BARE-WRITE-DECL`, at Error.**

The sibling `W-STATE-BLOCK-BARE-WRITE-DECL` currently covers a bare *write* at the same locus at
**Info**, and its own catalog text says it stops short of a hard error *"because a hard error there is
a bigger call."* The ruling overrides that for statement forms, on three grounds, all ratified:

1. **The base FORK RULE's first three rows all point here.** The rejected limb (c) — making the `<db>`
   body a lift surface — WIDENS. The status quo fails **OPEN**. Newly-rejecting is the REVERSIBLE
   direction.
2. **The earlier Info choice does not govern.** It was made for a bare *write*. `on mount` never
   running is a different failure class — the "my app doesn't load" bug, not a dropped assignment.
3. **S368 already ruled that logic at a markup locus is REFUSED, not linted** (the bare-call ruling,
   limb c). That makes this **conformance restoration against a ruling already made**, not new policy.

## What you must do

### 1. The governing-sentence gate (base Rule 4) — REQUIRED, before you write code
Find and **QUOTE** the normative sentence establishing that `<db>`/`<state>` bodies are not
default-logic loci, with its section number — or record explicitly *"searched §X, §Y, §Z — no
governing sentence found."* Outcome 2 is a FINDING and changes this from a fix into a re-ruling; say
so loudly rather than proceeding.

### 2. Derive the locus. **I have NOT asserted one and I do not know it.**
Per base §5 a PA-asserted locus is a hypothesis; I am not even giving you a hypothesis here, because I
would be guessing. What I know is the SYMPTOM and the reproducer above. Find where the state-block
body is classified and where `W-STATE-BLOCK-BARE-WRITE-DECL` fires; that is your entry point. **Report
the locus you found and how execution reaches it** — if you can't state the path, say you searched
rather than traced.

### 3. Scope: STATEMENT FORMS, not "everything that isn't a decl"
`on mount { … }` is the reported case. Enumerate what else reaches this locus — other lifecycle
blocks, bare calls, control flow — and **say which you covered and which you deliberately did not.**
The S368 bare-call ruling explicitly rejected "diagnose every non-declaration run", so prose and
free text at this locus must keep working. Name the form, refuse the complement.

### 4. MEASURE the migration. Newly-rejecting owes a measured count, not an assumption.
Derive the population **from the compiler** (`compileScrml({write:false})` over the corpus), not by
text-scanning — that is how the S368 bare-call population was derived and it is the standard here.
Report the count AND the file list across `samples/`, `examples/`, `stdlib/`, `conformance/cases/`,
`benchmarks/`, `docs/`. Assumed-zero is not measured-zero. **If the count is non-zero, STOP and report
before migrating anything** — a non-zero migration is a separate ruling, not yours to take.

## WRITE-SET — HARD BOUNDARY, and two of these are collision-critical

**MUST NOT write:**
- `compiler/src/codegen/emit-each.ts` — a concurrent session landed #710 here TODAY and a parked arc
  of mine rewrites it. Touching it collides with both.
- `compiler/src/ast-builder.js` — rulings 2 and 3 are sequenced onto it; a third writer breaks that.
- `compiler/SPEC.md` and `docs/known-gaps.md` — mine this session. **Hand me the §34 row text and any
  gap entries in your report; do not write those files.**
- `.claude/maps/`.

**MAY write:** the validation/classification source you locate (report it before you commit to it) ·
tests under `compiler/tests/` · `docs/changes/db-state-block-locus-2026-08-25/{progress.md,repro.scrml}`.

## Method

- **Execute, don't grep.** Compile the reproducer and read the emitted HTML; "the check fires" is not
  the same claim as "the page is right."
- Corpus differential both sides from `git worktree add` roots — **exit 2 is NOT-A-VALID-COMPARISON.**
- Bite-prove on the COMMITTED state. **No `git stash`.**
- **NEVER `--no-verify`. NEVER override `core.hooksPath`.**
- Incremental commits; append to `progress.md`; **commit your final report into `progress.md` before
  emitting it** — a sibling dispatch lost its whole report to a 600s stall today while its work sat
  committed and fine.

## Report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · **governing-sentence outcome (quoted, or recorded-as-searched)** ·
**the locus you derived + whether you traced or searched** · the statement forms you covered and those
you did not · **the MEASURED migration count + file list** · differential (count + exit code) · bite
proof (what you executed) · **§34 row text for me to land** · gap entries you want authored ·
**anything in this brief that is wrong.**

Four dispatches corrected me on load-bearing points today and every one was right. If the ruling's
premise does not reproduce for you, or the locus makes limb (b) unworkable, say so — that is a finding,
not a failure.
