# non-compliance.report.md
# project: scrml
# generated: 2026-08-06T06:17:17-06:00  commit: a3a34d80
# **SOURCE WALK IS AT `0d9d843d`; the stamp is `a3a34d80`, the true HEAD.** `a3a34d80` (the
# S322-bryan wrap continuity commit) landed WHILE this pass ran and is DOCS-ONLY — verified
# `git diff --name-only 0d9d843d..a3a34d80` = {docs/changelog.md, docs/pr-reviews.md, hand-off.md,
# handOffs/delta-log.md}, ZERO diff under compiler/ scripts/ stdlib/ package.json .github/. Every
# source claim below therefore holds at the stamp.
# scan mode: INCREMENTAL_UPDATE (S322/S324 map refresh over `15e5e070` -> `a3a34d80`, 23 commits,
#            TWO session-windows across two clones — S322-bryan on the ASUS + S322/S323/S324-peter
#            on Windows; session numbers collide across clones, disambiguated by name)

## Summary — this pass

Docs scanned (tracked `*.md`, excluding `archive/`, `handOffs/`, `node_modules/`, `.claude/`,
`spa-lists/`, `scratch/`): **120**. New/changed docs this window: **11** (`docs/changelog.md`,
`docs/FACTS.md`, `docs/known-gaps.md`, `docs/pr-reviews.md`, `hand-off.md`, `master-list.md`,
+5 under `docs/changes/`). **2 carried findings RESOLVED · 1 carried finding CORRECTED (it was
over-stated) · 1 NEW finding · 1 NEW uncertain item · the rest carried and re-verified.**

**The most important line in this report: `bun scripts/s34-census.ts` is NOT broken — it is broken on
WINDOWS.** It runs correctly on this Linux clone and the maps' unqualified "STILL BROKEN" claim, which
this map set carried for three passes, is wrong. See S320-N1 below.

Docs/specs/maps that do NOT match current code. Findings live here rather than being returned
inline, because inline findings go stale unread. **Every CARRIED finding below was re-executed at
this HEAD this pass — none is copied forward on trust.**

## RESOLVED this pass

### S313-N1 — RESOLVED. `<machine>`-removal doc drift is fixed.
PR #376 (`30eaaded`, landed 2026-08-02, same day as the finding) rewrote all four docs the S313 pass
flagged. Re-verified by grep at `b929b9c9`, not copied forward on trust:
- `docs/PA-SCRML-PRIMER.md` — now states `<machine>` is REMOVED (S305 ruled / S307 landed),
  `E-DEPRECATED-001` fires (Error), still PARSES per §63.5, and names the `bun scrml migrate`
  three-part rewrite. No remaining "deprecated but compiles" language.
- `compiler/PIPELINE.md` — still names `<machine>` at several sites, but as an EXPLICIT-REMOVED
  keyword-distinction fact ("`W-DEPRECATED-001` was RETIRED at S307 when `<machine>` was REMOVED"),
  not as a live deprecated alias.
- `compiler/SPEC-INDEX.md` (authored half) — the §51 pointer row now reads "`machine` NO LONGER
  COMPILES — the keyword was REMOVED before 1.0 (S307) and fires `E-DEPRECATED-001`… `W-DEPRECATED-
  001` is RETIRED."
- `docs/external-js.md` — both sites now carry an explicit "(`<machine>` was the old keyword; REMOVED
  at S307)" / "ported off the removed `<machine>` keyword at S307" annotation.

**Also resolved in the same PR, not separately filed at S313:** SPEC.md's `lint.deprecated-machine`
settings-table row is now struck with a retirement note (the setting was never wired — zero
references in `compiler/src/` even while the warning it suppressed was live).

## RESOLVED / CORRECTED this pass (S322/S324)

### S320-N1 — **CORRECTED, not carried. `scripts/s34-census.ts` is a WINDOWS-ONLY failure and the maps over-stated it as a tool-wide one.**
The carried finding said the §34 oracle "is STILL BROKEN" and instructed readers to fall back to a
manual table-column methodology. **Re-EXECUTED at this HEAD on this (Linux) clone rather than copied
forward, and it works.** Output:
`806 rows (§34 19030..19907, derived) · 1876 source files · 855 conformance cases`, buckets
`STRUCK 34 · PINNED 339 · IMPL-SITES 321 · DECLARED-AHEAD 14 · RUNTIME-SURFACED 3 · FALSE-CLAIM 95`,
dispositions `BUILD-ARC 62 / HOME-NO-SHALL 25 / ORPHAN-INDEX 0 / NOMINAL-HOME 8`.
**Reason the claim was wrong:** the defect is real but platform-scoped — `ROOT = join(dirname(new
URL(import.meta.url).pathname), "..")` (`scripts/s34-census.ts:49`) yields a leading-slash path
(`/C:/Users/...`) on Windows only; `scripts/facts.ts:31` uses the correct `fileURLToPath` pattern one
file over. **The CODE fix is still owed** (one-line, `fileURLToPath`), and the finding stays OPEN as a
tool defect — what is retracted is the maps' framing.
**Disposition:** fixed this pass in `error.map.md` and `primary.map.md` (both now say Windows-only and
tell a Linux/macOS reader to run the oracle FIRST). **This is a self-inflicted instance of the exact
class this report exists to catch:** a platform-specific observation propagated as a universal claim,
then carried on trust for three passes. It was caught only because this pass ran on a different clone.

