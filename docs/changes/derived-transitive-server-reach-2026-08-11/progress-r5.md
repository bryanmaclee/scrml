# derived-transitive-server-reach — ROUND 5 (S345 dispatch, dtr-r5)

Append-only. Branch `dtr-r5`, cut from `4b3f36f0` (= tag `review/derived-transitive-r4`).
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8acc65319ba91a90`.

Input: the S239 round-4 review work order (6/6 lenses, 10 blockers, each dual-verified by
execution) at
`/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/d127780a-…/scratchpad/dtr-r5/WORK-ORDER.json`.

## Mandate (from the dispatch brief)

1. STRIKE the false "codegen honours the import shadow, so suppression and emission agree"
   claim at all four sites (SPEC.md:3724, SPEC.md:19572, route-inference.ts:3744, :3821).
   Do not soften — it is false, not imprecise.
2. REMOVE the transitive limb's params-only carve-out. The limb suppresses on NOTHING.
   Newly-rejecting → run the corpus direction-of-change differential and REPORT counts.
3. FIX §11l — the test that RATIFIES the miscompile — and point an executed-artifact
   assertion at that shape.
4. FIX the §6.6.19 provenance citation (S345 does not contain the shadow-semantics ruling).
5. RESOLVE the §6.6.19 internal contradiction (:3723 unscoped SHALL vs residual 3).
6. RE-VERIFY every residual by COMPILING the shape it describes.

Out of scope (report, do not build): the DIRECT-limb leak itself (pre-existing; codegen
untouched by this arc), lexical scoping (S345 Q1(c), queued), `docs/known-gaps.md`
(PA-owned this session).

---

## [entry 1] baseline established by execution, before any edit

Tree at `4b3f36f0`, clean. Compiles via `compiler/bin/scrml.js`, artifacts under
`/tmp/dtr-r5/out/`.

**B1 — transitive params carve-out (blockers 1/2/4/8).**
`src/p1-param-bite.scrml`: `function doHash(p){return hashPassword(p)}` +
`function wrap(doHash, extra){return doHash("x") + extra}` + `const <computed> = wrap((v)=>v, @pw)`.
→ EXIT 0, zero errors. Emitted `p1-param-bite.client.js`:

```
49: async function _scrml_fetch_doHash_3(p) { … }
61: async function _scrml_wrap_4(_scrml_fetch_doHash_3, extra) {
62:   return await _scrml_fetch_doHash_3("x") + extra;
67: _scrml_cs_derived_declare("computed", () => _scrml_wrap_4((v) => v, _scrml_cs_reactive_get("pw")));
```

Codegen renamed the PARAMETER BINDING itself to the fetch stub and coloured `wrap` async, so
an async function is bound into a synchronous derived recompute. RI suppressed on that same
parameter name. Confirmed: the carve-out is exactly where RI and codegen disagree.

**B2 — direct-limb RHS-local shadow (blockers 0/3/6/7/9).**
`src/q3-direct-rhs-shadow.scrml` = the §7 unit pin's own source, verbatim.
→ EXIT 0, zero errors, NO `.server.js`, `client.js:21 const { hashPassword } = _scrml_stdlib.auth;`,
and the runtime the HTML loads (`scrml-runtime.00i7w5p2.js`) carries 4 hits of
`Bun.password` / `argon2id` (`:1679 return Bun.password.hash(password, { algorithm: "argon2id" });`).

**B3 — direct-limb cross-arm shadow.** `src/f2-direct-crossarm.scrml` (binder in `.Idle`,
GENUINE reference in `.Busy`) → EXIT 0, and `client.js:37
else if (_scrml_match_2 === "Busy") return hashPassword(_scrml_cs_reactive_get("pw"));`
— a live client-side call to the real import, handed the secret.

**B4 — the leak is NOT shadow-specific (new, mine; the review's one REFUTED verdict was
right about this).** `src/s1-strlit.scrml` is §6's own normatively-ratified string-literal
pin (`const <label> = "call hashPassword on the server"`, no shadow anywhere):
→ EXIT 0, same runtime hash `00i7w5p2`, `Bun.password` = 4, `client.js const { hashPassword }
= _scrml_stdlib.auth;`. Control `src/s2-unused-import.scrml` (same import, name absent from
the source text): runtime hash `003881zc`, `Bun.password` = 0.

**Mechanism, read at the fire site** (`compiler/src/codegen/emit-client.ts:2898-2945`, stage
`prune-server-only-stdlib-chunks`): the chunk is kept whenever the bound local name matches a
word-boundary regex over the joined emitted client body (`:2934-2943`). A shadowed binder
occurrence is a textual occurrence; so is a string literal's characters. Route inference is
never consulted. So the direct limb's suppression — in EVERY form, not just the shadow — is
artifact-blind, and the round-4 agreement claim is false for the whole limb.

Consequence for the round-5 text: the residual must be stated as "any occurrence route
inference declines to treat as a reference", not "the shadow", or the replacement sentence
would itself be false-because-too-narrow.
