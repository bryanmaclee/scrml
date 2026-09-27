# progress — s435-l19-reversal (append-only)
- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aeb8f36c7f0ec0f85, base 996c9aeda (== origin/main); bun install + pretest OK
- SPEC §5.2.3 rewritten (inline block legal+canonical; S435 banner); §5.1 note; §5.2.1/§5.2.2 updated; §4.14 cross-ref (NOT extended); §34 row NARROWED (unbraced bare `;` seq + §4.14 locus); §50.15 updated; SPEC-INDEX regen + row 5 / topic lines.
- TS measured (probes p1-p12): braced accepted everywhere; drops in <each> rows (all forms) + call-first blocks (existing carried gap).
- Filed 4 gaps (1 HIGH carried + 3 open), extended g-expr-handler-drops-every-statement-after-a-leading-call, SUPERSEDED note on bug-17-l19.
- 5 new conformance cases (3 PASS, 2 XFAIL); 3 existing case rationales updated. conformance 967/973 + 6 xfail, exit 0. unit+integration+conformance: 25333 pass 0 fail.
