# s443-worker-d1-d2 progress

- start: worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aeaa079ea457b2066, base c6fec3c24 (ff to origin/main)
- BEFORE (dev, Chromium): primes.worker.js 404; button stuck 'Computing…'; second click impossible (disabled)
- BEFORE (build + bun _server.js, main compiler): same 404 + stuck.
- impl: emit-worker (wire format {id,data}/{replyTo,data}, <page>-<name>.worker.js), emit-client (listener router, no onmessage assignment), emit-logic (when message/error from -> addEventListener), api.js (write + gate + manifest seed)
- AFTER (dev :4732 and build :4733, Chromium): 168 for 1000, button back to "Find Primes", second run 25 for 100. worker 200 text/javascript; _server.js 404.
- blast radius (Chromium probe): 2 workers/page ok; 2 hooks same worker both fire, source order; unsolicited 2nd reply fires hooks, doesn't resolve; concurrent sends correlate (20/40/9, pending drained); when error fires, hooks survive; esm dev ok; --emit-per-route: Worker stays in client.js, bundle written; multi-page tools/calc -> tools/calc-dbl.worker.js, 42 at /tools/calc and /tools/calc.html
- measured: output changes only in 13-worker, when-002-message-handler, 2 conformance capability cases (lang="ts" nested program — pre-existing misclassified as worker)
- tests: updated 5 unit files to new shape; new integration nested-program-worker-runtime.test.js (9 tests, real Bun Worker)
