<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S343-bryan:      -->
<!-- prior wrap handOffs/hand-off-s338-bryan.md (S338-bryan).      -->
<!-- ⚠ S341-bryan and S342-bryan BOTH DIED WITHOUT WRAPPING.       -->
<!-- Their state was RECOVERED this session — see §RECOVERY.       -->
<!-- Mechanical stream: handOffs/delta-log.md.                     -->
<!-- ============================================================= -->

# scrml — Session 343 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-13. `/boot` Profile A. **Zero PRs merged — deliberately.** The operator's
direction was *"those six were not landed for a reason … we need to make sure that we have all the
critical info before moving on"*, and at close: *"lets hold any decissions for next session."*
This session is a **recovery and verification** session, not a landing one.

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**S344-peter UPDATE (2026-08-13) — the review floor is DRAINED; bryan's four owed items below are UNTOUCHED and still stand.** S344 was an orthogonal review-floor session: the 13-deep floor (#507–#522) is now at **0 OWED** (PR #523, gate green → merged; docs-only). It touched no compiler code and none of bryan's held arcs. Three findings, all pre-existing, filed as gaps — **two of them are open MED and are the only new actionable items this session added:**
- `g-source-text-regex-census-crossos-separator-misclassifies-preast` (MED, `scripts/source-text-regex-census.ts:65`) — bryan's census instrument reports an OS-dependent number on Windows; **one-line fix, routed to bryan's inbox** (`handOffs/incoming/`), his instrument.
- `g-request-ref-in-lift-event-handler-attr-misroute` (MED, `emit-lift.js:1684`) — the one attr-value site the #511/#512 reparse patch missed; whole-compiler, reproduces at top-level.
- #508 was found to have shipped two HIGH silent-miscompiles its landing review missed — **already remediated by #515/#516**, no action needed.

Everything below is bryan's S343 handshake, carried forward verbatim — **still the substantive next-session agenda.**

---

**Nothing is blocked on machinery. Four things are blocked on bryan.** Every arc is now audited,
every reason-not-landed is written down, and the one arc that was ready has had its blocker found,
fixed and measured. Read `../scrml-support/handOffs/s342-arc-audit/` — six per-arc forensic reports
plus three reproduction records. Do not re-derive them.

### Owed by bryan (hold-for-next-session, his words)

