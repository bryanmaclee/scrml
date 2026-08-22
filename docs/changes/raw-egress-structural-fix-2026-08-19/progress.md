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
| `let R = Response` | silent | silent |
| `let R = globalThis.Response` | silent | silent |
| `let k = "Response"; globalThis[k]` | silent | silent |

> **CORRECTED at round 5.** This table originally recorded `let R = Response` as
> **"E-SCOPE-001 — does not compile"** on `main`, and the round-3/4 text built a
> WIDENING claim on it. Re-measured at S355 against a COMPLETE extracted
> `origin/main` tree (`git archive origin/main` + the real `node_modules`): it
> compiles on `main` with no `E-SCOPE-001`, because `Response` / `Request` /
> `Headers` are in `LOGIC_SCOPE_GLOBAL_ALLOWLIST` **on main** (#590, S355) and this
> branch's `type-system.ts` diff is comment-only. The whole class is a plain
> CARRY-FORWARD; this branch widens nothing and allowlists nothing.

The residual paragraph in `protect-egress.ts` is rewritten as three numbered bounds
with that parity table stated in words, and pinned by a test asserting BOTH that the
gate is silent AND that E-SCOPE-001 does not fire (on either tree).

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
   **CORRECTED at round 5:** `let R = Response` is a CARRY-FORWARD, not a widening —
   it compiles on `origin/main` with no `E-SCOPE-001` (measured on an extracted
   tree; main already allowlists `Response`/`Request`/`Headers` via #590/S355).
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

## ⛔ H2 — an unparseable expression silently disarmed the whole gate. FIXED.

`compiler/src/codegen/protect-egress.ts` — the `visit` closure in
`collectRawEgressFacts` had no handling for `kind: "escape-hatch"` (the string did not
appear in the file).

`expression-parser.ts:3018-3033` returns `{ kind: "escape-hatch", nativeKind, raw }`
for any expression acorn rejects after scrml preprocessing, and `ast-builder.js:373` /
`:3815` do the same for every expression `shouldSkipExprParse` declines. **The node
carries the expression as a STRING**, so the walk found no `kind:"new"`, no
`kind:"foreign"`, no `kind:"sql"` and no call edges inside it — and read every one of
those as *"no"* when the truth was *"UNKNOWN"*. Exactly the depth-cap class the round-3
`truncated` fix closed; the escape-hatch path had no equivalent.

### The bite, RED half — six executed reproducers

Every one is plain JS whose only offence is a token acorn rejects after preprocessing.
Every one emitted VALID server JS, compiled at exit 0 with **no `E-PROTECT-004`** on the
round-4 head, and fires on `origin/main`:

```scrml
return new Response(~u ? JSON.stringify(u) : '')
return new Response(JSON.stringify(u), { status: 200 + ~0 + 1 })   // ← the canonical leak, silenced by an incidental `~`
return new Response(JSON.stringify(u).slice(~~0))                  // ← `~~x` is the standard trunc idiom
return new Response(JSON.stringify(u), { status: 200 + 1n })
return new Response(u |> JSON.stringify)
return new Response(JSON.stringify(u), { status: -2 ** 2 })
```

### The blindness was NOT confined to the egress side — and the worst case is the canonical idiom

Measured on this tree: **an `!{}` error arm (§17) reaches this walk ONLY as an
escape-hatch.** The arm object carries `handler` as a STRING and `handlerExpr` as an
escape-hatch node, and there is **no structured form of the arm body anywhere in the
tree**:

```
R5ARM pattern:string binding:string handler:string handlerExpr:object armArrow:string
      | handler= "e - > {\nreturn new Response ( JSON . stringify ( e ) )\n}"
```

And the arm body is emitted **VERBATIM** into the server handler, ahead of the
`instanceof Response` passthrough:

```js
const AuthError = _scrml__scrml_result_3.data;
return new Response ( JSON . stringify ( row ) )      // ← emitted from the raw text
...
if (_scrml_result instanceof Response) return _scrml_result;      // ← never reaches the redact
const _scrml_resp_body = JSON.stringify(_scrml_protect_redact(_scrml_result) ?? null);
```

So a raw egress inside an `!{}` arm was a **live, unredacted egress the tree could not
see** — in THE canonical scrml failure idiom. Same for a `?{}` and for a call edge
inside an arm (measured: an arm-hidden `?{}` produced no `I-PROTECT-STRIP-001` at all,
and an arm-hidden call produced `W-DEAD-FUNCTION` on its callee).

### THE FIX, and why it is not the form dpa-029 Q1 rejected

The escape-hatch node's own `raw` field is asked what the opaque region COULD hold:

| question | answer | effect |
|---|---|---|
| could it hold a `?{}`? (`/\?\s*\{/`) | the QUERY half is unknown | `truncated` — the body fails CLOSED outright, because the gate's whole predicate rests on resolving the query |
| could it hold a raw egress? (`Response` in any member-chain spelling · the full §23.2.4a `_`+N`=`+`{` opener grammar · `asIs`) | an ordinary egress kind | resolved by the SAME co-occurrence rule as `_{}` / `Response` / `asIs` |
| what call edges does it hide? (`name(`) | recovered as candidate edges | a recovered name that declares no function in this file contributes nothing |

**Why testing this string is within the ruling, not against it.** dpa-029 Q1 rejected
scanning the function's SOURCE SLICE — "asking the text a question the tree already
answered" — and all four measured defects of that form followed from a better oracle
being available and ignored. Here there is no better oracle: **the tree's answer for
this node IS a string, by construction.** That is the same standing `annotationIsAsIs`
already has in this file, justified in its own comment as "the field is the tree's own
answer (invariant 55)". The test is used ONLY as an over-approximation of what the
opaque region could hold, never as the primary detector for anything the tree does
answer, and every error it makes is an over-report — the fail-CLOSED direction.

Two consequences, stated rather than hidden, both now in the source docblock:
- a `Response` / `asIs` token inside a COMMENT or string literal within the unparsed
  region over-reports. That was defect (3) of the old whole-slice scan; here the surface
  is ONE unparsed expression rather than a whole function body, and an over-report
  cannot ship a secret.
- a constructor whose NAME is not in the text (`globalThis["Resp" + "onse"]`)
  under-reports — the same residual as the tree path's bound (1). Carried, not
  introduced.

⚑ **This is the one judgement in round 5 that touches a ratified ruling's reasoning
rather than only its scope. It is flagged for the PA to confirm or overturn.** The
alternative the brief literally specified (`truncated = true` on every escape-hatch) was
implemented and MEASURED first — see below — and it is not shippable.

### WHY NOT the literal brief — measured, both alternatives

| treatment | closes the 3 reproducers? | corpus sources that gain `E-PROTECT-004` |
|---|---|---|
| **(A)** every escape-hatch ⇒ `truncated` (the brief's literal text) | yes | **22 of 1912** — all 21 `examples/23-trucking-dispatch/*` plus `samples/login.scrml` |
| **(B)** every escape-hatch ⇒ an unanalyzable EGRESS kind | yes | **1** — `samples/login.scrml`, i.e. every `!{}` in a protect-reachable set |
| **(F)** ask the raw what it could hold — **LANDED** | yes | **0** |

(A) build-blocks 21 adopter files on nothing worse than a C-style `for` header, and does
it with the depth-cap message ("reduce the expression nesting"), which is factually
wrong for that cause. (B) build-blocks the canonical `!{}` idiom — and it is **not
avoidable by the adopter**: measured, EVERY arm-body form escape-hatches, including
`| AuthError e -> not`. A gate an adopter cannot satisfy is not a safety property.

### The escape-hatch CORPUS MEASUREMENT (owed by the brief)

Instrumented walk, `examples,samples,conformance,stdlib,benchmarks` recursive:

```
sources enumerated : 1912
sources with >=1 escape-hatch node reached by the §14.8.9 walk : 22   (ALL 22 protect-active)
escape-hatch nodes : 59
by nativeKind      : ParseError 30 · SkippedExpr 29
```

Every one of the 59 is either a C-style `for` header (`SkippedExpr`) with its `let i = 0`
init (`ParseError`), or a benign `!{}` arm. **0 of 22** sources have an escape-hatch text
that could hold an egress; **0 of 22** could hold a `?{}`. Hence the 0-source blast
radius above. The 22 (21 of them one adopter example) are listed in the round-5 census
output.

### The diagnostic now names the RIGHT cause

`truncated` had ONE hard-coded resolution sentence — "reduce the expression nesting" —
which is the remedy for the depth cap and the wrong instruction for an unparsed
expression. The two reasons now carry their own kind + resolution
(`TRUNCATED_EGRESS_KIND_DEPTH` / `TRUNCATED_EGRESS_KIND_UNPARSED`), threaded to the
message through a new `resolution` field on the detection. Both are pinned two-sidedly:
the unparsed case asserts the parse remedy and asserts the nesting remedy is ABSENT, and
the depth-cap case asserts the reverse.

### Owed tests — landed, 17 of them, and their bite is measured

- 6 RED — the unparsed-expression egress shapes above;
- 4 RED — a raw egress hidden in an `!{}` arm (`Response`, member-chain `Response`,
  a level-1 `_={}=` foreign block, an `asIs` binding);
- 1 RED — a protected `?{}` hidden in an arm ⇒ fails the body CLOSED, message asserted;
- 1 RED — a call edge hidden in an arm, recovered, so the SELECT becomes reachable;
- 5 GREEN — the C-style `for` header, the benign `!{}` arm, an unparsed expression in a
  body whose SELECT projects no protected column, an `import()` expression, and the
  depth-cap message staying itself. Every green one asserts anti-vacuity (no
  `E-SCOPE-001`, `I-PROTECT-STRIP-001` present, `_scrml_protect_redact` emitted).

**Two-sided bite, run:** against the pre-fix collector those 17 are **5 pass / 12 fail**;
against the fix, **17 pass / 0 fail**. The 5 that pass on both sides are the green half —
deliberately, they are the guard against over-firing.

`g-sql-row-protect-leak.test.js` 118 → **135 pass / 0 fail**.
`bun conformance/run.ts` → **889/889**.
Corpus `E-PROTECT-004` population **unchanged at 7 sources**, all of them this branch's
own conformance cases.

### ⚑ FILED, NOT FIXED — a silent miscompile, REPRODUCED (not relayed)

`1n`, `|>` and `-2 ** 2` escape-hatch and emit **syntactically invalid server JS** that
passes `validateEmit: true` with **zero errors**. Verified independently, on a
NON-protect program so §14.8.9 is out of the picture:

```
[bigint]   errors=[]  serverJs=SYNTAX-ERROR: Unexpected token (38:51)
[pipeline] errors=[]  serverJs=SYNTAX-ERROR: Unexpected token (38:31)
[exponent] errors=[]  serverJs=SYNTAX-ERROR: Unexpected token (38:47)
[control]  errors=[]  serverJs=PARSES
```

Not a §14.8.9 leak — the bundle will not parse — but a silent miscompile, and
`validateEmit` is not catching it. **For the PA to file.**

## Item 4 — the "WIDENING" claim was false in FIVE loci. CORRECTED.

The claim, as it stood in round 4:

> *"on `origin/main` `let R = Response` fails `E-SCOPE-001` … This branch allowlists
> `Response` … this is a WIDENING of the residual, not a carry-forward."*

**Measured, not relayed.** A COMPLETE `origin/main` tree was extracted with
`git archive origin/main | tar -x` plus a symlink to the real `node_modules` (a partial
extraction with no `stdlib/` makes every `scrml:` import fail and reads exactly like a
regression — that is what produced the earlier wrong number). Against that tree:

```
[main:let-R-eq-Response]           E-SCOPE-001=silent  E-PROTECT-004=silent
[main:globalThis-bracket-key]      E-SCOPE-001=silent  E-PROTECT-004=silent
[main:let-R-eq-globalThis-Response] E-SCOPE-001=silent  E-PROTECT-004=silent
```

All three spellings compile on `main` and are silent there. `E-PROTECT-004` is absent on
both trees. `"Response", "Request", "Headers",` is in `LOGIC_SCOPE_GLOBAL_ALLOWLIST`
**on main** (#590 / S355 — confirmed with `git show origin/main:compiler/src/type-system.ts`),
and this branch's `type-system.ts` diff is **comment-only**. The residual is a plain
**carry-forward**; this branch widens nothing and allowlists nothing.

Independently confirmed by compiling each host HTTP name on this tree:

```
Response   E-SCOPE-001=silent      Request    E-SCOPE-001=silent
Headers    E-SCOPE-001=silent      FormData   E-SCOPE-001=FIRES
Blob       E-SCOPE-001=FIRES       File       E-SCOPE-001=FIRES
```

Corrected in all five places the claim sat (the brief named four; `progress.md` stated
it twice, once as a parity TABLE ROW and once in the residual list, so both are fixed):

1. `compiler/src/codegen/protect-egress.ts` — residual bound (1). Now records that two
   earlier revisions of this comment got the parity wrong in BOTH directions, and that
   all three spellings are carry-forwards.
2. `compiler/tests/integration/g-sql-row-protect-leak.test.js` — the block comment AND
   the test title (`"RESIDUAL (documented, WIDENED by this branch)"` →
   `"RESIDUAL (documented, carry-forward)"`), plus the inline note on the
   `expect(...E-SCOPE-001).toBe(false)` assertion, which was pinning a carry-forward
   while claiming to pin a widening.
3. `docs/known-gaps.md` — the `**One is a WIDENING**` sentence. (This is the one
   known-gaps edit this round makes.)
4. `docs/changes/…/progress.md` — the round-3 parity table row, now `silent | silent`
   with a `CORRECTED at round 5` note naming the extraction defect that produced the
   wrong reading.
5. `docs/changes/…/progress.md` — the residual-list restatement of the same claim.

**Method note, since this is the third measurement of the same fact and the second wrong
one:** a base-tree claim is only as good as the base tree. Both wrong readings came from
comparing against something that was not a complete `origin/main` checkout. Every
main-side number in this round was taken from `git archive origin/main` + real
`node_modules`, and the probe script that took them is reproducible.

## Item 3 — the SPEC contradicted the tree's own shipped allowlist. CORRECTED (not struck).

**The provenance round 4 was given was backwards, and verifying it changed the fix.**

| claim | verified how | verdict |
|---|---|---|
| the *"deliberately narrow — `Response` only"* sentence "survived the rebase" | `git show origin/main:compiler/SPEC.md \| grep -c "deliberately narrow"` → **0**; on the branch → **1** | FALSE. The branch is **introducing** it. |
| `"Response", "Request", "Headers",` is this branch's widening | `git show origin/main:compiler/src/type-system.ts` shows the trio verbatim; the branch's diff in that region is comment-only | came from **main** (#590 / S355) |
| `origin/main` documents the §40.3.5 admission | no §40.3.5 admission text on main at all | the #590 widening landed with **zero normative text** |

So the branch was about to publish a SHALL-adjacent sentence that its own tree's shipped
allowlist flatly contradicts. Confirmed by compiling each name on this tree rather than
reading the allowlist:

```
Response  silent    Request   silent    Headers   silent
FormData  E-SCOPE-001 FIRES    Blob    E-SCOPE-001 FIRES    File   E-SCOPE-001 FIRES
```

`Headers` is admitted by the compiler and denied by the sentence.

**Struck? No — corrected.** Striking it would leave `main`'s state, which is an
undocumented widening: worse than a wrong sentence, because there would be nothing to
compare the compiler against. `compiler/SPEC.md` §40.3.5 now reads:

- the SHALL widened to the trio — **`Response`, `Request` and `Headers` SHALL be in
  scope as bare identifiers**;
- the two-step grant recorded: `Response` alone as the §40.3.5 conformance restoration
  (S352, dpa-029 Q1), then `Request` + `Headers` on adopter #471's document-workflow
  path, which constructs all three (#590, S355);
- the `request`-vs-`Request` distinction lifted from `type-system.ts:7302-7308` — the
  lowercase parameter binding never consults the allowlist; the capitalized global
  CONSTRUCTOR is exactly what the allowlist arbitrates. (That distinction is in the
  source because it was got wrong once, so it belongs in the normative text too.)
- `File` / `FormData` / `Blob` stay OUT, with the reason: a native scrml file-upload
  arrival shape is an open deliberation (dpa-030) and admitting those names would
  pre-empt it;
- the trailing clause kept **verbatim**: *"A manual `Response` remains an un-analyzable
  egress for §14.8.9 purposes — being in scope makes it authorable, not redactable, and
  `E-PROTECT-004` still fires when a protected-origin column reaches it."*

Bidirectional check for other loci: `grep -n '\`Headers\`|\`FormData\`|\`Blob\`'` over
`compiler/SPEC.md` returns **one** hit — this line. No second locus states the allowlist,
so there is nothing else to bring into agreement.

`bun scripts/s34-census.ts --check-new --base origin/main` re-run after this, the last
SPEC edit of the round.

## Item 5 — L1: the green half's anti-vacuity evidence was PROSE. Now it is assertion.

8 `cleanShapes`, 6 clean `adversarial` entries, and three residual pins asserted only
`expect(fires(result)).toBe(false)`. **A fixture that failed to compile passes every one
of them.** Only the first ruling test guarded. The two residual pins carried a
`progress.md` claim that each had been checked by hand for `I-PROTECT-STRIP-001` and
emitted server JS — true in fact, and not an assertion. This is F6's own lesson recursed
one level: an unpinned measurement decays.

Every green shape now runs a shared `expectCompiledAndProtecting(result)`:

```js
expect(codes).not.toContain("E-SCOPE-001");
expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
expect(codes).toContain("I-PROTECT-STRIP-001");
expect(serverJsOf(result)).toContain("_scrml_protect_redact");
```

— the file really compiled, the protect machinery really engaged, and the row really
left through the redacting path. The FIRING halves additionally assert no
`E-SCOPE-001`, so a fire is this gate's and not a fixture that never compiled. The
cross-file residual pin uses the app-half variant (its SELECT sits in the imported file,
so the strip info is raised there): clean compile plus a non-empty emitted server JS.

Covered: the 8 `cleanShapes`, both halves of the 16-entry `adversarial` matrix, the 10
`firingShapes`, `the same-BODY form`, and all three residual pins (call-through-a-value,
call-on-a-member, cross-FILE helper).

**BITE PROOF, executed.** One `cleanShapes` fixture was deliberately made non-compiling
in a way that leaves the gate silent — `let z = TOTALLY_UNDECLARED_IDENT` beside
`return new Response("nope")`:

```
978 |       expect(fires(result)).toBe(false);          ← PASSED (the gate is silent)
914 |     expect(codes).not.toContain("E-SCOPE-001");   ← FAILED
     Received: [ …, "I-PROTECT-STRIP-001", "E-SCHEMA-001", "E-SCOPE-001" ]
```

The old assertion passed on the broken fixture and the new one caught it — which is
exactly the vacuity L1 named. Fixture restored; the file is **135 pass / 0 fail**, with
`expect()` calls up from **211 to 308**.

## Item 6 — the two nits. BOTH FIXED, and one has a twin on `main`.

**(a) `conformance/cases/protect/reveal-does-not-suppress-e004` shipped a second, unrelated hard error.**
Cause located rather than guessed — it is not "no `db=`" in the abstract, it is the
`<schema>` rule:

```
E-SCHEMA-001: this `<schema>` block's enclosing `<program>` root has no `db=` attribute.
```

The case's opener was a bare `<program>`; its four raw-egress siblings all carry
`<program db="./app.db">`. Opener aligned to the siblings. Measured before/after:

```
before   reveal-does-not-suppress-e004   errors=["E-SCHEMA-001","E-PROTECT-004"]
after    reveal-does-not-suppress-e004   errors=["E-PROTECT-004"]
```

Superset-on-codes meant it passed either way; the point is that a case demonstrating
E-PROTECT-004 was also demonstrating an unrelated schema failure, which would mask a
future regression in exactly the code the case exists to pin.

⚑ **The same defect has a twin that is NOT this branch's:**
`conformance/cases/protect/raw-egress-e004/case.scrml` also opens with a bare
`<program>` and also emits `E-SCHEMA-001` — and it is on `origin/main`
(`git show origin/main:…` returns it verbatim). The brief scoped this nit to the NEW
case, so the twin is **reported, not edited**. The fix is the same one word:
`<program>` → `<program db="./app.db">`. **For the PA to take or delegate.**

**(b) `authed-server-fn-response-http.test.js` attributed the allowlist to "S352/#590" in two places.**
S352 is the **RULING** (dpa-029 Q1 — `Response` admitted for §40.3.5); S355/#590 is the
**LANDING** that actually put `Response` / `Request` / `Headers` into
`LOGIC_SCOPE_GLOBAL_ALLOWLIST`. Both comments now say which is which rather than fusing
them into one label. (The same file's line 711 and its provenance line 728 already had
it right — `S355/#590` and `S352 … issue #471 / #590` respectively — so the two
corrected loci were the outliers, not the convention.) 20 pass / 0 fail.

## Item 7 — the VERIFICATION BAR. Regression floor re-verified, and the honest baseline is bigger than the one handed over.

**Base tree extracted COMPLETELY**, per the brief's warning:
`git archive origin/main | tar -x -C .tmp/r5/base` plus a symlink to the real
`node_modules`. That tree enumerates **1906** `.scrml` sources (with `stdlib/`, so no
`scrml:` import fails). The round-4 reviewer's baseline of *"74 sources shared between
the trees"* was a truncated population — the truncated-probe class `pa-base v2.13 §8`
names, and exactly what the brief warned about.

**Standing gate, both sides captured with `scripts/corpus-emit-differential.ts`:**

```
base  (origin/main 1d245134)  enumerated 1906 · compiled 1224 · emitted 7383 · checked 4426
head  (raw-egress-r5-work)    enumerated 1912 · compiled 1225 · emitted 7413 · checked 4444
```

```
  sources enumerated        base 1906   head 1912      (source set delta 8 — head-only conformance cases)
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 CODE / 1226 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    1176 of 7378 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  load-context changes      0
```

### **0 diagnostic-CODE deltas over 1905 common sources.** The floor holds.

### The two large numbers, explained rather than waved at

**1226 text-only diagnostic changes → 1 real one.** A DETERMINISM CONTROL was run: the
head tree captured TWICE and self-diffed (`--allow-same-revision`) —

```
  diagnostic changes        0 code / 1225 text-only
  artifact content diffs    0 of 7413 compared
```

The same tree against itself produces 1225 of the 1226. Set-differencing the two runs
leaves **two** candidates, and one of those (`if-in-dispatched-arm-neg`) is the same
nondeterminism caught a run later — its message embeds `match_00zohdyn_8` vs
`match_00r1enft_8`. The **one** real diagnostic-text change is
`conformance/cases/protect/raw-egress-e004`: the E-PROTECT-004 resolution sentence lost
`"declassify explicitly at the value with reveal(\"col\")"`, which is round 3's
dpa-033 (c) fix (reveal does NOT admit a value past this gate). Intended, and not from
this round.

**1176 artifact content diffs → 158 intended, 1018 harness.** Every one was classified by
re-reading both artifacts and normalizing scrml's generated-id shape (`0` + 7 lowercase
alphanumerics — the chunk-scope, `each_`, `match_`, `_scrml_meta_` and
`__scrml_engine_` families all share it):

```
  1018  GENERATED-ID ONLY   ← e.g. `// --- chunk cell scope (019nucek) ---` vs `(01cstyxu)`
   158  the M4 guard line   ← `if (_scrml_result instanceof Response) return _scrml_result;`
     0  anything else
```

The 1018 are an artifact of comparing two checkout LOCATIONS (the id varies with the
tree root, which is why the self-diff finds 0 of them); the 158 are round 4's intended
M4 emission, matching that round's own recorded 159 to within the one source whose path
moved. **Nothing else in 7378 compared artifacts differs.**

### The rest of the bar

- `bun conformance/run.ts` → **889/889**.
- `bun test compiler/tests/integration/g-sql-row-protect-leak.test.js` → **135 pass /
  0 fail**, 308 `expect()` calls (was 109/211 at round start).
- `bun test compiler/tests/integration/authed-server-fn-response-http.test.js` →
  **20 pass / 0 fail**.
- `bun scripts/s34-census.ts --check-new --base origin/main` → **PASS** (2 new/changed
  §34 rows, all well-formed), re-run AFTER the last SPEC edit.
- The full pre-commit gate ran on **every** commit of this round; no `--no-verify`, no
  hook override. One commit hit a 5 s per-test TIMEOUT in
  `compiler/tests/integration/mcp-program-attr.test.js` under load; re-run in isolation
  that file is **14 pass / 0 fail in 415 ms** — an environmental timeout, not a
  regression, and the commit passed the gate on retry. (A timeout wears the same
  `(fail) <name>` as an assertion; that is why it was re-run rather than assumed.)
- ENV-GAP ruled out up front: `bun install` and `bun run pretest` were both run in this
  worktree before any measurement, so `samples/compilation-tests/dist/` is populated.

## ROUND 5 — RESIDUAL HANDED BACK

1. ⚑ **The `!{}` arm body has no tree form. This is the finding of the round, and it is
   bigger than §14.8.9.** An `!{}` error arm — the canonical scrml failure idiom — carries
   its body as `handler` (a STRING) and `handlerExpr` (an `escape-hatch` node). There is no
   structured representation of the arm body anywhere in the AST, and the body is emitted
   VERBATIM into the handler. **Every** structural analysis over function bodies is
   therefore blind inside `!{}` arms, not just this gate. §14.8.9 is now fail-closed across
   that blindness; the tenant twin, the auth graph, the reachability solver, the DG and
   every future body-walking pass are NOT. **Root fix: parse the arm body.** Filed here for
   the PA to scope.

2. ⚑ **A silent miscompile past `validateEmit: true`.** `1n`, `|>` and `-2 ** 2`
   escape-hatch and emit syntactically INVALID server JS with **zero** errors (reproduced
   on a non-protect program — see the H2 section). Not a §14.8.9 leak; a miscompile, and
   `validateEmit` is not catching it. For the PA to file.

3. ⚑ **The judgement call in H2 is flagged for confirmation.** Asking an `escape-hatch`
   node's own `raw` field what it could hold is a TEXT test, and dpa-029 Q1 rejected a
   source-text form. The argument that this is within the ruling — no better oracle exists,
   the tree's answer for THIS node is a string, same standing as `annotationIsAsIs`, every
   error is an over-report — is stated in full in the source docblock and in the H2 section
   above. Both alternatives were implemented and measured (22-source and 1-source corpus
   regressions respectively; both unshippable). **The PA should confirm or overturn.**

4. **`conformance/cases/protect/raw-egress-e004/case.scrml` has the same E-SCHEMA-001
   defect as the case fixed in item 6, and it is on `origin/main`.** Bare `<program>` with
   a `<schema>` block. One-word fix, deliberately not taken here because the brief scoped
   the nit to the NEW case.

5. **The generated-id families are nondeterministic across checkout LOCATIONS.** 1018 of
   1176 artifact diffs in the corpus gate are `0`+7-alphanumeric ids that vary with the
   tree root. Not a defect this round introduced, but it makes the standing gate's headline
   artifact-diff number unreadable without a normalizer. Worth a `--normalize-generated-ids`
   flag on `scripts/corpus-emit-differential.ts` so the signal is not buried; a future round
   that skips the classification step will read 1176 as a regression.

6. **CARRIED, unchanged from round 4:** the value-scoped `reveal` EXIT at a raw egress is
   still absent (§14.8.9 is a floor with no exit — dpa-033 (d), a separate arc); a FAILED
   build still writes `dist/` artifacts (`scrml compile` exits 1, prints
   "FAILED — 1 error", and still writes `app.server.js` / `app.client.js` / `app.html`);
   and the tenant twin (`compiler/src/codegen/tenant-egress.ts`) is untouched, per brief —
   the round-4 port table above still applies, and **H1 and H2 both port to it**: the twin's
   eventual structural rewrite must land the RETURN-POSITION rule and the escape-hatch
   treatment in the SAME change, not after.

## 2026-08-21/22 — ROUND 6: the S356 re-ruling, F3, F4, the nit

Branch `raw-egress-r6-work`, cut from `origin/raw-egress-r5-work` (507d0e6d) and rebased
onto `origin/main` (cd66686b).

### THE REBASE — 22 commits over 20 of main's, and what it had to preserve

`origin/main` moved 20 commits under this branch. Two of them were the landing hazard the
brief named:

- **`0944002d` (#596, HIGH — the §14.3 lifecycle raw-text launder fix).** Three new
  `maskStringLiteralSpans()` calls in `type-system.ts` (`:25163`, `:25173`, `:25353`,
  `:25517`). **PRESERVED.** No conflict arose: this branch's only `type-system.ts` diff is a
  COMMENT block at `:7287` (documenting why `Response`/`Request`/`Headers` are on
  `LOGIC_SCOPE_GLOBAL_ALLOWLIST`), ~18,000 lines away from every #596 hunk, so the two
  intents composed automatically rather than needing a hand-merge. Verified after the
  rebase by grep (all four masking call sites present) and by
  `git diff origin/main HEAD -- compiler/src/type-system.ts`, which is **comment-only, 23
  lines added, 0 removed**.
- **The two main-only test files** — `lifecycle-field-string-launder.test.js` and
  `noarg-server-fn-tolerates-empty-body.test.js`. **BOTH PRESENT** on the rebased branch.

⚑ **A wholesale file-delta land would still have reverted #596 and deleted both files**, and
the reason is worth recording: the danger was never a merge conflict, it was that the r5
branch's base (`1d245134`) PREDATES them. Rebase resolves that; `git checkout <branch> --
<files>` does not.

**Conflicts, and how they were resolved.** Three, all in GENERATED files
(`docs/FACTS.md`, `compiler/SPEC-INDEX.md`). Per the brief, none was hand-merged: the two
pure `chore(gen)` commits (`ba45e364`, `11d0fb0a`) were `--skip`ped outright, and the third
(`507d0e6d`, which also carried progress.md) took main's `FACTS.md` via `--ours`. Both files
were then REGENERATED from the final tree (`bun scripts/facts.ts --write`,
`bun scripts/regen-spec-index.ts`) as the last content step.

**Cost note, for whoever schedules the next round of this arc:** the repo's `post-commit`
hook runs the full `compiler/tests/` suite on any commit touching `compiler/`, and `git
rebase` fires it per replayed commit. The 22-commit rebase took ~4.5 hours of wall clock on
this box. It also produces a hazard: a commit issued while the PREVIOUS commit's post-commit
tail is still running competes for CPU, and the pre-commit gate's 5 s per-test timeout then
fires as `(fail) <name>` — indistinguishable from an assertion failure. That happened once
here (`v0-3-x-spa-tree-shake-phase-b.test.js`, reported `40382886.36ms`); re-run in isolation
it is **19 pass / 0 fail in 749 ms**. Every subsequent commit waited for load average to drop
below ~1.0 first. **No `--no-verify`, no hook override, at any point.**

### ITEM 1 (⭐) — the S356 re-ruling: BINDING, not position

> Exempt an all-literal egress construction ONLY when it is UNNAMED in return position —
> i.e. the constructed value never binds anywhere in the analyzed function.

**Premise verified empirically first, not relayed.** Both prior formulations were reproduced
by compiling AND executing on the exact trees that shipped them, before any code was written.

**v1 (S354, round 4) — "arguments syntactically all literals."** True of the CONSTRUCTION,
false of the BINDING. Executed on the r5 tree (`git archive origin/raw-egress-r5-work` + the
real `node_modules`), `_scrml_sql` stubbed to one protected row, the compiler-injected auth +
CSRF gates SATISFIED rather than removed:

```
let r = new Response("Forbidden", { status: 403 })   →  compile errors: []
r.headers.set("x-user", u.passwordHash)                 STATUS 403  BODY "Forbidden"
return r                                                HEADERS [["x-user","$argon2id$SECRET"]]
```

**v2 (S355, round 5) — "return position only."** Wrong by one syntactic level: `visit`
recurses into nested `function-decl` nodes, so `isReturnValue` reached EVERY `return-stmt`,
and the docblock at `:864-868` claiming it was "TRUE for exactly one node" was false as
written. Executed on the r5 tree:

```
function noContent() { return new Response("", { status: 204 }) }   compile errors: []
let res = noContent()                                               STATUS 204  BODY ""
res.headers.set("x-etag", u.passwordHash)                           HEADERS [["x-etag","$argon2id$SECRET"]]
return res
```

⚑ **Both leaks are on HEADERS with an empty or innocuous body.** A body-only check reads
GREEN on all four shapes below. That is why the execution harness prints body AND headers and
tests the concatenation.

**THE FIX — naming, tested in two syntactic halves.** No dataflow; the ruling rejected that on
direction.

1. `collectRawEgressFacts` gains `ownScope`: TRUE while the walk is inside the ANALYZED
   function's own body, FALSE from the moment it descends into a nested callable
   (`isNestedCallable` — a kind list plus a STRUCTURAL catch-all, "carries its own parameter
   list", so a callable kind added to the AST later still ends the scope). An exempted
   construction is recorded on the new `exemptReturnResponse`, **not** on `sawResponse`, so
   the whole-file pass can still see that a construction exists.
2. `detectProtectedRawEgressAcrossFns` gains the REVOCATION set. Each bare-identifier call
   edge is classified at collection time — `returnedCalls` when the call is the direct
   returned expression of its body's own `return`, `boundCalls` otherwise (and for every edge
   recovered from an `escape-hatch`, whose text cannot answer the question, so it answers
   CLOSED). For each analyzed root, the union of `boundCalls` over its reachable set is closed
   transitively over `returnedCalls`, and any function whose NAME lands in that set loses its
   exemption.

The transitive closure is not decoration. Without it, one pass-through helper launders the
whole rule:

```scrml
function deny()     { return new Response("Forbidden", { status: 403 }) }
function passthru() { return deny() }                    // deny's value is never NAMED here
export server function dispatch(id) {
  let u = loadUser(id)
  let r = passthru()                                     // ...it is named HERE
  r.headers.set("x-user", u.passwordHash)
  return r
}
```

Executed on the r5 tree: `STATUS 403 BODY "Forbidden" HEADERS [["x-user","$argon2id$SECRET"]]`.

**TWO-SIDED BITE PROOF — every bullet of the brief's boundary list, measured by compiling on
three trees.** (`main` = extracted `origin/main` @ cd66686b; `r5` = extracted
`origin/raw-egress-r5-work` @ 507d0e6d; `r6` = this branch.)

| shape | main | r5 | r6 | |
|---|---|---|---|---|
| `return new Response("Forbidden", {status:403})` (§40.3.5's, unnamed) | FIRES | silent | **silent** | GREEN — the exemption's whole point |
| `return deny()` — the cross-call edge (round-5 F2) | silent | silent | **silent** | GREEN — F2 holds, and (c) dissolved it with no separate rule |
| `return Response.json({ok:true})` unnamed | — | — | **silent** | GREEN |
| `let r = new Response("ok"); r.headers.set(secret); return r` | FIRES | **LEAK** | **FIRES** | RED — v1 pin |
| `let r = new Response(...); return r` (unmutated) | FIRES | FIRES | **FIRES** | RED — we do not track mutation |
| nested `function noContent(){…}` + `let res = noContent()` + mutate | FIRES | **LEAK** | **FIRES** | RED — v2 pin; **the regression against main** |
| the same helper at FILE level | silent | **LEAK** | **FIRES** | RED — closed past main |
| `let r = deny(); r.headers.set(…)` | silent | **LEAK** | **FIRES** | RED — closed past main |
| pass-through helper + bind + mutate | silent | **LEAK** | **FIRES** | RED — closed past main |
| `taint(deny(), u)` — argument position names it | — | — | **FIRES** | RED |
| `let r = Response.json({ok:true})` + mutate | — | — | **FIRES** | RED |
| `new Response(JSON.stringify(u))` in return position | FIRES | FIRES | **FIRES** | RED — unnamed but not all-literal |
| an all-literal construction inside an ARROW body | — | — | **FIRES** | RED — stated fail-CLOSED corner |
| a NESTED helper's return, nothing names it | FIRES | silent | **FIRES** | RED — stated fail-CLOSED corner, see below |
| escape-hatch-wrapped folded bracket key (F3) | silent | silent | **silent** | RESIDUAL — carry-forward, pinned |

**EXECUTED, not grepped — the silent half.** Every shape asserted silent was compiled AND its
emitted handler run, with body and headers both inspected:

```
exempt_403      id=1   STATUS 200  BODY {"name":"ada"}  HEADERS [["content-type","application/json"]]
exempt_403      id=-5  STATUS 403  BODY Forbidden       HEADERS []
deny_return     id=1   STATUS 200  BODY {"name":"ada"}  HEADERS [["content-type","application/json"]]
deny_return     id=-5  STATUS 403  BODY Forbidden       HEADERS []
handle_403      id=1   STATUS 200  BODY {"name":"ada"}  HEADERS [["content-type","application/json"]]
```

`handle_403` is §40.3.5's worked example in its ACTUAL context — a `handle(request, resolve)`
body returning a bare `new Response("Forbidden", { status: 403 })` beside a protected query.
Silent on this tree and on `main` alike. (It reaches the gate as an escape hatch, but shares
no call edge with the protected query, so the co-occurrence never forms. Worth stating because
"the §40.3.5 shape is exempt" is true in the server-fn body for the reason the ruling gives,
and true inside `handle()` for a DIFFERENT reason.)

**ONE ASYMMETRY, stated rather than hidden.** A file-level `return deny()` is exempt; a NESTED
`function noContent(){ return new Response("",{status:204}) }` + `return noContent()` FIRES,
even though nothing names the value. `collectFunctions` does not collect nested declarations,
so the nested helper is not a member of the file's `function-decl` set and the whole-file
revocation cannot see who names it — and "cannot see" answers CLOSED. Pinned as a test with
that reasoning attached, so it reads as a decision rather than an oversight.

**Ruled OUT, having looked for it: no shape was found where (c) still leaks**, so the brief's
escalation clause (fall back to (b), drop the exemption) was not triggered. The vectors probed
and their answers: mutation through a binding (revoked); mutation through a nested callable
(own-scope ends); mutation through a helper one call away (revoked); through TWO calls with a
pass-through in between (revoked by the transitive closure); through an argument position
(`boundCalls`, since `isReturnValue` is false there); through a member-call receiver
(`deny().headers.set(...)` — same); through an `!{}` arm or any other opaque region (its
recovered edges are `boundCalls` by construction). The one remaining vector is a CROSS-FILE
namer, which is residual (2) — the intra-file call-graph bound — and is silent on `main` for
the same reason, so it is carried, not introduced.

### ITEM 2 (F3, MED) — "CLOSED, not pinned as residual" had an escape-hatch bypass

`staticIndexKey` folds `"Resp" + "onse"` ON THE TREE PATH. `escapeHatchSurface` tests TEXT and
does not fold, so wrapping the identical shape in any expression the parser cannot represent
takes it off the tree path and the surface sees no `Response` TOKEN.

```scrml
return new globalThis["Resp" + "onse"](JSON.stringify(u), { status: 201 + ~0 })
```

**Executed, this tree:** `compile errors: []`, `STATUS 200`,
`BODY {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}`. Silent on `main` too, so
**carry-forward, not a regression**. The emitted handler serializes the TAGGED row and returns
it through the `instanceof Response` passthrough — i.e. before `_scrml_protect_redact` is ever
reached, which is why the floor cannot save it.

Wording corrected at **both** loci to "closed on the tree path; the escape-hatch path carries
residual (1)" — `protect-egress.ts` (residual paragraph (1)) and `docs/known-gaps.md`. Pinned
as a `RESIDUAL (documented)` test asserting the silence AND the leak's presence in the shipped
server JS, so closing it turns a test red. The fold inside `escapeHatchSurface` was
deliberately NOT attempted: it is a text-side constant fold and wants its own corpus
measurement, per the brief.

⚑ **One known-gaps edit beyond the item, flagged.** The paragraph immediately after the F3
one ("⚑ S354 — one PRECISION narrowing, ruled") stated the all-literal rule as the SHIPPED
rule. After the S356 re-ruling that is false as written, and read literally it licenses the v1
leak. A security doc stating a superseded fail-OPEN rule next to a correction of a different
fail-OPEN is worse than the edit, so a one-paragraph `⚑ RE-RULED S356` correction was appended
rather than rewriting the historical record. **Surfaced here because the brief scoped
known-gaps to the F3 locus only.**

### ITEM 3 (F4, LOW) — the anti-vacuity guard was duplicated, and incomplete

Two copies of `expectCompiledAndProtecting` (`:637`, `:912`), a third describe with none
(`:1220`), and both copies only EXCLUDED two codes — so any other hard error walked through.

Replaced by ONE set of helpers at module scope, asserting an **equality** on the error set:

- `expectCompiledCleanly` — `errorCodesOf(result)` **equals** `["E-SCHEMA-001"]` (the
  fixture-wide constant: `protectProgram`'s `<program>` carries no `db=`), plus non-empty
  emit.
- `expectCompiledAndProtecting` — the above, plus `I-PROTECT-STRIP-001` present and
  `_scrml_protect_redact` in the emitted server JS.
- `expectFiredCleanly` — the red half's mirror.

Applied to **every** green shape the brief listed (`:459/:467`, `:515/:523`, `:594/:606`,
`:708`, `:787`, `:883`, `:936`, `:1175`, and all four escape-hatch greens), plus every green
in the new S356 block. Two greens correctly get `expectCompiledCleanly` and an explicit
assertion that `I-PROTECT-STRIP-001` is **absent** — their SELECT projects no protected
column, and demanding the strip info there would have been a false assertion.

**BITE PROOF (the brief's own probe, executed).** Injecting `let n:number = "not a number"`
into a green fixture:

- under the round-5 helper: every assertion still passed (the exclusion list does not name
  `E-TYPE-031`);
- under this one: **`(fail) EXEMPT — §40.3.5's own …`**, `Expected - 0 / Received + 1`.

Reverted; file back to 152 pass / 0 fail.

### ITEM 4 — the nit

`emit-server.ts` attributed #590's `LOGIC_SCOPE_GLOBAL_ALLOWLIST` landing to "this same arc".
It is **S355/#590's landing, on `main`**; this arc carries the S352 ruling and its
`type-system.ts` diff is comment-only. Sixth instance, so the correction now also names WHY it
keeps re-entering (adjacent in time, both cite §40.3.5). Grepped: no other "this same arc"
attribution remains under `compiler/src` or `compiler/tests`.

### VERIFICATION

- **Baseline, on the rebased tree BEFORE any round-6 edit:**
  `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` →
  **22531 pass / 0 fail / 70 skip / 1 todo**, 114278 expects, 1236 files.
- **`g-sql-row-protect-leak.test.js`** → **152 pass / 0 fail**, 396 expects (was 135 / 308 at
  round-6 start).
- **`authed-server-fn-response-http.test.js`** → 20 pass / 0 fail (172 / 523 for the pair).
- **`bun conformance/run.ts`** → **889/889**.
- **`bun scripts/s34-census.ts --check-new --base origin/main`** → **PASS** (2 new/changed §34
  rows, well-formed), run AFTER the last SPEC edit.
- **ENV-GAP ruled out first:** `bun install` (217 packages) and `bun run pretest` (13 samples →
  `samples/compilation-tests/dist/`) both run in this worktree before any measurement.

**THE REGRESSION FLOOR, RE-MEASURED against current main (cd66686b).** The round-5 figure was
measured against `1d245134` and is stale. Method: a diagnostic-code census over the full
default corpus root set (`examples`, `samples`, `conformance`, `stdlib`, `benchmarks`,
recursive), each tree compiling ITS OWN checkout so no source is attributed to the wrong
revision, then intersected by relative path. Both trees extracted with `git archive` + a real
`node_modules` symlink — `stdlib/` present on both, so `scrml:` imports resolve (the ENV-GAP
that reads as a regression).

```
base (origin/main cd66686b) sources : 1906
head (this branch)          sources : 1912
SHARED                              : 1905      head-only 7, base-only 1
SHARED SOURCES WITH A DIAGNOSTIC-CODE DELTA : 0
  ...of the 18 shared sources emitting any PROTECT code : 0
```

**Zero.** Not 62 protect-active sources but the whole 1905-source shared corpus, because the
narrower population is the one that can be truncated without anyone noticing. The 7 head-only
sources are this arc's own conformance cases; the 1 base-only is a rename.

### ROUND 6 — RESIDUAL HANDED BACK

1. **The escape-hatch bypass of the folded bracket key (F3) is OPEN**, now pinned and correctly
   worded at both loci. Closing it = a text-side constant fold inside `escapeHatchSurface`,
   which wants a corpus measurement first. Not attempted here.
2. **The nested-callable asymmetry** (a nested helper's unnamed return FIRES where the
   file-level twin is exempt). Fail-CLOSED, pinned, stated. Closing it properly means teaching
   the revocation about nested declarations — i.e. giving `collectFunctions` a nested view, or
   tracking nested declarations inside the body walk. Worth doing only if an adopter hits it.
3. **CARRIED from round 5, unchanged and still the biggest of them:** the `!{}` arm body has no
   tree form, so EVERY body-walking analysis is blind inside it, not just this gate. §14.8.9 is
   fail-closed across that blindness; the tenant twin, the auth graph, the reachability solver
   and the DG are not. Root fix: parse the arm body.
4. **CARRIED from round 5:** `1n`, `|>` and `-2 ** 2` escape-hatch and emit syntactically
   INVALID server JS with zero errors, past `validateEmit: true`. A miscompile, not a §14.8.9
   leak.
5. **CARRIED from round 5:** the H2 judgement call (asking an `escape-hatch` node's own `raw`
   field what it could hold) still wants the PA's confirm-or-overturn.
6. **CARRIED:** the value-scoped `reveal` EXIT at a raw egress is still absent (§14.8.9 is a
   floor with no exit — dpa-033 (d), a separate arc); and the tenant twin
   (`compiler/src/codegen/tenant-egress.ts`) is untouched per brief. **The port table now has a
   third row: the twin's structural rewrite must land the UNNAMED-IN-RETURN-POSITION rule, the
   escape-hatch treatment AND the call-edge classification in the same change** — landing the
   all-literal narrowing there without the naming half would reproduce this exact fail-OPEN in
   the tenant lane.
7. ⚑ **NEW, and it is an infrastructure problem, not a §14.8.9 one.** The `post-commit` hook
   runs the full `compiler/tests/` suite on every compiler-touching commit, and `git rebase`
   fires it once per replayed commit — 22 commits ≈ 4.5 h here. Worse, the resulting CPU tail
   makes the NEXT commit's pre-commit gate flake on its 5 s per-test timeout, and a timeout
   wears the same `(fail) <name>` as an assertion. A `--no-verify` is the obvious wrong answer
   and was not taken. Two honest options for the PA: gate the post-commit hook on
   `GIT_REFLOG_ACTION`/rebase-in-progress, or raise the per-test timeout so load cannot
   manufacture a red gate.

---

# ROUND 7 (S354, delta-log `[1676]`) — THE EXEMPTION IS DELETED

Branch `raw-egress-r7-work`, cut from `raw-egress-r6-work` (`5f5736e3`) and brought onto current
main. **The operator dropped the rule the three prior rounds were built around.**

> "DROP the all-literal exemption. `E-PROTECT-004` returns to CO-OCCURRENCE. The §40.3.5 false
> positive is ACCEPTED."

This supersedes the original S354 ruling (`[1606]`) and both narrowings (S355, S356 `[1644]`).

---

## 0. The rebase — MERGE, not rebase, and why

The branch was **24 commits behind** and that was a live landing hazard. Both of main's fixes named
in the brief were absent and a wholesale file-delta land would have REVERTED them. After the merge,
both verified present:

| main fix | what it does | verified |
|---|---|---|
| **#634** (`ef6800c7`) | `ASSIGN_RE.exec(maskStringLiteralSpans(txt))` in `type-system.ts` — without it a base64 data URI, `"a=b&c=d"` and `obj["a = b"]` wrongly fire `E-FN-003` | present at `type-system.ts:24099`; and **independently confirmed by measurement** — the corpus floor shows `compiler/self-host/ast.scrml` LOSING 5 spurious `E-FN-003` between the r6 head and this head |
| **#624** (`2a2676f8`) | `indentBodyLines` extracted to `codegen/utils.ts` | shared import in place at `emit-server.ts:3`, 8 call sites route through it, the old inline re-indenter is gone |

`docs/known-gaps.md` **auto-merged**, so main's 6 new gap entries and 24 `@gap` marker changes
survive alongside this arc's. The only conflict was `docs/FACTS.md`, a GENERATED file, resolved to
main's values and regenerated.

**Merge rather than rebase, deliberately.** The `post-commit` hook runs the full suite on every
compiler-touching commit and `git rebase` fires it per replayed commit — the round-6 residual (item
7) measured 22 commits at ≈4.5 h. A first attempt here timed out having replayed exactly ONE commit
in two minutes. A merge is one commit with identical landing semantics and the brief permits either.
**Round 6's residual item 7 is hereby re-confirmed as still-open infrastructure: it now costs every
round of this arc real time.**

---

## 1. What was DELETED and what was KEPT

Read before deleting. The dividing line: **the call-graph reachability is the S352 ruling and is NOT
part of the exemption; the argument test, the position/scope machinery and the naming classification
existed ONLY to serve it.**

### DELETED (exemption-only, verified by grep before removal)

| symbol | why it was exemption-only |
|---|---|
| `isSyntacticLiteral` + its ~160-line rationale | only callers were `objectPropIsLiteral` / `argsAreAllLiterals` |
| `objectPropIsLiteral` | only caller was `isSyntacticLiteral` |
| `argsAreAllLiterals` | only callers were the two grant sites |
| the two grant sites (`new Response`, `Response.json`) | now set `sawResponse` unconditionally |
| `RawEgressFacts.exemptReturnResponse` | the grant flag |
| `RawEgressFacts.boundCalls` / `.returnedCalls` | the revocation inputs |
| `NESTED_CALLABLE_KINDS` + `isNestedCallable` | only consumer was `ownScopeHere` |
| `visit`'s `isReturnValue` and `ownScope` parameters | only consumers were the grants + the call classification |
| the explicit `return-stmt` pre-visit | existed only to set the flag; the generic key loop already reaches `exprNode`, so removing it computes the same walk |
| `egressKindOf`'s `responseRevoked` parameter | the revocation read |
| the transitive revocation closure in `detectProtectedRawEgressAcrossFns` | the `boundCalls` seed + `returnedCalls` fixpoint |

Net: **−816 lines / +406** across the four files in that commit.

### KEPT (the gate's non-exemption work)

- **The whole intra-file call graph** — `calls`, `indicesByName` (the fail-closed MULTIMAP, S354
  round 3), `reachFrom` and the BFS call paths the diagnostic names. Cross-function detection is the
  S352 ruling; the Extract-Function hole depends on it.
- **Callee resolution** — `terminalName`, `memberReceiverName`, `staticIndexKey`,
  `staticStringLiteralValue`, `templateLitIsStatic`. Verified by grep that these serve the CALLEE
  chain (`new globalThis["Resp" + "onse"]`), not the argument test.
- **`escapeHatchSurface` / `escapeHatchSnippet`** and the escape-hatch call-edge recovery (minus its
  `boundCalls` half).
- **The depth cap and BOTH fail-closed truncation reasons.**

---

## 2. TWO-SIDED BITE PROOF — compiled AND executed, body AND headers

Every leak is **header-only with an innocuous body**, so a body-only probe reads all of them clean.
Each shape was compiled, its emitted handler imported, and the route handler invoked with a seeded
session + CSRF token against a stubbed `_scrml_sql`.

| reproducer | `origin/main` | r6 head | **r7 head** |
|---|---|---|---|
| **1.** v1 — bound directly (`let r = new Response(...)`; `r.headers.set`) | FIRES | FIRES | **FIRES** |
| **2.** v2 — a nested helper's return, named by the enclosing body | FIRES | FIRES | **FIRES** |
| **3.** v2 — across a file-level call edge (`let r = deny()`) | silent | FIRES | **FIRES** |
| **4.** v3 — two frames out through a pass-through | silent | FIRES | **FIRES** |
| **5a.** `let make = deny; make()` | silent | silent | **silent** ⚑ |
| **5b.** `http.deny()` | silent | silent | **silent** ⚑ |
| **5c.** `handlers["deny"]()` | silent | silent | **silent** ⚑ |
| **5d.** `apply(deny)` | silent | silent | **silent** ⚑ |
| **FP** §40.3.5 co-occurrence (`return deny()`) | silent | silent | **FIRES** ← the ruling |
| **FP** §40.3.5 inline return | FIRES | silent | **FIRES** ← the ruling |

Executed on the r6 head, every `silent` row above answered:

```
status=403  BODY: "Forbidden"   HEADERS: [["x-user","$argon2id$SECRET"]]
status=204  BODY: ""            HEADERS: [["x-etag","$argon2id$SECRET"]]
status=200  BODY: "ok"          HEADERS: [["x-user","$argon2id$SECRET"]]
```

The two **FP** rows are the ACCEPTED FALSE POSITIVE. That is the point, not a regression.

### ⚑ THE FIFTH REPRODUCER DOES NOT FIRE, AND THE BRIEF'S PREMISE ON IT IS WRONG

> ⛑ **CORRECTED AT ROUND 8 — THIS HEADING AND THE PARAGRAPH BELOW IT ARE WRONG, AND THE ERROR IS
> LOAD-BEARING.** The brief's premise was RIGHT and this section's refutation of it was built on a
> WEAKENED reproducer. The fixtures below omit one line — `if (!u) { return deny() }`, a bare-name
> call in return position — and that line is what puts `deny` in `reach(getUser)`. WITH it, all four
> spellings FIRE on this head and are SILENT on an otherwise-identical tree carrying only the
> round-6 `protect-egress.ts`: the exemption was the SOLE cause, and deleting it CLOSED the leak.
> WITHOUT it there is no edge at all and the silence is the call-graph bound — which is the only
> half this section actually measured. **"Deleting the exemption was never going to close them" is
> false of the edge-bearing class.** Consequence: the leak this arc closed sat UNPINNED for a full
> round. See ROUND 8 §1-§2; the four `REGRESSION GUARD (closed leak)` tests are the fix.


The brief's expected outcome was that all five fire. **Four do.** The fifth's four spellings do not,
and **the reason is not the exemption** — it is the intra-file BARE-IDENTIFIER call-graph bound
(residual (2), documented in `detectProtectedRawEgressAcrossFns` since round 3).

Proof by measurement on three trees: **all four spellings are silent on `origin/main` too**, where
there is no exemption AND no call graph at all. `reach(getUser)` simply has no edge to `deny`,
because the callee arrives through a binding / a member / an index / a parameter. Deleting the
exemption was never going to close them.

They are now **pinned** as `RESIDUAL (documented)` tests, which is the guarantee `known-gaps.md`
claimed at S354 and did not have: closing the bound turns them red and forces the bound paragraph to
be updated in the same change.

---

## 3. THE FIFTH LEAK IS CLOSABLE, MEASURED, AND HANDED BACK — NOT LANDED

> ⛑ **RE-SCOPED AT ROUND 8.** Everything below about the patch — the 10 lines, the zero blast
> radius, the SPEC-amendment blocker — still holds. Its MOTIVATION does not. This is NOT the fix
> for a live leak: the edge-bearing half of "the fifth leak" was closed by the exemption deletion
> in this same round and is now pinned. The patch addresses the weaker NO-EDGE class, which has been
> silent since before this arc existed. The operator is being asked a PRECISION question, not a
> security one. See ROUND 8 §5.


Because "handed back with a question" is worth less than "handed back with a decision", the fix was
built and measured on a **scratch copy** (`git archive HEAD` + real `node_modules`), and deliberately
**not committed**.

**The patch** — 10 lines in `collectRawEgressFacts`, immediately after the existing `call` branch:

```ts
// a bare-identifier REFERENCE also contributes an edge, so `let make = deny`,
// `{ deny: deny }` and `apply(deny)` reach `deny`. The caller's `indicesByName`
// drops any name that declares no function in this file, so the
// over-approximation is bounded by the file's own function-decl set.
if (n.kind === "ident" && typeof n.name === "string") {
  calls.add(n.name);
}
```

**Measured:**

- **All four L5 spellings FIRE** (5a, 5b, 5c AND 5d) — the fifth leak closes completely.
- **Corpus blast radius: ZERO.** 2,369 shared sources, diagnostic-code multiset delta **empty** —
  not one source gains or loses a code.

**Why it was NOT landed, and this is the load-bearing reason:** §14.8.9 now states `reach(F)`
normatively as *"`F` plus every function `F` transitively **calls** within the file"*. A reference
edge redefines `reach` as *mentions*, not *calls*. That is a **normative SPEC amendment to the
reachability definition**, and Rule 4 makes that the operator's call, not a codegen agent's — landing
it would put the compiler in contradiction with SPEC text written in this same dispatch.

Note also that corpus-zero here is **blast-radius evidence only**, not evidence of no cost: an
adopter file that merely *names* a helper would newly be treated as reaching it.

**The decision PA/operator owes:** amend §14.8.9's `reach(F)` from *calls* to *calls-or-names* and
land the 10 lines, or leave the bound and keep the four pins. Everything needed to fire it is above.

---

## 4. THE ACCEPTED FALSE POSITIVE IS NOW A CONTRACT, NOT AN ACCIDENT

The adversarial pass found **zero** conformance cases covering the exemption side — the half of the
rule that shipped two executed leaks had no contract coverage at all.

**New:** `conformance/cases/protect/raw-egress-40-3-5-accepted-false-positive` (889 → 890 cases).
It asserts the §40.3.5 shape **FIRES** `E-PROTECT-004`, and its description says plainly that the
fire is deliberate and ratified, names both workarounds, and states the reopening condition.
`I-PROTECT-STRIP-001` is asserted alongside as the anti-vacuity half — proof the protect machinery
engaged and the row left by the redacting path, rather than the fixture failing to compile.

Also filed in `docs/known-gaps.md`: the FP, its two workarounds (project the protected column out of
the SELECT; or return through the compiler-emitted path), and the reopening condition.

---

## 5. SPEC — the exemption was normative text and is struck

**§14.8.9.** The round-6 "TWO REQUIRED CONDITIONS" block is replaced by the co-occurrence rule
stated normatively, THE ACCEPTED FALSE POSITIVE recorded in the prose, a normative *why no
exemption* paragraph (a whitelist revoked by proving a NEGATIVE over a provably incomplete graph),
and a REOPENING CONDITION that routes a future complaint to the make-the-sink-mediatable question
rather than to a fourth formulation.

**§34 `E-PROTECT-004` row.** Restated for co-occurrence. Both defects the pass found disappear —
**verified by probe, not by reading:**

1. *It licensed more than the code allowed.* A nested callable's **unnamed** return satisfied the
   row's plain words ("all literals AND unnamed in return position") but fired. Probed on this head:
   that shape **FIRES**, and the row now says every construction fires — row and compiler agree.
2. *Its truncation parenthetical named only the depth cap* while the compiler also truncates on an
   unparseable `escape-hatch`. The row now names **both causes and both resolutions**, because they
   differ — "reduce the nesting" sends an author to fix something that is not broken. The second
   cause is pinned by the existing test asserting `has no tree form` + `move the ?{} out of that
   expression`.

`bun scripts/s34-census.ts --check-new --base origin/main` → **2 new/changed rows, all well-formed —
PASS**, run after the last SPEC edit.

---

## 6. SUPERSEDED RULES STATED AS CURRENT — swept

| locus | was | now |
|---|---|---|
| `g-sql-row-protect-leak.test.js` v1 block + describe title | "an egress whose arguments are SYNTACTICALLY ALL LITERALS is not an egress" as the current rule | block REPLACED; the phrase survives only inside an explicitly-historical v1/v2/v3 list |
| same file, v2 block | "applies ONLY where the construction is the RETURN VALUE" | REPLACED |
| `protect-egress.ts` inline rationale above the code | v1 stated as the live rule | REPLACED with "The ARGUMENTS ARE NOT CONSULTED" |
| `protect-egress.ts` residual bound (4) | the exemption stated as a shipped precision narrowing | REPLACED with the deletion note |

Swept SPEC, `known-gaps.md`, `docs/changes/**`, conformance descriptions and code/test comments:
every surviving mention is framed as superseded history. No survivor states a dead rule as current.

**Two additional corrections found while sweeping, neither in the brief:**

- **`templateLitIsStatic`'s fail-direction note was wrong.** It claimed its one false negative errs
  fail-CLOSED. That was true of the exemption caller and FALSE of the other one even before this
  change; with the exemption deleted its only caller is bracket-KEY resolution, where a false
  negative means the key does not resolve, the callee does not resolve, and the shape reads as **no
  egress** — the fail-OPEN direction. Corrected rather than deleted.
- **The "`type-system.ts` diff is comment-only" phrasing is RETIRED at three loci**
  (`protect-egress.ts`, `emit-server.ts`, `known-gaps.md`). It is a true statement about this arc's
  ADDITIONS that was being read as a licence to land the file WHOLESALE. Off a stale base that
  reverts main's own edits — measured here, where it would have reverted #634. Replaced with "this
  arc adds no allowlist entry" plus an explicit **rebase-or-merge, never file-delta** instruction at
  each site.

---

## 7. ONE VACUOUS ASSERTION — closed

`g-sql-row-protect-leak.test.js` "a non-protect app is byte-unchanged" asserted only
`not.toContain("_scrml_protect")` + `parseClean`. A fixture that fails to compile yields
`serverJs === ""`, which contains nothing and parses fine — **both assertions pass on a broken
fixture.** Positive assertions now come FIRST (error set equals the file-wide `E-SCHEMA-001`, the
emission is non-empty, and it contains the query the fixture is about plus `_scrml_sql`), and only
then does the absence claim mean anything. Its channel/SSE twins already carried positive
assertions and were left alone.

---

## 8. REGRESSION FLOOR — re-measured against CURRENT main

Both baselines extracted completely (`git archive` + symlinked real `node_modules`); **`stdlib/`
verified present at 21 modules in each**, so no `scrml:` import fails and nothing reads as a phantom
regression. `compiler/tests/unit/__fixtures__/` differences are **gitignored test-run artifacts**
(`git check-ignore` confirms; 0 tracked files there) — ENV-GAP, ruled out, not counted.

| comparison | shared sources | files with a CHANGED code multiset |
|---|---|---|
| `origin/main` → r7 head | 2,361 | **0** |
| r6 head → r7 head | 2,368 | **1** — `compiler/self-host/ast.scrml`, which **LOSES** 5 spurious `E-FN-003`. That is main's #634 arriving via the merge: a FIX, and independent proof the merge landed it. |
| r7 head → r7 head + the §3 probe patch | 2,369 | **0** |

**Non-vacuity:** the measurement is not zero-because-nothing-ran. `I-PROTECT-STRIP-001` fires in
**27** corpus sources on this head, so the protect floor is genuinely engaged.

### Every new `E-PROTECT-004` fire, enumerated

`E-PROTECT-004` fires in 1 source on `origin/main`, 7 on the r6 head, **8** on this head.

**r6 head → r7 head: exactly ONE new fire**, and it is
`conformance/cases/protect/raw-egress-40-3-5-accepted-false-positive` — a file that exists only on
this head, and which is the accepted FP **by construction**. **Zero pre-existing corpus sources
gained a fire.**

`origin/main` → r7 head: 7 new fires, all of them this arc's own conformance cases (6 from the
earlier rounds' cross-function / escape-hatch / reveal work, 1 the new FP case). Every one accounted
for; none is a surprise.

⚑ **The brief expected new fires where the exemption previously silenced them. There are none on the
corpus.** The honest reading: the exemption never bought a single real corpus source any precision.
It cost five executed leaks and returned zero.

---

## 9. RESIDUAL HANDED BACK

1. ⭐ **The fifth leak's four spellings** (§3 above) — the call-GRAPH bound, closable by a measured
   10-line patch with **zero** corpus blast radius, NOT landed because it requires a normative
   amendment to §14.8.9's `reach(F)` definition. **This is the one live decision this round hands
   back.**

   > ⛑ **RE-SCOPED AT ROUND 8** — see ROUND 8 §5. The edge-bearing half of this item is CLOSED and
   > pinned; only the no-edge half remains, and it is a precision question.

2. ⚑ **NEW, and NOT a §14.8.9 question.** A server fn referenced as a VALUE emits **no in-process
   peer**: `function deny() {...}` + `apply(deny)` emits a handler that dies on `ReferenceError:
   deny is not defined`. Found while building reproducer 5d. Pre-existing, unrelated to protect, and
   a plain codegen gap.
3. **CARRIED (round 6, item 7) and now measured twice:** the `post-commit` hook runs the full suite
   per commit, so `git rebase` is unusable on this branch — the first attempt here replayed ONE
   commit in two minutes before timing out. Gate the hook on rebase-in-progress, or accept that
   every round of this arc must merge rather than rebase.
4. **CARRIED:** the `!{}` arm body has no tree form, so every body-walking analysis is blind inside
   it. §14.8.9 is fail-closed across that blindness; the tenant twin, the auth graph, the
   reachability solver and the DG are not.
5. **CARRIED:** `1n`, `|>` and `-2 ** 2` escape-hatch and emit syntactically INVALID server JS with
   zero errors, past `validateEmit: true`. A miscompile.
6. **CARRIED:** the value-scoped `reveal` EXIT at a raw egress is still absent — §14.8.9 remains a
   floor with no exit (dpa-033 (d), a separate arc).
7. ⚑ **The tenant twin's port table SHRINKS.** `compiler/src/codegen/tenant-egress.ts` is untouched
   per brief, and round 6 said its structural rewrite must land the unnamed-in-return-position rule,
   the escape-hatch treatment AND the call-edge classification together. **Two of those three are
   now void** — there is no naming rule and no call-edge classification to port. The twin needs the
   escape-hatch treatment and the call-graph reachability, and it must NOT be given an all-literal
   exemption: doing so would reproduce all five leaks in the tenant lane.

---

# ROUND 8 (S354, change-id `raw-egress-structural-fix-2026-08-19`) — THE CORRECTION: ROUND 7 CLOSED A LEAK AND THEN ARGUED IT HADN'T

Branch `raw-egress-r8-work`, cut from `origin/raw-egress-r7-work` (`0e8c3f5e`), which already
contained `origin/main` (`a0e30329`) — `git merge origin/main` reported *Already up to date*, so
there is no merge commit this round and no stale-base hazard.

**ENV-GAP ruled out first:** `bun install` (217 packages) in this worktree before any measurement;
every extracted tree below carries a symlink to that real `node_modules` and a `stdlib/` verified at
21 modules, so no `scrml:` import fails and nothing reads as a phantom regression.

---

## 1. ⭐ THE CORRECTION — ROUND 7'S CONCLUSION ABOUT REPRODUCER 5 IS FALSE

Round 7 wrote, in this document and in the test file and in `known-gaps.md`:

> *"All four spellings are silent on `origin/main` too… Their silence is the intra-file
> bare-identifier call-graph bound… Deleting the exemption was never going to close them."*

**Measured at round 8 on two trees. The conclusion is false.** Round 7's fixtures omitted ONE line —
a bare-name call to the helper, in return position — and that line is the whole difference:

```scrml
function deny() { return new Response("Forbidden", { status: 403 }) }
export server function getUser(id) {
  let u = ?{`SELECT id, name, passwordHash FROM users WHERE id = ${id}`}.get()
  if (!u) { return deny() }        // ← THE VISIBLE EDGE. Round 7's fixtures omit this.
  let make = deny                  // the unresolvable callee
  let r = make()
  r.headers.set("x-user-hash", u.passwordHash)
  return r
}
```

With that line present, `deny` is in `reach(getUser)`, the gate sees `deny`'s `new Response`, and
co-occurrence fires. Round 7's own pins are correct **for what they pin**; the conclusion drawn from
them is not. Two different classes were reported as one.

### The two-sided measurement, BOTH HALVES EXECUTED

| tree | alias | member | index | pass-through |
|---|---|---|---|---|
| **r8 head, WITH the visible edge** | FIRES | FIRES | FIRES | FIRES |
| **r6-exemption tree, WITH the visible edge** | SILENT | SILENT | SILENT | SILENT |
| either tree, WITHOUT the visible edge | SILENT | SILENT | SILENT | SILENT |

**Neither half is reasoned.** The RED tree is this head's `git archive` + a symlinked
`node_modules`, with `git show origin/raw-egress-r6-work:compiler/src/codegen/protect-egress.ts`
written over that one file. That construction isolates the exemption as the **only** variable: the
only other file the exemption-deletion commit (`e1a25346`) touched is `emit-server.ts`, and that
hunk is comment-only; nothing else on this branch has touched either file since the r6 tip.

Error sets on the GREEN side are exactly `[E-PROTECT-004, E-SCHEMA-001]` — the fixture-wide constant
plus this gate, nothing else.

---

## 2. ⛔ THE GAP THAT MATTERED — THE CLOSED LEAK WAS GUARDED BY NOTHING, AND NOW IS

Before this round, **zero** tests in `g-sql-row-protect-leak.test.js` carried BOTH a visible
return-position call edge AND an alias / member / index / pass-through rebind. Four residuals were
pinned as *silent*; the shape the deletion actually **fixed** had no pin at all. A future round that
"improves" the call graph, or reintroduces an exemption in any form, would have reopened a
password-hash leak against a fully green suite.

**Landed (commit `a1e11066`), 5 new tests, every one executed:**

| test | asserts |
|---|---|
| `REGRESSION GUARD (closed leak): a VISIBLE edge + an ALIASED callee (…) FIRES` | `E-PROTECT-004` fires; message names the path ``getUser` -> `deny`` |
| `…+ a MEMBER callee (`http.deny()`) FIRES` | same |
| `…+ an INDEX callee (`handlers["deny"]()`) FIRES` | same |
| `…+ a PASS-THROUGH chain (`passthru()` -> `deny()`) FIRES` | fires; message names ``getUser` -> `passthru` -> `deny`` |
| `CONTROL — the same file WITHOUT the visible edge is SILENT` | the edge is the whole difference |

**The call path is asserted, not just the code.** ``reached through `getUser` -> `deny``` in the
message is what proves the fire came through the VISIBLE EDGE and not from something the gate
happened to see inside `getUser`'s own frame. A regression that re-silenced the edge while leaving
some other in-frame trigger would still turn these red.

**New anti-vacuity helper `expectFiredAndProtecting`.** `expect(fires(result)).toBe(true)` on its own
passes on a fixture that fired for an unrelated reason. The guard asserts the error set is EXACTLY
`[E-PROTECT-004, E-SCHEMA-001]`, that the protected SELECT was genuinely recognised
(`I-PROTECT-STRIP-001`), and that the file really emitted.

**Which half of each proof was executed:** BOTH, for all four. RED executed on the reconstructed
exemption tree; GREEN executed on this head. Nothing in the table above is inferred.

---

## 3. ⚑ A SECOND ROUND-7 CLAIM, RE-MEASURED AND CORRECTED — "EXECUTED LEAK" IS TRUE OF TWO OF FIVE

While building the RED half I ran the emitted handlers, per the verification bar (body AND headers).
They did not leak. They **threw**. Chasing that produced a correction nobody asked for and everyone
needs:

```
leak                                          executes?   measured
1  same-frame `let r = new Response(...)`      YES         [["x-user",  "$argon2id$SECRET"]] 200 "ok"
2  NESTED function-decl's return               YES         [["x-etag",  "$argon2id$SECRET"]] 204 ""
3  file-level helper across a call edge        NO          throws on r.headers.set
4  file-level pass-through, two frames out     NO          throws on r.headers.set
5  file-level helper, unresolvable callee      NO          throws on r.headers.set
```

**Mechanism.** A file-level `<db>`-block helper lowers to an `async` in-process peer
(`async function deny()`), and asynchrony is **not propagated across a call to a peer**: the emitted
`getUser` contains a bare `let r = make();` / `let r = deny();`. `r` is a Promise, `r.headers.set`
throws, and the handler 500s before anything reaches the wire. `await` is not available as a
workaround — it is refused by design (`E-AWAIT-NOT-IN-SCRML`), confirmed by probe.

**Where the original claim came from.** A probe harness that slices a peer out of the emission
starting at the token `function` drops its `async`, turning it into a synchronous function that
returns a `Response`. I reproduced that artifact on my first attempt and got round 7's exact
reported output — `[["x-user","$argon2id$SECRET"]]`, body `"Forbidden"`, status 403 — before fixing
the harness. That is almost certainly the provenance.

**This does not weaken the pins; it sharpens the argument for them.** Leaks 3/4/5 are **LATENT** —
masked by an unrelated codegen gap, not prevented by anything in §14.8.9, and un-masked the day that
gap is fixed. A leak guarded by a bug is the worst state to be in, because fixing the bug is what
detonates it. The compile-time gate is the only thing actually holding, which is the whole case for
pinning it.

⚑ **Corpus-zero caution, stated because the reverse ouroboros is easy here:** the fact that these
three do not execute *today* is not evidence the shapes are unreachable or that the gate over-fires.
It is one implementation accident, in one lowering path.

---

## 4. THE RECORD, CORRECTED AT EVERY LOCUS (commit `9e32ac72`)

Both corrections were swept bidirectionally — for loci that state the round-7 conclusion, and for
loci that state "executed" as true of all five.

| locus | was | now |
|---|---|---|
| `g-sql-row-protect-leak.test.js`, the M2 block comment | *"every spelling is SILENT on all three"*, *"a plain CARRY-FORWARD"* | a header naming BOTH classes — (A) edge-bearing, exemption was the sole cause, deletion closed it; (B) no-edge, `reach()` has no edge, call-graph bound — plus how round 7 conflated them |
| same file, class-(B) test titles | `RESIDUAL (documented): the EGRESS behind an invisible edge` | `RESIDUAL (documented, NO-EDGE class B): … and NO bare-name edge` |
| same file, the CO-OCCURRENCE rationale's five-leak list, item 5 | *"deleting the exemption does not close them and was never going to"* | the two-class split with the two-tree measurement |
| same file, the LEAK PINS block comment | *"Each was compiled AND EXECUTED… and each answered with the secret"* | the same-frame/file-level split, with the measured values for the two that do execute |
| `protect-egress.ts` residual (2) | the bound, stated correctly but with no mirror | + an explicit note that the MIRROR splits in two, and which pin guards which half |
| `protect-egress.ts` residual (4) | *"every one of them SHIPPED AN EXECUTED LEAK"* | *"SHIPPED A LEAK"* + the two-of-five execution table and its mechanism |
| `protect-egress.ts` `detectProtectedRawEgressAcrossFns` prose | *"each shipped an executed leak … through an edge the classifier cannot classify at all"* | *"each shipped a leak"* + the two-class split + "a change that re-silences the FIRST class has re-introduced the exemption" |
| `docs/known-gaps.md`, the S354-r7 ruling paragraph | the v3 bullet, and *"every one of them shipped an executed leak"* | two ⛑ corrections appended in place, marked as corrections |
| **SPEC §14.8.9**, *"why no exemption"* | *"admitted a shipped, executed leak one level deeper than the last"* | *"admitted a leak one level deeper than the last"*, + which execute, + that the latent ones are silenced by an implementation accident **the specification does not guarantee** — which is why the SHALL is written over the compile-time gate rather than over observed behaviour |

Swept and found clean: conformance case descriptions and `expected.json` rationales carry no claim
about the four spellings; `emit-server.ts`'s §14.8.9 note states the bound without the conclusion.

⚑ **Round 7's reasoning is instructive and is recorded as a correction, not silently edited.** A
weakened reproducer produced a confident, wrong conclusion about a **security gate**, and the
conclusion then propagated into four separate documents in one commit. The reproducer was weakened by
omission — nobody removed a line on purpose; the fixture was written from the shape's *description*
rather than from the shape that leaked. The defence is the CONTROL test: pin the difference, not just
the behaviour.

---

## 5. THE HANDED-BACK DECISION — RE-SCOPED, NOT BUILT

Round 7 measured a 10-line reference-edge patch in `collectRawEgressFacts`:

```ts
if (n.kind === "ident" && typeof n.name === "string") {
  calls.add(n.name);
}
```

**The framing stands and the patch is NOT built this round. Its motivation is corrected:**

- **It is NOT unfinished business from the leak.** The leak — the edge-bearing class — is **CLOSED**,
  by the exemption deletion, and is now pinned by four regression guards. Round 7 handed this back as
  though it were the fix for a live hole. It is not.
- **What it actually addresses is the weaker class (B):** the no-edge spellings, where `reach()` has
  no edge at all. Those are silent on `origin/main`, on the r6 head and here; they have been silent
  since before this arc existed; and they are a **precision** question, not a regression.
- **The blocking reason is unchanged and is still the operator's call.** §14.8.9 now defines
  `reach(F)` normatively as *"`F` plus every function `F` transitively **calls** within the file"*. A
  reference edge redefines that as *mentions*. That is a normative SPEC amendment, and Rule 4 makes it
  the operator's, not a codegen agent's.
- **Its measured cost is unchanged:** all four class-(B) spellings close; corpus blast radius zero.
  ⚑ Corpus-zero is blast-radius evidence ONLY. An adopter file that merely *names* a helper would
  newly be treated as reaching it.

**The question the operator is actually being asked, restated on the correct basis:** *is `reach(F)`
worth widening from `calls` to `calls-or-names` in order to close a precision gap in a gate whose
security hole is already closed?* Not: *is this the fix for the fifth leak?* It isn't.

---

## 6. THE REGRESSION FLOOR — RE-MEASURED AGAINST CURRENT MAIN

Method unchanged from round 7 so the numbers are comparable: a diagnostic-code census over the full
default corpus root set (`examples`, `samples`, `conformance`, `stdlib`, `benchmarks`, recursive),
each tree compiling ITS OWN checkout, then intersected by relative path. Both trees extracted with
`git archive` + a real `node_modules` symlink; `stdlib/` verified present (21 modules) on both.

```
base (origin/main a0e30329) sources : 1906
head (raw-egress-r8-work)   sources : 1913
SHARED                              : 1905      head-only 8, base-only 1
SHARED SOURCES WITH A DIAGNOSTIC-CODE DELTA : 0
  ...of the 18 shared sources emitting any PROTECT code : 0
```

**Zero — round 7's floor is not regressed.** The 8 head-only sources are this arc's own conformance
cases under `conformance/cases/protect/`; the 1 base-only is the retired
`protect/reveal-suppresses-e004` case (deleted by the dpa-033 (c) ruling, earlier in this arc).

**Non-vacuity.** `I-PROTECT-STRIP-001` fires in **19** base sources and **26** head sources, so the
protect floor is genuinely engaged on both sides and the zero is not zero-because-nothing-ran.
`E-PROTECT-004` fires in **1** base source and **8** head sources — and all 7 of the difference are
head-only files (this arc's own conformance cases). **Zero pre-existing corpus sources gained or lost
a fire.**

### Other gates

- `bun conformance/run.ts` → **890/890 cases pass**.
- `bun test compiler/tests/integration/g-sql-row-protect-leak.test.js` → **147 pass / 0 fail**
  (142 before this round; +5).
- The other four suites that touch the protect machinery — `trucking-dispatch-smoke-integration`,
  `authed-server-fn-response-http`, `unit/tenant-egress`, `unit/channel-watches-phase2-runtime` —
  **97 pass / 0 fail**.
- `bun scripts/s34-census.ts --check-new --base origin/main` → **2 new/changed rows, all well-formed
  — PASS.** No §34 row was touched this round; the 2 are the arc's existing `E-PROTECT-004`
  restatement from round 7.
- Full pre-commit gate ran on both content commits (no `--no-verify`, no `core.hooksPath` override).

---

## 7. RESIDUAL HANDED BACK — ROUND 8

1. ⭐ **The `reach(F)` = calls-or-names amendment (§5 above).** Unchanged as a decision; **re-scoped**
   as a precision question about class (B), not as the fix for a live leak. NOT built.
2. ⚑ **NEW, and NOT a §14.8.9 question — a call to an in-process server peer, bound to a variable, is
   not auto-awaited.** `let r = deny()` and `let u = loadUser(id)` emit bare inside the exported
   server fn, while the same call inside a peer body emits `return await deny();`. The bound value is
   a Promise, and every member access on it is silently wrong (or throws). Consequences beyond this
   arc: it is a §13.2 position-invariant-auto-await violation, and it is what currently masks leaks
   3/4/5. **Deliberately NOT filed as a new gap id and NOT fixed:** it may be a residual of
   `g-indirect-callee-never-server-placed-server-referenceerror`'s await-lowering half — that entry
   claims alias and dispatch-table callees are resolved *for placement, in-process peer emission, AND
   await-lowering* — rather than a new class. It needs root-cause triage before it gets an id.
   Reproducer: any `<db>`-block file-level helper called from an exported server fn with the result
   bound.
3. ⚑ **CARRIED, and now the reason for a process rule:** round 7's residual 2 (a server fn referenced
   as a VALUE emits no in-process peer) is the sibling of (2) above. Both are auto-await/peer-emission
   defects surfaced by protect fixtures, and both were found only because a probe EXECUTED the
   emission instead of reading it.
4. **CARRIED:** the `post-commit` hook runs the full suite per commit, so `git rebase` is unusable on
   this branch. Merging worked cleanly this round (`Already up to date`).
5. **CARRIED:** the `!{}` arm body has no tree form, so every body-walking analysis is blind inside
   it. §14.8.9 is fail-closed across that blindness; the tenant twin, the auth graph, the reachability
   solver and the DG are not.
6. **CARRIED:** `1n`, `|>` and `-2 ** 2` escape-hatch and emit syntactically INVALID server JS with
   zero errors, past `validateEmit: true`. A miscompile.
7. **CARRIED:** the value-scoped `reveal` EXIT at a raw egress is still absent — §14.8.9 remains a
   floor with no exit (dpa-033 (d), a separate arc).
8. **CARRIED and now sharper:** `compiler/src/codegen/tenant-egress.ts` is untouched per brief. It
   needs the escape-hatch treatment and the call-graph reachability, and it must NOT be given an
   all-literal exemption — doing so reproduces all five leaks in the tenant lane, including the
   edge-bearing class this round pinned.

---

## 8. PROCESS NOTE — WHAT WOULD HAVE CAUGHT ROUND 7

Two cheap rules, both of which this round applied and both of which would have prevented the wrong
conclusion:

1. **A silence claim needs a CONTROL that differs by one line.** "This shape is silent" is only
   informative next to "…and this shape, differing by exactly the mechanism under test, is not." The
   `CONTROL` test added this round is that pair. Round 7 pinned four silences with no positive twin,
   so a mis-built fixture read as a finding.
2. **A runtime claim needs the emission executed AS EMITTED.** Every over-claim corrected this round
   — round 7's, and my own first harness — came from evaluating a *transformation* of the emitted
   code rather than the emitted code. Slice by brace-matching from a token that includes every
   modifier, or do not slice at all.
