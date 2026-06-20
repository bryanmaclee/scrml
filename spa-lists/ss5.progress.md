# sPA ss5 — channel-codegen · progress

Branch `spa/ss5` (base `b67cd6e6`). Autonomous run, 2026-06-19. **List DISPOSITIONED — ready for PA re-integration.**

## item 1 `channel-v03-fixture-shape-migration` — LANDED `85ff5b85`
Migrated 8 skipped channel fixtures (§26 C18 describe.skip ×7 broadcast/disconnect injection +
§27 S83-B4 test.skip ×1) from file-top `<channel>` → inside `<program>` (v0.3 placement;
file-top fired E-CHANNEL-OUTSIDE-PROGRAM). The §27 publisher was ALSO `server function` mutating
channel cells → fires E-CHANNEL-SERVER-CELL-READ post-S189 RULING-A; dropped `server` → canonical
plain-client publisher fn (PRIMER §9.1). `channel.test.js` 106 pass / 0 fail / 0 skip (was 98/8-skip).
**Flag to PA:** the §27 server→client change exceeds the literal "pure placement" brief-seed (faithful
currency migration to PRIMER §9.1, empirically verified — but PA should note it).

## item 2 `g-export-channel-body-text` — LANDED (this commit; agent FINAL_SHA `75d69202` file-delta'd)
Option 2b: `export <channel>` bodies now parse STRUCTURALLY at TAB (ast-builder.js export path now
runs the same channel-root `liftBareDeclarations(..., "state", ..., true)` recursion the non-export
path uses). Pre-fix the export body collapsed to a single RAW TEXT child; cells never registered
through the normal MOD/SYM structural path. emit-channel needed NO change — its collectors already
walk structural nodes (silently returned empty for bare-body export channels); CHX deep-clone (§38.12.2)
propagates the now-structural node. The S192 `getCrossFileChannelCellNames` Class-B text-scan referenced
by the brief does NOT exist in current source (already retired). +25-line ast-builder fix + 3 regression
tests (the existing tests all used explicit `${...}` bodies, blind to the bare-body bug).
Dispatched `scrml-js-codegen-engineer` (isolation:worktree, opus). BRIEF.md archived (S136).
**sPA-independent R26 verify:** export channel now `["logic"]` / state-decl / no-raw-text, byte-matching
non-export; 12-file channel+p3a+cross-file suite 129 pass / 15 skip (item-4 deferred) / 0 fail.

## item 3 `g-channel-server-keyword-auto-migrate` — PARKED → ESCALATE TO PA
Item 3 = **Enhanced-A** (migrate auto-strips a deprecated `server function` channel-cell-write publisher
→ client). The **user EXPLICITLY DEFERRED Enhanced-A at S189** (user-voice S189, verbatim "land min A":
*"Enhanced A (the migration auto-strips it → client) was filed as a deferred LOW... zero corpus demand"*).
Minimal-A deliberately steers hand-migration via E-CHANNEL-SERVER-CELL-READ rather than silently flipping
server→client execution context. Building Enhanced-A reverses an explicit user ruling → **needs user
re-ratification before dispatch.** No branch landing. R4-verified against user-voice (not just known-gaps).

## item 4 `p3a-cross-file-channel-v03-deferred` — PARKED → ESCALATE TO PA
5 describe.skip blocks blocked on the **UNIMPLEMENTED v0.3 A8 cross-file route-emission contract**
(exporter = route-handler SoT · consumers emit client-stub only · route-dedup across consumer pages) —
"in v0.3 scope but the implementation is DEFERRED to a later wave (compiler-source codegen change)." A
feature BUILD, beyond an sPA's bounded-fix scope (cf. ss14 Bug 14 re-bucket). PLUS a design-open
disposition (pure-channel-file dispensation vs. retirement) — BUT note SPEC §38.12.6 + PRIMER §9.1 appear
to ALREADY grant the pure-channel-file dispensation (test comments dated 2026-05-12 may be stale); PA
should reconcile that currency conflict. Couples with item 2's emit-channel surface. No branch landing.

## Re-integration
Items 1+2 LANDED on `spa/ss5`. Items 3+4 PARKED (escalates). One re-integration message sent to
`scrml/handOffs/incoming/`. PA re-integrates `spa/ss5` → main (single-writer, coherence-gated) + owns
all durable bookkeeping (hand-off, master-list, changelog, known-gaps reconcile, delta-log, push).
