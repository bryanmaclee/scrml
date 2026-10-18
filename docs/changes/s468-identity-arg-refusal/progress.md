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
