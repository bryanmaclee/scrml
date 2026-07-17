# scrml — Session 263 (bryan) — WRAP · ⭐ #6b design ruled+P0-built · anti-rot thread audit (5 forgotten-half rulings) · E-ROUTE-002/005 landed · base-contract v2.1 · freeze drain

**Date:** 2026-07-17. **Profile:** A (`/boot`). Successor to the wrapped S261. A very large multi-arc session: landed the recovery + 3 scrml PRs + a base-contract change, ruled the #6b design and built its P0, drained a freeze fix, and ran an anti-rot audit that made the open-work surface executable-tracked. **Mechanical detail lives in the executable carriers now — `bun scripts/threads.ts` (14 tracked, the open-arc board) + `handOffs/delta-log.md` + `docs/changelog.md` S263.** This hand-off bloats the NARRATIVE + anomalies only.

## ⚠️ READ FIRST — state as of close
- **scrml main = `c67bf8a3`**, gate GREEN, conformance **725/725**, coherence 0/0. scrml-support 0/0.
- **TWO held branches (built, gated-green, HELD for the S239 adversarial pass — review-then-land next session):**
  - `feat/s263-6b-p0-semdiff` @ `80b72a43` (worktree `../scrml-s263-6b-p0`) — #6b P0 semdiff (thread `6b-p0-semdiff-land`).
  - `fix/s263-e-sql-004` @ `976f98ac` (worktree `../scrml-s263-esql004`) — the E-SQL-004 no-db fix (thread `e-sql-004-review-land`).
  - Do NOT clean these worktrees. Both modify/add compiler surface; land only after the adversarial review.
- **The thread-board is the open-work truth** (`bun scripts/threads.ts --open`, 12 open). It now tracks everything that would otherwise rot — the anti-rot audit's whole point.

## 🎬 WHAT LANDED (main)
- **Recovery:** the 2 at-risk S261 audit reports (were unpushed) → scrml-support `c8ca9b2`.
- **#83** — E-MARKUP/E-STATE §34 retire (5 dead codes + `<poll>` E-LIN fix + §4.4.1→E-CTX-001). ⚠️ a follow-through owed: native still emits E-MARKUP-002 (thread `e-markup-002-native-emit`).
- **#85** — §34 bookkeeping (6 retired + 10 reserved + E-CTX-002 repointed [bryan's slash-closer catch]).
- **#88** — **E-ROUTE-002 wired + E-ROUTE-005 new** (the #1 freeze soundness hole). 3 S239 adversarial rounds caught **12 real defects** (7+5) a green 20k-suite + 1001-file R26 both missed. Conformance 721→725.
- **scrml-support:** `pa-base v2.1` (+identifier-ergonomics comms rule, bryan-directed to the CONTRACT) + the #6b design DD.

