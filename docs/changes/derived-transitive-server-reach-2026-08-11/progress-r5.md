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

---

## [entry 2] mandate 2 + 3 — the params carve-out is gone (commit `a00d2050`)

`computeServerReachingFns` no longer subtracts anything from `live`. The limb suppresses on
NOTHING.

- `compiler/src/route-inference.ts` — the `callerRecord.fnNode.params` subtraction deleted;
  the shadow-discipline comment rewritten to record the measured mechanism
  (`post-fn-name-mangle`, `emit-client.ts:2955-2998`, is a raw-text alternation pass whose
  lookahead `(?=\s*[(;,}\]\n)]|$)` matches a parameter inside a parameter LIST, so the
  BINDING is renamed).
- §11l `BITE — a hop caller's own PARAM still suppresses` FLIPPED to `FIRES`, asserting the
  chain `const <computed> -> wrap -> doHash`, plus a NEW non-colliding-param differential
  control so the refusal is attributable to the name and not the shape.
- conf §6 `SHADOW_SHAPES` gains `hop-param` — the executed-artifact oracle the round-4 table
  deliberately did not point at this shape — plus an artifact-level control asserting the
  renamed-parameter twin emits `function _scrml_wrap_N(fn, extra)` with NO `async`.

End-to-end verification after the change: `p1-param-bite.scrml` now exits 1 with the chain
message and the correct root cause (`doHash` is on the server because it reaches `scrml:auth`).
Arc unit + conformance: 128 pass / 0 fail. Full unit suite: 17591 pass / 0 fail / 20 skip.

## [entry 3] mandate 1 — the false claim is STRUCK at all four sites (commit `e9b905d9`)

Struck, not softened, at: `SPEC.md:3724` · `SPEC.md:19572` (§34 row) ·
`route-inference.ts` `collectDerivedRhsLocalNames` · `route-inference.ts` the `"rhs-locals"`
doc — **and a fifth site the brief did not enumerate**, the §7 unit-test comment
(`route-inference-derived-server-only-reach.test.js:320-328`), which carried the same claim
verbatim ("RI's suppression agrees with what actually runs"). Leaving it would have left the
false sentence in the repo, so it is struck too.

What replaces it is the measured record, as a new **DIRECT-limb residual** in §6.6.19: the
suppression governs the DIAGNOSTIC only; the module ships anyway because codegen's prune
predicate is textual; the leak is not shadow-specific (the ratified string-literal
suppression leaks identically); and the RHS-wide suppression additionally silences a genuine
sibling-arm reference codegen emits as a live client-side call. Attribution recorded
explicitly: PRE-EXISTING, codegen untouched by this arc, closure is its own arc.

## [entry 4] mandates 4 + 5 + 6 (commit `bda6c08f`)

