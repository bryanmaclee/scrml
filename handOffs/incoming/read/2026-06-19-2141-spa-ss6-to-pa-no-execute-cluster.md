# sPA ss6 → PA — re-integration: NO-EXECUTE cluster (all 7 parked, 0 landed)

`needs: action` · from sPA ss6 (type-system-lifecycle-refinement) · 2026-06-19 S209

## TL;DR
ss6 carries **zero items executable** under the sPA autonomous-run contract. I empirically
scoped + verified all 7; every one is deferred-with-watch, blocked-on-spec, or blast-radius-escalate.
**0 code changes, 0 items landed.** This is the spa-scrml.md §Boundaries "whole list stalls on
escalations → report + stand down" case. The branch carries only the per-item dispositions +
progress.md (durable record). Nothing for you to merge into main beyond those two doc files (and
those are optional — the value is the dispositions + the 3 flags below).

## Branch
- **Branch:** `spa/ss6` · **tip SHA:** `bf92c7ce72eb538d47fd93c11531b7da4bbc9b84`
- **Based off:** local `main` `56a6fb36` (NOT origin/main — origin is 17 behind / fast-forward; I
  based on your current authoritative tree so the dispositions reference live code).
- **Worktree:** `../scrml-spa-ss6` (sibling, outside `.claude/worktrees/`).
- Pre-commit hook passed on the disposition commit (17339 pass / 0 fail / 84 skip).

## Items landed
**None.** (0 per-item SHAs.)

## Items parked (all 7) + reasons
| # | item | disposition | reason (verified this run) |
|---|------|-------------|----------------------------|
| 1 | `bug-21` | deferred-confirmed, no fix | S177 R26 deferral re-confirmed. Currency-verified: `applyResetToCellField` (:19737) still `fieldPath[0]`; `resetOne` writes a FLAT per-field map — no deep-nested-compound tracking exists, so the symptom is UNREACHABLE and a naive `fieldPath[0]`→full-path change is a no-op. Real fix = deep-tracking groundwork in `checkLifecycleFieldAccess`; no new friction. |
| 2 | `bug-22` | deferred-confirmed, no fix | S177 R26-confirmed. `classifyResetValueAgainstSpec` (:21689) present; benign heuristic with assignment-site type-check backstop; cross-cell uncommon. No new friction. |
| 3 | `derived-value-compound-mutate` | **MIS-CLUSTER → ss4** | Walker is correct (`derived-mutation-ops.ts`, 12 ops pass). Blockers are FRONT-END only: tokenizer splits `<<=`/`>>=`/`>>>=` at markup `<`/`>` boundaries in `${…}`; no parser support for in-compound `const <derived>` + multi-segment receivers. Both = ss4 (block-splitter-native-parser), outside ss6's type-system ingestion. |
| 4 | `form-for-smart-input-type` | deferred v1.next + design-Q | `FieldInfo` carries `baseTypeName` + `validators` but NO §53 predicate identity. Needs predicate-name surfacing + a ratified predicate→input-type mapping (what does a custom `pattern(…)` map to?). Exactly the TODO's stated gate. → PA/dPA. |
| 5 | `a5` | deferred-confirmed, no trigger | S134 DEFERRED, adoption-watch ≥2 post-A4 JS-host-boundary reports; none filed. A3 permanently rejected; A4 landed. |
| 6 | `phase-4h-transition-return-type-narrowing` | **BLOCKED on §54.6 NC-3 spec gap** | SPEC §54.6 assigns 4 codes but NONE for terminal-return enforcement (§54.3 "transition body SHALL `return <SubstateName>`"). CONF-S32-015a/b skip on exactly this. Needs a SPEC amendment assigning an error code. |
| 7 | `s32-fn-state-machine-conformance-deferred` | design-gated build + stale-doc flag | 30 gating skips need UNIMPLEMENTED features (Phase-4h narrowing = #6, machine audit/replay runtime, terminal-return). Encompasses #6. Plus R4 currency flag (see C). |

## 3 actionable flags (none sPA-executable — routed to you)
- **(A) Re-cluster item 3 to ss4.** The diagnostic walker is done; only tokenizer + parser block it.
  It is mis-ingested into ss6 (type-system). Move it to ss4 (block-splitter-native-parser) on the next
  list-refresh. (spa-scrml.md "footprint wrong / mis-clustered" escalate.)
- **(B) §54.6 NC-3 spec amendment.** Assign an error code for terminal-return enforcement (transition
  body must end in `return <SubstateName>`). One-line SPEC add unblocks item 6 + un-skips CONF-S32-015a/b.
  Design-owned (R4 / SPEC-normative). Candidate for dPA if it wants debate, but it reads like a
  mechanical code-assignment to fill an acknowledged hole.
- **(C) Stale REGISTRY currency (R4 doc-currency).** `conformance/s32-fn-state-machine/REGISTRY.md`
  (+ CONF-S32-003) references `W-PURE-REDUNDANT`, DEPRECATED → `W-PURE-DEPRECATED` at S176 (`pure`
  modifier retired). CONF-S32-007's E-FN-006-retirement framing should be cross-checked too. Derived
  doc trailed the code — same class as memory `feedback_verify_before_claim`. Quick currency-reword.

## New residual to file?
No NEW residual — items 1/2/5 already in known-gaps (bug-21/bug-22/a5), 3/6/7 already tracked in their
test files + REGISTRY. The only genuinely-new findings are flags (A)/(B)/(C) above, which are
process/clustering/doc-currency items for you, not gap entries. Your call whether (C) becomes a
known-gaps doc-currency note.

## Lifecycle
No wrap (PA-owned). Branch + `spa-lists/ss6.progress.md` + this message ARE the handoff. User closes
the instance.
