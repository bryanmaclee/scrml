# progress — s468-cps-unbound-cluster

- 2026-10-17T15:17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-ae6f1de09f4838fc3; branch s468-cps-unbound-cluster from origin/main 5c43c3b8e. bun install (puppeteer postinstall exit 1 — browser download step; node_modules present), pretest OK.

## 2026-10-17T15:40 — reproduced on origin/main 5c43c3b8e (executed compiles)

Reproducers (version-stamped) at `$HOME/.cache/scrml-agent-tmp/s468-cps-unbound-cluster/r1/app.scrml`, `r2/app.scrml`;
compiled with `bun compiler/bin/scrml.js compile <f> -o <dist>`.

- **Gap 1** (`g-cps-split-local-from-session-unbound-on-server-s467`) — REPRODUCES, in a WORSE form than filed. After #1435
  the server batch no longer reads `uid` unbound: it reads it FROM THE REQUEST (`const uid = _scrml_body["uid"]`) — #1435's
  carried-local admission admitted it as browser data. The client wrapper computes `const uid = session.userId` (the §20.5
  projection object, which has only `.current` → `undefined`) and sends it. A forged request body `{"uid":"victim"}` is
  inserted as the author: identity spoofing at exit 0. (The filed "no `session` in scope" on the client no longer holds —
  the projection `var session` is emitted.)
  Adjacent shapes measured: `@last = "x"` before the local (same), `const s = @session; const o = { u: s.userId }` (server
  reads `_scrml_body["o"]`), `const getU = () => @session.userId` (server reads `_scrml_body["getU"]` — a function through
  JSON, TypeError), a file-level `function who() { return @session.userId }` called in the `?{}` (server calls `who()` —
  unbound, see DEFERRED), `@last = @session.userId` then `${@last}` in the `?{}` (cell marshal — see DEFERRED).
  `@session` directly in the `?{}` / between two server statements → E-SESSION-AMBIENT-SERVER (already refused).
  `const uid = session.userId` (the server session object) → statement placed in the server batch,
  `_scrml_req._scrml_sess.userId` — correct.
- **Gap 2** (`g-server-fn-calls-cps-split-fn-unbound-s467`) — REPRODUCES: `app.server.js` handler of `outer` calls `add(m)`,
  no `add` anywhere in the module (free-name scan of the emitted module: `add` is the only non-import/export free name).
  Adjacent shapes, all unbound: transitive `outer -> mid -> add`; inferred-server `outer` (a `?{}` + `add(m)`); a CPS-split
  `g` whose server batch holds `add(m)` (rule 1 places it there); `add` also having a client caller. A CLIENT `g` calling
  `add` is fine (calls `_scrml_cps_add_N`).

## Locus (traced)

- Gap 2: hypothesis HELD for the mechanism, REFINED for the fix site. `emit-server.ts` peer-callable collection skips
  `_proute?.cpsSplit` (correctly — a split function has no server-side callable; its cell writes run in the browser). The
  decision that should refuse is route inference: Step 5c-bis E-ROUTE-002 runs BEFORE CPS splitting and only knows the
  DOM-pinned set; nothing ever asked "does server code reach a split function".
- Gap 1: hypothesis WRONG as a codegen locus. `route-inference.ts` `analyzeCPSEligibility` → the S467 round-5 admission
  allow-list (`carriedValueAdmission`) admits `uid` as browser data; codegen faithfully emits `_scrml_body["uid"]`.

## Governing sentences

- Gap 1 — §6.6.9 (SPEC.md:3858-3862): "The ambient identity singletons `@currentUser` and `@session` (§20.5 / §52) are
  compiler-provided server-side singletons, NOT `state-decl` client cells. … `@session` is server-only identity and SHALL
  NEVER be marshalled from the client — doing so would be a spoofing hole." and (:3876) "No server lowering SHALL read
  `@session` from the request body". §19.9.9.8 rule 4: statements before the first server statement are never moved, so
  the read cannot be relocated to the server either (where it would be E-SESSION-AMBIENT-SERVER, §6.6.9 / §20.5). The
  parameter-default sibling (§7.3.2, E-PARAM-DEFAULT-SERVER-IDENTITY) already refuses the same flow through a default.
