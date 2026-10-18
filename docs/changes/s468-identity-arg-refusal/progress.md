# s468-identity-arg-refusal — progress (append-only)

- 2026-10-17T23:30Z — start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a459ac2a2574845f2.
  Startup verified (worktree root, clean, merge-base == origin/main bbddfd7b9). `bun install` (puppeteer
  postinstall exits 1 — chromium download; not used by the unit/integration/conformance gate), `bun run pretest` OK.
- BASE: branch `s468-identity-arg-refusal` is cut from `origin/s468-cps-unbound-cluster` (d48cf9d56, PR #1442,
  not yet on main), NOT origin/main. Reason: the design reuses #1442's `free-name.ts` raw-text `@session` /
  `@currentUser` recognition (a template interpolation `${@session.userId}` in an argument is otherwise invisible
  to the identity follower) and its carried-local resolver shape (function-own provenance + mutating writes via
  `localsWrittenBy`). Land #1442 first.
- BRIEF.md = COMMON.md + BRIEF-identity-arg-refusal.md, verbatim.
- Baseline gate (pre-commit hook on the first commit, bd3e9e0d0 = #1442 head + docs): 37123 pass / 125 skip /
  13 todo / 0 fail, 1589 files, 1539 s.

## Reproducer (EXECUTED, origin/main bbddfd7b9)

`~/.cache/scrml-agent-tmp/s468-identity-arg-refusal/repro/r1.scrml` (scrml 0.8.0):

    <program db="./app.db" auth="required">
      function add(name: string, uid: string) {
        ?{`INSERT INTO posts (author, body) VALUES (${uid}, ${name})`}.run()
      }
      <button id="go" onclick=add("hi", @session.userId)>add</button>
    </program>

`bun repro/forge.mjs <compiler-root> r1.scrml <work>` compiles it, then POSTs to the `add` route with the
ATTACKER's session cookie (`userId: "attacker"`) and body `{name: "hi", uid: "victim"}`.
- base (origin/main bbddfd7b9): `COMPILE: ACCEPTED (exit 0)`; `status 200; rows = [{"author":"victim","body":"hi"}]`.
  The client emits `_scrml_fetch_add_3("hi", session.userId)` — the browser's projection value, sent in the body.
- r2 (`@currentUser.id` instead): same — ACCEPTED, row authored `victim` (client emits
  `_scrml_cs_reactive_get("currentUser").id`).
- head: `COMPILE: REFUSED — E-ARG-SERVER-IDENTITY: argument 2 (`uid`) of this call of server function `add`
  carries an identity — it is computed in the browser from `@session.userId` … Fix: remove the `uid` parameter
  and read the identity on the server, inside `add` — `const uid = session.userId`.` No artifacts written.

## Governing sentence

The ruling IS the governing text (brief): user-voice-scrml.md S468, "your recos on both", item (2):
> "(b): a value derived from `@session` / `@currentUser` used as an argument to a server function is a compile
> error naming the fix (read the session on the server); newly-rejecting, fail-closed, corpus MEASURED before
> landing (real code newly refused returns to bryan)."
Supporting normative sentence, §6.6.9: "`@session` is server-only identity and SHALL NEVER be marshalled from the
client — doing so would be a spoofing hole." Written into SPEC as a §12.4 bullet + §34 row (E-ARG-SERVER-IDENTITY,
minted: no existing E-ROUTE-*/E-AUTH-* row covers an argument — E-AUTH-001 is a client `@var` bound in `?{}`,
E-PARAM-DEFAULT-SERVER-IDENTITY is a parameter DEFAULT, E-RI-002 a CPS carried local / cell write).

## Locus

