# progress

- 2026-09-30T10:46:02-06:00 start; base c53b297a7; bun install + pretest ok
- 2026-09-30T11:14:25-06:00 D1+D2 implemented (route-inference findRoutePrefix build-relative + computeBuildRoot; api buildRoot option; CLI pass-through; W-AUTH-REQUIRED-NOT-INHERITED). Local gate 26717 pass / 0 fail. New tests fail 16/20 on base source (adversarial check). First commit attempt: 5s timeout flake (--emit-reachability determinism) under memory pressure (~1GB available; siblings running).
- 2026-09-30T11:50-06:00 fix landed 93b3ca286 (hook green on retry). Phase 3 HTTP: build before /about 200+body, after 302 /login; /login 200 both; authed (seeded session, __Host-scrml_sid) 200. dev before 200, after 302 (also after a watch recompile). MEASURED 1223 units / 2117 outputs: 0 output diffs, 0 diagnostic diffs. conformance 1144/1151 (7 pre-existing xfail). §34 row W-AUTH-REQUIRED-NOT-INHERITED + both gap entries resolved.
