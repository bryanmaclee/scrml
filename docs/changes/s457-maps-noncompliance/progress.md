# progress — s457-maps-noncompliance

- 2026-10-07T12:09:33-06:00 start; base 0d8e9d8ce = origin/main; pretest ok (34 dist files)
- 2026-10-07T12:09:33-06:00 item1: NOT_A_VERB += fix-client-server-call, fix-sql-failable; facts --write; --check PASS; FACTS verbs 12 = cli.js dispatch chain (12)
- 2026-10-07T12:17:02-06:00 item2: fix.js HELP + header and fix-s66.js header now say sql-failable rewrites reads only, writes listed; other rule help lines + options checked vs code (consistent); compiler/tests/commands 0 fail
- 2026-10-07T12:27:23-06:00 item3: bootstrap-conformance --write (1391 cases; PASS 121 FAIL 56; ~60s); --check current twice; ci.yml gate step: PR-only, path-scoped (git diff base...HEAD -- conformance/cases compiler/self-host-v2), staleness blocks; filter logic simulated (no-touch exit 0, #1335 exit 1, bad sha 128 -> check runs). conformance/run.ts 1341/1391 + 50 xfail
- 2026-10-07T12:39:38-06:00 item4 PROBE (no walker change): E-ATTR-INTERP-EXECUTABLE fires top/engine/match (href javascript: and onclick) — it walks via walkEveryMarkupNode, not walkFileAst. MISSED in engine+match bodies: VP-3 E-CHANNEL-007, VP-1 W-ATTR-001, W-TRY-CATCH-IN-SCRML-SOURCE; post-CE E-COMPONENT-035 fires in engine (S429 compensation) but MISSED in a <match> arm (emits phantom <Zork></Zork>, exit 0). Done.