### S320-N2 — RESOLVED. `docs/changes/onmount-c-build/BRIEF.md` is now TRACKED.
The prior pass flagged it as correctly-scoped-but-untracked so it would not be miscounted either way.
It landed in `#426` (S322-peter) with a `DONE-PROBE` and is now in `git ls-files`. Re-verified:
`git status --porcelain -uall` no longer lists it. No further action.

## RESOLVED in an earlier pass (S321), retained for the audit trail

### S320-N-MAPS — RESOLVED. The maps' own "PR #405 HELD, unmerged" claim was stale and is now corrected.
This is a finding about `.claude/maps/` itself, not a project doc — flagged here because the report's
scope is "current truth only" and a stale map is exactly the failure mode this report exists to catch.
At the `b929b9c9` stamp, `primary.map.md`, `dependencies.map.md`, `domain.map.md`, `error.map.md` and
`structure.map.md` all stated PR #405 (the CPS auto-await choke-point consolidation) was "HELD,
unmerged, pending bryan's ruling on the fix locus." **That was accurate at `b929b9c9` and became stale
the moment #405 merged** (`649d6fce`, after bryan's `go, your recs` delegation per `hand-off.md`'s S321
top block; reviewed clean at `bbd77bec`, #413) — three commits the maps-refresh cadence did not catch
before this pass, because no map refresh ran between `b929b9c9` and this pass. **Re-verified against
source, not copied forward:** `scheduling.ts`'s `injectPromiseAwait` is confirmed absent from the
current tree (`git diff b929b9c9..15e5e070 -- compiler/src/codegen/scheduling.ts` shows the function
deleted and replaced by `collectAwaitSites`/`applyAwaitSites`/`injectFnBodyServerCallAwaits`); three
open gaps the consolidation was expected to close (`g-given-block-server-call-no-autoawait`,
`g-hash87-member-read-await-misparen`, `g-ternary-init-server-call-await-misbind`) are confirmed
`status=resolved` in `docs/known-gaps.md` at this HEAD.
**Reason:** map-currency gap — the same root cause the S313-N4 successor gap
(`g-nav-maps-have-no-scheduled-refresh`) already names; this is a fresh data point, not a new class.
**Disposition:** fixed this pass in all five maps (header notes, invariant/routing-table rows, tags).
No further action.

## Carried from S320 pass — re-verified at this HEAD

### S320-N1. `scripts/s34-census.ts` is a broken TOOL, not a doc — but it breaks a claim this map
### set makes about itself. **RE-VERIFIED at `15e5e070`: still broken, not re-chased this window.**
`bun scripts/s34-census.ts` `ENOENT`s on this Windows clone. Root cause: `ROOT = join(dirname(new
URL(import.meta.url).pathname), "..")` (line 49) — `scripts/facts.ts` uses the correct
`fileURLToPath(import.meta.url)` pattern one file over (line 31), and this script does not. On
Windows, `new URL(...).pathname` yields a leading-slash path (`/C:/Users/...`), which `join()` then
mangles into a malformed leading-backslash absolute path (`\C:\Users\...`) that every subsequent
`readFileSync` call rejects. **This is the exact platform-path class the repo already documents and
gates elsewhere** — `isOutsideBase`/`distRelativeServerSpecifier`'s platform-`sep` discipline
(dependencies.map.md), `stripPagesPrefix`'s same rationale (domain.map.md's "Coordinate space"
section) — recurring in a script nobody put a Windows CI leg behind.
**Reason:** grep-mismatch / tooling defect — every claim in error.map.md and primary.map.md that
cites "`bun scripts/s34-census.ts` as the machine oracle" is currently unverifiable on this platform,
and this pass had to fall back to the manual table-column methodology to re-derive the §34 count.
**Suggested disposition:** UPDATE — swap `new URL(import.meta.url).pathname` for
`fileURLToPath(import.meta.url)`, one line, mirroring `facts.ts`. File a gap (`g-`-prefixed) if not
fixed same-session; the census's own documentation claims "in-repo and current by construction",
which is false on Windows until this lands.

