# BRIEF — freeze-campaign SPEC-text reconciliation batch (E-ATTR-012 / E-ERROR-010 / E-FN-009)

**change-id:** freeze-spec-reconcile-s274 · **opened:** S274 (bryan) 2026-07-20 · **base:** f2332c09 (post-SSR-#120).
**Dispatched:** general-purpose (iso:worktree, opus, bg) — pure SPEC-text; the §34/§48 reconcile half of three half-executed rulings.

> Three freeze-campaign threads whose CODE half already landed but whose SPEC half was forgotten (the
> S263 "half-executed ruling rots into a limbo the freeze-sweep misreads" class). This closes all three
> SPEC halves. The DIRECTIONS ARE RULED — do NOT re-open. PA (S274) verified every site by content on
> base f2332c09 (the BRIEF line numbers below are current-as-of-verification but WILL drift as you edit;
> re-locate each by its quoted CONTENT, never by raw line number).

## ⚠️ This is DOCS-ONLY (SPEC.md is documentation; no runtime path)
SPEC-text + `SPEC-INDEX.md` regen + ONE `.scrml` fixture header comment. **Touch NO compiler/src code.**
Do NOT touch `docs/known-gaps.md`, `hand-off.md`, `handOffs/delta-log.md`, `master-list.md`,
`docs/changelog.md`, or `.claude/maps/` — the PA owns those and lands them separately.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (worktree isolation) [incident-counter: N]
1. FIRST action: `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does NOT, STOP and report (wrong-root allocation).
2. Confirm `git rev-parse --show-toplevel` equals that worktree root; confirm a clean tree.
3. `bun install` (worktrees don't inherit `node_modules` — acorn etc. will be missing otherwise).
4. Every Read/Write/Edit targets a WORKTREE-ABSOLUTE path under that root. Never a bare relative path (it resolves against the main checkout via the additional-working-dirs list). Never `cd` into the main checkout. Prefer `git -C "$WORKTREE_ROOT"` / `bun --cwd "$WORKTREE_ROOT"`.
5. First commit message: `WIP(freeze-spec-reconcile): start at $(pwd)` (the PA verifies the prefix on landing).

## MAPS — REQUIRED FIRST READ
- `.claude/maps/primary.map.md` (stamp `df2ac831`, 2026-07-19). **Post-map landing to factor in:** SSR leak fix #120 (`f2332c09`) touched `compiler/SPEC.md` §34 + §52.15; the map predates it. For THIS task the map is low-load-bearing (you edit SPEC.md prose only) — report "not load-bearing" if so. Treat map content as a verify-against-SPEC hypothesis.

---

## THREAD 1 — RETIRE E-ATTR-012 (ruled S249-DROP; code half done, ZERO fire sites)
**Authority (ruled, do NOT re-open):** S249 user-voice `"confirm both (validators-closed-at-14 + drop-E-ATTR-012)"`. `bind:value` + a same-event explicit handler (`oninput`) is **composable by design**. Code fire site already removed; `bind-value.test.js` §12/§13 lock "E-ATTR-012 removed — composable by design". Only the SPEC/docs half remains (the S263 freeze-sweep re-flagged the non-firing code as a false "hole" against this stale SPEC).

Verified sites (re-locate by CONTENT):
- **(a) The SHALL prose** — `compiler/SPEC.md` §5.4, the sentence `"...handler on the same element SHALL be a compile error (E-ATTR-012: conflicting ..."`. Read the full sentence and **reword it to state the composition is ALLOWED** (`bind:value` and a same-event handler co-exist / compose by design — the handler runs alongside the binding). Remove the compile-error assertion entirely. The string `SHALL be a compile error (E-ATTR-012` must NOT survive.
- **(b) The §5.4-local error table row** — `"| E-ATTR-012 | \`bind:\` and an explicit event handler for the same event on the same element | Error |"`. **Retire** (house convention): strike the code as `~~E-ATTR-012~~` and replace the description with `**Retired (S249-drop, SPEC-cleaned S274)** — \`bind:\`+same-event-handler is composable by design; see \`bind-value.test.js\` §12/§13.` Keep the row present (struck), do not delete it.
- **(c) The range mention** — `"Error codes E-ATTR-010 through E-ATTR-012 continue to apply to the DOM element per §15.1"`. Change the range to **`E-ATTR-010 through E-ATTR-011`** (012 retired).
- **(d) The main §34 catalog row** — `"| E-ATTR-012 | §5.4 | \`bind:\` and explicit event handler conflict on same element | Error |"`. Retire it with the SAME strikethrough+label convention as (b).
- **(e) The fixture header** — `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-bind-conflict-035.scrml` line 1, `"// bind:value and explicit oninput on same element → E-ATTR-012."` → relabel: `"// bind:value + explicit oninput on the same element — composable by design (E-ATTR-012 retired, S249); compiles clean."` (comment only; do NOT change the fixture's scrml body.)

**DONE-PROBE:** `! grep -qE 'SHALL be a compile error \(E-ATTR-012' compiler/SPEC.md`

## THREAD 2 — CATALOG E-ERROR-010 (ruled S249; code emits it, conformance asserts it)
**Authority:** S249 minted a DEDICATED `E-ERROR-010` for the `?`-propagation incompatible-error-variant check (was overloaded on `E-TYPE-001`). Code half landed — `compiler/src/type-system.ts` emits `"E-ERROR-010"` (the propagation-incompat site); conformance asserts it (`conformance/cases/error/propagate-incompat-variants/expected.json`). SPEC half forgotten (`grep -c E-ERROR-010 compiler/SPEC.md` = 0). NOTE: this is DISTINCT from the fail/enum-construction-arity gap (that one was ruled to mint `E-TYPE-082`, S253 — do not conflate).

Verified sites:
- **(a) Add the §34 row** in BOTH §34-region tables that carry the E-ERROR family:
  - the §19-local error table (immediately after the `E-ERROR-009` row `"| E-ERROR-009 | §19.3.3 | \`fail\` variant not a valid variant ... | Error |"`), and
  - the main §34 catalog (after its `E-ERROR-009` row; the family sits together there).
  Row (mirror sibling format exactly): `| E-ERROR-010 | §19.5.4 | \`?\`-propagation: a called function's error variants are incompatible with the enclosing function's declared error type (dedicated code; formerly overloaded on E-TYPE-001) | Error |`
- **(b) Repoint §19.5.3** — `"...the compiler SHALL emit a compile error (E-TYPE-001) identifying the incompatible variants."` → `E-ERROR-010`.
- **(c) Repoint §19.5.4** — `"Incompatible error variants SHALL be a compile error (E-TYPE-001)."` → `E-ERROR-010`.
- **DO NOT touch** the other `E-TYPE-001` mentions — those are the LIFECYCLE per-access code (a different property): the §14.12 tracker prose, `| E-TYPE-001 | §14.3, §18.4 | Type mismatch ...`, the E-TYPE-046 distinguisher, and the `<formRes>`/`§34` lifecycle references. ONLY the two `?`-propagation SHALL sentences repoint.

**DONE-PROBE:** `grep -q 'E-ERROR-010' compiler/SPEC.md`

## THREAD 3 — MARK E-FN-009 NOMINAL/SPEC-AHEAD-DEFERRED (S31-retained, impl deliberately defers)
**Authority:** S31 "Fate of fn" RATIFIED retaining `E-FN-009` (`design-insights.md`), but impl#1 **deliberately defers** it — `compiler/src/type-system.ts` (search `E-FN-009 (reactive subscription capture) is deferred`) documents that reactive-subscription-capture detection needs call-graph analysis; ZERO fire site. SPEC asserts it fires at 4 sites, none marked Nominal — an oversight (SPEC otherwise diligently marks deferrals Nominal). **Direction: mark Nominal/spec-ahead-DEFERRED. Do NOT wire the check** (that's a v1.next feature build, out of scope). Do NOT delete the SHALL — keep the spec intent, annotate the deferral.

Verified sites:
- **(a) §48.5.4** (the section `"48.5.4 E-FN-009 — Reactive Reference Captured as Live Subscription"` + its prose `"...the compiler emits E-FN-009."`) — add a banner at the top of the subsection: `> **Nominal / spec-ahead (deferred).** The E-FN-009 check is specified but DEFERRED in impl#1 — reactive-subscription-capture detection requires call-graph analysis; \`type-system.ts\` defers it (zero fire site as of S274). Retained per the S31 "Fate of fn" ruling; wiring is v1.next.`
- **(b) The §34 rows** — the main §34 row `"| E-FN-009 | §48.5.4 | Reactive \`@variable\` captured as live subscription inside \`fn\` body | Error |"` AND the §48-local table row (search the `"| E-FN-009 | Reactive \`@variable\` captured as a live subscription inside a \`fn\` body | Error |"` row) — append to each description `(Nominal — deferred, see §48.5.4)`.
- **(c) The §48.7 SHALL** — `"Establishing a live reactive dependency on an \`@variable\` ... SHALL be a compile error (E-FN-009). (§48.5.4)"` → append `(Nominal/spec-ahead — deferred; see §48.5.4)`.

**DONE-PROBE:** `grep -rq '"E-FN-009"' compiler/src || grep -iqE 'E-FN-009.{0,120}(defer|nominal|spec-ahead)' compiler/SPEC.md` (the second clause is what you satisfy — an E-FN-009 SPEC line with defer/nominal/spec-ahead within 120 chars).

---

## AFTER ALL EDITS
1. **Regen SPEC-INDEX:** `bun run scripts/regen-spec-index.ts` (row-count/line-range shifts; commit the regen). Report the "N rows, 0 missing" line.
2. **Gate (docs-only, so non-runtime):** `bun test compiler/tests/unit compiler/tests/conformance` — expect **0 fail** (clean baseline). SPEC-text edits have no runtime path, so ANY new failure means a test PARSES SPEC.md/§34 — if so, update that test to match the reconciliation (it's the same ruled change) and name it in your report. **Do NOT run the full integration dir expecting 0 fail** — it carries a KNOWN pre-existing baseline (self-host-smoke `dist` ENV-GAP, `serve-target-tool-r26` full-bundle-HTTP flake, `migrate-*` §8-§11) that is NOT yours and out of scope.
3. Verify all THREE DONE-PROBEs pass; paste their output.
4. Incremental commits (one per thread is ideal) + append-only `progress.md`.

## REPORT
`WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, `FILES_TOUCHED` (expect: `compiler/SPEC.md`, `compiler/SPEC-INDEX.md`, the one fixture, `progress.md`), the 3 DONE-PROBE results, the gate pass/fail counts, any §34-parsing test you updated, and anything ambiguous you hit.
