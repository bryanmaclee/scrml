# scrml — Session 210 (OPEN)

**Date:** 2026-06-20. **This session:** S210 (resumed across a `/clear` mid-session — NOT rotated; same OPEN S210). **Prev:** S209-CLOSE → `handOffs/hand-off-214.md`. **Profile:** A — FULL. **Deputy:** **ACTIVE** (`deputy-maint` ticking — at `45b9d049`, advancing through the session) → `^main` >0 → **merge-before-push gate (S205) at every push.**

> **Thinned hand-off (S205).** Mechanical state → `bun scripts/state.ts` + digest · `delta-log.md` [S210 1-20] · `deputy-state.md`. This carries the IRREDUCIBLE + the OPEN intake.

## Boot/current state
- scrml + scrml-support **0/0 with origin** as of the last push (`c1c96ca1`); **ss3 + gap-reconcile committed locally on top, UNPUSHED** (HEAD past `2eea9d4e`).
- Board **HIGH 1 · MED 11 · LOW 17 · Nominal 8** (HIGH = `g-paren-binary-group-dropped-before-method` flogence; +AF lint gap `g-input-state-markup-nonreactive-lint` LOW). Tests **17,384 / 68 skip / 0 fail** (subset) @ v0.7.0.
- Maps behind HEAD — **deputy-owned + deputy active → left to deputy.**
- `docs/graph/` (flograph projection) keeps getting staged **directly into main's index** (S119 hazard — a flograph/deputy tool, NOT via deputy-maint) → kept out of every PA commit via explicit pathspec. **Watch:** worth checking why the deputy/flograph writes main's index.
- **Worktrees:** main · `../scrml-deputy-maint` (deputy, KEEP). (ss3 integrated + 6b-cleaned; stale `agent-a4e244bf…` already gone.)

## ✅ S210 — DONE
- **3 HIGH bugs RESOLVED:** AD+regex (`14fb0230`) · AE engine-`name=` dual-table (`faa213c5`).
- **sPA ss4** (`f65b1de9`) + **ss13** (`c3e9d16e`) + **ss3** (`2eea9d4e`, 3/3: g-attr-bare-compound-is-op, bug-18/GITI-015, @.-sigil expr-parser) integrated. **sPA lists REBUILT** (fattening rule).
- **dpa-001 A2 RATIFIED** + **A2 build SCOPED** (`docs/changes/api-primitive-a2-2026-06-20/`) + **A2 W0 DD landed** (`scrml-support/docs/deep-dives/api-primitive-decl-site-epistemics-2026-06-20.md`).
- **6nz 1624 reply** sent (AB closed @ `2ebd107a`; AA open; X/Y/Z/AC current). **giti GITI-015** + **flogence paren-bug** acks sent. Bookkeeping done (user-voice/changelog/state/inbox).

## ⚠️ OPEN — needs the USER / next action
1. **A2 — W1 DONE: SPEC §60 `<api>` authored** (user "go A2"; F1=A; W0+W1 closed). New top-level Nominal section §60.1-§60.11 (`<api src= base=>` + endpoint grammar · owned-vs-unowned must-not-lie [element-name marker] · `<request api=>` bind · parseVariant response reuse · client-only §12.2 · LIMIT-PRIMITIVES · A1-deferred · planned E-API-*). SPEC-INDEX §60 row + count 59→60. **NEXT WAVE → W2 (parser): a dev-agent dispatch (isolation:worktree) to recognize the `<api>` element + endpoint decls + attrs + fire the §60.9 E-API-* codes (§34 rows land with it, Rule 4). Awaiting user go.** delta-log [21]+[24].
2. **6nz AF — CONFIRMED by-design** (user "confirm AF"; reply sent). §36.1 clarified (dropped the `<poll>`-style overclaim) + §36.6 markup-interp note added (PA-direct, SPEC currency). **Lint impl pending:** `g-input-state-markup-nonreactive-lint` (LOW — the planned `W-INPUT-STATE-MARKUP-NONREACTIVE`; §34 row lands WITH the impl per Rule 4). A small dispatch when scheduled. delta-log [22].
3. **ss3 REFRESHED + fire-ready** (user "refresh ss3"). `read spa.md ss3` → the expression-serializer **paren/span cluster** (`g-paren-binary-group-dropped-before-method` HIGH + `g-isop-call-tail-lhs-paren-miscompile` MED; same `_rewriteParenthesizedIsOp`/serializer ingestion, one fix may cover both). User fires. delta-log [23]. (Alternate ss: `ss2` engine-codegen poss-HIGH crash.)
4. **flogence raw-route (serve-side)** — fold into A2 philosophy or bank as **dpa-002**.
5. **stdlib Phase 3** — needs a §40.4 `fail`/`!{}`/bun-import ruling.
6. **AA lint-fire regression** — `W-MATCH-VALUE-UNUSED` (S144, `emit-functions.ts:1021`) no longer fires on the v0.7.0 bare-tail-`match` repro. Not yet board-filed; investigation-worthy.

## OPEN escalations carried (S209)
- ss5 item3 `g-channel-server-keyword-auto-migrate` (Enhanced-A, DEFERRED S189) · ss9 §20.5 SPEC examples (migrate vs carve-out) · ss10 item7 render-gap-ingestion + item8 L2/L3 oracle-strategy · ss6 b17 cases 1-3 (gated on `g-component-body-markup-parser-absent`) · §58 build-story re-bucket · §20.5+despace residual (ss11 items 4-8, partly Rule-1 marketing-gated).

## OTHER carry
- **giti/6nz pa.md modernization** committed LOCAL+UNPUSHED in siblings (giti `72fda7c` / 6nz `e6fc5e8`) — push from their instances.
- ss3 residuals not board-filed: #2 dead each-sigil band-aid in `expr-node-corpus-invariant.test.js` (test-hygiene) · #3 native-parser `@.` structuring not verified.
- item6 **native-parser M2-M6** PARKED→escalate (~v0.8 default-flip).

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · digest-first (S203) · S88 isolation · S99/S126 path-discipline · S136 BRIEF.md · S138 R26 verify-before-claim (both directions) · S147 coherence · S164 bg-commit-race · **S205 merge-before-push gate** · S119 explicit-pathspec (deputy active) · wrap 8-step · S206 flogence + co-location · S208 sPA role · S209 cPA monitor-not-launch + §2.1 deref-vs-mark.

## Tags
#session-210 #open #profile-a #board-high-1 #ss3-integrated #paren-span-cluster #a2-w0-dd-landed #a2-A-vs-B-Q1 #AF-ruling-owed #next-ss-ss3-or-ss2 #deputy-active #push-pending
