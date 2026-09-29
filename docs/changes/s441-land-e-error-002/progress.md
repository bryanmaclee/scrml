# s441-land-e-error-002 progress

- 2026-09-29 start; startup checks pass (base cf62b4154 == origin/main)
- 2026-09-29T06:40:11-06:00 merged worktree-agent-ae3f795fdfd7f8631; 1 conflict (SPEC-INDEX.md generated ranges -> ours + regen); known-gaps auto-merged, all 1297 @gap ids from both sides present; state.ts + facts.ts regen
- 2026-09-29T06:47:55-06:00 §19.6.6 reconciled (formFor submit route = the one handler-time exception, cross-ref §41.14.3; impl#1 Nominal note); §19.4.3 cross-ref; §41.14.3 Nominal note covers both cases; gap g-formfor-onsubmit-error-discarded currency. Reproducers: plain handler + handler-in-boundary -> E-ERROR-002; render-in-boundary -> clean; formFor+boundary -> result discarded (not routed); formFor no boundary -> no E-ERROR-005 (both Nominal, pre-existing)
- 2026-09-29T07:05:51-06:00 verify: core suite 26031 pass/70 skip/12 todo/0 fail; conformance 1056/1063 + 7 xfail (origin/main: 1047/1054 + same 7 xfail); pushing
- 2026-09-29T07:51:41-06:00 S441 fix round: reference E-ERROR-002 implemented (ruling 'yes on references'); SPEC §19.4.3 references paragraph + handler-site message templates + item 4 + §19.4.4 + §34 rows + §19.6.6 PA note + carried gaps; conformance 1058/1065 + 7 xfail; corpus 2041 files -> 0 newly failing
