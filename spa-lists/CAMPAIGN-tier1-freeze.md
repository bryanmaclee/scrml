# CAMPAIGN — V1-freeze tier-1 conformance (the ~200-case authoring campaign)

**Goal (the freeze gate):** scrml-language-1.0 does NOT freeze until the conformance suite pins every
CLAIMED V1 surface — both halves (codes + runtime). The S256 audit
(`scrml-support/docs/audits/v1-conformance-coverage-2026-07-15/`) found the suite asserts only
**155 / 605 fireable codes**; of the 450 unasserted, **247 are V1-HOLEs** (real default-pipeline fire
sites, zero coverage). This campaign authors the **tier-1** subset — every code that verifies a
**SOUNDNESS, SECURITY, or PILLAR-CONTRACT** guarantee. Freeze = campaign end.

**The high bar (bryan, S256 ratified):** Tier-1 = verifies a soundness/security/pillar-contract
guarantee. Tier-2 (deferred to v1.0.x) = config/shape/ergonomic diagnostics. **When in doubt → tier-1.**
Tiering DEFERS the cosmetic long-tail (~45 cases); it does NOT collapse the freeze-distance — most
V1-holes genuinely verify a guarantee. This manifest loads **196 tier-1 codes + 4 Direction-B runtime
cases = 200** across 20 lists (10 NEW · 10 EXTEND).

**Method:** each list points at `conformance/README.md` (the `expected.json` schema + the
capture→SPEC-review→escalate discipline) + `ss56` (the canonical "what conformance authoring IS"
section). The fired sPA authors the `.scrml` + `expected.json`; these lists enumerate the CODES + the
trigger + the pos/neg shape. Do NOT invent cases beyond the enumerated codes.

## Manifest table

| Wave | List | Surface (§) | tier-1 codes | new/extend | Status |
|---|---|---|---|---|---|
| **A** | ss60 | SSR §52.8 / protect §14.8.9 / **security floor** §40/§52.15 + route-serialize §61 | 11 | extend | ready |
| **A** | ss70 | **fn-purity** §48/§33 | 8 | NEW | ready |
| **A** | ss69 | **type-system soundness** §14/§53 + state-soundness §54 | 16 | NEW | ready |
| **A** | ss62 | **equality/value soundness** §45 | 5 | extend | ready |
| **B** | ss56 | **engine contract** §51 (+ replay §51.14) | 22 | extend | ready |
| **B** | ss71 | **match / exhaustiveness** §18 | 12 | NEW | ready |
| **B** | ss68 | **components** §15/§16 (prop-contract) | 13 | NEW | ready |
| **B** | ss72 | **import / module** §21 | 14 | NEW | ready |
| **B** | ss73 | **channel core** §38 | 7 | NEW | ready |
| **B** | ss59 | **reactivity / state** §6 | 13 | extend | ready |
| **C** | ss61 | L22 type-as-arg — formFor/tableFor §41.14/.16 | 14 | extend | ready |
| **C** | ss63 | api/route/mw §60/§61 (+endpoint RT → Dir-B) | 5 | extend | ready |
| **C** | ss66 | sql/schema §8/§39 codes | 7 | extend | ready |
| **C** | ss58 | error model §19 (fail/`?`/`!{}`/CPS) | 14 | extend | ready |
| **C** | ss74 | foreign §23.2 + meta-eval | 8 | NEW | ready |
| **C** | ss75 | control-flow §17 + linear §35 | 14 | NEW | ready |
| **C** | ss77 | markup / parse contract §4/§10 | 10 | NEW | ready |
| **C** | ss57 | validators §55 (synthesized-write) | 2 | extend | ready |
| **C** | ss65 | meta `^{}` §22 (fold-note → ss74) | 0 | extend | ready |
| **C** | ss67 | serverdb runtime + **4 Direction-B RT cases** | 1 (+4 RT) | extend | ready |

## Fire-order (soundness/security FIRST; 3 waves)

**WAVE A — security + soundness (fire first, freeze-critical):**
`ss60` → `ss70` → `ss69` → `ss62`
> The audit's TOP FINDING is a security trio (`W-AUTH-CONTENT-NOT-GATED`, `W-SERVERLOAD-UNGATED`,
> `W-SSR-PRERENDER-UNSCOPED`) — data-confidentiality floors that fire only a WARNING today. ss60 pins
> them (and carries the "should these be ERRORS?" correctness escalation, per FINDINGS). fn-purity +
> type + equality soundness are the silent-wrong class — highest freeze risk.

**WAVE B — core pillar-contract:**
`ss56` → `ss71` → `ss68` → `ss72` → `ss73` → `ss59`
> "what an engine / match / component / module / channel / reactive-cell MEANS" — the pillars with
> ~zero error-coverage (all 4 component cases assert ZERO codes; engine has 6 cases / 26 holes).

**WAVE C — feature/server contract + language boundary:**
`ss61` → `ss63` → `ss66` → `ss58` → `ss74` → `ss75` → `ss77` → `ss57` → `ss65` → `ss67`
> server-split/CPS/SQL/protect · L22 param-validation · error-model · foreign/control-flow/linear ·
> markup-parse boundary. ss67 closes the 4 Direction-B runtime holes (endpoint §61, auth §40, print
> §20.7, channel-watches-feed §38.13) + the channel multi-client freeze-DECISION (accept-with-note).

## Coverage gate (checked at authoring)
Every tier-1 code from TIER-SPLIT lands in exactly one list. See `progress.md` "Notes / decisions" for
the resolved fuzzy-band placements (`[tier-1?]` marks) + the considered-but-excluded set. The union of
placed codes = 196 + 4 RT cases = **200** (TIER-SPLIT's "~200 tier-1 + 4 runtime"). Fuzzy-band codes
carry `[tier-1?]` in their list — reclassifiable to tier-2 at case-time.

## Audit pointer
`../../scrml-support/docs/audits/v1-conformance-coverage-2026-07-15/` — TIER-SPLIT.md (the bar + family
tiering) · FINDINGS.md (class definitions + the security-trio top finding) · DIRECTION-B-runtime.md (the
4 runtime holes) · candidate-holes.txt + cluster{1..4}-*.txt (the 450 candidates).
