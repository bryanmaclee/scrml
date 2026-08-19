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
