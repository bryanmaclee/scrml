# V1-freeze tier-1 conformance campaign — list-authoring progress (S256 audit ingest)

Task: load the V1-freeze tier-1 conformance backlog into the sPA authoring-list system so the
campaign is ready to fire. Pure list-authoring (markdown under `spa-lists/`) — additive, no
compiler-source. Worktree `agent-ac7d118abb3b00d19`; branch `worktree-agent-ac7d118abb3b00d19`.

Inputs read: `scrml-support/.../v1-conformance-coverage-2026-07-15/{TIER-SPLIT,FINDINGS,DIRECTION-B-runtime}.md`
+ `candidate-holes.txt` + `cluster{1..4}-*.txt`; format template `ss56`; skimmed ss57-ss67; `conformance/README.md`.
Empirical grounding: greppped every tier-1 code live in `compiler/src` for its exact trigger
(scratchpad `triggers.tsv`). Tier-1 derivation = TIER-SPLIT family-table ∪ brief per-list assignment,
minus FINDINGS EXCLUSIONS (OFF-V1-PATH native-parser 79 / codegen-soundness 18, NOMINAL, LINT-ADVISORY,
RESERVED, INDIRECTLY-COVERED, tier-2 cosmetic).

## Ledger (commit per-file)

| # | file | new/extend | tier-1 codes | committed |
|---|------|-----------|--------------|-----------|
| 0 | progress.md | — | — | pending |
| 1 | CAMPAIGN-tier1-freeze.md (manifest) | new | — | pending |
| 2 | ss60 (SSR/protect/security) | extend | 11 | pending |
| 3 | ss70 fn-purity §48 | NEW | 8 | pending |
| 4 | ss69 type-soundness §14/§53 | NEW | 16 | pending |
| 5 | ss62 equality/value | extend | 5 | pending |
| 6 | ss56 engine §51 | extend | 22 | pending |
| 7 | ss71 match §18 | NEW | 12 | pending |
| 8 | ss68 components §15/§16 | NEW | 13 | pending |
| 9 | ss72 import/module §21 | NEW | 14 | pending |
| 10 | ss73 channel core §38 | NEW | 7 | pending |
| 11 | ss59 reactivity/state §6 | extend | 13 | pending |
| 12 | ss61 L22 formFor/tableFor | extend | 14 | pending |
| 13 | ss63 api/route/mw §60/§61 | extend | 5 | pending |
| 14 | ss66 sql/schema | extend | 7 | pending |
| 15 | ss58 error model §19 | extend | 14 | pending |
| 16 | ss74 foreign §23.2 | NEW | 8 | pending |
| 17 | ss75 control-flow + linear §17/§35 | NEW | 14 | pending |
| 18 | ss77 markup/parse §4 | NEW | 10 | pending |
| 19 | ss57 validators §55 | extend | 2 | pending |
| 20 | ss65 meta §22 (fold-note) | extend | 0 | pending |
| 21 | ss67 serverdb runtime | extend | 1 (+4 RT cases) | pending |

**Total: 196 codes + 4 Direction-B runtime cases = 200 (the ~200 tier-1 target).**

**STATUS: COMPLETE.** All 21 files committed (4 commits: manifest+progress `8b44a4d8`, wave-A `d61be267`,
wave-B `a385503f`, wave-C `4b6ae95b`). Coverage gate PASSED (script `scratchpad/placement.txt`): 196
unique codes, ZERO duplicates, every code present as a bolded `**CODE**` item in its assigned file. Every
TIER-SPLIT tier-1 *named* code verified placed exactly once (cross-checked the full TIER-SPLIT family
table). No unplaced tier-1 code.

**Coverage-gate note — the only "count gap":** TIER-SPLIT says "E-FORMFOR-* ×10" but only **9** E-FORMFOR-*
codes exist in candidate-holes.txt (the "10" is an audit approximation) — all 9 placed in ss61. Similarly
"E-COMPONENT-010..035 ~14" → 13 placed (011..035 minus 015/016/017/018/032 which don't exist as holes).
No real code is missing.

## Notes / decisions
- E-FN-006 RETIRED S32 (§54 universal scope) — NOT authored (confirmed at type-system.ts:23305).
- E-TYPE-006/024/025/026 placed in ss71 (match), NOT ss69, to avoid double-count.
- E-ENGINE-001 (illegal-transition, runtime) + E-REPLAY-001/002/003 (§51.14) added to ss56 — TIER-SPLIT
  tier-1 but the brief's ss56 enumeration omitted them; hits TIER-SPLIT's "~22" engine estimate exactly.
- E-COMPONENT-020/035 added to ss68 `[tier-1?]` — the brief listed 11, TIER-SPLIT says "~14"; both are
  component-resolution/invariant contract.
- E-BATCH-001 → ss66 (TIER-SPLIT tier-1 server; ss66-landed found it NOT compile-pinnable → known-gap note).
- I-AUTH-REDIRECT-UNRESOLVED → ss60 (TIER-SPLIT "I-AUTH-REDIRECT").
- E-META-EVAL-001+002 → ss74 (brief's fold-choice); ss65 carries a fold-note only.
- E-CONTROL-FLOW-IN-MARKUP + E-LOOP-007 → ss75 `[tier-1?]` (§17 control-flow, TIER-SPLIT-silent).
- Considered-but-EXCLUDED (not TIER-SPLIT tier-1): E-BATCH-002 (runtime throw), E-SYNTAX-012 (match
  nested-pattern; leans tier-2), E-CLOSURE-001/002 (reachability/internal invariant), E-TYPE-051 (SQL
  column naming), E-PAGE-ROUTE-ATTR-FORBIDDEN, E-UNQUOTED-DISPLAY-TEXT, E-LIFECYCLE-015/017 (element-config).