- Gap 2 — §12.4 (SPEC.md:10129-10134): "**Reactive cells are client-only (S451 R2).** … a function that READS or WRITES a
  reactive cell … is a client-only function for the rule above. A server-escalated function whose static call graph reaches
  such an access through a callee, directly or transitively, SHALL be E-ROUTE-002, and the message SHALL name the chain
  down to the function that touches the cell and the cell itself." A CPS split exists only when the body writes a cell
  (`findReactiveAssignment` gates `analyzeCPSEligibility`), so every split callee is in that rule. (The §34 E-ROUTE-002
  row marks the R2 limb "Nominal / not yet emitted by impl#1 (frozen)"; this lands the split-callee subset of it.)

Direction: both NEWLY-REJECTING (each shape compiled at exit 0 and failed or spoofed at run time). Corpus measurement
pending.

## 2026-10-17T17:20 — fix landed on branch (f25abff94)

- route-inference.ts: (gap 1) after `analyzeCPSEligibility`, every `carriedLocals` entry is followed with free-name.ts
  `identityReadInDefaultDeep` (function-local provenance first via `bindingsOfFile` over the body + every statement that may
  write the local per `localsWrittenBy(…, true)`; parameters not followed; else the file resolver). An identity read →
  E-RI-002 naming `const <local> = session.<field>`. First cut failed CLOSED on `unresolved` provenance and refused the
  legal s467 flow `xs.forEach((x) => { n = n + x })` (raw-text write) — replaced by scanning the writing statements.
  (gap 2) new Step 6b after the route table is built: server code (wholly-server body; a CPS function's server-batch
  statements via `walkBodyForTriggers(...).callees`) → same-file callees → through non-split server peers → a split
  callee is E-ROUTE-002 with the chain and the written cell.
- free-name.ts `identityReadIn`: `@session` / `@currentUser` in raw text recognised (was `session` only). Also tightens the
  §7.3.2 default check for raw-text defaults (newly-rejecting there too; corpus: no change).
- Verified: every new refusal test FAILS on the origin/main route-inference.ts (10 of 18 at that point), passes on head.
  #1435 suites (cps-server-logic-stays-server-s462 + browser, s465-cps-pre-first-stays-client, s466-cps-guard-stays-server,
  s467-cps-carried-admission, s467-cps-nested-writes-and-callees, unit cps-split-server-tier-s462) + route-inference-e-route-002,
  s466-server-param-defaults, session-ambient-server-refused: 285/285 pass.
- security-await-pack classify: before PASS=249 PASS-REFUSED=136 PASS-500=20 PASS-DENY=8 UNJUDGED=1 FAIL=10 (all known-fail);
  after identical, per-case classes byte-identical.
- Corpus (`scripts/corpus-emit-differential.ts`, default roots, 2,847 sources, base = this worktree at 5c43c3b8e): 0 newly
  failing, 0 newly passing, 8,578/8,578 artifacts byte-identical, syntax delta 0. 3 already-failing gauntlet samples gain
  E-ROUTE-002 (gauntlet-r10-bun-admin, gauntlet-r13/elixir-pipeline, gauntlet-r13/htmx-forms) — all the "INSERT then
  reload" idiom (CPS fn's server batch calls another CPS fn). Real (non-fixture) newly-failing sites: 0.
- Pre-commit gate (full): before 37099 pass / 0 fail / 125 skip; after 37123 pass / 0 fail / 125 skip.
- Gap ledger: both markers → resolved; filed g-cps-rule1-split-callee-placement-ruling-s468 (RULING),
  g-cps-cell-written-from-session-marshalled-s468 (HIGH), g-cps-server-half-calls-client-fn-unbound-s468,
  g-cps-carried-function-value-marshalled-as-json-s468. state.ts / facts.ts regenerated, --check PASS.
