# BRIEF — g-pgnotify-listen-case-split: one channel-name derivation for NOTIFY and LISTEN (S346-bryan dispatch)

DONE-PROBE: grep -qE 'LISTEN "?scrml_|LISTEN \$\{' compiler/src/codegen/emit-channel.ts && grep -rqiE 'camelCase|ordersFeed' compiler/tests/unit/*channel* 2>/dev/null

## The defect (HIGH, S282, PA-confirmed by emission at `34f2b863`; the ledger entry is `docs/known-gaps.md` `G-PGNOTIFY-LISTEN-CASE-SPLIT` — read it IN FULL first)
`compiler/src/codegen/emit-channel.ts` builds the PostgreSQL NOTIFY channel name TWICE, independently, and
the two are not case-equivalent: `buildWatchesTriggerDDL` (~`:903`) bakes `pg_notify('scrml_${safeName}', …)`
— a STRING LITERAL, case preserved — while the LISTEN bridge (~`:987`) rebuilds `scrml_${ident}` by hand and
emits `LISTEN scrml_ordersFeed` — a BARE identifier PostgreSQL folds to lowercase. For any `<channel name=…>`
with an uppercase letter the feed delivers ZERO rows, silently (a NOTIFY with no listener and a LISTEN on an
un-notified channel are both legal no-ops). Neither sanitiser lowercases and `sqlSafeIdent`'s docstring says
it does (false). All conformance fixtures are lowercase-kebab, so 28k tests are blind. Line numbers are as of
S282 — RE-LOCATE; the file has moved. Loci are PA/ledger-located: verify the trace before editing.

## The fix (FORK RULE row 4 — root, not position)
1. **ONE derivation.** `buildWatchesTriggerDDL` already RETURNS `notifyChannel`; the caller destructures
   only the DDL strings and the LISTEN site rebuilds the name. Thread the returned value to the LISTEN
   site so the pair CANNOT drift (delete the second derivation, do not "make it agree").
2. **Quote the identifier** at the LISTEN site (`LISTEN "scrml_ordersFeed"`) so PostgreSQL does not fold it —
   OR lowercase at BOTH ends through the one derivation. Pick the one that keeps the emitted SQL simplest
   and say why; either way there is exactly one place the name is made.
3. Fix the false `sqlSafeIdent` docstring (or make it true — but do not silently change its behaviour for
   existing callers without measuring: `grep -n sqlSafeIdent compiler/src` and report every caller).
4. **A camelCase-named conformance/unit fixture** (`<channel name="ordersFeed" watches=orders>`) that reads
   the emitted trigger DDL AND the emitted LISTEN statement and asserts they name the SAME PostgreSQL
   channel under PG's folding rules (i.e. the LISTEN target is quoted, or both are lowercase). This is the
   bite: it must FAIL on the pre-fix code — prove it (`git stash` / compile at the parent) and say so.

## Direction-of-change (report, never self-ratify)
INERT for every existing lowercase-kebab fixture (the fold was a no-op). For camelCase names it is
`semantics-changed` in the correct direction. Run the corpus differential (`scripts/corpus-emit-differential.ts`
— read its header) over the channel fixtures and REPORT the count; expect ~0 changed for kebab names.

## OUT OF SCOPE
The `<onchange>` consumer (§38.13.3, Nominal) — do not build it. Do not touch `docs/known-gaps.md` (PA-owned).
Do not touch `emit-server.ts` / `route-inference.ts` (other agents are in them).

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp 4f034e13, 2026-08-11) §"Task-Shape Routing", then `domain.map.md`
(channels §38) and `schema.map.md`. Post-map landings: none touch `emit-channel.ts` (verify:
`git log --oneline 4f034e13..origin/main -- compiler/src/codegen/emit-channel.ts`). Report the load-bearing
finding, "not load-bearing" included.

## Mechanics (STARTUP VERIFICATION + PATH DISCIPLINE)
isolation: worktree. FIRST `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`;
toplevel equals it; clean tree; else STOP. `bun install`. `git checkout -b fix/pgnotify-listen-case-split`.
Edit/Write on WORKTREE-ABSOLUTE paths only; never the main checkout; `bun --cwd`, `git -C`. Echo pwd in the
first commit; commit per unit; append-only `docs/changes/pgnotify-listen-case-split/progress.md`; NEVER
`--no-verify`; commit timeout ≥ 8 min; push `-u origin fix/pgnotify-listen-case-split` early + at end.
Gates: the new fixture red-then-green proven; `bun test compiler/tests/{unit,integration,conformance}` 0 fail;
differential count reported.

## Final report (raw data)
FINAL_SHA · branch · files touched · the ONE derivation site (file:line) · which quoting/lowercasing choice
and why · every `sqlSafeIdent` caller · the bite proof (pre-fix red output) · differential count · whether the
ledger locus was wrong · maps finding.
