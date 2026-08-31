# BRIEF — `E-STATE-UNDECLARED` over-fires on a CE-inlined cross-file channel cell read inside a `<match>` arm

**Dispatched:** S385-bryan, 2026-08-29. **Base:** `origin/main` @ `56473410`.
**change-id:** `s385-channel-cell-match-arm-scope`
**Gap:** `g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm` (HIGH, open)
**Adopter:** flogence (handle) — **their flagship gate is RED right now**, on source that has not
changed. This is a live regression against a real consumer, not a hypothetical.

**You are fixing TWO defects that the PA believes share ONE root cause. Read the hypothesis section
before you start, and treat it as a hypothesis — the PA did not trace it.**

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — hard gate)

Worktree root: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/` = `WORKTREE_ROOT`.
⚑ The repo is **`scrml`** (renamed S200). Any older brief saying `scrmlTS` is stale.

## Startup — BEFORE any other tool call
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is under any other repo, **STOP and report** (S90 CWD-routing). Save `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **Assert your base:** `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
   ⚑ **S346: a worktree is cut from `origin/main`, NOT from the dispatching checkout's HEAD.**
4. **Fetch this brief into your tree** — it is on a branch, not on `main`:
   ```
   git fetch origin brief/s385
   git checkout FETCH_HEAD -- docs/changes/s385-channel-cell-match-arm-scope/
   ```
5. `git status --short` clean. 6. `bun install`.
7. `bun run pretest` — **run it plainly, from the worktree CWD.**
   ⚑ **S376: `bun --cwd <path> run <script>` SILENTLY NO-OPS and exits 0.** It prints the script list
   and does nothing, so the browser fixtures never build and the pass is fake. **Verdict by exit code
   is no defence — check the artifact exists** (`samples/compilation-tests/dist/`). Use `--cwd=<path>`
   (with the `=`) or plain CWD.
8. Use `bun run test` (chains pretest) for full-suite baselines, never bare `bun test`.

If ANY step fails: **STOP and report.** Do not proceed on a half-verified workspace.

## Path discipline
- Apply edits via **Edit/Write on `WORKTREE_ROOT`-absolute paths.**
  ⚑ **S314: the old "Bash-only edits" rule is RETIRED and is now actively wrong** — the isolation
  guard refuses Bash heredocs/redirects as "too complex to verify", and the `path-discipline.sh`
  PreToolUse hook guards *Edit/Write* specifically. Bash writes are the one surface it cannot see.
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `--cwd=`, absolute paths.
- ⚑ **NEVER a bare `pkill -f "bun test..."` / `killall`.** Every checkout shares the command string,
  so that pattern matches a suite running in MAIN just as well as yours, and killing another
  checkout's pre-commit hook leaves **no trace on your side**. Kill by PID captured at launch.
- First commit message includes your verbatim `pwd`: `WIP(s385-chan-scope): start at <pwd>`.

# COMMIT DISCIPLINE
Commit **after each phase** — do not batch. Your branch + `progress.md` are the only crash-recovery
anchor. Coupled code+test lands **together**. `git status` clean before DONE. Update
`$WORKTREE_ROOT/docs/changes/s385-channel-cell-match-arm-scope/progress.md` per phase.
**NEVER `--no-verify`** — and never work around it by overriding `core.hooksPath` (S283).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing**; for this shape also
read `.claude/maps/error.map.md` (diagnostics) and `.claude/maps/structure.map.md`.

Map stamp `0dd659a1`; your base `56473410` (**17 commits ahead of the stamp**).
**PA currency check PERFORMED and MEASURED — do not re-derive:**
`git diff --name-only 0dd659a1..56473410 -- compiler/src` returns nine files:
`ast-builder.js` · `codegen/emit-expr.ts` · `codegen/emit-server.ts` · `codegen/rewrite.ts` ·
`commands/dev.js` · `default-logic-exemption.ts` · `lint-e-state-block-statement-form.js` ·
`runtime-template.js` · `symbol-table.ts`.
⚑ **`compiler/src/type-system.ts` — the primary file for this arc — has NOT moved since the map
stamp** (`git log 0dd659a1..HEAD -- compiler/src/type-system.ts` is empty). So the maps are current
for your main surface. Treat map content as a verify-against-source hypothesis anyway, and **report
whether it was load-bearing — "not load-bearing" is a real answer** and the PA wants it.

---

# RULE 4 — THE GOVERNING SENTENCE (already run by the PA; quoted so you do not re-derive it)

`compiler/SPEC.md` is the single normative source. **The governing-sentence gate returned OUTCOME 1.**

`compiler/SPEC.md:2081` (§6.1.2), verbatim:

> **Read:** `@varname` evaluates to the cell's current value. A structural `<varname>` declaration
> (§6.1.1) — or an equivalently-resolved cell: an `<each>`/`<tableFor>` loop local, an engine state
> cell (§51.0.C / §51.0.H), **a CE-inlined cross-file channel cell (§38.12)**, or an import binding —
> SHALL be in scope; otherwise the read is **`E-STATE-UNDECLARED`**.

**That sentence names this exact shape.** So the fix is **newly-accepting TOWARD THE CONTRACT** —
conformance restoration, which base §8 admits as a bug fix. It is NOT a widening and does NOT need a
ruling. Do not re-open that question.

Corroboration, and it indicts a normative row you may want to correct — §34's `E-STATE-UNDECLARED`
row at `compiler/SPEC.md:19725` asserts TS was chosen as the fire layer **precisely because** it can
see this shape:

> "SYM is the WRONG LAYER (it over-fires on `@`-names materialised POST-SYM — … **cross-FILE channel
> cells inlined by CE §38.12**). TS resolves ALL of these directly: **the cross-file channel cell
> flows through CE inlining into TS's scopeChain** (the SYM-stage Class-B channel-body scan is
> RETIRED — TS reaches the inlined channel decl directly)"

It demonstrably does not, inside a match arm. **If your root cause confirms that the row's claim is
false as written, say so in your report** — but do NOT edit `SPEC.md` in this dispatch (see MUST NOT
TOUCH). The PA owns that correction.

---

# THE DEFECTS

## Defect 1 (the fix) — the over-fire

An imported channel cell, read via `${…}` **inside a `<match>` arm**, is reported undeclared.

**PA-REPRODUCED BY EXECUTION on `56473410`.** Two files, self-contained. Reproducer files are in
this brief's directory as `repro/chan.scrml` and `repro/a.scrml`; inlined here so they cannot drift:

`chan.scrml`:
```
export <channel name="probe">
    ${
        <items> = []
        <stamp> = ""
        export function beat(n) {
            @stamp = `tick ${n}`
        }
    }
