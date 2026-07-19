# BRIEF — strike the stale E-ATTR-012 SHALL from SPEC (the S249-drop's forgotten SPEC half)

## The task (SPEC-text only — docs)
E-ATTR-012 (`bind:` + a same-event explicit handler) was **ratified-DROPPED at S249** (`bind:value`+`oninput` is composable by design). The CODE half was executed (fire site removed; `bind-value.test.js` §12/§13 lock "E-ATTR-012 removed — composable by design"). The **SPEC/docs half was forgotten** — and the §34 execution-verify sweep (S263) then re-flagged the non-firing code as a soundness "hole" against the stale SPEC. This thread closes the forgotten half:
1. Strike the "SHALL be a compile error (E-ATTR-012)" sentence from `compiler/SPEC.md` §5.4 (~L1558-1561).
2. Retire the §34 E-ATTR-012 row (~L1629) — house convention `~~E-ATTR-012~~` + "**Retired (S249-drop, SPEC-cleaned S263)** — `bind:`+same-event-handler is composable by design; see `bind-value.test.js` §12/§13."
3. Retire/relabel the stale fixture `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-bind-conflict-035.scrml` (header claims "→ E-ATTR-012"; now compiles clean by design).

## Design authority (READ — ruled, do NOT re-open)
- S249 user-voice: `"confirm both" (validators-closed-at-14 + drop-E-ATTR-012)`.
- S263 finding: `scrml-support` — the fix-agent that verified the drop + reverted (see delta-log / this session's hand-off).
- Root-cause meta (S263, bryan): a HALF-EXECUTED ruling (code done, SPEC pending) that is NOT a tracked thread ROTS into a limbo the freeze-sweep misreads. This BRIEF *is* that thread — half-executed rulings get registered here so the thread-board (`scripts/threads.ts`) surfaces them OPEN until the docs half lands.

## Scope fence
SPEC-text + one fixture only. No compiler-source change (the code half is already done). Lands via a docs PR (bundle into the next §34 docs cleanup batch).

DONE-PROBE: ! grep -qE 'SHALL be a compile error \(E-ATTR-012' compiler/SPEC.md
