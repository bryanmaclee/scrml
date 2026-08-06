# BRIEF — server-fn route handlers SHALL return a `Response`

change-id: `authed-server-fn-bare-return`
dispatched: S325-bryan, 2026-08-06
agent: `scrml-js-codegen-engineer` · `isolation: "worktree"` · model opus
gap: `g-authed-server-fn-route-returns-bare-value-not-response` (HIGH)
DONE-PROBE: bun test compiler/tests/integration/authed-server-fn-response-http.test.js >/dev/null 2>&1

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST (stamp `a3a34d80`, source walk `0d9d843d`; current main
`74d60fb0` — the only landing since the walk is a docs-only wrap, so the map is CURRENT for source).
Follow its **Task-Shape Routing** table. For this task also read **`auth.map.md`** (its "Session
read-side" block) and **`dependencies.map.md`**. Treat map content as a verify-against-source
HYPOTHESIS. **Report the load-bearing map finding in your final message — including "not
load-bearing" if that is the honest answer.**

⚑ From the routing table, binding on this task: **`bun scripts/corpus-emit-differential.ts` is the
standing PRE-LAND GATE for ANY change under `compiler/src/codegen/`.** It is NOT in `ci.yml`, NOT in
`bun test`, NOT in a hook. Run it BY HAND, base-vs-head: `capture` each side, then `diff`.
**`diff` exit 2 means NOT A VALID COMPARISON — do not read it as "no differences".**

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. First action: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Also confirm `git rev-parse --show-toplevel` equals that path and the tree is clean.
   **If any check fails, STOP and report — do not proceed.**
2. `bun install` (a worktree does NOT inherit `node_modules`; the hook fails on `acorn` otherwise).
3. `bun run pretest` (populates the gitignored `samples/compilation-tests/dist/` browser fixtures).
   Use `bun run test` (chains pretest) for baselines, never bare `bun test` for a full run.
4. Every Read/Write/Edit uses an ABSOLUTE path under the worktree root. Edit/Write are the CORRECT
   tools (the S126 Bash-only mitigation is RETIRED — the PreToolUse hook guards Edit/Write and the
   isolation guard now REFUSES Bash heredocs). **NEVER `cd` into the main checkout**; use
   `--cwd "$WORKTREE_ROOT"` for `bun` and `git -C "$WORKTREE_ROOT"`.
5. First commit message: `WIP(authed-server-fn-bare-return): start at $(pwd)`.
6. Commit after EACH meaningful unit — do not batch. Append to `progress.md` (timestamped: what was
   just done, what is next, blockers). WIP commits are expected; the branch is the crash anchor.
7. **NEVER `--no-verify`, and never override `core.hooksPath`.** If a hook blocks you, report it.

---

## THE DEFECT (measured by the PA, S325 — evidence, not hypothesis)

A `server function` route handler emits a real `Response` **iff** `useBaselineCsrf` or the A9-Ext-5
idempotency flag is set. Otherwise the adopter's `return` becomes the handler's `return` verbatim,
or is wrapped only by `_egressRedact`. **Both hosts the compiler ships dispatch with
`return route.handler(req)`** — `dev.js:598` and the built `_server.js:57` — so a bare value goes
straight to Bun, which answers `200 text/plain "Welcome to Bun! To get started, return a Response
object."`

MEASURED end-to-end on BOTH hosts: on a synthetic `<program auth="required" csrf="auto">` app the
auth gate passed, the CSRF gate passed, the body executed, the correct value was computed — and
14/14 probes logged `error: Expected a Response object, but received '<value>'`.

**The predicate is WIDER than `auth=`.** `auth=` is sufficient (it zeroes `useBaselineCsrf`) but not
necessary — `protect=` / tenant-active does it too. Return shape, arity, `csrf=` mode and `session`
usage are all IRRELEVANT (measured across 12 emission variants). In `examples/23-trucking-dispatch`,
**59 of 66** server-fn handlers are in the bare-return class, driven by a protected `password_hash`
column.

**NOT affected — these already take an always-`Response` path and must stay byte-identical:**
`serverLoad` data routes (`<x server> = ?{…}`), `<endpoint>`, the reserved `/_scrml/*` routes.

## THE CONTRACT DECISION (already made — do not re-litigate)

**Route handlers SHALL return a `Response`. The EMITTERS are wrong, not the hosts.**

Governing-sentence gate: the PA searched §12.5, §40.2, §20.5 and the §34 route rows and found **no
sentence stating the route-handler return contract** — recorded as a finding. The direction was then
decided on the pa-base §1 FORK RULE, all four structural rows agreeing: requiring a `Response`
LIMITS rather than widens, fails CLOSED, is the reversible direction, and fixes the ROOT rather than
the boundary. Per the S278 precedent, emitted-JS shape is compiler-spec, not language-spec, so this
is not a language ruling.

`provenance: rationale:fork-rule-all-four-rows · measured-S325-bare-return-defect`

## UNIT 1 — make the emitters produce a `Response`

**LOCI ARE PA-LOCATED HYPOTHESES — VERIFY, and report whether each HELD, was REFINED, or was WRONG.**
The PA searched for these by symbol; it did NOT trace execution to them.

- `compiler/src/codegen/emit-server.ts:3488` — `useBaselineCsrf = !authMiddlewareEntry && isStateMutating && _webAppShape`
- `:4085-4092` — the no-wrapper path (adopter `return` becomes the handler `return`)
- `:4102` — `return _egressRedact(_scrml_result);` (its own comment says *"returns a raw value (the pre-floor behavior)"*)
- `:4127` — the A9-Ext-5 `_ext5DedupNonCsrf` path

Requirements:
- Every server-fn route handler returns a `Response` on EVERY path, in every combination of
  `auth=` / `protect=` / tenant / `csrf=` / idempotency.
- **Preserve the egress-redaction and tenant floors.** `_egressRedact` / `_scrml_protect_redact` must
  still run on the value BEFORE it is serialized — §14.8.9 and §14.8.10 are confidentiality floors and
  a refactor that serializes pre-redaction is a security regression. Probe this explicitly.
- Match the existing `Response` shape the `useBaselineCsrf` path already produces (status,
  `Content-Type`, body encoding) so the emitted client stub keeps working unchanged. Read that path
  and mirror it; do not invent a second envelope.
- A void/no-return handler must still produce a well-formed `Response`.

## UNIT 2 — `.get()` prototype + own-property guard (separable, no ruling needed)

`emit-server.ts:2568` — the session accessor is `get(key) { return this._rec[key] ?? null; }`, with no
`hasOwnProperty` and no prototype guard. MEASURED: `.get("__proto__")` returns `Object.prototype`;
`.get("constructor")` / `.get("toString")` return functions; and through the `?{}` interpolation path
`constructor` is an **HTTP 500** (SQL bind TypeError) reachable from a request-controlled key.

Make `.get()` an own-property read (return `null` for anything not an own property of `_rec`).
This is a plain robustness fix with **no language-surface change** — it does not narrow any documented
behaviour (`session.get(k)` for a real key is unchanged).

**Explicitly OUT OF SCOPE: any reserved-key denylist / key policy.** That is an open language ruling
with bryan and is NOT yours. Do not add one, do not add a diagnostic for it.

## UNIT 3 — THE TEST METHODOLOGY, and this is the load-bearing unit

**This class survived because of how the tests are written, not because of a coding mistake.**

`compiler/tests/integration/auth-csrf-synchronizer-token.test.js:222-225` asserts the defect as
CORRECT, verbatim:

```js
// Retry with the matching token → gate passes → body runs → returns "ok".
expect(r2 instanceof Response).toBe(false);
expect(r2).toBe("ok");
```

The same file's `statusOf` helper (`:209`) silently tolerates either shape. That tolerate-or-assert-bare
pattern is at **19 sites across 5 files**: `auth-csrf-synchronizer-token.test.js`,
`session-establishment-roundtrip.test.js`, `session-secure-b4b5-roundtrip.test.js`,
`csrf-canonical-delivery.test.js`, `session-context-gate-b2b3.test.js`.

1. **You MUST flip those assertions.** A fix that leaves all 19 passing unchanged is WRONG — it means
   you did not change the behaviour they encode. Expect them to fail, and correct them to assert the
   `Response` and its status/body. **Report the count you changed.**
2. **Add `compiler/tests/integration/authed-server-fn-response-http.test.js`** that EXECUTES — drive
   the route through `Server.fetch(new Request(...))` (per the S273 ruling: no real socket, it races
   under load) and assert on the real `Response`, its status, and its parsed body. **Do NOT write a
   test that calls `route.handler(req)` and inspects the raw return — that is the exact methodology
   that hid this class.** Cover at minimum: `auth="required"`, `protect=`-active-without-auth,
   both together, and a no-auth control that must stay unchanged.
3. Prove the bite: with your emitter fix reverted, the new test MUST fail. Confirm red, restore,
   confirm green, and report both. A gate that has never failed is indistinguishable from one that
   cannot (pa-base §8).

## VERIFICATION — all of it, before you report DONE

- `bun run test` full suite green (chains pretest).
- **`bun scripts/corpus-emit-differential.ts`** base-vs-head (`capture` both, then `diff`). This is the
  standing hand-run pre-land gate for codegen. Report the artifact-content delta, the syntax delta under
  all three goggles, and the bare-server-fn-site count. Exit 2 = invalid comparison, NOT "no diff".
- **R26 empirical:** recompile real adopter sources
  (`../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` and `examples/`) on the post-fix baseline
  via `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>`. The symptom check is
  **the emitted handler's terminal return is a `Response`**, NOT "tests pass".
- **Compile AND RUN `examples/23-trucking-dispatch`** and report how many of its 66 server-fn handlers
  now terminate in a `Response`. Note: that app has a SECOND, independent defect — it never calls
  `session.set`, so its compiler auth gate can never open and its routes `302 → /login`. You will
  probably not be able to exercise the bodies. **Do not "fix" that; report it.**
- **DO NOT mark DONE without the empirical pass.** Regression-tests-pass is not empirical-pass.

## REPORT BACK

Worktree path · final commit SHA · files touched · for EACH named locus whether it HELD / was REFINED /
was WRONG · the count of test assertions you flipped · the corpus-differential numbers · the bite proof
(red then green) · the trucking-dispatch count · anything you deferred and why. If the contract decision
turns out to be wrong on contact with the code, **STOP and report** rather than building around it.