</>
```

`a.scrml`:
```
<program>
    ${
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p class="a">loading</p></>
        <Ready>
            <probeChan/>
            <p>${@stamp}</p>
            <each in=@items as i key=i.id><li>${i.id}</li></each>
        </>
    </>
</program>
```

Command and observed result on `56473410`:
```
bun compiler/bin/scrml.js compile <dir>/a.scrml --output-dir <tmp>
→ error [E-STATE-UNDECLARED]: bare `@stamp` read with no reactive cell in scope. …
  stage: TS
  FAILED — 1 error, 3 warnings
```

**The variant matrix — PA-RE-RUN on `56473410`, not relayed from the adopter.** Each row is one
compile, same two files, one variable changed:

| # | variant | result on `56473410` | who verified |
|---|---|---|---|
| A | `${@stamp}` inside the `<match>` arm, channel mounted | **ERROR** | PA, by execution |
| B | same, mount `<probeChan/>` removed | **ERROR** — mount is irrelevant | adopter (PA did not re-run) |
| C | `${@stamp}` in a `<div>` **outside** the match | **CLEAN** | **PA, by execution** |
| D | only `<each in=@items>` in the arm, no `${…}` read | **CLEAN** | adopter (PA did not re-run) |
| E | a same-file local cell `${@localCell}` inside the arm | **CLEAN** | adopter (PA did not re-run) |
| F | `${@stamp}` inside an `<each>` body, no match | **CLEAN** | **PA, by execution** |

⚑ Rows B, D, E are **RELAYED-UNVERIFIED** — the adopter ran them, the PA did not. Re-run them
yourself before you rest any design decision on them.

**Failing conjunction:** cross-file (CE-inlined channel) cell · `${…}` interpolation position ·
inside a `<match>` arm. It is **not** nested scopes generally (row F is clean).

## Defect 2 (fix it in the same arc) — the diagnostic carries no source location

The `E-STATE-UNDECLARED` output above has **no `-->` line and no `(line N, col N)`** — only
`stage: TS`. Every other diagnostic in the same run carries both. **PA-CONFIRMED by reading the same
compile output.** For the adopter this was not cosmetic: localising three errors in a real 3,700-line
file cost them manual line-by-line bisection.

⚑ **This is NOT a forgotten argument.** PA-verified by reading the source: the fire site at
`compiler/src/type-system.ts:7830` DOES pass a `span` to `new TSError(code, message, span)`, and
`TSError` (`:1034`) does accept and store it. So the span is being passed and is evidently empty /
zero / spanless **at this walk path**. Find out why.

---

# THE PA'S HYPOTHESIS — LABELLED, AND NOT TRACED

**⚑ PA-LOCATED-VERIFY. The PA can name the fire site but CANNOT state the path from entry point to
the scope-chain construction for a match-arm body. Do not let this anchor your search.**

**Verified by the PA (grep + reading, trust these):**
- The fire site is `compiler/src/type-system.ts:7830`, inside the S192 read-side walker.
- Resolution is a single `scopeChain.lookup(...)` at ~`:7823-7825`: it tries the sigil form
  (`@stamp`) then the bare form (`stamp`), and fires if **both** miss.
- `TSError` accepts a `span` and the call site passes one.

**NOT verified — this is the hypothesis:** both defects share one root cause — **a `<match>` arm body
is walked in a context that carries neither the parent scope chain (so the CE-inlined channel cells
are absent → defect 1) nor a real span (so the diagnostic is location-less → defect 2).** If one
walk-site fix makes both symptoms disappear together, that is the hypothesis confirming. If they turn
out to be independent, **say so** — a corrected root cause is a more valuable report than a confirmed
guess, and the standing invitation to contradict this brief is real.

There is a related-looking comment at `type-system.ts:12931-12939` about the match-block node and the
read-side walker. **The PA did not trace it and does not know if it is relevant.** Check it, and
report whether it was a useful pointer or a red herring.

**Report explicitly in `progress.md` and in your final report: did the PA's locus hypothesis HOLD, get
REFINED, or was it WRONG?** That answer feeds the nav-maps.

## On bisecting

The adopter reports this WAS green and regressed inside a wide window (their last-green source commit
is dated 2026-07-17). **Root-cause by READING first.** The fire site is already narrowed to one
walker and you have a six-row variant matrix. Reach for `git bisect` **only if** reading has not
produced the cause after a genuine attempt — and if you do bisect, the repro above is a clean
deterministic predicate for it. Do not open with a 100-commit bisect.

---

# WHAT IS OUT OF SCOPE — do not fix, do not "improve on the way past"

**Observation 3 — `each in=` reads are never checked.** `<each in=@totallyUndeclaredName>` with no
declaration anywhere compiles **CLEAN** (PA-REPRODUCED by execution on `56473410`, variant G).

**Leave it alone.** It is a false NEGATIVE in the same predicate, and closing it is
**newly-REJECTING** — a different direction-of-change class that owes a **measured corpus migration**
over ~2,365 files and is a ruling for the operator, not a fix you can scope. It is being surfaced to
bryan separately.

⚑ **If your fix to defect 1 incidentally causes `each in=` reads to start being checked, STOP and
report before going further.** That would turn a conformance restoration into an unmeasured
newly-rejecting change, which is exactly the class base §8 says must not ship as a bug fix.

# MUST NOT TOUCH
- `compiler/SPEC.md` — the PA owns the §34 row correction.
- `docs/known-gaps.md`, `docs/pr-reviews.md`, `hand-off.md`, `master-list.md`, `docs/changelog.md`,
  `handOffs/` — PA-owned shared docs, live-edited this session.
- The `each in=` check surface (above).

---

# PHASES

**Phase 0 — baseline.** F4 startup. Reproduce defect 1 and defect 2 yourself from the files above,
on your own base, before changing anything. Record the verbatim output in `progress.md`. Re-run
matrix rows B, D, E (the relayed-unverified ones). Commit.

**Phase 1 — root cause.** Find why the scope chain misses at this locus. Write the mechanism in
`progress.md` in prose — *how execution reaches the failing lookup* — before writing any fix. State
whether the PA hypothesis held / was refined / was wrong. Commit.

**Phase 2 — the fix.** Fix defect 1 and defect 2. If they have one root, one fix; if two, two, and
say so. Land tests **in the same commit** as the code they pin (coupled code+test is one logical
unit). Add a regression test built from the reproducer above.

**Phase 3 — EMPIRICAL VERIFICATION (R26). Do NOT mark DONE without this.**
1. Recompile the reproducer: `a.scrml` MUST compile clean, exit 0.
2. Symptom-specific check, **not "tests pass"**: grep the compile output for `E-STATE-UNDECLARED` —
   it MUST be absent for `a.scrml`, and the diagnostic MUST carry a `-->` + line/col when it fires
   legitimately (construct a genuine `@typoCell` case and confirm the location IS present).
3. Re-run the FULL variant matrix A–F; A must flip to clean, C/D/E/F must STAY clean.
4. Run variant G (`<each in=@totallyUndeclaredName>`) — it must STILL compile clean. If it now
   errors, you have changed the out-of-scope surface: **STOP and report.**
5. Recompile real adopter sources on the post-fix baseline:
   `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` plus a sweep of `examples/`.
   Report any file whose diagnostic set CHANGED, in either direction.
6. Full suite: `bun run test`. Zero regressions.

**Phase 4 — direction-of-change report.** State explicitly, per base §8: which files in the corpus
changed diagnostics, and in which direction (inert / newly-rejecting / newly-accepting /
semantics-changed). **Assumed-zero is not measured-zero** — measure it.

# REPORTING — what the PA needs back
- `WORKTREE_PATH`, final branch SHA, files-touched list, `git status` clean confirmation.
- Root cause in prose, with the execution path.
- **Did the PA's locus hypothesis hold, get refined, or was it wrong?**
- Were the maps load-bearing? ("no" is a real answer.)
- Phase 3 empirical results, per numbered step.
- Phase 4 direction-of-change table.
- Anything you found and did NOT fix, with why.

**A NOTE ON THIS BRIEF'S CLAIMS.** Rows B/D/E of the matrix are relayed from the adopter and marked
unverified. The locus hypothesis is explicitly untraced. If measurement contradicts anything written
here, **measurement wins and the PA wants to hear it** — two premises in a recent session were
falsified by the agent, and that was the dispatch working correctly, not failing.