Brief hypothesis: binding-provenance.ts + free-name.ts (the gap marker). REFINED: the follower
(`identityReadInDefaultDeep`) was right and is reused unchanged in shape; what was missing was (1) any check at an
ARGUMENT position at all (route-inference.ts gained Step 6c over a compilation call index), and (2) a resolver that
answers at a LOCATION — parameters (call-site arguments), mutating writes, loop / `<each>` binders, per-scope locals.
That is new module `compiler/src/identity-flow.ts`; free-name.ts gained `resolveName(name, at)` + `rootAt` + a
per-binding `key`; binding-provenance.ts exports `declaredNamesOf`; `localsWrittenBy` gained a `cells` flag.
The §7.3.2 default check now uses the same resolver (closes the gap's param / mutation routes for CPS defaults).

## Design decisions

- Server-placed callee = route boundary `server` (wholly-server or CPS-split), not a channel `onserver:*` handler.
- Client context = not under a wholly-server function, a CPS server statement, a `?{}`, an `<endpoint>`, a `^{}`.
- A value computed ON THE SERVER is not followed (a server function body, a CPS server statement, a `?{}`, a call
  of a server function): a server result travelling back through the browser is ruling (2)(d), banked — NOT
  refused here. §52 server cells likewise are not identity for this check (they are for the default check, as before).
- Raw text the parser keeps unparsed (block-bodied callbacks) is checked whole, plus the raw arrow's parameters.
- A function passed as a markup attribute value: an event handler receives the event; a component prop is
  substituted by component expansion, whose calls of it are call sites of their own (verified: CE emits
  `relay(@session.userId)` in the expanded markup; the refusal follows `u` into it).
- A name assigned in raw text: the argument check follows the raw text that writes it (scanned whole); the default
  check keeps its long-standing fail-closed reading (`followRawAssigned: false`) — no newly-accepting change there.

## Measurement (direction of change: NEWLY-REJECTING)

- In-process compile scan of every `.scrml` under examples, samples, conformance/cases, stdlib, benchmarks,
  /home/bmacs/scrmlMaster/giti, /home/bmacs/scrmlMaster/flogence — 2960 sources, base = bd3e9e0d0 compiler,
  head = this branch's compiler (both in-repo): **0 sources whose error-code set changed; 0 E-ARG-SERVER-IDENTITY;
  0 new E-PARAM-DEFAULT-SERVER-IDENTITY.** (`repro/scan.mjs` + `repro/cmp.mjs`.)
- First cut measured 2 REAL sites (examples/23-trucking-dispatch pages/dispatch/load-detail.scrml, load-new.scrml)
  — both FALSE POSITIVES of the first cut, not identity flows: a function passed to a component prop
  (`onTransition=transition`) was treated as "passed as a value → unfollowable", and the server call itself
  (`transitionStatusServer(tok, loadId, target)`) counted as a mutating writer of its own arguments. Fixed at the
  root: a markup-attribute use of a function contributes no sources (component expansion substitutes the prop,
  so the component's calls are call sites of their own — verified the refusal still follows a component that
  DOES call the prop with `@session.userId`), and a value computed by a server call is a server result (not
  followed). Re-measured: 0.
- `scripts/corpus-emit-differential.ts` (roots examples, samples, conformance, stdlib, benchmarks; 2847 sources;
  base = archive of bd3e9e0d0, head = same + this change): compile-failure delta **0 newly failing / 0 newly
  passing**, diagnostic changes 0, syntax delta 0, bare server-fn sites 29 → 29. 167 "content diffs" are ALL the
  `_scrml_project_root` string (the two archives live at different paths): after normalizing that path, 8578 of
  8578 artifacts are byte-identical. (Verdict prints "NOT A VALID COMPARISON" only because an archive has no git
  revision.)
- security-await-pack `classify.js` (base bd3e9e0d0 vs head): PASS 249 / PASS-REFUSED 136 / PASS-500 20 /
  UNJUDGED 1 / PASS-DENY 8 / **FAIL 10 → identical; 0 new FAIL.**
  **CORRECTION to commit 9c27a625e's message** ("security-await-pack: FAIL 10 -> 9"): that figure came from an
  intermediate cut in which two pack shapes (m4/appExportConstAnn, m1/topLetAssignLater — no session at all) were
  refused by E-ARG-SERVER-IDENTITY as FALSE POSITIVES ("the callback's arguments cannot be followed" for a lambda
  bound by `export const` / a reassigned `let`). Fixed before that commit landed (a lambda bound to a name receives
  what every call of the name passes; binding-provenance binds an exported value to its parsed tree); the
  committed code measures FAIL 10 = 10. Both shapes are pinned as NOT-refused in the integration test.

## Gates

- pre-commit hook on 9c27a625e: 37178 pass / 125 skip / 13 todo / 0 fail (37316 tests, 1591 files).
  Baseline was 37123 / 125 / 13 / 0 — +55 = the two new test files.
- `scripts/types-gate.ts --check`: OK — 180 diagnostics (113 distinct), unchanged.
- Validated against MAIN too: origin/main (bbddfd7b9, has #1434's F4 refusal) + #1442 + this branch's
  compiler/src + tests patched cleanly; the 5 identity test files: 169 pass / 0 fail. Tests accept
  E-ASYNC-FN-ESCAPES-AS-VALUE alongside (a lambda binding that calls a server function is refused by F4 on main).
- facts.ts / state.ts regenerated (FACTS: +1 compiler/src file); `--check` PASS both; SPEC-INDEX regenerated.

## Executed forged requests

- base (origin/main): r1 ACCEPTED; forged request (attacker cookie, body `uid: "victim"`) → 200, row authored
  `victim`. Same for r2 (`@currentUser.id`).
- head: r1 / r2 REFUSED at compile (E-ARG-SERVER-IDENTITY), no artifacts. The fix form (`const uid =
  session.userId` inside `add`) compiles and writes the REAL session id whatever the body says (integration test
  "the fix: …", executed against the emitted server route).

## Not covered / notes for the PA

- Ruling (2)(d) (banked): a value the browser received from a server result (`@rows = loadRows()` then
  `save(@rows[0].owner)`; a §52 server cell) is NOT refused — deliberately; the follower stops at server-computed
  values. That is the server-only-value-kind deliberation.
- Precision limits (fail-closed, measured 0 corpus hits): a lambda whose parameter flows into a server call is
  refused as unfollowable when it is passed to a user function that hands the callback on to something other
  than a direct call, or when it sits somewhere other than a call argument / a name binding / a markup attribute
  (an object-literal field, a returned lambda).
- Observed on this branch's base (pre-#1434), NOT on main: `export const w = (u) => add("hi", u)` in a page
  compiles with no `w` in client.js (the handler calls an undefined `w`); the builder kept no `valueInitExpr` for
  the un-annotated form, so the call inside is raw text. On main #1434's F4 refuses the binding
  (E-ASYNC-FN-ESCAPES-AS-VALUE), so no follow-up filed.
- Did NOT edit the gap marker (brief); added a resolution note under it in docs/known-gaps.md.
- Message precision (after 9c27a625e): an `@currentUser.<field>` read is reported with its field (free-name.ts
  `identityReadIn`, as `@session.<field>` already was), so the fix names `const uid = @currentUser.id`.

## FIX ROUND 1 (S239 review of 79b34a878, PR #1451) — commit 89700c8ee

Reproduced every item with the reviewer harness `~/.cache/scrml-agent-tmp/s468-rev-idarg/h/` (run.mjs over
a1–a6, f1–f4) on 79b34a878 before fixing.
- H1 DONE: a `function` declaration's parameter default (source text) is read from at-refs.ts's parsed default
  tree, resolved where the function is declared; destructured `{ u } = {…}` parameters (a `destructure-object`
  pattern as `name`) are bound. b23, d11, d12, e15–e18 now REFUSED.
- H2 DONE: a CPS-split callee is followed as a helper with its server statements pruned (free-name.ts
  `prune`); only wholly-server calls are server results. k01/k02 REFUSED; a CPS helper whose server batch reads
  `session.userId` but returns browser data is not refused (test).
- F1 DONE: predicate subtrees (filter/find/findIndex/findLast/findLastIndex/some/every/sort/toSorted callbacks,
  ternary + `if` conditions) do not taint — argument check only (`ignorePredicates`); §7.3.2 default check
  unchanged. m01/m02/m03/f17 accepted; a ternary BRANCH / `.map` still refused (tests).
- F2 DONE: per-parameter mutation summary (identity-flow.ts `paramMutated` over the injected `localsWrittenBy`,
  now taking a `callArgWritten` hook): a user call writes argument i only if the callee mutates parameter i
  (transitive, positional; rebinding is not mutation; recursion fails closed). f14/g01/g02/h03/m04 accepted;
  g02 (identity in the used position) and mutate-through-callee still refused (tests).
- H4 (rest params / `arguments`) — CLOSED rather than filed: `"... args"` (the builder's spacing) now binds,
  and `arguments` in a function resolves to every argument of every call. e01/e02/e06 REFUSED (tests).
- Gate on 89700c8ee: pre-commit 37200 pass / 125 skip / 0 fail; targeted suites (identity, s466 param
  defaults, s468 cps, s467 carried admission, s462 cps) 446/0; types-gate unchanged.

## PAUSED (S468 wrap)

Done: H1, H2, F1, F2 (code + tests, commit 89700c8ee); H4 closed in code (not filed).
NOT done:
- SPEC narrow: the §12.4 bullet / §34 row still read as written in 9c27a625e; they must be narrowed to what is
  enforced and list the carried limits (H3 alias mutation; component-prop object values `o={ u: @session… }`
  — probe c13, still accepted; f09/f10/f15 flow-/field-insensitive refusals) pointing at the gaps + dpa-071.
- H3 gap NOT filed yet (MED): mutation through an alias — a40, a45, b13–b16, b29, d16, d17, e08 still
  ACCEPTED-SPOOFED; c13 (component prop object) to go in the same entry. H4 needs no gap (closed) — note it.
- Re-measure NOT finished for round 1: security-await-pack classify (FAIL set == base), corpus scan
  (scan.mjs / cmp.mjs vs scan-base.json), corpus-emit-differential, S467 param probes
  (~/.cache/scrml-review-s467-param-r5/cases via repro/codesdir.mjs, base2 vs head). Run all before landing.
- progress/known-gaps note to update with the round-1 figures; FACTS already regenerated in 89700c8ee.

## RESUMED S469 (branch s469-1451, worktree agent-a7f8339dfedb7424e)

- 2026-10-18 — resumed from origin/s468-identity-arg-refusal 89700c8ee; the old worktree's one uncommitted file
  (this progress.md) carried over (byte-identical to the hand-off diff) — 7234a1ca1.
- Merged origin/main 38e7ab398 (#1442 now on main; the stacked base dissolves) — e0e39ee1e. Conflicts only in
  generated docs (SPEC-INDEX.md, FACTS.md) — regenerated; known-gaps gap-id union verified. Pre-commit gate on the
  merge: 37677 pass / 125 skip / 13 todo / 0 fail (1602 files).
- Reviewer harness re-run on the merged tree (a1–a6, f1–f4): ACCEPTED-SPOOFED attack probes are exactly the carried
  H3 set a40 a45 b13 b14 b15 b16 b29 d16 d17 e08 + c13; every other attack probe REFUSED; controls f/g/h/m accepted
  except f09 / f10 / f15 (flow-/field-insensitive refusals, carried) and f16 / g03 / g04 (a cell that DOES receive the
  identity from another handler — true positives: the cell persists across clicks).
- §12.4 bullet + §34 row NARROWED: "What the compiler follows" (exact list, incl. H1 defaults / rest / `arguments`,
  H2 CPS browser statements, F2 mutated-parameter rule, F1 predicate-only reads), "Not covered", and "Known limits
  of this check (impl#1)" — (a) alias mutation + component-prop object literal NOT refused, (b) flow-/field-
  insensitive refusals — with the floor-not-the-model sentence pointing at dpa-071.
- FILED `g-identity-arg-via-alias-mutation-s468` (MED, open) under the s467 entry; gap-counts regenerated (MED +1).
- 2026-10-18 — RE-MEASURED (fix round 1 + merge; base = archive of origin/main 38e7ab398, head = this branch):
  - in-process scan (repro/scan.mjs): examples + samples + benchmarks + giti + flogence 1157 sources → 0 changed
    outside stdlib; conformance/cases 1844 → 0 changed; stdlib 54 (each side its own copy) → 0 newly refused, 15
    newly passing = base-archive E-IMPORT-008 (environment: the archive lacks what stdlib/compiler imports).
    E-ARG-SERVER-IDENTITY: 0 files; E-PARAM-DEFAULT-SERVER-IDENTITY: 0 files, both sides. **0 real sites newly refused.**
  - corpus-emit-differential (2857 sources): 0 newly failing / 14 newly passing (the same stdlib/compiler
    E-IMPORT-008 archive artifact); after normalizing `_scrml_project_root`, the sqlite path prefix and per-path
    8-char hash ids, 8533 / 8533 common artifacts identical; syntax delta 0; bare server-fn sites 29 → 29.
  - security-await-pack classify: base == head (PASS 264 / PASS-REFUSED 355 / PASS-500 17 / PASS-DENY 3 /
    UNJUDGED 1; 640 shapes; 0 FAIL).
  - S467 param probes (~/.cache/scrml-review-s467-param-r5/cases, 96): newly refused t1 t2 t3 t4 t7 t8 t16 (the
    gap's param / mutation / loop routes — true positives); newly ACCEPTED t5 (`function other() { const me =
    @session.userId }` shadowing an outer `const me = "x"` — base's refusal was a scope false positive; the outer
    `me` the default reads is the literal).
- `bun run test` (full compiler/tests/): 40376 pass / 171 skip / 17 todo / 51 fail. The 51 are browser / e2e
  files outside the pre-commit gate: 48 fail standalone on this branch AND on the origin/main archive (same files, same or larger counts on main) (E-TYPE-031 `email`
  validator in bug60, transitions, engine dispatch, soft-nav, …) — pre-existing; 3 (s462 handler-helpers, s457
  url-guard, e2e detector-validation) pass standalone on this branch — full-run cross-file interference. Pre-commit gate: 0 fail.

## FIX ROUND 2 (S469 re-review of f9be1befc = LAND-WITH-FOLLOWUPS)

- 1 MED (object shorthand fail-open) — CONFIRMED by execution before the fix: `const o = { userId }` +
  `add("hi", o.userId)`, `{ u }.u`, `[{ u }]`, `pick({ u })`, top-level, `@o = { u }`, mixed, spread,
  `add("hi", { u })`, a parameter `{ u }`, `Object.assign(o, { u })`, `xs.push({ u })`, `{ id }` of
  `@currentUser.id` — all ACCEPTED-SPOOFED (row author VICTIM). Cause as the reviewer said: the deep follower
  (free-name.ts `identityReadInDefaultDeep`) followed only `kind: "ident"`; the parser's `{kind:"shorthand", name}`
  property was never followed. FIXED in every identity walker that reads names: the deep follower; the
  `session`-builtin reader (`{ session }` in a server default — E-PARAM-DEFAULT-SERVER-IDENTITY); identity-flow.ts
  call index (a function shorthand `{ save }` is a function passed as a value — fail closed, as `{ save: save }`)
  and the lambda-hand-on walk (`{ cb }` hands the callback on). All 15 shapes now REFUSED; tests added
  (integration "S469 — object shorthand").
  NOT touched (outside identity; surfaced): `exprReadsFreeSession` (server-PLACEMENT trigger) also ignores a
  shorthand `{ session }` — a function whose only `session` use is `{ session }` is not server-placed.
- 2 LOW — §12.4 Known limits (a) now names predicate laundering / implicit flow (n14 `.find(...).owner`, n15
  `if (x == @session.userId) q = x`), both re-executed ACCEPTED-SPOOFED, stated plainly as delivering the
  identity's value; the predicate rule is called a deliberate gap. §34 row likewise.
- 3 LOW — f09 (`@x == @session.userId`) moved to "refused by design" (a browser "is this me" answer). Message:
  a read in the argument itself "carries an identity — it is computed in the browser from …"; a value reached
  through a binding "may carry an identity — it reads `q`, which can hold a value computed in the browser from …,
  and the compiler cannot rule that out"; unresolved "may carry an identity — … so it cannot rule out an
  identity". Two existing assertions on "(through `u`)" updated to the new wording.
- Corpus (item 1 can only add identity refusals): head scan over examples, samples, conformance/cases, stdlib,
  benchmarks, giti, flogence = 3001 sources → E-ARG-SERVER-IDENTITY 0, E-PARAM-DEFAULT-SERVER-IDENTITY 0. One
  CRASH (samples/gauntlet-s19-phase4/nested-comments.scrml, stack overflow) is pre-existing — the same in every
  S468 scan including base.