### S320-N2. `docs/changes/onmount-c-build/BRIEF.md` — untracked, correctly-scoped as a live dispatch
### brief, NOT aspirational drift — flagged so it is not miscounted either way. **RE-VERIFIED at
### `15e5e070`: `git status --porcelain -uall` still shows it untracked, unchanged content.**
Untracked in git (`git status --porcelain` shows `?? docs/changes/onmount-c-build/`), sitting under
`docs/changes/` (the per-dispatch archive location, out-of-scope for content-mapping by the standing
convention this report already carries for that directory). Content-checked: it is a task brief for
**parked, unbuilt** work ("on-mount (c) build") — consistent with `hand-off.md`'s S317/S318 notes
that the worktree `.claude/worktrees/onmount-c` is RETAINED but merge-blocked (originally on bryan's
A79 fix, itself never landed across three sessions). It correctly describes itself as not-yet-built
and gates its own scope (STOP-AND-REPORT before building; explicit language-decision carve-outs).
**Reason:** uncertain — needs human review, but on the LOCATION/TRACKING axis only, not the content
axis. The content is compliant (an honest, gated, un-landed brief in the right place). What's unusual
is that it is UNTRACKED rather than committed — every sibling in `docs/changes/` this report has ever
listed is a tracked file.
**Suggested disposition:** no content action. **Operator decision owed:** should an active dispatch
brief for parked work be committed (so `git status` stays clean and the brief survives a `git clean`)
or is untracked-and-scratch the intended state for a not-yet-authorized build? Not a documentation
compliance question — a workflow-hygiene one, routed here only because the scan surfaced it.

### S313-N2 — RESOLVED. `examples/23-trucking-dispatch/README.md` now reads correctly.
Re-grepped at `b929b9c9`: line 34 now reads **"`<engine>` × 1 — driver HOS state machine"** with an
explicit parenthetical — *"(Read `<machine>` before S307; the keyword is REMOVED and no `.scrml` in
this tree uses it.)"* — which is both accurate AND forward-looking (a reader hitting an old link or
doc still finds the right frame). The mangled sed-contrast sentence is gone. Fixed by `#376`
(`30eaaded`), the same commit that resolved S313-N1.

### S313-N3 — RESOLVED (before this pass — S314 caught it, not S320). `g-ci-does-not-run-root-level-
### test-files` now carries a correction banner in place, not a rewrite.
Re-checked at `b929b9c9`: the gap entry (`docs/known-gaps.md`) now opens with **"⚠️ S314 CORRECTION —
THE BODY BELOW IS FALSE AND WAS DISPATCH-HAZARDOUS"**, states the same fact this report flagged (the
`gate` job has run the root-level files since S302), and re-severitizes MED → LOW. The stale body is
RETAINED below the correction (a deliberate pattern — see the route-region-teardown SCOPING.md
precedent this report already praises) rather than rewritten, so the historical claim and its
correction are both readable. **This was fixed in a DIFFERENT session (S314) than the one that filed
it (S313) and before this pass (S320) — recorded here so the resolution is not lost to a future
incremental pass that never re-reads S313's original text.**