## 🧵 THE ARCS (narrative — the irreducible)
1. **#6b (the semantic-diff primitive) — DD ruled, P0 built+held.** Two measured consumers (giti hard-blocked ENTIRELY, flogence partial) converge on one additive compiler primitive: classify base-vs-head AST as cosmetic-vs-behavioral-on-axis. DD `../scrml-support/docs/deep-dives/6b-semantic-diff-primitive-design-2026-07-17.md`. **RULED (bryan, "rule A and C from your leans"): Fork A = confidentiality is a DISTINCT 6th axis** (decisive example: `protect="ssn,email"→"ssn"` reads cosmetic on all 5 axes yet leaks email); **Fork C = whole-program classification projected onto entities** (the transitive tail is the point). Build plan: **P0+P1 (~2-3 sessions) unblocks both consumers**; full 6-axis ~6-10, P4 confidentiality gated on the auth-content arc. **P0 BUILT** (held branch above). **Interleave decision (bryan "fire P0"):** #6b runs parallel to the freeze — it's additive/low-risk, and the freeze is far enough out (~10-15 sessions honestly) that making giti wait for all of it is the worse trade.
2. **#7 (element→source addressing) — NEW second-consumer converge, PARKED v-next.** flogence's `groundedit` (structural authoring) + floStyle both need `data-scrml-sid` + a DG structural projection. EXPOSE-not-build (substrate verified in the DG). Unlike #6b, flogence is NOT hard-blocked (wedge ships stubbed) → genuinely v-next, co-design with #6b later. Inbox msg → read/. Owed: fold the #7 + #6b oracle-ledger entries.
3. **The anti-rot audit (bryan-directed "comprehensive pass").** Root cause bryan sharpened: a HALF-EXECUTED ruling (code done, docs/SPEC pending) that isn't a tracked thread ROTS → the freeze-sweep misreads the stale half. 3 parallel sweeps found **5 forgotten-half rulings**, all now DONE-PROBE threads: `e-error-010-spec-catalog` (HIGH, dup-confirmed, mirror of E-ATTR-012), `e-fn-009-spec-defer-mark`, `e-mw-002-005-006-reconcile` (false precise self-cites), `theme-token-at-sigil-spec` (a LIVE on-board thread is briefed to build the superseded form — fix before it builds), `e-markup-002-native-emit`. **Meta:** the S256/S260 §34 audits are themselves STALE on S260-fixed rows → re-baseline owed.
4. **Freeze drain.** E-ROUTE-002/005 landed (#88). **E-ATTR-012 was NOT a fix** — ratified-DROPPED S249 (composable by design); the agent caught it, reverted; the owed work is a SPEC-remove (thread `e-attr-012-spec-remove`). E-SQL-004 built+held. **Remaining FIX bucket: E-MARKUP-001, E-SQL-003** (2 real holes, pre-checked clean of drop-rulings).

## 🔬 IRREDUCIBLE ANOMALIES / WHAT TO WATCH
- **The S239 gate earned its keep massively** — 12 defects on E-ROUTE-002 across 3 rounds; caught E-ATTR-012 as a false-positive-that-would-hard-error-valid-code. Both P0 + E-SQL-004 are HELD precisely because they haven't had it yet. Do NOT land them without it.
- **The freeze-classifier has THREE unsoundnesses** (memory `feedback_freeze_classifier_dropped_by_design`): grep-fireable≠reachable · grep-hit≠assertion · **execution-doesn't-fire+SPEC-SHALL is NOT a hole if ruled-intentional (dropped/deferred)**. Every FIX-bucket dispatch now premise-verifies (check drop-rulings, prototype, R26) + STOPs if it contradicts a ruling.
- **Self-caught error in my own #83:** §4.4.1:420 claims "native honors E-CTX-001" but native emits the retired E-MARKUP-002 — false claim, now tracked (`e-markup-002-native-emit`).
- **E-SQL-004 surfaced 11 corpus data-loss bugs** (6 in clean examples, e.g. `examples/05-multi-step-form` silently drops a signup INSERT) — a SCOPE CALL for bryan (migrate vs track); thread `esql004-corpus-nodb-bugs`. Agent did NOT edit example content unilaterally.
- **Concurrent:** Peter's S262 WRAPPED mid-session (redefined his lane to adopter compiler-source bugs; PR #81 held on a design fork; #56 still open [his to close]). Watch for intersection if Peter resumes on compiler-source.
- **A sweep agent hit a transient 529** — resumed cleanly from transcript (no work lost).

## 🚦 OPEN THREADS / OWED → see `bun scripts/threads.ts --open` (the executable list). Prose-summary of the non-thread owed:
- **Freeze:** land P0 + E-SQL-004 (adversarial-review threads) · E-MARKUP-001 + E-SQL-003 FIXes · the §34 docs batch-2 (legacy-family retires + 21 uncatalogued adds + the E-ATTR-012 SPEC-remove thread) · re-baseline the s34-catalog audit post-S260.
- **#6b:** review+land P0 → build P1 (footprint) → the A/C-informed P2+ · fold the #6b+#7 oracle-ledger entries · fix the `css-wave1-emission` BRIEF to the @-sigil form before it builds.
- **Contract:** the pa-base v1→v2→v2.1 vendored-copy sync for giti + 6nz (scrml direct-reads, already current).
- **Held from prior:** colorless-async seam-a + css-wave1-emission (both on the thread-board) · auth-content build · SSR-prerender land.

## pa.md directives in force
R1-R5 · PR-flow (branch→PR→gate→merge; 0-review) · **S239 mandatory adversarial pass on EVERY compiler-source land** (12 bugs caught this session — NON-NEGOTIABLE; both held branches await it) · **premise-verify every FIX-bucket dispatch** (E-ATTR-012 lesson) · **half-executed rulings become DONE-PROBE threads** (base doctrine now) · **identifier-ergonomics: pair opaque IDs with a descriptor** (pa-base v2.1) · R26 empirical · manual-worktree provisioning · orchestrate-don't-grind.

## Tags
#session-263 #6b-design-ruled-P0-built #e-route-002-005-landed #anti-rot-audit-5-threads #pa-base-v2.1-identifier-ergonomics #e-attr-012-not-a-fix-dropped-by-design #freeze-classifier-3rd-unsoundness #two-held-branches-await-s239 #7-parked-vnext #conformance-725
