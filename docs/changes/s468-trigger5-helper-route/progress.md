# progress — s468-trigger5-helper-route

- 2026-10-17T15:17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a8652604a36a6b2cf, base 5c43c3b8e (== origin/main). bun install (puppeteer postinstall failed: chrome download — not used by gate), pretest ok. BRIEF.md = COMMON.md + BRIEF-trigger5.md verbatim.
- 2026-10-17T15:28 REPRODUCED on a clean `git archive 5c43c3b8e` (`~/.cache/scrml-agent-tmp/s468-trigger5-helper-route/base`):
  `function helper(n: int) -> int { return n * 2 }` called only by `function save(n) { ?{INSERT…}.run(); const r = helper(n); return r }`
  → server exports `__ri_route_helper_1` + `__ri_route_save_2`, client has `_scrml_fetch_helper_4`, `POST /_scrml/__ri_route_helper_1 {"n":5}` → `200 10`,
  and the module's `fetch()` answers it `200 10`. (Expected: no helper route, no stub; only `async function helper` peer.)
- Locus trace: RI Step 5c (`runRI`, caller-context fixed point) promotes `helper` (reason `caller-context-propagation`); Step 6
  gives EVERY server-boundary fn a `generatedRouteName` (only `channel-ws-handler` is exempted); emit-server's route-handler loop
  and emit-functions' stub loop then emit a route + stub for every fn with a route name. Hypothesis HELD for both files; refined:
  the decision point is Step 6's route-name assignment, and the fix is a post-Step-6 RI pass, not a 5c change.
- GOVERNING (quoted):
  - §13.4 "The callee SHALL NOT generate an additional HTTP route when called from a server-escalated caller. The compiler SHALL
    inline the callee's logic into the caller's generated server handler."
  - §13.4 "If function A (server-escalated) calls function B (server-escalated), and function B is also referenced from client
    code, the compiler SHALL generate TWO representations of B: one inlined version (used by A's server handler) and one
    fetch-based route handler (used by client call sites of B)."
  - §12.6 reads §13.4 the same way: "this is the same structural case as §13.4, where a server-escalated callee with no
    client/wire caller generates no separate HTTP route."
  - §12.3's "For each server-escalated function, the compiler SHALL generate: A server-side route handler. A client-side fetch
    call…" is the general rule §13.4 specialises (the route exists "used by client call sites of B").
- Direction of change: SEMANTICS-CHANGED (no program's acceptance changes; a request to a compiler-internal route that only the
  server called now 404s). Not newly-accepting, not newly-rejecting. Corpus measured below.
- Scope note: the governing sentence covers every server-escalated callee, not only Trigger-5 promotions, so the rule is keyed
  on the §13.4 condition (has a server caller, no client reference) — a `?{}` helper only server code calls loses its route too.
  Kept routes (old behaviour, fail-safe): CPS-split, SSE, `onserver:*`, `<channel>`-body fns, explicit `server`/`route=`/`method=`,
  exported, no same-file server caller, or the name appears as a token anywhere outside server-placed bodies.
- 2026-10-17T15:38 FIX (route-inference.ts `markServerCallersOnly`, post-Step-6; emit-server.ts skips the route-handler loop
  for `serverCallersOnly`, keeps the fn in `serverFns` so its peer callable is emitted; emit-functions already skips a null
  route name). Executed: repro → server routes `[save]`, no `_scrml_fetch_helper`, `async function helper` peer present,
  module `fetch()` returns null for the old helper path, production `_server.js` answers 404 (test pins it).
- Rounds found while measuring (each fixed before landing):
  - a comment naming the helper kept its route (token scan read `comment` nodes) → comments skipped.
  - a CPS-split caller kept the helper's route although the client wrapper only calls the batch → only the CPS function's
    client statements + params count as client tokens (server statements run in the batch; emit-functions CPS wrapper).
  - security-await-pack `s10/topDestrParamDefault` went PASS-REFUSED → PASS-500: the base refusal came only from the route
    handler's invalid output for a destructuring param (`const [object Object] = …`); the peer drops the binding. Boundary:
    only plain-identifier params are admitted. Filed g-server-fn-pattern-param-peer-drops-bindings-s468 (pre-existing).
- MEASURED (base = git archive 5c43c3b8e; differential flags provenance INCOMPARABLE only because the archive has no git):
  corpus 2840 sources (examples, samples, conformance/cases, stdlib): 0 compile-failure delta, 0 diagnostic changes,
  0 syntax delta; 178 artifact diffs of which 163 are the absolute project-root string; 15 real diffs in 5 sources, all route
  removals: examples/17-schema-migrations (lookupUser), examples/19-lin-token (redeem), conformance dg-001-cyclic-neg (loadPet),
  first-class-fn-ref-server-helper-rt (sumAmounts), sql-hoisted-loop-write-between-iterations-rt (bump, bumpTwice).
  flogence 31 sources: 0 error-set changes, 0 route-set changes. security-await-pack classify: base == head (PASS 249,
  PASS-REFUSED 136, PASS-500 20, PASS-DENY 8, UNJUDGED 1, FAIL 10) — 0 new FAIL, 0 changed shapes (after the param boundary).
