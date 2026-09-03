# scrml — Session 396 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-09-02. Booted `/boot` Profile A. Reconciled off a superseded wrap branch up to true HEAD
`8f3c5b74` (#819, S395-bryan). A **dog-food + adopter-ops** session: no compiler `src` touched. Two
landings — the aM pin bumped to HEAD, and a real scrml gate hole surfaced dog-fooding flogenceP,
root-caused end-to-end and routed to bryan. Third time this epoch the *instrument* was the bug, not the
subject — caught by re-running on a clean referent, not by reasoning.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**S396-peter is CLOSED and nothing peter-owed is in flight.** The aM pin is bumped; the flogenceP find
is filed + routed. The queue below is **bryan's** (rulings + the if-chain class) — reconciled against
S395, which landed while the S393 PICKUP sat un-rewritten. Absorb delta-log **[2026]–[2036]** for the
full S395+S396 detail; this block names only the still-actionable.

### 1. ⚑ S396-peter — aM pin BUMPED, and a flogenceP gate hole FILED + ROUTED (both done)
- **aM pin bumped `f4ec0400` (#746) → HEAD `8f3c5b74`.** `scrml-pinned`'s `app-pinned` branch
  fast-forwarded; `run.cmd`/`serve.cmd` unchanged (they point at scrml-pinned, which now IS HEAD).
  Re-verify was green: aM compiles clean on HEAD (203 routes, validate-emit), emit **semantically
  identical** to the old pin, deterministic. ⚑ A first-compile "silent drop of the Readings-to-review
  section" was a **read-during-write of `portal.scrml`** (mtime == the compile), NOT a codegen bug —
  dissolved by re-run, not filed. Reversible via reflog to `f4ec0400`. See [[assetmanagement-pin-blocked-off-head-by-region-track]].
- **`g-route-004-untyped-fn-param-escapes-serializability-gate` (MED, FILED, ROUTED to bryan).**
  E-ROUTE-004 (`type-system.ts:4734`) `continue`s on un-annotated params, so a server-boundary fn with
  an untyped-but-CALLED function param is routed as a silent dead-500 endpoint. PA-reproduced on
  flogenceP (`runGatedAgentic`) + a two-sided minimal repro (typed → E-ROUTE-004; untyped → exit-0 dead
  route, POST→500). Route note: `handOffs/incoming/2026-09-02-from-peter-to-bryan-e-route-004-untyped-fn-param-hole.md`.
  **Needs bryan** — the `continue` is deliberate (asIs hatch); the fix is a normative fork (usage-based
  signal / require annotation / warn). His lane owns E-ROUTE-004 + route-inference.

### 2. ⚑ RULINGS OWED — bryan's (reconciled against S395; delta-log carries the corrected premises)
- **Carried, unchanged:** `dpa-037` (NaN — *"not ratifying NaN! TBC"*) · the `@`-sigil normative line ·
  4(b) condition 3.
- **Carried, premises corrected in S393 (re-read before ruling):** `g-dev-root-path-fallback` (defect is
  an extra ungated branch AFTER the `/`→`/index.html` fold, not "teach dev to route `/`") ·
  `g-conformance-runanchored` (limb (a) prediction FALSIFIED — RED 0 · ok 15; limb (c) is the cheap
  answer) · `g-tracking-job-red-on-main` (#800 fixed the guard; open because the not-a-required-check
  mechanism is unchanged).
- **From the S395 arcs (NEW owed):** `g-if-chain-all-arms-run-at-module-init` (MED) — rule whether a
  markup `${}` body is FILE-SCOPE or BRANCH-SCOPED; [2032] says this is the SAME question as
  `g-same-named-branch-declarations` (MED) — **rule once**. · `g-bare-expr-in-if-arm-rebinds-tilde…`
  (HIGH, [2028]) — candidate governing sentence §17.6.2, PA-read not ruled.
- **RESOLVED by S395 — do NOT re-carry:** the "inverted ruling" ([2026], bryan ruled *"seems ok not to
  have a trailing else"*, direction stands — it was the PA's own mis-description) · `g-value-form-sugar-in-bound-position-emits-null` (#815).
- **Banked, ready to fire:** `dpa-038` (#509 offline/PWA) · `dpa-039` (#471 enterprise doc workflows).

### 3. ⚑ THE if-CHAIN CLASS — still open (bryan's), minus what S395 closed
- **CLOSED #818:** `g-collect-functions-branch-decl-vs-server-boundary-routing` (the security-gated one,
  in the mandated order — routing walk first, then collect; the obvious one-walk fix was the leak).
- **Still open:** `g-timer-in-if-chain-branch-never-starts` (MED, relayed) · ~25 further
  `symbol-table.ts` walks + 4 further `collect.ts` walks (unmeasured; `collectMarkupNodes` double-emit
  risk) · `reactive-deps.ts` 2 of 15 blind · **the native-parser mirror never inspected for this class**.
- **NEW from the #818 arc ([2032]):** `g-call-expression-interpolation-in-if-chain-branch-renders-empty`
  (MED, an ORDERING defect — `_scrml_boot` renders before `_scrml_nav_rewire` inserts the branch) ·
  `g-types-check-baseline-never-refreshed-for-ast-if-chain` (LOW, RELAYED — `tsc` absent from checkout).

### 4. In flight / held
- **Nothing in flight.** No dispatches out; no peter worktrees.
- `handOffs/incoming/` holds the **FSP `Initialize`** deliberation (peter→bryan) — still **bryan's
  ruling** (dPA-produced, awaiting his ratify/reject); and my route note to bryan (item 1). The FSP one
  is deliberately not archived — it is his.
- **Maps STALE** but were refreshed at S395 (#817, `ad7b65dc`); no code landed this session, so maps
  **unchanged** and current-enough. Pre-existing agent worktrees (`agent-a0742…`, `agent-a4e6b5…`,
  `onmount-c`) retained — NOT this session's, status unconfirmed; do not sweep on `worktree-sweep.ts`
  rows (it mis-classifies, per [2020]).

---

## 🔭 WHAT LANDED (S396-peter)

- **aM pin bumped to HEAD**, re-verified green (203 routes, validate-emit, deterministic, emit
  semantically identical to the old pin). Verified through the real `scrml-pinned` invocation path.
- **`g-route-004-…` filed** (`docs/known-gaps.md`, MED open) + counts regenerated (`state.ts`: MED
  203→204) + **routed to bryan** with the exact locus, the flogenceP manifestation, the two-sided
  minimal repro, and the normative fork.
- **flogenceP dog-fooded on HEAD** — compiles clean (21 files, 94 routes, 1 WS channel, validate-emit),
  boots clean (server + MCP 11 tools); all 92 server-fns swept — every 500 triaged to app-level
  (empty-args / schema-init-order), ZERO codegen-signature errors (no ReferenceError/SyntaxError). HEAD
  codegen is faithful to flogenceP's real program; the one scrml-relevant find is item 1.
- **`~/.claude/settings.json` `blockReadsOutsideWorkingDirectories` → false** (Peter's ask; needs a
  restart / `/add-dir` to take effect — read at startup). I am BLOCKED from self-editing the permission
  config (auto-mode classifier) — dir-adds and permission fixes are Peter's own `/add-dir` / `/permissions`.

## ⚑ MISSES / LESSONS (mine)

1. **★★ The read-during-write phantom.** My first aM HEAD compile dropped a whole portal section at
   exit 0; I nearly filed a HIGH if-chain-class regression. It did NOT reproduce — six clean compiles
   had the section, and `portal.scrml`'s mtime pinned the contamination. Caught by re-running on a static
   source, not by reasoning. Third instance this epoch of *the instrument, not the subject*.
2. **★ I stopped short before routing — Peter had to push.** I invoked "bryan's lane" to avoid reading
   route-inference/type-system, when READING for diagnosis is not EDITING (his lane concern). After the
   push I root-caused to the exact line + built a runtime-confirmed two-sided minimal repro. The
   hypothesis was right, but I should have proven it before offering to route. ([[be-the-authority-root-cause-dont-hand-wave]].)

## 🧷 STATE
- **main `8f3c5b74`** at boot; this wrap adds docs only (known-gaps + route note + continuity). Counts:
  **HIGH 76 · MED 204 · LOW 87 · Nominal 7** (post-filing; `state.ts`-generated).
- **No compiler `src` changed** — no FACTS/state code regen owed; the code gate is untriggered. The
  session's real gate was the dog-food compiles (aM + flogenceP, all green) + `state.ts` regen (clean).
- **Mechanical stream:** delta-log `[2033]`–`[2036]`. Do not re-derive from here.
