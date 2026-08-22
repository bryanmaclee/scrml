# F1 — ratelimit= scope restoration (per-route, not per-request)

Branch: `handle-onion-top-level-dispatch`
Base at dispatch: `b70db793bfcbca8f0adf0ee5bb1a3763b5e70db0`

## Status
- [x] Startup gate passed (5/5)
- [ ] SPEC §40 read in full
- [ ] Locus verified (hypothesis: emit-server.ts:3045-3047, build.js:503, dev.js:1070)
- [ ] Fix shape chosen
- [ ] Fix landed in all three dispatchers
- [ ] Reproducer flips (req #4 -> 200)
- [ ] Cross-module bleed flips
- [ ] Limiter still fires on real route requests
- [ ] Executing regression test added
- [ ] Gate run + new-failure name set compared

## Log
- Startup gate: pwd/toplevel/branch/status/HEAD all as briefed. Clean.
- Crash anchor committed (BRIEF.md verbatim + this file).

## Locus verdict — HYPOTHESIS HELD, but the "three dispatchers" framing was wrong
- `emit-server.ts:3046-3047` IS the ratelimit call site (inside `_scrml_mw_wrap`,
  which the branch re-mounted at top-level dispatch). Hypothesis held.
- `build.js:503` (`const _scrml_onions = [...]`) and `dev.js:1070`
  (`return runThroughOnions(...)`) ARE the mount points — confirmed.
- BUT: `grep -c ratelimit` is **0** in both `build.js` and `dev.js`. Neither host
  contains any rate-limiting code; both mount whatever `_scrml_mw_pipeline` the
  compiled module exports. There is exactly ONE decision site. Fixing
  `emit-server.ts` fixes all three hosts, and touching build.js/dev.js would
  CREATE the divergence the brief warned against.

## Shape chosen — a route-match predicate gating the top-level limiter
Rejected: a per-route `_scrml_ratelimit_wrap(handler)`. It would put the limiter
INSIDE `downstream`, i.e. AFTER `handle()` PRE, inverting SPEC §40.2/§40.3.3
("CORS -> rate limit -> ... -> route handler"; "[rate limit] -> handle() PRE"),
and it would spread the decision across the two route-registration sites so any
future site silently opts out.

Chosen: `_scrml_is_rate_limited_route(req)` emitted next to `_scrml_check_ratelimit`,
gating the existing call at its existing position. Position unchanged (still
before handle() PRE); only the SET of counted requests is restored to route
traffic. It reads the module's OWN `routes`, which is what scopes the limiter per
module and makes the cross-module bleed fall out for free.

Cost, stated honestly: the route table is scanned twice on a route hit. It is a
short array of string compares, and it buys the SPEC ordering.

## SPEC note (surfaced, not resolved here)
The brief's governing sentence (SPEC:1080 / E-PAGE-INVALID-ATTR) classifies
`ratelimit=` as a PER-ROUTE attribute — that is a DECLARATION-SCOPE taxonomy
(`<page>` may carry it; `title=`/`cors=`/`headers=` may not), not literally a
statement about which requests the limiter counts. §40 does not contradict it,
but it does not restate it either: §40.2/§40.3.3 are ORDERING statements, and
§40.3.4 gives `handle()` an explicit "including statically-served assets"
carve-in that `ratelimit=` conspicuously lacks. The decisive evidence is that
main (`77a7b381`) counted route traffic only, so this is a REGRESSION restoration.
Recommend SPEC add one sentence to §39.2.4 making the scope explicit. Not done
here — out of scope for a fix round.

## Verification (all EXECUTED against the emitted server, no text-grep oracle)
| case | pre-fix | post-fix |
|---|---|---|
| one page load, `ratelimit="3/min"` (html/css/runtime/client) | 200,200,200,**429** | 200,200,200,200 |
| 3 page loads = 12 requests | 429 from #4 on | all 200 |
| 404 x5 | 200,200,200,429,429 | all 404 |
| bleed: alpha=2/min, `GET /beta.html` x5 | 200,200,**429**,429,429 | all 200 |
| limiter fires: POST route x4, `ratelimit="2/min"` | 200,200,429,429 | 200,200,429,429 |

## Log
- Fix landed in `compiler/src/codegen/emit-server.ts` (single decision site).
- Regression test `compiler/tests/unit/ratelimit-per-route-scope.test.js`:
  9 tests, all EXECUTING. Adversarially verified — reverting the fix flips
  7 of 9 to fail; the 2 that stay green are exactly the §3 counter-tests that
  guard against a "fix" that merely disables the limiter.
- Test-harness finding: happy-dom's `Headers` (globally registered by earlier
  browser tests, never unregistered) DROPS the forbidden `Cookie` header, so the
  emitted double-submit CSRF check answers 403 in a full-suite run and 200
  standalone. Probed directly: native `Cookie` -> "a=b", happy-dom -> null.
  Pre-existing environmental leak, NOT a regression. The route assertions now pin
  the limiter (reached vs 429) instead of the incidental CSRF status.
