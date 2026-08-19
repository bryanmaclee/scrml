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
