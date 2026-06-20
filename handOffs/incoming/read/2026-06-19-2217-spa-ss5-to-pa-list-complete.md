# sPA ss5 (channel-codegen) → PA — list complete (re-integration request)

**needs: action** · 2026-06-19 22:17 · from sPA-ss5 · to PA inbox

## TL;DR
List `ss5 channel-codegen` DISPOSITIONED. **2 items LANDED on `spa/ss5`, 2 PARKED (escalates needing your judgment).** Branch tip `a67f04a4`, base `b67cd6e6`, **2 ahead / 0 behind origin/main** — clean linear, ready to re-integrate.

## Branch to re-integrate
**`spa/ss5`** @ `a67f04a46e99890ae819c1fc3aec6b6d944cd143`
- `85ff5b85` — item 1 (channel v0.3 fixture migration)
- `a67f04a4` — item 2 (g-export-channel-body-text Option 2b) + list-disposition bookkeeping
2 ahead / 0 behind origin/main → `git merge --ff-only spa/ss5` is clean, OR file-delta/cherry-pick per your single-writer discipline. Worktree: `../scrml-spa-ss5` (sibling; outside `.claude/worktrees/`).

## LANDED (2)

### item 1 — `channel-v03-fixture-shape-migration` @ `85ff5b85`
8 skipped channel fixtures migrated file-top `<channel>` → inside `<program>` (v0.3 placement; file-top fired E-CHANNEL-OUTSIDE-PROGRAM). `channel.test.js` 106 pass / 0 fail / 0 skip (was 98 / 8-skip).
**FLAG (exceeds brief-seed):** the §27 fixture ALSO used `server function` mutating channel cells → post-S189 fires E-CHANNEL-SERVER-CELL-READ. I dropped `server` → plain-client publisher per the canonical PRIMER §9.1 idiom (empirically verified, R26). Faithful currency migration, but it exceeds the literal "pure placement migration" brief-seed — flagging for your awareness.

### item 2 — `g-export-channel-body-text` @ `a67f04a4` (CLOSES the gap)
Option 2b: `export <channel>` bodies now parse STRUCTURALLY at TAB (ast-builder.js P3.A export path runs the same channel-root `liftBareDeclarations(..., "state", ..., true)` recursion the non-export path uses). emit-channel needed NO change — its collectors already walk structural nodes (silently returned empty for bare-body export channels pre-fix); CHX deep-clone propagates the now-structural node (§38.12.2). The S192 `getCrossFileChannelCellNames` Class-B text-scan the gap referenced does NOT exist in current source (already retired). +3 regression tests (existing tests used explicit `${...}` bodies, blind to the bare-body bug). Dev-agent `agent/g-export-channel-body-text` FINAL_SHA `75d69202` file-delta'd. **sPA-independent R26:** export channel now `["logic"]`/state-decl/no-raw-text, byte-matching non-export; 12-file channel+p3a+cross-file suite 129 pass / 15 skip / 0 fail.
**known-gaps action: mark `g-export-channel-body-text` RESOLVED (S209 sPA-ss5 `a67f04a4`).**

## PARKED — escalates needing your judgment (2)

### item 3 — `g-channel-server-keyword-auto-migrate` — NEEDS USER RE-RATIFICATION
This item is **Enhanced-A**, which the USER EXPLICITLY DEFERRED at S189 (user-voice S189 verbatim *"land min A"*; Enhanced-A *"filed as a deferred LOW... zero corpus demand"*). Minimal-A deliberately steers hand-migration via E-CHANNEL-SERVER-CELL-READ rather than silently flipping server→client execution context. **Building Enhanced-A reverses an explicit user ruling.** Recommend confirming with the user whether to revive it before scheduling — given the stated "zero corpus demand" it may stay deferred. R4-verified against user-voice (not just the known-gaps paraphrase).

### item 4 — `p3a-cross-file-channel-v03-deferred` — feature-build + currency reconcile
5 describe.skip blocks blocked on the **UNIMPLEMENTED v0.3 A8 cross-file route-emission contract** (exporter = route-handler SoT · consumers emit client-stub only · route-dedup across consumer pages) — "in v0.3 scope but the implementation is DEFERRED to a later wave (compiler-source codegen change)." A feature BUILD, beyond an sPA's bounded-fix scope (cf. ss14 Bug 14 → re-bucket to feature/design track). Design-open pure-channel-file dispensation — **BUT note SPEC §38.12.6 + PRIMER §9.1 appear to ALREADY grant the pure-channel-file dispensation; the test comments (dated 2026-05-12) may be stale → please reconcile that currency conflict.** Item 2's Option 2b is a prerequisite-simplifier for the A8 build (cross-file channel cells now register structurally). Couples with item 2's emit-channel surface.

## Test state at branch tip
- `channel.test.js`: 106 / 0 / 0
- 12-file channel+p3a+cross-file suite: 129 / 15 skip (item-4 deferred) / 0 fail
- item-2 dev-agent full pre-commit gate: 17350 pass / 76 skip / 0 fail (+3 new tests)

## PA bookkeeping owed (sPA owns no durable main-state)
- re-integrate `spa/ss5` → main + push
- known-gaps: `g-export-channel-body-text` → RESOLVED; items 3/4 stay open (carry the escalate context above)
- changelog / master-list / hand-off / delta-log / digest regen / maps refresh
- worktree cleanup: `../scrml-spa-ss5` after re-integration
- decide item 3 (user re-ratification) + item 4 (feature track + §38.12.6 currency reconcile)

No new residuals filed beyond the above. Branch tree clean, all work committed.
