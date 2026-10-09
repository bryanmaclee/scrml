# progress — s460-aprime-land

- 2026-10-08 start; branch s460-aprime-land @ d5c9ef382; startup verified; bun install + pretest OK.
- F1 reproduced on impl#1 (cli compile): narrows simple `if (x is some|given) {}`, `is not` early-return, bare `if (x)`, ternary, bare `if=@x`; E-TYPE-046 on `x is some && …`, `x is given && …`, `if=(x is given)`, `if=(x is some)`.
- SPEC edits: §42.2.2a (impl#1 status + honest provenance: `is some` PA-added at S237, narrows by alias = PA reading), §42.3.5 item 2 note, §42.4 st.6 (any Error in span; not fail-open) + st.8 (partly Nominal), §34 row cascade text aligned, §49.2.3 regex-loop sentence dropped, §17.2 condition xref, provenance lines §42.1 / §42.6 / §42.7 / §49.3. Gap g-impl1-condition-rule-s460 extended. SPEC-INDEX / FACTS regenerated; master-list left (stale only from main's wraps).
