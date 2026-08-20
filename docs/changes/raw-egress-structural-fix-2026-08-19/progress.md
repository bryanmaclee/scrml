# progress — raw-egress structural fix + dpa-033 (c)

Append-only. Timestamps local.

## 2026-08-19 — startup + empirical reproduction (PA locus HELD)

**Done**

- Worktree isolation asserted: `pwd` == `git rev-parse --show-toplevel` ==
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a00a8f44d41f15897`, tree clean.
- Base asserted: `merge-base HEAD origin/main` == `origin/main` == `HEAD` == `3b5eed44`.
- `bun install` (217 packages) · `bun run pretest` (13 samples compiled).
- BRIEF recovered from `origin/feat/raw-egress-structural-fix` via `git checkout FETCH_HEAD -- docs/changes/...`.
- Maps: read `.claude/maps/primary.map.md` Task-Shape Routing. Load-bearing rows —
  row 16 (§12.5 response contract / invariant 44: `instanceof Response` passthrough sits BEFORE
  `_egressRedact`, deliberately) which is the exact mechanism defect 1 rides;
  row 19 (`bun scripts/corpus-emit-differential.ts` is the standing PRE-LAND gate for any
  `compiler/src/codegen/` change, NOT in CI, run by hand base-vs-head);
  invariant 55 / row "you are about to write a REGEX over source text in a stage that already has
  the AST" — the Rule 7 census, which is this dispatch's whole shape.
- **Baseline** `bun run test`: **30038 pass / 57 fail / 216 skip / 1 todo** across 1366 files
  (386 s). All 57 failures are browser / dev-watcher / TodoMVC-dist tier; none touches
  protect/egress. Names captured for the post-fix diff.

**PA locus: HELD.** `compiler/src/codegen/protect-egress.ts:274-303` `detectProtectedRawEgress`,
fired from `compiler/src/codegen/emit-server.ts:1812-1839`. Confirmed by reading + by execution.

**Defects reproduced (all by compiling, not by reading):**

1. `new globalThis.Response(JSON.stringify(u))` — compiles **exit 0, zero diagnostics**. Emitted
   `.server.js:206-207` carries `_scrml_protect_tag(row, ["passwordHash"])` at the read and a bare
   `new globalThis.Response(...)` at the sink; `:209`'s `instanceof Response` passthrough returns it
   BEFORE `_scrml_protect_redact` at `:210`. Replayed the emitted helpers + emitted handler tail:
   **`SHIPPED BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}` — the secret ships.**
2. Bare `new Response(...)` fires **`E-SCOPE-001: Undeclared identifier \`Response\``** — `Response`
   is absent from `LOGIC_SCOPE_GLOBAL_ALLOWLIST` (`type-system.ts:7257`). The compiler steers the
   author onto the spelling that silences the gate.
3. Cross-value `reveal`: `other.reveal("passwordHash")` on a `WHERE id = 999` row suppresses the
   gate for the actually-returned `u`. Only `E-SCOPE-001` fired; **`E-PROTECT-004` did not.**
4. **NEW — same root cause, not in the brief.** The foreign-block regex is
   `/(^|[^A-Za-z0-9_$])_\{/`, which matches ONLY the level-0 `_{` opener. The opener grammar is
   `_` + N `=` + `{` (`block-splitter.js:2286`), so the **canonical `_={ … }=` form that SPEC
   §23.2.4a's own worked example uses** bypasses the gate: compiles clean, and the emitted slice
   `JSON.stringify(u)` yields a plain string that `_scrml_protect_redact` passes through untouched.

**AST shapes established empirically** (temporary dump at the fire site, since reverted):
`?{}` → `{kind:"sql", query}` (attached as `sqlNode` on let/const/return) · `new Response(...)` →
`{kind:"new", callee:{kind:"ident",name:"Response"}}` · `new globalThis.Response(...)` →
`{kind:"new", callee:{kind:"member", object:{ident "globalThis"}, property:"Response"}}` ·
`.reveal(...)` → `{kind:"call", callee:{kind:"member", property:"reveal"}}` · `asIs` →
`typeAnnotation:"asIs"` (and `returnTypeAnnotation` on fns) · `_={}` → `{kind:"foreign"}`.

**Next**

- Implement the structural detector over the parsed fn tree (member-chain callee resolution).
- Allowlist the §40.3.5 HTTP vocabulary.
- Delete the body-wide `reveal` suppressor.
- Population differential (old regex vs new structural) over the corpus — both counts.

**Blockers** — none.

## 2026-08-19 — structural detector + allowlist + reveal deletion COMPLETE; commit ENV-BLOCKED

**Landed in the working tree (anchored as `wip-source.patch.txt`, see the blocker note below)**

- `compiler/src/codegen/protect-egress.ts` — `detectProtectedRawEgress` now takes the fn NODE and
  walks the parsed tree (`astReadsCurrentUserAmbient` precedent: identity seen-set, depth cap 128,
  `span` skipped). Egress kinds are node-kind / callee questions; the constructor callee resolves
  through its MEMBER CHAIN (`terminalName`), so `globalThis.Response` / `window.Response` answer as
  bare `Response`. `Response.json(...)` handled via `memberReceiverName`. `asIs` reads the
  `typeAnnotation` / `returnTypeAnnotation` FIELD. Egress-kind priority is fixed, not
  traversal-ordered. **The `reveal` suppressor is deleted.**
- `compiler/src/codegen/emit-server.ts` — fire site passes `fn`, not a `_sourceText` slice;
  detection no longer depends on `_sourceText` at all. E-PROTECT-004's message no longer offers
  `reveal` as a resolution at a raw egress (it would not work).
- `compiler/src/type-system.ts` — `Response` added to `LOGIC_SCOPE_GLOBAL_ALLOWLIST`, scoped to the
  one name §40.3.5 constructs. `Request` / `Headers` / `FormData` deliberately NOT added.
- `compiler/SPEC.md` — three amendments, each carrying `provenance: ruling:user-voice-scrml.md S352`.
- `compiler/tests/integration/g-sql-row-protect-leak.test.js` — 6 new tests + 2 population guards.
- `conformance/cases/protect/` — 1 re-authored (renamed) + 4 new cases.

**Verification**

- Conformance **887/887** (was 883/883; +4 new, 1 renamed).
- Bite proof: the 6 new integration tests and the 4 new/re-authored codes cases ALL fail pre-fix and
  pass post-fix (verified by stashing `compiler/src` and re-running).
  `reveal-value-scoped-runtime` passes on BOTH sides — deliberately: it pins that the RUNTIME helper
  was always value-scoped, so the defect was the static suppressor alone.
- `corpus-emit-differential` base-vs-head over 1906 sources / 7383 artifacts:
  **artifact content diffs 0 of 7378 · compile-failure delta 0/0 · artifact set delta 0/0 ·
  effective syntax delta 0/0 · bare server-fn sites delta 0.** Source-set delta 2 = the case rename.
  Of 1227 differing diagnostic texts, **1224 are purely the capture work-dir prefix**; the 3 real
  changes are all `E-SCOPE-001` DISAPPEARING — including two real adopter sources
  (`samples/gauntlet-r13` and `r14 react-auth-dashboard.scrml`).
- **R26 empirical** on `gauntlet-r25/dev-{1..4}`: emitted artifacts byte-identical (md5) and
  diagnostic code sets identical, base vs head. No `_scrml_sql` / `passwordHash` in any emitted
  `client.js`. (Those sources use no `protect=`, so blast radius there is nil.)