### S313-N4 — RESOLVED (before this pass — S314). `g-cloud-maps-ci-red-api-rejection` is closed and
### superseded exactly as recommended.
Re-checked: the entry now reads `RESOLVED S297 (bryan)` at its own line, and a NEW successor gap
`g-nav-maps-have-no-scheduled-refresh` ("NEW S314-bryan (successor to
g-cloud-maps-ci-red-api-rejection, resolved-by-removal)") carries the actually-live concern. **This
is precisely the disposition S313-N4 recommended** ("CLOSE as non-gap / resolved-by-removal, and file
the successor"). The successor gap's own framing ("staleness is silent and has already mis-routed a
dispatch") is now four windows of evidence deep — this pass is the fourth.

### S313-N5. `scripts/git-hooks/pre-push` — STILL STALE (re-verified this pass; `scripts/git-hooks/`
### is not in this window's 18-file changed-file set)
The comment block at `:75-76` still says the browser NAME-SET check *"runs in CI \`tracking\` today"*
and that promoting it to the blocking gate *"is bryan's to make — NOT taken unilaterally"* — both
true when written, both stale since bryan ruled promote (S313, `df41ea97`/`16783d6d`) and `ci.yml`'s
`gate` has run it every window since. **Reason:** intra-window supersession, harmless but
self-contradicting, carried three passes now with no fix.
**Suggested disposition:** unchanged — update the comment to record the promotion. Low cost, low
urgency (the hook's SCOPE is unaffected, only its narration is wrong), which is presumably why it has
gone three passes without anyone picking it up — naming that pattern explicitly in case it is a
signal that LOW-severity doc-only findings in this report are systematically not being drained.

### S313-N6 — RESOLVED. `runtime-template.js`'s `_scrml_teardown_region` comment now states the
### narrow truth, not the over-broad one.
Re-checked at `b929b9c9`: PR `#379` (`f6a7e078`, "the leave edge alone is a REGRESSION — measured,
reverted, and Edge 2 is a scoping decision") rewrote the comment block above `_scrml_teardown_region`
to name BOTH producers precisely (`_scrml_region_track`'s `closest("[data-scrml-outlet]")` display
effects, and codegen's `_outletResident` lexical-inside-`<outlet>` branch), state the "timers" clause
is TRUE but NARROW, and name the exact gap (`g-route-timer-poll-not-stopped-on-soft-nav`) plus which
§20.8.8 steps are NOT performed there. **This is close to the exact fix this report suggested** (name
the mechanism, name the granularity gap) — slightly more thorough, since it also cites the SPEC steps
by number.

### S313-N7. Map-size budget breach has WIDENED FURTHER, and this pass widened it again
`domain.map.md` is now **868 content lines** (was 772 at S313, before that 498). Also over budget:
`build.map.md` 404 (was 391), `error.map.md` 416 (was 388), `dependencies.map.md` 386 (was 369),
`primary.map.md` ~215, `test.map.md` 263, `structure.map.md` 132 (the only one that stayed under 300
this pass — coincidentally the smallest map). **The split recommended at S313 (domain.map.md →
domain.map.md + security.map.md) was NOT done — this is now the FOURTH pass in a row recommending it
without action** (S302's original N3, S313-N7, and this entry). **Reason:** accumulated real content
plus a standing decision not to restructure inside an incremental pass.
**Suggested disposition unchanged, escalated in tone only:** the security tier (§14.8.9/§14.8.10/
§14.8.11, ~150 self-contained lines, untouched for FIVE windows running now) remains the cleanest cut
line. **This report is not the place to perform the split** — it can only keep recommending it. If a
FULL_COLD_START pass does not happen soon, the honest alternative is to stop citing the 300-line
budget as though it is enforced, since four consecutive passes have not enforced it.

## Carried from earlier passes — RE-EXECUTED at this HEAD, WITH ONE HONEST CAVEAT

**This pass's re-execution budget went to the RESOLVED/NEW findings above** (all grep- or
diff-verified against `b929b9c9`). **C1 through C9 below were re-read but not independently
re-derived from source this pass** — where a file relevant to a finding appears in this window's
18-file changed-file set, that finding was cross-checked (none were); where it does not, the finding
is carried on the strength of its own prior verification plus the absence of a diff that could have
invalidated it. This is a narrower claim than "every carried finding re-executed" (the S313 pass's own
standard) — stated explicitly per the "shoot straight" discipline, rather than silently relaxing the
bar.

### C1. Third-party adopter identity in `hand-off.md` / `master-list.md` — NOT re-derivable from
### this map set, and that is deliberate
The S299/S302 reports recorded 3 sites in `hand-off.md` and 1 in `master-list.md`. **This pass cannot
honestly re-count them: the scrubbed token is deliberately not named anywhere in `.claude/maps/`**
(that is the point of the scrub), and `hand-off.md` grew by 1,078 lines this window. `.claude/maps/`
itself is CLEAN and stayed clean through this pass.
**Suggested disposition:** re-count must be done by someone holding the token. The standing decision
is unchanged: a neutral codename in `hand-off.md`'s live items; the `master-list.md` echo is a commit
TITLE that git history cannot rewrite on a pushed public branch — an irreducible exposure deserving
an explicit operator decision rather than a silent carry.

### C2. **RESOLVED-BY-DELETION** — `cloud-maps` is no longer red, because its AI leg is gone
Superseded by S313-N4 above. The workflow's surviving Stages 1/1b/3 are deterministic and free.
**The finding that replaces it is not a CI failure: there is now NO scheduled map refresh at all.**

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
Re-grepped: exactly **1 site** in `compiler/SPEC.md`. Since `df6d269c` a top-level `<each>` mounts as
a comment fence. The §52.15.5 BEHAVIOUR is correct — only the noun is stale. §17.1 added a SECOND
comment-node shape to that surface (`<!--scrml-if-row-->`), so a reader reconciling spec prose
against emitted DOM has two mismatches to trip over.
**Suggested disposition:** one clause — "its each-mount fence is left unfilled". No ruling needed.

### C4. **CORRECTED — EIGHT live `W-LINT-*` codes have no §34 row, not nine**
Re-enumerated at this HEAD. Live `code:` emit sites in `compiler/src/lint-ghost-patterns.js`:
`W-LINT-001..008` + `010..024` = **23 distinct**. §34 now catalogs `W-LINT-001..015` **plus `018`** =
**16 rows**. Uncatalogued-but-live: **`016`, `017`, `019`, `020`, `021`, `022`, `023`, `024` —
eight.** The prior report's nine is stale because `018` was catalogued in the interim.
**Standing correction retained:** `W-LINT-009` is CATALOGUED and NOT live (the `:868` hit is the
comment *"No separate entry for W-LINT-009 — W-LINT-004 subsumes it"*). Grep `code:\s*"W-LINT-`.
**Suggested disposition:** unchanged — catalog the eight or rule them internal-only; either way
footnote the §34 total as counting the CATALOG, not the implementation. **`bun scripts/s34-census.ts`
now makes this mechanically checkable**, which is the better fix than another hand count.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
Re-checked at this HEAD: the `@generated` totals block tracked correctly all window (CI-gated).
`grep -ci "db-authoritative|SECURITY DEFINER|RLS"` across the whole file still returns **0**, and the
banner still reads **"Last updated: 2026-07-20 (S273)"** — now **eleven sessions** after §14.8.11
landed, and it has since also missed §34.0, §6.7.2.1, §20.8.8, §19.4.4.1 and the `<machine>` removal.
**Reason:** currency gap (omission). **This is the same shape as S313-N1** — the gated half stayed
current, the ungated half rotted.
**Suggested disposition:** append Quick-Lookup rows (DB-authoritative / RLS / SECURITY DEFINER /
db-migrate / route region / §34.0 → their sections), fix the `W-DEPRECATED-001` pointer at :309, and
either refresh the banner or retarget it to single-most-recent-session. **The durable fix is to widen
the generator**, not another manual edit — that is the argument this finding has now made five times.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
**RE-VERIFIED at `a3a34d80`: still 4 sites, unchanged** (`docs/tutorial.md:9`, `:646`, `:1039`, `:1121`).
`package.json` had ZERO diff this window, so the drift neither widened nor closed. `docs/FACTS.md` derives `compiler version` mechanically under a
CI `--check` gate, so this is a hardcoded figure that already has a generated authority.
**Suggested disposition:** replace with a FACTS.md reference. The tutorial's PROSE is not under the
snippet gate — that gate proves only that a page COMPILES.

### C7. `compiler/native-parser/` — zero diff, none owed, one CONFIRMED standing gap
`git diff --name-only fe14c9b2..HEAD -- compiler/native-parser/` returns **0 files**, and **no parity
was owed**: every landing this window is emit-time (codegen), runtime, diagnostic-message, spec, CLI
or CI. None touches the parsing/AST-shape layer. `compiler/src/types/` likewise has zero diff, which
is why `schema.map.md` was not re-walked.
- **Confirmed standing gap:** `E-SCRIPT-001` has **0 occurrences** in `parse-markup.js`, which
  carries an explicit `<style>` → `E-STYLE-001` mirror and no `<script>` counterpart.
- Do not upgrade to "drifted" without executing the native path; do not downgrade to "fine" on the
  grounds that nothing changed.

### C8 (was N2). The four `*.generated.md` indexes are now **unmaintainable, not merely stale**
**RE-VERIFIED at `a3a34d80`: all four still stamped `2026-06-25 16:27`, and the drift WIDENED again.**
`error.generated.md` (353 E-codes → `file:line`), `structure.generated.md` (155 files / 1128 symbols
— `compiler/src` actually has **189**), `dependencies.generated.md` (488 import edges) and
`test.generated.md` (1042 `.test.js` — actually **1323**, so the index now under-reports by 281).
**~6 weeks and ~167 commits stale.** Concretely damaging this window: `error.generated.md` has no
entry for anything in `async-combinators.ts` or the new `emit-server.ts` detectors, and being
E-codes-ONLY it returns nothing for `W-IF-IN-EACH` while looking like proof the code does not exist. `error.generated.md` is **E-codes ONLY**, so a `W-`/`I-` lookup
returns nothing and looks like proof the code does not exist.
**ESCALATED this window:** they are `@generated by flogence/scripts/mapgen.ts`, an out-of-repo script
this project's CI does not run — **and the only CI leg that ever refreshed anything under
`.claude/maps/` was deleted at #351.** There is now no path by which these files can become current.
**Suggested disposition (recommendation, not a menu):** **wire `mapgen.ts` into `cloud-maps` Stage 1
alongside `state.ts`, and widen it to emit `W-`/`I-` codes.** It is deterministic and zero-cost, it
would keep working with the AI stage gone, and a mechanical code→`file:line` index is the single
highest-value artifact in this set for a grep-first agent. If that is not going to happen, **delete
all four** — an index nobody regenerates is a silent-wrong-answer surface, and the routing notes now
attached to them are a mitigation, not a fix.

### C9. `g-maps-error-map-missing-diagnostics-and-emit-client` is now correctly `status=narrowed`
The S302 report asked for this; the ledger reflects it. Re-derived at this HEAD: §34 carries **187**
distinct code prefixes and `error.map.md`'s family table names ~**70**, so ~117 route only via grep —
which the map now STATES rather than papering over. No further action; do not re-flag.

## NEW this pass

### S322-N1. The `g-auto-await-family-not-closed-…` gap ID bakes **150** while the landed measurement is **142** — and the ID is the string every future session greps
**Location:** `docs/known-gaps.md` (entry id
`g-auto-await-family-not-closed-150-bare-server-call-sites-in-clean-sources`).
**Reason:** content-heuristic / internal inconsistency, minor but load-bearing for search.
**Detail:** the entry's own body gives TWO honest independent counts (reviewer sweep 49 bare of 148
across 70 sources; harness metric 150 bare of 472 across 103 sources), and `docs/changelog.md` +
`handOffs/delta-log.md` [1171] both record the **landed re-measure on the rebased tree** as
**"bare server-fn sites 142/142 delta 0"**. So `142` is the figure at the merged SHA and `150` is the
pre-rebase harness figure — **both are real, and the ID immortalizes the one that is not the landing's
number.** This is not a correctness defect in the gap; it is a currency hazard, because the id string
is what `--check`, `state.ts` and every future grep key on, and renaming a gap id has its own cost.
**Suggested disposition:** do NOT rename the id (churn + tooling keys). Add one clarifying line to the
entry body stating plainly that the id's `150` is the harness's wider/looser pre-rebase metric and the
**landed** count at `cf838f4c` is **142/142, delta 0**. The maps now state 142 with the 150 provenance
attached (dependencies.map.md, domain.map.md, primary.map.md).

### S322-N2 (carried forward as a WARNING, not a finding). Two S322 gap entries were **outdated on their stated fix-locus**, and the agent had to re-diagnose against HEAD
**Location:** `docs/known-gaps.md` — the two `emit-server` dangling-ref entries closed by `#440`.
**Detail:** one said "binding emits only in serverLoad/SSR" when a prior fix had already spliced it in
the route handler (the LIVE facets were the resolver DETECTION gate + the missing SSE splice); the
other understated the dependency (it also needed `_scrml_session_middleware`, not just
`_scrml_auth_check`). Recorded as friction at delta-log **[1186]**.
**Why it is in this report:** it is the doc-currency failure mode this file exists for, in its most
expensive form — a *stale but plausible* locus is worse than a missing one, because it is actionable
and wrong. **Standing rule, now stated in dependencies.map.md and domain.map.md: a gap entry's stated
fix-locus is a HYPOTHESIS — verify against current HEAD before scoping.** No disposition owed; both
entries are now `status=resolved`.

## OPEN — code defects filed at this HEAD

`docs/known-gaps.md` is the authority. Cited for map-set completeness only.

- **`g-route-timer-poll-not-stopped-on-soft-nav`** (HIGH, open, `locus=compiler/src/runtime-template.js:3026`,
  `prov=dd:soft-nav-outlet-lifecycle-model-2026-08-02`) — the arc this map refresh was commissioned
  for. Scoped in `docs/changes/route-region-teardown/SCOPING.md`; SPEC side ratified (§6.7.2.1 /
  §20.8.8); codegen side unbuilt. See domain.map.md for what the implementation actually does today.
- `g-gate-tier-unit-test-red-local-green-cloud` (HIGH, open) — a unit test inside the BLOCKING gate's
  own scope fails locally while cloud `gate` is green on the same content.
- `g-onmount-multistatement-bypasses-statement-codegen` — §6.7.1a's sugar-equivalence SHALL is not met
  by impl #1 (`lift`, markup-as-expression, `?{}` and `!{}` each fail `E-CODEGEN-INVALID-LOGIC`).
  **The SPEC states this in place rather than asserting the SHALL — that is the compliant shape.**
- `g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion` (LOW, `locus=scripts/browser-baseline.ts`)
  — the browser tier is now name-set-assertable; the other three baselined tiers are not.
- `g-fn-params-typed-string-actually-objects` — fixed in `collectServerOnlyBindingModules`; the
  identical latent bug remains in `buildClosureCapturesForFunction`. Filed, not folded.
- The `buildImportedServerFnNames` aliasing blind spot — keys on `names` not `specifiers[].local`, so
  every `import { x as y }` is missed. Separate blast radius, deliberately not folded in.

## Aspirational-content inventory (correctly located, flagged so no one mistakes it for shipped)

Under `docs/changes/**`, the per-dispatch archive, excluded from content-mapping by scope. Listed
only because they describe work that does NOT exist at this HEAD:
- **`docs/changes/route-region-teardown/SCOPING.md`** — NEW, and it is the exemplary shape: it opens
  with a `⛔ TRACED S313 — the design below was a HYPOTHESIS and it is WRONG` banner over its own
  superseded section, retains the superseded design for provenance with a DO-NOT-BUILD-FROM-THIS
  label, and voids its own sizing. **Two caveats for a reader:** its "the region↔scope association
  must be established at EMIT time" premise reads as if from scratch, and that machinery already
  exists (`_outletResident`) — see S313-N6; and its "MAPS — REQUIRED FIRST READ" block names
  watermark `fe14c9b2` as STALE, which **this pass supersedes** (the maps are now at `e80b692e`).
- `docs/changes/route-region-teardown/CONFORMANCE-CN1-CN10.md` — NEW. Conformance for a contract
  whose emitter is unbuilt; lands with the impl. Correctly labelled.
- `docs/changes/s34-catalog-truthfulness/SCOPING.md` — NEW. The build arc for the 62 BUILD-ARC
  FALSE-CLAIM rows; the arc is open by construction.
- `docs/changes/machine-keyword-retirement/SCOPE.md` — NEW, and **the work it scopes IS landed**;
  read it as an archived dispatch record, not as pending work.
- `docs/changes/esm-chunks/U4-BRIEF.md` + `progress.md` — U4/U5/U6 not built; `classic` is still the
  default and the only conformance-tested format.
- `docs/changes/chunk-namespacing/{BRIEF,SCOPING}.md` · `docs/changes/marketing-claim-gate/SCOPING.md`
  · `docs/changes/navigate-wave1c-piece1-landmark/` · `docs/changes/if-mount-unmount-phase2/SCOPING.md`
  — scoping for unbuilt or premise-changed work; all carried unchanged.

## Compliant — new docs this window, checked

- `compiler/SPEC.md` **§34.0**, **§6.7.2.1**, **§20.8.8**, **§19.4.4.1**, the **§6.7.1a** amendment —
  all five carry explicit direction-of-change statements, and three carry an explicit implementation-
  status or `Nominal / spec-ahead` banner instead of asserting a SHALL the impl does not keep. §19.4.4.1
  additionally carries the first `provenance:` block (pa-base v2.10 Rule 4b) and uses it to SUPERSEDE
  a PA-authored rule that had none. **This is the shape every future amendment should copy.**
- `scripts/browser-baseline.ts` and `scripts/s34-census.ts` — both open with a WHY-THIS-EXISTS block,
  both enumerate the probe traps they defeat *by construction with the scar attached*, and both state
  their own scope limits (browser-tier only; "a FALSE-CLAIM verdict is a HYPOTHESIS, not a verdict").
  `s34-census.ts` explicitly refuses hardcoded line numbers and says why.
- `examples/29-engine-vs-flags.scrml` — migrated to a real error enum and rewritten to TEACH why the
  enum is load-bearing. It previously taught the rejected form in a comment.
- `docs/changes/machine-keyword-retirement/SCOPE.md` — correctly located, and the scoped work landed.

**Checked this pass (S322/S324) — 5 new/changed docs under `docs/changes/`, all COMPLIANT:**
- `docs/changes/u1-emitcall-client-serverfn-await/{BRIEF,progress}.md` — the #429 dispatch archive
  (S133 archival convention). **Now TRACKED** (it was the `?? ` entry in the session-start status).
- `docs/changes/u1-wide-corpus-harness/{BRIEF,progress}.md` — the #428 dispatch archive.
- `docs/changes/async-predicate-unification/{BRIEF,SCOPING,progress}.md` — the #442 (Limb 1) archive.
  **SCOPING.md carries UNBUILT content and labels it correctly** — it opens `**Not dispatched.** This
  is a scope, not a brief`, marks Limb 2 "the expensive limb… scope it separately", and its `Out of
  scope` section is explicit. **It also carries a PA-verified CORRECTION to the deep-dive that
  recommended the work** (dpa-023's second limb — "containment is decided by a string rewrite" — is
  measured FALSE: `post-server-fn-iife-wrap` spans `emit-client.ts:2975–3324` and contains zero
  `.replace(`/`RegExp(`; the regex the DD meant is the fn-name mangler at `:2947–2966`, in the
  PRECEDING stage). **A doc that falsifies its own upstream authority with a measurement is the shape
  this report wants more of, not less.**
- `docs/changes/{emit-server-handler-dangling-refs,gh357-session-sql-interpolation}/progress.md` — the
  #440 / #435 archives.
- `docs/FACTS.md` — regenerated and CI-`--check`-gated; agrees with an independent `git ls-files`
  recount at this HEAD (1,323 test files; 187 files / 238,198 lines under `compiler/src`).
- `docs/known-gaps.md` — 9 new entries, all carrying `sev=`/`status=`/`locus=` and a `prov=`; counts
  regenerate clean (HIGH 23 · MED 115 · LOW 49 · Nominal 7). One minor internal inconsistency filed as
  S322-N1 above.
- `docs/changelog.md` — the S322/S323/S324 entries **state the negative**: #429 "landed explicitly NOT
  claiming its bug class", #428's gate "shipped hollow in the one layer the decision rested on", and a
  PA miss recorded rather than smoothed. Checked precisely because a changelog is where an
  over-claim would live; there is none.

## Uncertain — needs human review

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** all unmodified since 2026-06-22 or earlier while SPEC.md has gained §14.8.11, §23.2.4a,
§38.6.2, §39.5.5, §20.8.2, §17.1, and now §34.0 / §6.7.2.1 / §20.8.8 / §19.4.4.1. **`docs/external-js.md`
is no longer uncertain — it is confirmed stale (S313-N1) and moves out of this bucket.** The rest were
not content-verified this pass.
**This has now been deferred SIX passes running** (S290, S292, S297, S299, S302, S321) and is deferred
again here — this pass's changed-file set does not touch any of them. **Recommendation,
not a sixth deferral: rule them OUT OF SCOPE explicitly** — none is under any gate, none is
adopter-facing on scrml.dev, and the one that turned out to matter (`external-js.md`) surfaced through
a targeted keyword sweep rather than a general audit. A general audit of this set has been proposed
five times and executed zero times; that is the honest evidence about its priority.
**What to check if scheduled anyway:** grep each for backticked identifiers against `compiler/src/`;
specifically anything describing `<machine>`, a security/auth/DB model predating §14.8.9-§14.8.11, or
a path/coordinate model predating the §47.9.5 dist-space clarification.

### `docs/website/`
**Reason:** carried unchanged — retained as a compile fixture (`g-docs-website-retained-as-test-fixture`)
while ALSO being under the snippet gate (98 `.scrml` files). A compile-gated directory reads as
endorsed content, and compiling proves nothing about prose.
**What to check:** confirm with bryan whether `docs/website/` is authoritative content or a fixture.

### NEW uncertain — `docs/adopter/`, `docs/heads-up/`, `docs/pinned-discussions/`, `docs/curation/`, `docs/graph/`
**Reason:** these five directories have never been content-verified by any pass of this report, and
none of them appears in any prior finding. They are outside every gate (`snippet-gate` covers
`docs/website/` and the readme/tutorial snippet corpora, not these).
**What to check:** whether each is (a) live adopter-facing content that must track SPEC.md, (b) an
inbound/outbound correspondence archive that should behave like `handOffs/` and be excluded from
content-mapping by convention, or (c) dead. **Recommend a one-time classification ruling rather than a
content audit** — the same argument that applies to the block above: five prior general-audit
proposals executed zero times is the honest evidence about priority, whereas a scope ruling is cheap
and permanent.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · domain · dependencies · error · structure · test | `a3a34d80` | re-walked this pass against source |
| **build** | **`a3a34d80`** | **re-walked (it was `b929b9c9` and deliberately older).** `git diff 15e5e070..HEAD -- .github/ package.json Dockerfile docker-compose.yml Makefile` is EMPTY — zero CI/packaging/CLI/Docker change. It is re-walked ANYWAY because a NEW pre-land gate landed (`corpus-emit-differential.ts` + `corpus-check-goggles.js`, #428) that any codegen task must know about, and it is not in `ci.yml` |
| **auth** | **`a3a34d80`** | **re-walked (it was `df2ac831` and deliberately older across five windows).** That is no longer defensible: the §20.5 session surface CHANGED this window (#435 Proxy prologue binding, #440 `@currentUser` resolver gate + `<channel auth=>`) and two auth gaps are open and routed to bryan |
| non-compliance | `a3a34d80` | this file — every carried finding re-executed, not copied. One carried finding CORRECTED as over-stated (S320-N1) |
| config · infra | `e80b692e` | **deliberately older, RE-VERIFIED zero-diff this pass** (`git diff 15e5e070..HEAD -- package.json .env.example Dockerfile docker-compose.yml .github/` is EMPTY) |
| schema | `fe14c9b2` | **deliberately older.** `compiler/src/types/` has ZERO diff across FIVE windows now (re-verified: `git diff 15e5e070..HEAD -- compiler/src/types/` empty); no new FileAST node kind. The whole of this window lives in `compiler/src/codegen/` |
| migrations | `115e8b1b` | **deliberately older.** No DB/migration surface in five windows |
| `*.generated.md` × 4 | `2026-06-25` | **stale AND unmaintainable** — see C8. ~6 weeks / ~198 commits stale now; `test.generated.md` under-reports by 281 files |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision.

## What changed about how these maps work, this pass

- **The cadence slipped again — 23 commits and TWO session-windows across TWO CLONES.** Same drift
  pattern S313-N4 predicted; this is the **sixth** consecutive data point supporting the standing
  recommendation (a deterministic non-AI map-currency check in `cloud-maps` Stage 1). Nothing has moved
  on that recommendation in six passes, which is itself the finding.
- **Concurrent-clone drift is a NEW wrinkle this pass and it will recur.** Two clones landed work into
  the same `main` under colliding session numbers (S322-bryan on the ASUS, S322/S323/S324-peter on
  Windows), so "the last session's maps" is not a well-defined idea — only the SHA is. Every map header
  in this set now states the SHA range and names the clones, not just the session numbers.
- **The prior pass's headline was a CORRECTION; this pass's is too, and it is worse because it was
  self-inflicted and platform-shaped.** For three passes this map set told every reader that
  `scripts/s34-census.ts` "is STILL BROKEN" and to use a manual fallback. It is broken **on Windows**.
  On this clone it runs, and it answers in one command the question the fallback methodology takes a
  page to approximate. **A claim derived on one machine and carried on trust is exactly the
  "verify-before-you-propagate" failure this report exists to catch** — and the maps were the offender
  both times. The mitigation that actually worked was neither a gate nor a heuristic: it was running
  the pass on a different clone.

## Tags
#non-compliance #project-mapper #cleanup #scrml #machine-retired #e-deprecated-001 #w-deprecated-001-retired #pa-scrml-primer-stale #pipeline-md-stale #spec-index-currency #external-js-stale #trucking-example-stale #mangled-sed-rewrite #gap-entry-body-false #resolved-by-deletion #no-scheduled-map-refresh #cloud-maps-stage2-deleted #generated-indexes #mapgen-unmaintainable #map-size-budget #domain-split-recommended #w-lint-uncatalogued-eight #s34-census #s34-census-broken #§34.0 #teardown-region-comment #outlet-resident #route-region #native-parser-parity #e-script-001 #privacy-scrub #adopter-identity #each-mount-noun #tutorial-version-hardcode #prose-gate-gap #pre-push-comment-stale #machine-doc-drift-resolved #pr-376 #fileURLToPath-vs-pathname #onmount-c-build-untracked #e-fn-equals-body #keep-alive #pr-405-landed #w-if-in-each #cps-choke-point-landed #map-self-staleness #maps-refresh-cadence #s34-census-windows-only #platform-scoped-claim-overstated #onmount-c-brief-tracked #142-vs-150 #gap-id-immortalizes-a-number #fix-locus-is-a-hypothesis #concurrent-clone-drift #session-numbers-collide #corpus-emit-differential #dual-goggle #auth-map-rewalked #build-map-rewalked #docs-adopter-unclassified #session-read-disclosure #routed-to-bryan

## Links
- [primary.map.md](./primary.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [test.map.md](./test.map.md)
- [auth.map.md](./auth.map.md)
- [build.map.md](./build.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [known-gaps.md](../../docs/known-gaps.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