1. **Gap 5 — the lambda-param shadow, and it is a SEQUENCING trap.** On `main` today §6.6.19 says
   *"A name bound **inside** the RHS shadows the import and SHALL NOT fire"* — normatively mandating
   lexical scoping the compiler does not implement. The derived-transitive arc's F3 fix **rewrites
   that sentence** to bless the over-fire (*"A LAMBDA PARAMETER DOES NOT SHADOW, AND THEREFORE
   FIRES"*). Landing the arc therefore converts a future **conformance-restoration bug fix** into a
   **widening needing R2**, purely by changing the sentence that classifies it. PA recommended **(c)**:
   land as ruled, but record the rewrite as *descriptive of current impl, not a ratification*, and
   queue lexical scoping citing main's pre-arc sentence as governing.
2. **The 18+ unfiled known-gaps entries** (several HIGH). Not at risk of loss — the branches are on
   origin and bundled — but the ledger currently asserts one of these classes is CLOSED while a
   silent whole-bundle-killing defect is live in 13 measured positions.
3. **The five zero-byte git objects** — delete or leave. Nothing is blocked by them.
4. **The merge call on derived-transitive** once (1) is settled — it is otherwise ready.

### Do NOT do these (each would repeat a measured mistake)

- **Do not start g-263.** It is a **PA-verified DO-NOT-LAND** — three §14.8 confidentiality
  regressions at exit 0, NEW on the branch. Its blocking reason is **not written on the branch**;
  its own artifacts read as a clean bill, and the dead S342 board file puts a six-step *"LANDING PLAN
  — execute this"* ABOVE the DO-NOT-LAND section. Anyone reading only the branch re-attempts it.
- **Do not land derived-transitive from tag `review/derived-transitive`** — it points at `259ac285`,
  **round 1**, four commits behind. Use `review/derived-transitive-r2` (`bdee6c2c`) or the current
  tip. Same stale-ref shape as g-263's `fix/g263-seed-convergence-land` @ `8ad13b84`, which is not
  an ancestor of origin/main.
- **Do not enumerate a population through `head`/`tail`.** See §BOOT DEFECT.

## 🔧 THE ARC THAT MOVED — derived transitive reach (§6.6.19)

**F2 RULED by bryan** (user-voice S343, *"your rec"*): land the transitive refusal as built; take the
placement fix (extending `#284 FIX B` so a derived-read reference vetoes server promotion) as its own
later arc. Reasoning banked verbatim. The asymmetry that decided it: holding the arc hostage to F2
keeps **four silent wrong-render defects shipped** to avoid **one loud over-fire measured at zero**.

**Then the S239 re-review returned DO-NOT-LAND on a NEW blocker, and it was real.** PA-reproduced
rather than relayed:

| reproducer | where the name occurs | main `3ebaa01e` | arc `bdee6c2c` |
|---|---|---|---|
| `@nums.map(v => { return "status " + v })` | **string literal only** | exit 0 | **refused** |
| `@rows.map(r => { return r.status })` | **member property** | exit 0 | **refused** |

Rule 7 again — a raw-text word-boundary scan answering a question the tree already held — inside an
arc built in the session Rule 7 was ruled. It also violated two `SHALL`s the same commit writes into
§6.6.19.

**Fix round 3 is DONE and verified** (branch `worktree-agent-a17073292e367092e`, tip `896fc7f0`):

| check | result |
|---|---|
| both F1 reproducers | **exit 0** — blocker closed |
| genuine reach still refused | **exit 1**, exactly 1 diagnostic |
| new pins bite on the pre-fix tree | **7 of 94 fail** at `bdee6c2c`; 94/94 pass fixed |
| contract gate (unit+integration+conformance) | **22,347 pass / 0 fail**, 1,219 files, 349s |
| full-suite failing name-set | 48 names, all the known happy-dom class, **none in the changed subsystem** |
| direction-of-change, 923 corpus files, both trees | **INERT** — 0 newly-rejected, 0 newly-accepted, 0 diag delta, 923/923 identical |

**The agent's own best find:** auditing its fix, it caught that `parseExpression` returns a
**truncated** tree with trailing content, so `parseExpression(raw).ast ?? parseStatements(raw).ast`
took the partial tree and never tried the statement parse — *"a SILENT, ARBITRARY miss … worse than
the deliberate decline, because nothing distinguishes it from a clean scan."*

**Direction-of-change is TWO directions and they classify differently.** `77256fe9` refuses LESS →
newly-accepting but **toward the contract** (§6.6.19's own sentences govern → a bug fix, not a
widening). `896fc7f0` finds MORE names → newly-**rejecting**; measured at zero over 923 files rather
than assumed. ⚠ **Power stated honestly:** both triggers are a NAME COINCIDENCE no corpus file
contains — which is exactly why F1 shipped past round 2's own zero over 2362 sources. The honest
claim is *"zero among sources that exist"*, not *"zero risk"*. A minting battery would raise it.

## 🚑 RECOVERY — two dirty shutdowns, reconstructed from the board

**S341-bryan never wrapped. S342-bryan booted as its successor and DIED 2026-08-13 ~06:10** — no
wrap, no hand-off, no delta-log entry. `S342-bryan.md` is a full crash anchor and is ACCURATE; S343
independently verified its corruption and salvage claims. It is now marked `DEAD-NO-WRAP`.

**Repo damage (scrml only; scrml-support clean): five ZERO-BYTE objects**, all orphans —
`rev-list --objects --all` hits 0 for each. `HEAD` tree, `main` history and all refs verify readable.
**No committed work lost.** The only structural reference is in the cache-tree of a dead worktree's
index, which is what made `git stash create` fail there.

**Two uncommitted work-sets found — both fix rounds for HIGHs live on main:**

| worktree | work | state when found |
|---|---|---|
| `ab0480c75e2b5c45f` | each-request-ref (**#511-family HIGH**) | 2 WIP commits + 4 codegen files staged |
| `abad4d4f374bc280d` | `commands/dev.js` (**#518 fail-open HIGH**) | **419 lines staged, ZERO commits** |

Preserved non-destructively (worktrees untouched): tags `salvage/s342-ab0480c75e2b5c45f` (stash-commit
`bb1376d7`) and `salvage/s342-each-request-ref` (`37ddc660`, which is what keeps the dead session's
`BRIEF.md` + **21-position matrix** alive if the branch is deleted), plus file copies at
`scrml-support/salvage/s342-dead-session-2026-08-13/` and a 492K thin bundle of **17 refs**.

⚠ **A claim I made and had to retract:** I reported *"four of six arc branches were local-only"*. False
— **five of six are on the server**. My probe was `git ls-remote --heads origin <ref> | wc -l` against
the SSH remote while SSH auth was failing intermittently; a failed `ls-remote` prints nothing, so
`wc -l` returned 0, indistinguishable from "absent". **Two forensic subagents made the identical error
from the same cause.** Genuinely local-only: **all six `review/*` tags** and the `each-request-ref`
branch. Corrected in the salvage README.

## ⚠ BOOT DEFECT — the truncated probe, and it nearly cost the whole anchor

I listed `handOffs/active-sessions/` through `head -20`. The directory holds **111 files**; the probe
returned 17, all from July, and I committed the false claim *"board registration had LAPSED"*.
`S342-bryan.md` was sitting there, `status: LIVE`. On that truncated read I proposed starting g-263 —
straight into three confidentiality regressions.

**Third member of this family in two sessions**, all "a probe returns nothing and it reads as success":
S342 recorded `$?` from a pipeline reading as a clean exit; this boot's `head -20`; and mid-session I
ran `bun --cwd <path> run test` (needs `--cwd=<path>`) which printed help and **exited 0** — my
name-set diff then reported "0 failing names" from a suite that never ran. The tell was in the log:
START and END stamped the same second.

**Standing fix, now in memory** (`feedback_enumerate_boot_populations_untruncated`): enumerate with
bare `ls -1` + `wc -l`, report `N of M`, and put a DURATION guard on any long job. Also: **the shell
is zsh, which does not word-split unquoted variables** — `cmd $REFS` passes one argument.

## 🤖 AGENT STALLS — three this session, and what saved every one

The differential-harness audit, the g-263 audit, and the derived-transitive fix agent all stalled
(`no progress for 600s`) — one of them **twice**, and `ListAgents` reported `running` for 48 minutes
after the process was gone. **Every one had banked committed work first**, because the briefs
mandated write-early / commit-after-each-edit. Nothing was lost. Two were resumed successfully via
`SendMessage` and did more good work after resuming; the third was taken over PA-direct.

**Keep the brief clauses that did this**: write the deliverable file EARLY and append as you go;
commit after every meaningful edit, WIP commits expected; never `--no-verify`.

## 🚨 LIVE ON MAIN — unfixed (carried, verified by the dead session, unchanged)

1. **#511 family (HIGH, SILENT)** — a Tier-1 `<each>` nested in a Tier-0 lift body mis-routes a
   per-item attr request-ref to the §36 input-state registry; the runtime defines it **0** times →
   hard `ReferenceError` at mount, killing the WHOLE client. 13 of 21 positions measured silently
   broken. Fix round exists, uncommitted-then-preserved. **The ledger currently asserts this class is
   CLOSED** (two sibling gaps `status=resolved`).
2. **#518 (HIGH, fail-open)** — an uncaught compiler internal error leaves `compileFailure` null, the
   short-circuit never fires, and dev serves the STALE bundle at **HTTP 200**. Fix round preserved.
3. **`emit-library.ts` does NO lowering** — structural `==` not lowered; a silent wrong ANSWER.
4. `resultExpr`-class raw string inside a parsed ExprNode; a derived cell reaching a server-escalated
   helper through a lambda (this last one is what the derived-transitive arc closes).

## 🧷 STATE / DEFERRED

- **Maps (6c): DEFERRED, third session.** Stamp `4f034e13`, HEAD `3ebaa01e` — only **6 commits**
  behind, but five arcs are about to move it. Refresh after they land, not before.
- **Worktrees retained (6b): ALL of them.** Six carry unlanded arcs; two carry the dead session's HIGH
  fix rounds. **Do not prune** — `salvage/s342-each-request-ref` is the only thing standing between a
  branch delete and the loss of the 21-position matrix.
- **`gh` push returned HTTP 500 for ~20 minutes mid-session** and SSH auth failed intermittently while
  reads and the API stayed healthy. Both cleared on retry. If pushes fail, retry over
  `git -c credential.helper='!gh auth git-credential' push https://…` before diagnosing anything else.
- **Open PR #501 (`tare`)** — unchanged, CONFLICTING, one red `gate` leg that is **real, not a flake**
  (a §34.0 census failure; the *passing* leg compared `HEAD~1` and passed vacuously). Held behind a
  chain: g-263 → symbol-table convergence → tare. `B3_EXPR_FIELDS` is still an 11-name list, so all
  four §6.8.4 checks silently skip markup handlers.
- **Review floor: 12 OWED**, unchanged — nothing merged this session.