**Population counts (base §8 coverage-removal question), measured by instrumenting the real fire
site over 1878 server-fn bodies corpus-wide (1598 of them protect-active):**

- **(A) sites the check STOPS looking at: 2** — `stdlib/compiler/meta-checker.scrml::typeToString`
  and `::buildFileTypeRegistry`, both matched by the old `/\basIs\b/` on the token inside a STRING
  LITERAL (`type.kind == "asIs"`, `["number", …, "asIs"]`). **Both false positives. Zero genuine
  coverage lost.**
- **(B) sites it NEWLY reaches: 10** foreign-block bodies (every `_={`-and-above opener level),
  **plus 4 kind-corrections** (`response`→`foreign`, where the `new Response` lived INSIDE the opaque
  slice, so `foreign` is the correct classification), **plus 9 on the SQL half** (a structured `sql`
  node present where the old backtick regex matched nothing).
- `_sourceText`-independence reaches **0** additional bodies in this corpus (every FileAST carried it).
- Bodies the deleted suppressor would have silenced: **2**, both conformance cases.

**Migration re-measured independently:** `grep -rl '\.reveal(' --include='*.scrml' .` = **2 files**,
both dedicated conformance cases. Zero adopter/sample/example usage. (Three other `.scrml` declare a
free `reveal()` function; the suppressor required the dot and none declares `protect=`.)

**BLOCKER — commit of the code change is environment-blocked, not code-blocked**

The pre-commit hook `--bail`s on `compiler/tests/unit/mcp-runtime-helpers.test.js`
`fs.watch reload (watch: true)` (2 tests). Root cause, measured: the per-user inotify instance cap
(`/proc/sys/fs/inotify/max_user_instances` = 128) is exhausted by **76 orphaned
`scrml dev --port 0` servers on `/tmp/scrml-dev-*` fixture dirs**, leaked by the dev-watcher tests,
aged up to 1d6h, all reparented. Direct probe: `fs.watch` returns `EMFILE` for 0 of 3 handles in a
fresh process. Both tests are in this dispatch's BASELINE at `3b5eed44` and still fail with the
source changes stashed, so they are pre-existing and causally unrelated.

`--no-verify` and `core.hooksPath` overrides are forbidden without operator authorization, and the
tool classifier (correctly) blocked reaping the orphans. The work is therefore anchored as an inert
`.txt` patch committed via the hook's docs-only lane. **This is a repo-wide condition: no agent on
this machine can commit a code change until those processes are reaped.**

**Next / deferred** — see the report.

## 2026-08-19 — adversarial self-review: two real findings, both closed

**1. Depth cap was a latent fail-OPEN.** The walk was capped at 128, copied from the
`astReadsCurrentUserAmbient` siblings (which use 64). But those walk markup/statement nesting only;
THIS walk descends ESTree expression trees, which nest one level per term — the same reason
`collectDerivedCellDecls` (route-inference.ts:3740) uses **512** with an explicit S337 note. On a
fail-CLOSED check, silently truncating the walk is a fail-OPEN: a body deep enough to hit the cap
escapes the gate with no diagnostic. Raised to 512 to match the security-walk precedent.

**2. A test elsewhere pinned the bug I fixed — and its author had predicted this exact moment.**
`compiler/tests/integration/authed-server-fn-response-http.test.js` asserted
*"the shape still build-blocks on E-SCOPE-001 (pins the upstream gate)"*, with the comment:
*"If this ever stops firing, the shape becomes adopter-reachable and the passthrough guard below
stops being belt-and-braces and becomes load-bearing."* That day is today. Verified by compiling:
`export server function deny() { return new Response("no", { status: 403 }) }` under
`auth="required"` now compiles **CLEAN**.

Consequence, and it is the substantive one: `if (_scrml_result instanceof Response) return
_scrml_result;` is now **LOAD-BEARING**. It is the only thing between an adopter's deliberate 403 and
a fail-OPEN 200 `{}` (a `Response` has no enumerable own properties, so enveloping it yields `"{}"` —
a DENY silently becoming a SUCCESS). The block's assertion is inverted and its scope comment rewritten
to say so; the EXECUTED test that proves the 403 survives is now primary evidence for a live adopter
path rather than a probe of an unreachable one. 17/17 pass.

**Residual bound documented rather than over-claimed:** callee resolution is SYNTACTIC. A local
rebinding (`const R = Response; new R()`) is not recognised — closing that needs the name resolver,
and the source-text form had the identical hole, so it is carried forward, not introduced. Only
`Response.json` is treated as a static-factory egress; `Response.redirect` / `Response.error` carry no
caller-supplied body.

**Test state**

- `compiler/tests/integration` + `compiler/tests/conformance` (post-all-edits): **4800 pass / 0 fail /
  50 skip** across 329 files.
- Full pre-commit scope: **28785 pass / 3 fail / 86 skip / 1 todo** across 1245 files. Of the 3: one
  was the `authed-server-fn-response-http` pin, fixed after that run started (re-verified 17/17); the
  other two are the pre-existing `fs.watch reload` env failures, present in the `3b5eed44` baseline.
  **Net new failures: 0.**

## 2026-08-19 — FINAL state + landing instructions

**Final test sweep (full pre-commit scope, post-all-edits, clean tree):**
**28786 pass · 2 fail · 86 skip · 1 todo** across 1245 files (385 s).
Both failures are `fs.watch reload (watch: true)` — the pre-existing inotify-exhaustion env
failures, present verbatim in the `3b5eed44` baseline. **Net new failures: 0.**

Corroborating targeted runs, all on the final tree:
`compiler/tests/integration` + `compiler/tests/conformance` → 4800 pass / 0 fail / 50 skip ·
`g-sql-row-protect-leak.test.js` → 44/44 · `authed-server-fn-response-http.test.js` → 17/17 ·
`bun conformance/run.ts` → 887/887.

## LANDING INSTRUCTIONS (the code is NOT committed as code — see the blocker)

1. Apply the patch:
   `git apply docs/changes/raw-egress-structural-fix-2026-08-19/wip-source.patch.txt`
   It carries **17 file changes**: `compiler/SPEC.md`, `compiler/src/codegen/protect-egress.ts`,
   `compiler/src/codegen/emit-server.ts`, `compiler/src/type-system.ts`,
   `compiler/tests/integration/g-sql-row-protect-leak.test.js`,
   `compiler/tests/integration/authed-server-fn-response-http.test.js`, and the
   `conformance/cases/protect/` set (1 rename + 4 new).

2. **Reap the orphaned dev servers first, or the pre-commit gate cannot run.** They are
   `bun … scrml.js dev /tmp/scrml-dev-*/entry.scrml --port 0` processes, ~76 of them, aged up to
   1d6h, all reparented, holding the per-user inotify instance cap. A dry-run lister is at
   `.tmp/repro/reap-orphaned-dev-servers.sh` (scoped to `scrml.js dev /tmp/scrml-dev-` + `--port 0`
   + age ≥ 30 min; SIGTERM). Confirm with:
   `bun -e 'const {watch}=require("fs"); try{watch("/tmp").close();console.log("OK")}catch(e){console.log(e.code)}'`
   — `EMFILE` means still exhausted.

