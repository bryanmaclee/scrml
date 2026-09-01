# scrml — Session 393 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-01. Booted `/boot` Profile A onto `adc61f15`. Boot cost **32.3%** (vs the S375
baseline of 43.0% — the tier-1 rotation and the §13.7 cut are holding). **SOLO**; S392-peter had
wrapped, his work sitting on then-open PR #805.

**The framing: this session was mostly VERIFICATION, and verification kept changing the answer.**
Nine reviews and two fix rounds produced findings — but the durable result is that **four separate
premises died on contact with execution**, two of them mine, and three of my own instruments
returned confident wrong answers. The landings matter less than that.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚑ RULINGS OWED — six carried, THREE NEW, and three carried ones had their premises move

**Carried from S391, unchanged:** dpa-037 (NaN — *"ok hold on I am not ratifying NaN! TBC"* still
stands) · the `@`-sigil normative line · 4(b) condition 3.

⚑ **THREE carried rulings now rest on CORRECTED premises — re-read before ruling:**
- **`g-dev-root-path-fallback…`** — the entry said *"dev has a separate root branch instead"*. FALSE.
  `dev.js:1027` does the SAME `/`→`/index.html` fold INTO the gated loop (that is why the
  `index.scrml` control 302s). The defect is an **ADDITIONAL ungated branch AFTER the loop**, so
  limb (b) is "delete the extra branch", not "teach dev to route `/`". Its stated multi-input caveat
  needs re-deriving on that basis.
- **`g-conformance-runanchored…`** — its prediction that limb (a) *"will turn some of the 18 RED"*
  is **FALSIFIED**. Running the real harness with `count` stripped: **RED 0 · ok 15**, bite-proven
  both directions. Limb (a) is a one-line fix with zero fallout; limb (c) is now the cheap answer.
- **`g-tracking-job-red-on-main…`** — said the guard repair was *"explicitly NOT fixed here"*. #800
  fixed it and the named test case no longer exists in `compiler/`. Corrected; gap stays open
  because the not-a-required-check mechanism is unchanged.

**NEW, all three yours:**
- ⚑⚑ **A RATIFIED LIMB OF YOUR S371 RULING WAS INVERTED.** You ratified *"else required on every
  path"*; #802 shipped `SHALL NOT require a trailing else` and flipped the predicate to match, on a
  dispatch BRIEF's authority. PA-verified on both trees: pre-802 `if (!alt) return false`, post-802
  `return true`, and `SPEC.md:12203`. The change fixes a real silent-wrong so it may be right on the
  merits — but it reversed your text without returning to you.
- **`g-if-chain-all-arms-run-at-module-init`** (MED, landed knowingly). Every arm's `${}` body now
  runs at module init, last writer wins; §17.1.1 forbids it. Landed because the property NEVER held —
  a LONE `if=` with a **false** condition still fires its body on untouched main. Closing it means
  ruling **whether a markup `${}` body is a FILE-SCOPE statement or a BRANCH-SCOPED one**, and the
  answer changes lone `if=` too. That is the ruling.
- **`g-value-form-sugar-in-bound-position-emits-null`** (HIGH). #802 put the §17.6.10 sugar on
  arm-body GENERALLY but the emitters implement it only in the interpolation-sole-content path, so a
  bound `const label = if (…) { "pos" } else { "neg" }` compiles exit 0 and `label` is ALWAYS null.

**Banked and ready to fire:** `dpa-038` (#509 offline/PWA) · `dpa-039` (#471 enterprise document
workflows). Both were named in this session's own boot report and had sat 21 and 24 days. Naming is
not banking.

### 2. ⚑ THE if-CHAIN CLASS IS THE SPINE OF THE SESSION AND IT IS NOT CLOSED

`collapseIfChains` rewrites an `if=`/`else` chain into `{kind:"if-chain", branches:[{condition,
element}], elseBranch}` — keys no hand-rolled walk recursed into, and `branches` holds RECORDS with
no `.kind`, so even a generic walk that lists it never reaches `element`. **#805 fixed six walks and
extracted `ast-if-chain.js`; #811 closed ten more.** Still open, all filed:

- **`g-collect-functions-branch-decl-vs-server-boundary-routing` (HIGH)** — the next one, and it is
  SECURITY-GATED. A branch-declared `function` is never defined while its call sites emit unmangled
  (`ReferenceError` at exit 0) — but closing that walk ALONE puts a `server fn` BODY into
  `client.js` with no `server.js`, because it feeds the client emitter while the server-boundary
  ROUTING walk is separately blind. **Close the routing walk FIRST, in the same arc.** A LEAK GUARD
  test ships and was proven to red on exactly that mistake.
- `g-timer-in-if-chain-branch-never-starts` (MED, lifecycle emitter, relayed-not-reproduced).
- ~25 further `symbol-table.ts` walks and 4 further `collect.ts` walks, unmeasured.
  `collectMarkupNodes` carries a double-emit risk. `reactive-deps.ts` still has 2 of 15 blind
  (`buildFunctionBodyRegistry`, `stampCompoundDeepSetTargets`) while its new header says
  "every collector".
- **The native-parser mirror was never inspected for this class.** Known drift hazard.

### 3. In flight / held

- **Nothing is in flight.** All dispatches landed; both agent worktrees swept clean.
- `handOffs/incoming/` holds ONE unread item: the **FSP `Initialize`** deliberation (peter → bryan).
  Deliberately not archived — it is yours.
- Maps are **STALE at `2ec2ce3a`** against HEAD `0f398b95` and wrap-6c was **NOT run** (context).
  Ten source files changed since the stamp. A dev dispatch must treat map claims as hypotheses.

### 4. S394-peter — aM pin READY TO BUMP (adopter-ops, no compiler work owed)