**Provenance.** `SPEC.md:3700` no longer says "round-4 shadow semantics per ruling:S345".
Verified against `scrml-support/user-voice-scrml.md`: S345 contains three rulings (Q1 Gap-5 at
:14192, Q2 file-the-40, Q3 zero-byte objects) and none is the shadow semantics. The shadow
semantics now carry a `rationale:` citation (the PA-authored silent-miss-vs-loud-over-fire
constraint), an explicit statement that they carry NO operator ruling, the S343 asymmetry they
apply — quoted verbatim from `user-voice-scrml.md:14167` and flagged as applied to shapes S343
did not have in front of it — and the house-style "no debate or DD ratified the direction"
disclosure (the precedent is §12.5.3's S326 note). The S345 citation is kept only for Q1(c).

**Internal contradiction.** `SPEC.md:3723`'s unscoped "any depth … including inside an RHS
that does not structurally parse" is now limb-scoped, and so is the §34 row's opening. Both
halves verified by execution: `e-strlit-block.scrml` (direct limb, block-bodied arrow, name
only inside a string literal) → REFUSED; `r3-unparse.scrml` (transitive limb, one hop inside
an `if`-expression RHS) → NOT refused, `E-CODEGEN-INVALID-LOGIC` only. Residual 3 is accurate.

**Residuals re-verified by COMPILING each shape:**

| residual | shape compiled | result |
|---|---|---|
| 1 cross-file reach | `xfile/app.scrml` + `xfile/helpers.scrml` | exit 0; `const { doHash } = _scrml_modules["helpers.client.js"]` where that export IS `_scrml_fetch_doHash_3`, bound into `_scrml_cs_derived_declare("computed", …)` — **a rendered Promise**. SPEC under-stated this as "not caught"; corrected. |
| 2 same-file ambiguity | `res2-ambig.scrml` (two `function doHash`) | exit 0, does not fire — as stated. |
| 3 unparseable RHS | `r3-unparse.scrml` | exit 1 `E-CODEGEN-INVALID-LOGIC` only — as stated. |
| 4 function-valued bindings | `res4-let-alias.scrml` | exit 0; `let f = _scrml_fetch_doHash_3;` + `_scrml_cs_derived_declare("computed", () => f(…))` — **unchanged, still open.** |
| (over-fire claim) | `ovf-lambda-param.scrml` | refuses, as §6.6.19 states. |

**New residual 5** (recorded, not fixed): the "why" clause can name a function's own PARAMETER
as a captured server symbol. `function total(p) {…}` + `function summarize(total) { return
total + 1 }` + `const <s> = summarize(@n)` refuses with *"`summarize` is on the server because
it closes over the server-side symbol `total`"*. Root cause is `buildClosureCapturesForFunction`
(`route-inference.ts:4539`) building its param set with `new Set(fnNode.params ?? [])` while
`params` carries objects — the identical bug the file's own comment at :3413-3421 documents for
the sibling site and declines to fix there. The REFUSAL is right; the REASON is false about the
source. Closing it moves PLACEMENT, so it needs its own measured direction of change. NOT fixed
here.

## [entry 5] direction-of-change differential — RUN, with a stronger instrument

Instrument: `/tmp/dtr-r5/diff-run.mjs`. Compiles every git-tracked `.scrml` with one compiler
tree and records, per file, the **full sorted multiset of error-severity codes** plus the exit
disposition — strictly stronger than round 4's exit-code-plus-one-boolean, which the review's
instrument lens filed as under-reporting 11:1.

Trees: pre-round-5 = `09531d75` materialised via `git archive` to `/tmp/dtr-r5/base` (verified
to still carry the params subtraction at its :4125-4134); head = this worktree.

```
corpus files                                          : 2362
identical disposition + identical error-code multiset : 2362
newly REJECTING (base clean -> head errors)           : 0
newly ACCEPTING (base errors -> head clean)           : 0
same disposition, DIFFERENT code multiset             : 0
E-DERIVED-SERVER-ONLY-REACH hit set  base: 5  head: 5  (identical files)
```

The five are this rule's own cases: `conformance/cases/derived/e-derived-server-only-reach-{lambda-hop,nested-loop,pos,transitive}/case.scrml` and
`docs/changes/s331-derived-rhs-server-only-escalation/reproducer.scrml`.

**Instrument positively controlled** through the same driver: the round-5 reproducer
(`probe-p1.scrml`, a hop caller whose parameter collides) →
base `{"ok":true,"codes":[]}` / head `{"ok":false,"codes":["E-DERIVED-SERVER-ONLY-REACH"]}`.
So the zero is a measurement, not a blind spot. Recorded limit: the instrument compares
DIAGNOSTICS, not emitted artifacts.

## [entry 6] the brief's one factual error, surfaced

The brief states the round-3 alias blockers (`let f = doHash`, `let api = { run: doHash }`,
`const g = (p) => doHash(p)`) are "confirmed FIXED". **They are not.** The work order records
them under `confirmed_nonblocking[0]` as "DOCUMENTED, not CLOSED", and round 5 re-measured
`let f = doHash` at exit 0 with the async stub bound through the alias (entry 4, residual 4).
What round 4 actually fixed was the FALSE in-code claim that Step 5b already refused them.
They are pinned — §11m of the unit test, three pins asserting 0 diagnostics as documented
misses, plus a `function`-form BITE control — so the "pin them if not already pinned" half of
the brief is satisfied, and nothing in round 5 regresses them.