3. **Regenerate `docs/FACTS.md` AFTER committing the content** (the pre-push gate blocks otherwise,
   and the gate's own note says regenerate after the last content commit):
   `bun scripts/facts.ts --write`
   Expected movement: specification lines **37,152 → 37,169** · conformance cases **883 → 887** ·
   `compiler/src` **240,680 → 241,277 lines across 188 files**.

4. Nothing else is owed. The corpus differential, R26, population counts and both-direction bite
   proofs are all recorded above and were run on this exact tree.

## Not touched deliberately (PA-owned / historical)

`spa-lists/ss60.progress.md` and `handOffs/incoming/read/ss60-spa-reintegration-2026-07-03.md` both
reference the old case name `protect/reveal-suppresses-e004`. They are historical progress records
and PA-owned shared docs, so an agent rewriting them is the wrong move — surfaced instead.
`handOffs/dpa-queue.md` and `handOffs/delta-log.md` also cite it, likewise left alone.

## 2026-08-19 — ROUND 3: the S239 adversarial pass's two blockers closed, plus H2/M2/M3/M4/L1/L2/L3/L5

Branch `raw-egress-r3-work`, cut from `origin/feat/raw-egress-structural-fix-land`
(tip `6ca6e468`). Every claim below was measured by COMPILING the shape and, where
a leak is asserted, EXECUTING the emitted handler — never read off the code.

**Method note.** The reproduction harness extracts the shipped `_scrml_protect_*`
helper block and the handler tail VERBATIM from the emitted `.server.js` (plus any
local helpers the body calls), evals them with a stubbed `_scrml_sql` returning
`{id:1, name:"ada", passwordHash:"$argon2id$SECRET"}`, and prints
`await resp.text()`. "The secret ships" below always means that string appeared in
an executed response body, not that a grep matched.

### ⛔ H1 — the depth cap was a silent fail-OPEN, and a REGRESSION vs `main`. CLOSED.

The comment above `if (… || depth > MAX_DEPTH) return;` named the hazard exactly
and the next line implemented it. Two compounding problems, both confirmed:
`depth` counts EDGES (an array costs two — the container and each element), so 512
internal levels is ~250 SOURCE levels, not 512; and `main`'s source-text regex had
NO depth limit, so `main` failed CLOSED at any nesting while this branch failed
OPEN above the cap.

Bite proof, shape
`let deep = [[[…new Response(JSON.stringify(u))…]]]; return deep.flat(Infinity)[0]`
in a `protect="passwordHash"` app:

| nestings | `6ca6e468` | this branch |
|---|---|---|
| 250 | E-PROTECT-004 fires | fires (message unchanged) |
| 255 | **silent**, `scrml compile` exit **0**, "Compiled 1 file" | fires, exit **1**, "FAILED — 1 error" |
| 500 | silent | fires |

Executed at 255 on `6ca6e468`:
`STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}`.

**Fix is behavioural, not numeric.** Exceeding the cap sets a `truncated` flag and
forces a POSITIVE result, checked BEFORE the `protectedQuery === null` early return
— the truncation may be what hid the query. Raising the number cannot fix this;
any finite cap has a boundary, so the boundary BEHAVIOUR is what has to be right.
The cap stays 512 as a call-stack resource bound (measured max over the 1878-body
corpus: 37) and is hoisted to `RAW_EGRESS_MAX_DEPTH` with the contract stated once.
A second message form under the same code carries the truncation case: no SELECT
is named, and the resolution is "reduce the nesting", not "project a column out".

Regression test: 4 new, two-sided — under-the-cap fires on the merits with the
ordinary message; past-the-cap fires with the truncation message; deeper-still
fires; a deep body WITHIN the cap and with no raw egress stays silent (no
cap-manufactured false positive). Red half: `compiler/src` stashed to `6ca6e468`
→ 46 pass / **2 fail**, exactly the two past-the-cap tests.

Commit `fca83b7e`.

### ⛔ M1 — §14.8.9 contradicted itself inside the amended section. CLOSED.

Three corrections, `compiler/SPEC.md`:

1. The Diagnostics bullet for `E-PROTECT-004` still ended "…and it is not
   `reveal`-declassified" — exactly what the new paragraph seven lines above
   declares non-conformant and what the §34 row already replaced with "Fail-closed
   **unconditionally**". Struck; the bullet now states the unconditional rule with
   its one-line reason.
2. The Diagnostics preamble "(named now; emitted when the floor build lands…)" was
   stale for BOTH codes. Replaced with a LIVE statement plus per-code emitter
   provenance, named by SYMBOL per the §34 census's own no-hardcoded-line-numbers
   rule.
3. The §34 row for `I-PROTECT-STRIP-001` carried the same stale claim; given an
   emitter note in the shape `6ca6e468` established for `E-PROTECT-004`
   (`generateServerJs`, draining `drainProtectInfosFromRewriter`).

Also folded the H1 consequence into both §14.8.9 and the §34 row so the SPEC and
the shipped behaviour agree.

`bun scripts/s34-census.ts --check-new --base origin/main` →
**"§34.0 gate: 2 new/changed §34 row(s), all well-formed — PASS"**.

Commit `6d908c4b`.

### H2 — computed-member evasion. FIXED (not merely disclosed).

Reason for fixing rather than disclosing: a bracket with a string-literal key is
STATICALLY RESOLVABLE — the key's value sits on the `lit` node the parser already
built — so reading it is the tree's own answer, not a source re-scan. The §14.8.9
SHALL is on the CONSTRUCT, not on a spelling, and a gate that reads one spelling
and not the other is one keystroke from a leak.

Root cause is slightly different from the review's description: `a["b"]` is not a
"computed member". `types/ast.ts` declares `MemberExpr.property` a plain string and
routes computed access to `IndexExpr`, so `terminalName` saw a node kind it did not
handle at all.

| spelling | `6d908c4b` | now |
|---|---|---|
| `new Response(...)` | FIRES | FIRES |
| `new globalThis.Response(...)` | FIRES | FIRES |
| `new globalThis["Response"](...)` | **silent** | FIRES |
| `new globalThis['Response'](...)` | **silent** | FIRES |
| `new window["Response"](...)` | **silent** | FIRES |
| `new globalThis["foo"]["Response"](...)` | **silent** | FIRES |
| `globalThis["Response"].json(...)` | **silent** | FIRES |
| `Response["json"](...)` | **silent** | FIRES |
| `let k = "Response"; new globalThis[k](...)` | silent | silent (RESIDUAL, documented) |

Executed on the bracket form pre-fix:
`STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}`.
Red half 50 pass / **6 fail** → 56 pass / 0 fail. New conformance case
`protect/raw-egress-computed-response`. The
`protect-raw-egress-globalthis-response` rationale's "Any aliasing receiver …
reaches the same conclusion" was false for the bracket forms and is corrected.

Commit `48de10dd`.

### M2 — cross-function helper. FIXED (not merely disclosed).

Reason for fixing: it is the most idiomatic shape of the lot, and the per-body unit
was a boundary the author could cross by pressing Extract Function. Three shapes,
all executed pre-fix, all answering
`{"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}` at exit 0 with zero
diagnostics:

- SELECT in the callee, `new Response` in the caller (the row RETURNS into the egress);
- SELECT in the caller, `new Response` in the callee (the row is PASSED IN);
- a two-hop callee chain.

**Rule: reachability, not file scope.** `detectProtectedRawEgress` is replaced by
`collectRawEgressFacts` (per body: protected SELECT, egress kinds, bare-identifier
callees, truncation) + `detectProtectedRawEgressAcrossFns`, which for each fn F
takes reach(F) = F plus every fn F transitively calls IN THIS FILE, and fires when
reach(F) holds BOTH. Forward reachability alone covers both flow directions because
it is evaluated at every function. Two fns with no call path share no data path and
stay silent — pinned by a CONTROL test (an unrelated protected query plus an
unrelated §40.3.5 `403` does not fire), which is what stops this becoming "any
protect= app with any manual Response". Mutual recursion terminates on the visited
set (pinned). The diagnostic names the call path (`getUser` -> `loadUser` -> `raw`).

Red half 58 pass / **4 fail** → 62 pass / 0 fail. New conformance case
`protect/raw-egress-cross-function`.

**Blast radius, measured:** all 75 `protect=`-bearing `.scrml` in `samples/`,
`examples/`, `stdlib/`, `docs/` and `conformance/`, compiled base-vs-head with
per-file per-code diagnostic counts — **0 diffs** for this change alone.

Commit `5fba6b41` (with L5).

### M3 — the residual disclosure misstated `main`. CORRECTED.

Verified by checking out `origin/main`'s `compiler/src` into this worktree and
compiling all three spellings:

| spelling | `origin/main` | this branch |
|---|---|---|
| `let R = Response` | **E-SCOPE-001 — does not compile** | silent (leak) |
| `let R = globalThis.Response` | silent | silent |
| `let k = "Response"; globalThis[k]` | silent | silent |

So the CLASS carries forward, but for the one spelling the paragraph named it is a
**WIDENING**: this branch adds `Response` to `LOGIC_SCOPE_GLOBAL_ALLOWLIST` for
§40.3.5, which is what makes that program compile at all. The residual paragraph in
`protect-egress.ts` is rewritten as three numbered bounds with that parity table
stated in words, and pinned by a test asserting BOTH that the gate is silent AND
that E-SCOPE-001 no longer fires.

### M4 — the passthrough guard on ONE arm only. FIXED.

The baseline-CSRF arm (`!authMiddlewareEntry && isStateMutating && _webAppShape` —
i.e. no `auth=`, no `protect=`, state-mutating; the majority shape for a small app)
emitted NO `instanceof Response` guard.

| | guard count | executed 403 path |
|---|---|---|
| baseline arm, `5fba6b41` | **0** | `STATUS 200 BODY: "{}"` — the DENY became a SUCCESS |
| baseline arm, now | 1 | `STATUS 403 BODY: "Forbidden"` |
| `auth="required"` arm | 1 (both) | 403 (already covered) |

Placement is doubly ordered and both orderings are load-bearing: AFTER the
`_envelope` COMMIT (an early return must not strand an open transaction), BEFORE the
JSON envelope (which would already have destroyed the `Response`). Red half 18 pass
/ **2 fail** → 20 pass / 0 fail; the third new test (a NORMAL return still enveloped
as 200 JSON with the baseline `Set-Cookie` intact) passes on both sides
deliberately — it is the guard against the guard.

**Blast radius, measured over 1906 corpus sources** (`examples/ samples/ stdlib/
conformance/ docs/readme-snippets`, recursive), comparing diagnostic-code counts AND
the emitted server/client LINE ARRAYS: 0 diagnostic deltas; 159 artifact halves
differ, **all of them by the guard line alone**, +257 guard lines; 0 anything else.
257 is also the population answer for how wide this fail-open was.

Commit `9319975f`.

### L5 — the span-less `continue`. FIXED.

A FAIL-CLOSED gate went silent on a fn node whose only defect was missing position
metadata. Now falls back to a file-anchored span (the shape `I-PROTECT-STRIP-001`
already uses). Latent rather than active (0 span-less fn nodes measured across the
protect-active corpus), but not a hole to leave in a security gate. Landed with M2
in `5fba6b41`.

### L1 / L2 / L3 — three stale claims this arc made false. CORRECTED.

- **L1** `emit-server.ts` — "no corpus source reaches it today (a plain body naming
  `Response` build-blocks on E-SCOPE-001)" stopped being true in the same arc that
  wrote it. Rewritten: the guard is LOAD-BEARING, with the reason and a
  do-not-weaken-or-reorder note.