- **The `854a6a9b` scrml pin on `../assetManagement` can bump to HEAD.** S394 dog-fooded the real
  aM app on HEAD (`adc61f15`): compiles clean (`scrml build --validate-emit`, 200 routes, 0 errors),
  `_scrml_region_track` is defined + wired into `_scrml_nav_rewire` in emitted client JS, all routes
  SSR 200, client bootstraps clean, Home→Fleet→Home SPA soft-nav swaps cleanly (NO stacked-views
  regression), and Peter confirmed all 10 portal views. The functional pass the S382 note called the
  last de-risk is DONE. No scrml defect found. See [[assetmanagement-pin-blocked-off-head-by-region-track]].
- **Concrete action (peter-lane, whenever):** repoint `scrml-pinned` → HEAD (or a chosen SHA) and
  update `assetManagement/app/run.cmd` + `serve.cmd` `SCRML_BIN` from `...\scrml-pinned\...` to
  `...\scrml\...`. Peter's own S104 per-diem-mask WIP is uncommitted in the aM tree — leave it.
- Two ENV-only footnotes (pre-existing, NOT HEAD regressions, moot in prod HTTPS): native `?{}` bakes
  cwd-relative `sqlite:app.db` ignoring `SCRML_DB_PATH`; the `__Host-scrml_sid` cookie is flaky in a
  browser-extension tab on `http://localhost`. Neither is a scrml gap.

---

## 🔭 DURABLE FINDINGS

### A. ⭐⭐ Four premises died on contact with execution — two were mine
The dispatch brief's traced root (`symbol-table.ts`) was **secondary**; the real hole was
`type-system.ts`, whose `visitNode` had no case, so the ENTIRE chain subtree was unvisited. My second
locus (`symbol-table.ts:10642`) was a **comment** above a deliberately-TOTAL walk — routing it
through the helper would have NARROWED a correct site. Both caught only because the brief carried its
own verify-instruction. Peter's *"the mount is irrelevant"* was falsified by his own successor's
matrix; #803's *"it will turn some of the 18 RED"* turned zero.

### B. ⭐⭐ An agent walked into a server leak and backed out — that is the behaviour to keep
Closing `collectFunctions` emitted a `server fn` body into `client.js`. It ran a control to confirm
it had introduced the leak, reverted, filed it, and left a guard that reds if anyone repeats the
mistake. **Trading a loud `ReferenceError` for a silent server-code-in-client leak is strictly
worse** — the fail-loud/fail-silent axis, decided correctly without being asked.

### C. ⭐ The same axis decided a landing-ORDER question
Removing the false `E-STATE-UNDECLARED` was correct AND could not ship alone: it was the last
diagnostic in front of the uninitialised-cell hole, so alone it converted a loud failure into a
silent blank render. `reactive-deps.ts` (13 collectors) + `collect.ts` came into the same arc.
**`reactive-deps.ts` alone did NOT clear the bar** — it produced *subscribed reads of a cell that is
never created*, which looks like progress and ships the same blank.

### D. ⭐ A carve-out label can hide the most valuable content
Three PRs this session were `carve-out` by file surface and carried verification work as their
CONTENT. The label is right and the note is what matters.

---

## ⚑ MISSES (mine)

1. **★★ A gate poll reported `GATE PASS` off the PREVIOUS SHA's run.** `gh pr checks 805` returned a
   run whose `headSha` was the pre-push commit, minutes after I pushed. Merging on it would have
   claimed a green gate that never ran on the fix round. Discriminator: compare the run's `headSha`
   to what you pushed. Every later poll pins the SHA.
2. **★★ My first channel-mount reproducer was wrong** — a pure-channel file needs
   `export <channel …>`; without it the import never resolved and BOTH variants failed identically,
   which would have read as *"peter's matrix does not reproduce."* Fixed by reading a working corpus
   pair, not by reasoning harder.
3. **★ I nearly reported a live cross-repo delivery failure that does not exist.** The wrong-cased
   `6NZ/` stray still holds 9 message files; I checked each against the real `6nz/handOffs/` before
   claiming — **9 of 9 delivered.** S140 was recovered; the stray is dead duplicate weight.
4. **★ `tail -3` on a sorted `git ls-files` is not "the newest."** Caught mid-report while verifying
   the return leg had landed.
5. **★ I named the two adopter Direction issues in my own boot report and then did not act on them
   for most of the session** — the exact S346 failure, on issues already 21 and 24 days old.

**The pattern, and it is the session's real output:** three of my own instruments returned confident
wrong answers, and none was caught by remembering — each was caught by re-running with the referent
pinned. Recall is not the control; construction is.

---

## 🧷 STATE

- **main `0f398b95`**, 0/0 clean. **Seven PRs merged**: #805 #807 #808 #809 #810 #811 (+#806 pre-boot).
- **Gaps:** HIGH 77 · MED 200 · LOW 86 · Nominal 7. **13 new entries filed this session**, every one
  labelled PA-reproduced-by-execution or RELAYED-UNVERIFIED / INSPECTION-ONLY. **`pa-ruled` count: 1**
  (unchanged — the 4(b) class has not drifted).
- **Review floor:** drained 9→0, then 3→0. **Owed again for #809/#810/#811** — the #541 recursion.
- **Worktrees:** 102. Both this session's agents swept. ⚑ The S393-filed sweep HIGH means
  `worktree-sweep.ts` still mis-classifies: 2 of 2 SWEEPABLE rows are exclusion artifacts, one on a
  clean tree holding unlanded work. **Do not act on its rows.**
- **Mechanical stream:** delta-log `[2003]`–`[2016]` + this wrap's. Do not re-derive from here.