- **L2** `type-system.ts` — the exclusion of `Request` was justified with "it is a
  parameter binding", which conflates the lowercase `request` parameter (never
  consults the allowlist) with the capitalized `Request` CONSTRUCTOR (which the
  allowlist is exactly the arbiter of). Behaviour unchanged; the reason is now the
  real one — no §40.3 example CONSTRUCTS a `Request`.
- **L3** `docs/known-gaps.md`
  `g-handle-globalthis-response-ships-protected-columns` — `open` → **`narrowed`**,
  with the three halves adjudicated individually: (b) the per-body source-text regex
  CLOSED, (c) §40.3.5's own example failing E-SCOPE-001 CLOSED, (a) the
  `instanceof Response` passthrough DELIBERATELY UNCHANGED (a `Response` is opaque to
  the redactor; the fix is upstream — the gate build-blocks the row — and removing
  the passthrough would be a regression in the other direction). The stale locus
  claim "`Response` is not [allowlisted]" is replaced. Only that entry is touched.

Commit `51ae0793`.

### FULL-BRANCH DIFFERENTIAL — `origin/main` -> HEAD, 1906 corpus sources

Diagnostic-code-set deltas: **9**, and every one is intended.

```
conformance/cases/protect/raw-egress-computed-response      +E-PROTECT-004
conformance/cases/protect/raw-egress-cross-function         -E-SCOPE-001 +E-PROTECT-004
conformance/cases/protect/raw-egress-e004                   -E-SCOPE-001
conformance/cases/protect/raw-egress-foreign-inline-level1  +E-PROTECT-004
conformance/cases/protect/raw-egress-globalthis-response    +E-PROTECT-004
conformance/cases/protect/reveal-cross-value-no-suppress    -E-SCOPE-001 +E-PROTECT-004
conformance/cases/protect/reveal-does-not-suppress-e004     -E-SCOPE-001 +E-PROTECT-004
samples/gauntlet-r13/react-auth-dashboard.scrml             -E-SCOPE-001
samples/gauntlet-r14/react-auth-dashboard.scrml             -E-SCOPE-001
```

Seven are this branch's own conformance cases. The two real adopter sources lose an
error and gain none (the §40.3.5 conformance restoration); their other pre-existing
errors are unchanged. **No adopter / sample / example / stdlib source gains a
diagnostic.**

Artifact deltas: 159 halves, **all by the guard line alone** (+257 lines, the M4
fix); **0** artifact halves differ for any other reason. (The prior round recorded
"artifact content diffs 0"; the 159 here are M4's intended emission and nothing
else.)

### TEST STATE (final tree)

- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`
  → **22433 pass · 0 fail · 70 skip · 1 todo** across 1231 files (165 s).
- `bun conformance/run.ts` → **889/889** (887 at round start; +2 new cases).
- `g-sql-row-protect-leak.test.js` → 62/62 (was 44).
- `authed-server-fn-response-http.test.js` → 20/20 (was 17).
- `bun scripts/s34-census.ts --check-new --base origin/main` → PASS.

The inotify-exhaustion env failures recorded in the previous round did NOT recur —
the full pre-commit hook ran clean on all five commits this round.

### RESIDUAL HANDED BACK (for the PA — known-gaps is PA-owned except the L3 entry)

1. **The syntactic-resolution bound**, now the whole of what
   `g-handle-globalthis-response-ships-protected-columns` still covers. Callee AND
   call-edge resolution are syntactic: `let R = Response`, `let k = "Response";
   globalThis[k]`, `let f = loadUser; f(id)`, a CROSS-FILE helper, and
   `obj.method()` all still slip the gate. Closing them needs the name resolver /
   constant propagation. Each is pinned by a passing `RESIDUAL (documented)` test so
   closing one turns a test red and forces the bound paragraph to move with it.
   `let R = Response` is a WIDENING vs `main`, not a carry-forward.
2. **The value-scoped `reveal` EXIT at a raw egress is still absent.** §14.8.9 admits
   a protected column only when its descriptor bears a `reveal` stamp AT THE SINK,
   and a raw egress has no compiler-emitted serializer to read it — so the gate is a
   floor with NO exit. Restoring an ergonomic exit means LOWERING a mediatable raw
   sink so the floor runs there, not widening `reveal`. Separate arc; unchanged from
   the previous round.
3. **A FAILED build still writes `dist/` artifacts.** Observed while proving H1:
   `scrml compile` on a file with an `E-PROTECT-004` exits 1, prints
   "FAILED — 1 error", and still emits `app.server.js` / `app.client.js` /
   `app.html`. Verified identical for a SHALLOW E-PROTECT-004, so it is PRE-EXISTING
   CLI behaviour for any CG error, not introduced here and not in this brief's scope
   — but for a fail-closed security gate "the build failed" and "the leaking
   artifact is on disk" being simultaneously true is worth a ruling. NOT filed in
   `docs/known-gaps.md` (PA-owned); recorded here.
4. **`E-TENANT-RAW-EGRESS` (§14.8.10) is still the source-text scan this round
   deleted.** Verified by reading the code, not relayed: `detectTenantRawEgress`
   in `compiler/src/codegen/tenant-egress.ts` takes `fnSource: string` and calls
   itself the "mirror of §14.8.9's `detectProtectedRawEgress`". It still carries
   the exact four predicates this round removed on the protect side — the
   backtick-SQL regex for the query, the level-0-only `_{` opener test, the
   `new\s+Response` / `Response\s*\.\s*json` pair for the manual `Response`, and
   the bare `asIs` token test — plus a per-body unit. So
   `new globalThis.Response(...)`, `new globalThis["Response"](...)`, `_={ … }=`,
   a token inside a comment or a string literal, and the helper split are all
   PRESUMPTIVELY open on the tenant twin. Explicitly OUT of this brief's scope,
   and NOT empirically leak-tested here (only the code path was verified) —
   flagged as the obvious next dispatch.

---

## 2026-08-20 — ROUND 4: the S354 ruling, plus F2/F3/F5/F6 from the round-3 adversarial pass

Branch `raw-egress-r4-work`, cut from `origin/raw-egress-r3-work` (tip `83369e94`)
and REBASED onto `origin/main` (`1d245134`, which carries S355-peter's #582/#590).
Every claim below was measured by COMPILING the shape against three separate
compilers — `origin/main`, the round-3 head, and this head — and, where a leak is
asserted, by EXECUTING the emitted handler. Nothing here is read off the code.

### THE REBASE — three conflicts, and what each was resolved to

`origin/main` moved 40 commits under this branch. Eleven r3 commits replayed; the
two pure-regeneration commits (`5a03a1fc`, `83369e94`) were **SKIPPED** and the
derived files regenerated once, on the rebased tree, after the last content
commit — derived numbers are regenerated, never hand-merged.

**1. `compiler/src/type-system.ts` — the `LOGIC_SCOPE_GLOBAL_ALLOWLIST` entry, TWICE.**
Both intents kept, and the fact that they CONFLICT on one axis is recorded rather
than papered over. Round 3 admitted `Response` ALONE and wrote a rationale saying
`Request`/`Headers` "would be a widening, not a conformance restoration, and needs
its own ruling". **#590 (S355-peter) is that ruling and it landed first** — adopter
#471's document-workflow path constructs all three. Resolution: main's trio
(`"Response", "Request", "Headers"`) is the current state; r3's §40.3.5 conformance
rationale is folded in beside main's #471 rationale; r3's narrowness CLAIM is
retired in place with a sentence saying why, not silently deleted.

One genuinely useful distinction from r3 is preserved verbatim because it was got
wrong once already: `Request` is not excluded-or-included on the grounds that "it
is a parameter binding". The lowercase `request` in `handle(request, resolve)` is a
parameter and never consults the allowlist; the capitalised `Request` is the global
CONSTRUCTOR, which the allowlist is exactly the arbiter of.

**2. `compiler/tests/integration/authed-server-fn-response-http.test.js`** — both
sides say the same thing (the `new Response(...)` shape is now adopter-reachable, so
the passthrough guard is LOAD-BEARING); they differ only in which landing they
credit, S352 vs S355/#590. Merged: main's honest-scope framing + r3's §40.3.5
normative citation and its "do not weaken or reorder that guard" instruction, with
both provenances.

**3. `docs/known-gaps.md`** — main had RESOLVED `g-handle-request-formdata-emitted-unawaited`
(S354-peter); our side carried its pre-resolution header plus the S353 UPDATE block
for the protect entry. Resolution: main's RESOLVED entry, our S353 UPDATE block
placed before it. ⚑ One sentence INSIDE that block was falsified while it sat on the
branch — "`Request` / `Headers` / `FormData` deliberately not added" — and is
corrected in the same edit rather than landed stale.

`compiler/SPEC-INDEX.md` / `docs/FACTS.md` conflicted as expected and were
regenerated, twice: once after the rebase (883→889 cases, 37,293→37,322 lines) and
once after the S354 SPEC amendment (37,322→37,339).

---

### ⭐ THE RULING (S354, delta-log `[1606]`) — an ALL-LITERAL egress is not an egress

`E-PROTECT-004` fired on CO-OCCURRENCE within a call-reachable set, not on flow.
That is what makes it sound — but a `Response` built entirely from literals cannot
carry caller data, so counting it was a DEFECT, not conservatism.

**Premise verified before any code was written** (both halves, by compiling):

```scrml
function loadUser(id) { return ?{`SELECT * FROM users WHERE id = ${id}`}.get() }
function deny()       { return new Response("Forbidden", { status: 403 }) }

export server function dispatch(id) {
  if (id < 0) { return deny() }
  let u = loadUser(id)
  return { name: u.name }        // compiler-emitted path — redacts correctly
}
```

| compiler | result |
|---|---|
| `origin/main` (`1d245134`) | **clean**, exit 0 |
| round-3 head (rebased, `bb24a46a`) | **`E-PROTECT-004`**, exit 1 — the false positive |
| this head | **clean**, exit 0 |

§40.3.5's own early return IS `deny`'s body, so the gate was rejecting the shape
this specification documents whenever any protected query sat in the same
reachable set.

**Implementation.** `isSyntacticLiteral` / `objectPropIsLiteral` /
`argsAreAllLiterals` in `protect-egress.ts`, gating BOTH `Response` egress kinds
(`new <chain>.Response(...)` and `<chain>.Response.json(...)`) on
`!argsAreAllLiterals(n.args)`. What counts as a literal: `lit` (string / number /
bool / absence, and an UN-INTERPOLATED template), `array` / `object` literals whose
every element / property value is itself literal, and a `spread` of a literal. An
argument list the walk cannot see as an array answers "not all literals" — the
fail-CLOSED direction. An EMPTY list answers true: `new Response()` carries nothing.

**The boundary is the ruling, so the still-firing half is as load-bearing as the
newly-silent half.** All measured on this head, all still firing:

| shape | why it still fires |
|---|---|
| `new Response(JSON.stringify(u))` | a call, not a literal |
| `let msg = "Forbidden"; new Response(msg, { status: 403 })` | a NAMED BINDING is not a literal even when its initializer is |
| `` new Response(`user ${u.name}`, …) `` | an interpolated template |
| `new Response("x", u)` | one non-literal argument is enough |
| `let status = 403; new Response("x", { status })` | an object SHORTHAND reads a binding |
| `new Response("x", { status: u.id })` | a member expression inside a literal object |
| `new Response("For" + "bidden", …)` | a `+` is an expression, not a literal |
| `Response.json(u)` | the static-factory form is gated identically |
| `new Response("x", { ...u })` | a spread of a non-literal |
| `_{ const x = 1; }` beside a protected SELECT | no argument list to test — foreign blocks are untouched |

**Full flow analysis was REJECTED on DIRECTION, not cost**, and the code says so at
its site: resolving `SOME_CONST` to its initializer trades a precision bug for a
soundness bug, because every gap in a dataflow analysis is a fail-OPEN. That
sentence is in `isSyntacticLiteral`'s doc and in the SPEC amendment, so a later
reader cannot mistake the narrowness for an oversight.

**One deliberate false NEGATIVE, stated rather than discovered later.** An escaped
dollar in a single-quasi template (`` `a \${b}` ``) reads as INTERPOLATED, because
the parser reconstructs that node's `raw` from the cooked text and the backslash is
gone by then. So it reads as caller-bearing and the gate FIRES. That is the only
direction a confidentiality floor may err in; the alternative (dropping the
`!raw.includes("${")` conjunct) would open the parser's own astring fallback path.

**SPEC.** §14.8.9's closed-world section gains a normative paragraph, "The egress
test is on an ARGUMENT-BEARING construction", with the SHALL NOT and the syntactic
boundary; the §34 `E-PROTECT-004` row carries the same in one sentence.

Green half: `g-sql-row-protect-leak.test.js` gains 21 tests for this ruling — 10
CLEAN shapes, 10 STILL-FIRES shapes, and the foreign-block control.

---

### F2 (MED) — the call edge resolved to the WRONG duplicate, and the comment claimed otherwise

`protect-egress.ts` said *"First declaration wins on a duplicate name (the emitter's
own resolution order)."* **That property is FALSE.** Reproduced and executed:

```scrml
function loadUser(id) { return { id: id } }
export server function getUser(id) {
  let u = loadUser(id)
  return new Response(JSON.stringify(u))
}
function loadUser(id) { return ?{`SELECT * FROM users WHERE id = ${id}`}.get() }
```

Compiled exit 0, zero diagnostics on both `origin/main` and the round-3 head. The
emitted `.server.js` names the **SECOND** declaration as the in-process peer:

```js
// Issue #1: in-process peer callable for server function "loadUser"
async function loadUser(id) {
  return _scrml_protect_tag((await _scrml_sql`SELECT * FROM users WHERE id = ${id}`)[0] ?? null, ["passwordHash"]);
}
```

…while the gate had resolved `getUser`'s edge to the first. Executed against a
stubbed `_scrml_sql` returning `{id:1,name:"ada",passwordHash:"$argon2id$SECRET"}`:

```
STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}
```

**Fix, fail-closed:** `indexByName` becomes the multimap `indicesByName`
(`Map<string, number[]>`); every declaration of a name contributes an edge, so
whichever one the emitter picks, the gate has already looked at it. The cost is a
possible over-report on a file that declares one name twice — a shape a linter
should reject anyway; the cost of the other answer is a shipped secret. The false
comment is replaced by the measurement.

**BOTH ORDERINGS pinned.** A fix that merely re-ordered the tie-break would pass one
test and fail the other. Both now exit 1.

---

### F3 (MED) — a static CONCATENATED key evaded, so the documented bound was false

`staticIndexKey` and the `raw-egress-computed-response` conformance rationale both
said the residual is *"the genuinely dynamic key … whose value is not in the tree."*
It was in the tree:

```scrml
return new globalThis["Resp" + "onse"](JSON.stringify(u))
```

Exit 0, zero diagnostics on `origin/main` AND on the round-3 head. Emitted verbatim
into the handler (`new globalThis["Resp" + "onse"](JSON.stringify(u));`) and
executed:

```
STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}
```

**FIXED, not re-documented** — the brief's preference and the right one: a
fail-closed gate must not carry a false bound. `staticIndexKey` folds a `+` of
static string keys, recursively. The fold is STRING-only, so `a[1 + 1]` still
answers null rather than the wrong key `"11"`. Four folded spellings are pinned
(`["Resp" + "onse"]`, a three-way `["R" + "esp" + "onse"]`, the
`globalThis["Resp"+"onse"].json` receiver form, and `Response["js" + "on"]`), and
the bound the fold does NOT move — a `+` with a dynamic operand — is pinned as a
residual so it stays honest.

Two smaller corrections ride along, both fail-CLOSED. An INTERPOLATED template key
previously answered `""` (a non-match by ACCIDENT, not by decision) and now answers
null. `templateLitIsStatic` discriminates the two template forms structurally,
because the parser gives both the same `kind` and `litType` and differs only in what
it puts on the node.

The false bound sentence is corrected at BOTH loci that stated it.

---

### F5 (LOW/MED) — the §34 provenance named a symbol this arc deleted

Six loci named `detectProtectedRawEgress`, which round 3 renamed to
`collectRawEgressFacts` / `detectProtectedRawEgressAcrossFns`. All six fixed:
`compiler/SPEC.md` §14.8.9 Diagnostics and the §34 `E-PROTECT-004` row;
`protect-egress.ts` (`terminalName`'s population note); `docs/known-gaps.md:~1048`;
both new conformance rationales.

**⚑ THE ORIGIN, RECORDED HONESTLY BECAUSE IT IS THE INTERESTING PART.** The PA wrote
that provenance note in `6ca6e468` **specifically to fix a stale claim**, and round
3's rename made it stale **within hours**. `--check-new` passed at every step, and
correctly so by its own contract: its `EMITTER` regex asks only whether the row
MENTIONS a backticked path under `compiler/` — it validates row WELL-FORMEDNESS,
not symbol EXISTENCE. So the gate built to stop unverifiable §34 claims cannot
catch a claim that names a symbol which no longer exists. Twice in two sessions.

At `:1048` a SECOND stale claim sat beside the first and is corrected in the same
edit: *"Currently **unreachable** (a plain body naming `Response` build-blocks on
`E-SCOPE-001`)"* is now FALSE — `Response` is allowlisted (S355/#590, and §40.3.5's
own worked example required it independently), so the shape is adopter-reachable and
the `instanceof Response` passthrough guard is **load-bearing**, not
belt-and-braces. Fixing the symbol and leaving a false reachability claim one clause
away would have been half a fix.

**RECOMMENDATION — reported, deliberately NOT built (out of brief scope).** The
check that would have caught BOTH instances: after `--check-new` matches its
`EMITTER` provenance regex, extract the backticked SYMBOL names in the same row
(`the \`X\` gate in \`compiler/…\``) and assert each appears as an exported symbol
in the file the row names. Two caveats a builder needs up front. (1) There is no
convention today for how a row names a symbol — it is free prose — so the extractor
needs either a convention (a `symbol:` field, or "the backticked identifier
immediately preceding `gate`/`pass`/`emitter`") or a heuristic that will have false
positives, and a §34 gate with false positives gets bypassed then deleted
(`pa-base` §8). (2) It should run over ALL rows, not just diff-scoped ones — this
defect is created by a RENAME, which touches the emitter and not the row, so a
diff-scoped gate on `compiler/SPEC.md` sees nothing. That argues for a separate
`--check-symbols` mode over the full catalog, reported rather than gating, at least
until its false-positive rate is measured.

---

### F6 (LOW) — a coverage claim that was false

`docs/known-gaps.md` (S353 UPDATE) named FIVE residuals and asserted *"closing any of
them turns a test red"*. Counted: `g-sql-row-protect-leak.test.js` carried **three**
`RESIDUAL (documented)` tests. The **cross-FILE helper** and **`obj.method()`** had
no pin, so for those two the guarantee did not hold and a later arc could have
closed them silently, leaving the bound paragraph in `protect-egress.ts` stale.

Both are now pinned, and both were checked for VACUITY rather than assumed —
a test that passes because the fixture failed to compile is not a pin:

| pin | not vacuous because |
|---|---|
| cross-FILE helper | both files compile (one `E-SCHEMA-001` each), the server IS emitted, it contains `new Response(JSON.stringify(loadUser(`, and `I-PROTECT-STRIP-001` fires — the protect analysis is live and simply cannot see across the file boundary |
| `obj.method()` | the server is emitted, contains `handlers.load(` AND the protected `SELECT * FROM users`, and `I-PROTECT-STRIP-001` fires |

The **sixth** residual the paragraph never named — F3's concatenated static key — is
recorded as **CLOSED**, not pinned as residual, because it was fixed.

---

### VERIFICATION

**Three-compiler bite table** (`origin/main` `1d245134` / round-3 head `bb24a46a` /
this head), six shapes, each compiled through the CLI; executed where a leak is
asserted:

| shape | origin/main | round-3 head | this head |
|---|---|---|---|
| the ruling's `deny()` shape | clean | **E-PROTECT-004** (false positive) | **clean** |
| `new Response(JSON.stringify(u))` | clean (leak) | E-PROTECT-004 | E-PROTECT-004 |
| named-binding argument | clean (leak) | E-PROTECT-004 | E-PROTECT-004 |
| interpolated-template argument | clean (leak) | E-PROTECT-004 | E-PROTECT-004 |
| **F2** duplicate declaration | clean (**LEAK**) | clean (**LEAK**) | **E-PROTECT-004** |
| **F3** concatenated key | clean (**LEAK**) | clean (**LEAK**) | **E-PROTECT-004** |

Exit codes, and what is on disk (this head vs round-3 head):

```
                  round-3 head          this head
f2-dup-decl       exit=0 (shippable)    exit=1 (build-blocked)
f3-concat-key     exit=0 (shippable)    exit=1 (build-blocked)
ruling-deny       exit=1 (rejected)     exit=0 (compiles)
```

**Corpus differential.** Population enumerated with `find` (recursive), never a
shell glob — the S282/S319 truncated-probe class — and asserted non-zero before a
manifest is written: **81 `protect=`-bearing `.scrml`** across `samples/`,
`examples/`, `stdlib/`, `docs/`, `conformance/` and `benchmarks/`. Per-file
per-code diagnostic counts, three captures.

- **round-3 head → this head: `0` of 81 files have a diagnostic-code delta.** Round
  3's zero-delta-on-real-sources property is not regressed; round 4 changes nothing
  on the corpus.
- **`origin/main` → this head: 6 of 81**, and all six are this branch's OWN
  conformance cases gaining `E-PROTECT-004`
  (`raw-egress-computed-response`, `raw-egress-cross-function`,
  `raw-egress-foreign-inline-level1`, `raw-egress-globalthis-response`,
  `reveal-cross-value-no-suppress`, `reveal-does-not-suppress-e004`).
  **No adopter / sample / example / stdlib source gains or loses a diagnostic.**

⚑ **A probe artifact was caught and corrected mid-measurement, and it is worth
recording.** The first `origin/main` capture reported 31 delta files, 25 of them
`E-IMPORT-006` on real adopter sources (`examples/23-trucking-dispatch`,
`stdlib/auth/templates/login.scrml`, `samples/compilation-tests/`). That was NOT a
real delta: `STDLIB_ROOT` is derived from the compiler module's OWN location
(`module-resolver.js` — `resolve(dirname(fileURLToPath(import.meta.url)), "../../stdlib")`),
and the extracted base tree had no `stdlib/`, so every `scrml:` import failed to
resolve under the base compiler. Symlinking `stdlib/` into the base tree and
re-capturing gave the 6-file result above. A base-tree extraction that omits a
directory the compiler resolves against reads exactly like a regression.

**Test state (final tree).**

- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`
  → **22478 pass · 0 fail · 70 skip · 1 todo** across 1234 files (225 s).
  Baseline on the rebased tree before any round-4 edit: **22448 pass · 0 fail ·
  70 skip · 1 todo** — +30 tests, no new failures.
- `bun conformance/run.ts` → **889/889**.
- `g-sql-row-protect-leak.test.js` → **92/92** (was 62 on the round-3 head).
- `authed-server-fn-response-http.test.js` → **20/20**.
- `bun scripts/s34-census.ts --check-new --base origin/main` → **PASS** (2
  new/changed rows, all well-formed).
- ENV-GAP ruled out first: the fresh worktree had no `node_modules` and no
  `samples/compilation-tests/dist/`; `bun install` + `bun run pretest` were run
  before the baseline, so the browser half loads real artifacts.

---

### HANDED BACK — residual, and what ports to the tenant twin

1. **The four syntactic residuals stand**, all five now pinned: `let R = Response`,
   `globalThis[k]`, `let f = loadUser; f(id)`, the cross-FILE helper, and
   `obj.method()`. Closing any needs the name resolver / constant propagation, not
   a wider callee test — and each is a fail-OPEN today, so this is a real bound and
   not a formality.
2. **The escaped-dollar template reads as interpolated** (stated above) — a
   fail-CLOSED false positive in a corner. Not worth a fix at the cost of reopening
   the parser's astring fallback; recorded so it is not rediscovered as a bug.
3. **`.claude/maps/domain.map.md:1180` still names `detectProtectedRawEgress`** — a
   SEVENTH locus, outside this brief's six and inside PA-owned tooling. NOT edited.
   Reported.
4. **`docs/known-gaps.md:6710` names the same deleted symbol** while describing the
   tenant twin. The brief scoped this round to exactly ONE known-gaps edit
   (`:~1048`), so it is NOT edited. Reported.
5. **Carried forward from round 3, unchanged:** `scrml compile` on a file with an
   `E-PROTECT-004` exits 1, prints "FAILED — 1 error", and STILL writes
   `app.server.js` / `app.client.js` / `app.html`. Re-confirmed this round on both
   F2 and F3 (`exit=1  artifact=WRITTEN`). Pre-existing CLI behaviour for any CG
   error, not introduced here — but for a fail-closed security gate, "the build
   failed" and "the leaking artifact is on disk" being simultaneously true is still
   worth a ruling.

**WHICH ROUND-4 FIXES PORT TO THE TENANT TWIN** (`compiler/src/codegen/tenant-egress.ts`,
`detectTenantRawEgress` / `E-TENANT-RAW-EGRESS`, gap
`g-tenant-raw-egress-is-a-byte-identical-twin-of-the-protect-gate` — NOT touched
this round, per brief):

| round-4 fix | ports? | why |
|---|---|---|
| **the S354 all-literal narrowing** | **YES, and it is the same DEFECT there** | the tenant gate is also a co-occurrence test; a tenant-scoped read reaching a constant `deny()` will over-report identically once the twin is made cross-function |
| **F3 concatenated static key** | **N/A TODAY, YES AFTER** | the twin is still a SOURCE-TEXT scan with a `new\s+Response` regex, so it has no `staticIndexKey` to fix — but the moment it is made structural (the filed HIGH), it inherits the same question and should land with the fold already in |
| **F2 duplicate-declaration multimap** | **N/A TODAY, YES AFTER** | the twin has no call graph at all (per-body unit), so there is no index to make a multimap — but a cross-function twin must not repeat the first-wins mistake |
| **F5 symbol provenance** | **YES, DIRECTLY** | `tenant-egress.ts:371` calls itself the "mirror of §14.8.9's `detectProtectedRawEgress`" and `docs/known-gaps.md:6710` repeats it — both dangling, both out of scope here |
| **F6 residual pins** | **YES, AS A METHOD** | whatever the twin's residual list ends up being, the "closing any turns a test red" claim needs a counted pin per residual, not an assertion |

⚑ The strongest cross-round finding for whoever takes the twin: **do the S354
narrowing in the SAME change as the structural rewrite, not after.** Round 3 shipped
the cross-function widening without it and created a false positive on §40.3.5's own
documented shape; the twin can skip that round trip entirely.

---

# ROUND 5 — the two executed fail-opens, and three false claims

Round 4 returned **DO-NOT-LAND**. Two of its own changes regressed against
`origin/main`: the S354 narrowing opened a header-mutation fail-open (H1), and the
structural rewrite left an unparseable expression able to silently disarm the whole
gate (H2). Both were PA-reproduced and both are closed below with a two-sided,
EXECUTED bite proof.

## ⛔ H1 — the S354 narrowing was true of the CONSTRUCTION and false of the BINDING. FIXED.

`compiler/src/codegen/protect-egress.ts` — the `!argsAreAllLiterals(n.args)` guards on
the `new Response(...)` and `Response.json(...)` egress predicates, introduced by
`a2594385`.

The ruling's premise as implemented — *"a `Response` whose every argument is a literal
cannot carry caller data"* — is a statement about the CONSTRUCTION. A `Response` is a
live mutable handle: its headers are writable after it is built, so the premise says
nothing about what the object carries by the time it leaves the function.

### The bite, both sides, EXECUTED

```scrml
export server function getUser(id) {
  let u = ?{`SELECT * FROM users WHERE id = ${id}`}.get()
  let r = new Response("ok", { status: 200 })
  r.headers.set("x-user", u.passwordHash)
  return r
}
```

| tree | compile | executed handler (stubbed `_scrml_sql` returning `passwordHash: "$argon2id$SECRET"`) |
|---|---|---|
| round-4 head (`08255478`) | **silent** — no `E-PROTECT-004` | body `ok`, **headers `[["x-user","$argon2id$SECRET"]]`** → **SECRET SHIPPED** |
| this fix | **`E-PROTECT-004` FIRES** — build-blocked | the handler never ships |

The redaction floor cannot catch this one: `_scrml_protect_redact` passes a `Response`
instance through untouched (it cannot introspect a serialized body or a header map), so
for this shape the gate is the ONLY thing between the row and the wire. That is exactly
what `docs/known-gaps.md`'s
`g-handle-globalthis-response-ships-protected-columns` (a) says, and round 4 removed the
gate from in front of it.

Same silence measured on the round-4 head for `.headers.append(...)`, for
`new Response()` with no arguments at all, and for `Response.json({ok:true})` bound to a
name — four executed shapes, all silent, all firing on `origin/main`.

### THE FIX — the ruling's stated boundary, narrowed to RETURN POSITION

The all-literal narrowing now applies **only where the construction IS the returned
value** — the `exprNode` a `return-stmt` holds. A construction assigned to a binding
stays an egress.

Why this is the right shape and not a retreat:

- The ruling was granted for exactly one shape, §40.3.5's own worked example
  `return new Response("Forbidden", { status: 403 })`. Return-position-only preserves
  that shape **completely**.
- It stays **purely syntactic** — one boolean threaded through the existing walk,
  answering "is this node the `exprNode` of a `return-stmt`?". It does not consult a
  binding, so it does not drift toward the flow analysis the ruling explicitly rejected
  on DIRECTION.
- It is strictly **fail-CLOSED** relative to round 4: every shape it changes moves from
  silent to firing, and none moves the other way.

Deliberately NOT return position, every one the fail-closed answer: an arrow's
EXPRESSION body, a construction under a ternary or a `||` inside a `return`, and a
construction returned through a temporary. Each is one syntactic step from the shape the
ruling names, and none of them is that shape.

The implementation records the exemption on the NODE the `return-stmt` holds. Its stated
bound: if the expression parser ever memoized one node into two positions — one of them
a `return` — the walk's `seen` guard would visit it once and the exemption could carry.
**Measured on this tree:** identical `new Response("Forbidden", { status: 403 })` text in
a `let` and in a `return` produces TWO distinct nodes (the instrumented walk reports both
separately), so the aliasing does not occur. Stated because the property belongs to the
expression parser, not to this file.

### The green half — VERIFIED, not trusted

The round-4 adversarial pass asserted that all 8 `cleanShapes` and all 6 clean
`adversarial` entries already use `return new Response(...)`. Re-checked by execution
rather than by reading: `g-sql-row-protect-leak.test.js` went **109 pass / 0 fail →
118 pass / 0 fail**. Not one previously-green shape moved.

### Owed tests — landed, and their bite is measured

Nine new tests in the S354 `describe`:

- 4 **bound-then-mutated** shapes (`headers.set`, `headers.append`, no-arg construction,
  `Response.json`) — FIRE;
- 3 **bound-then-returned-UNMUTATED** shapes — FIRE. We do not track mutation, and this
  half is as load-bearing as the mutated one: proving "this binding was never mutated" is
  the rejected flow analysis, and every gap in it would be a fail-OPEN;
- 1 **ternary inside the return** — FIRES (not the returned value itself);
- 1 **§40.3.5 return shape** — still SILENT, the guard against the guard.

Every firing test also asserts no `E-SCOPE-001`, so a fixture that failed to compile for
an unrelated reason cannot pass it.

**Two-sided bite, run:** against the pre-fix collector those 9 tests are
**1 pass / 8 fail**; against the fix, **9 pass / 0 fail**. The one that passes on both
sides is the §40.3.5 silent shape — deliberately, it is the guard against over-applying.
