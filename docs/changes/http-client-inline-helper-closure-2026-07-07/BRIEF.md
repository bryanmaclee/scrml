# BRIEF — Fix g-http-client-inline-private-helper-drop (MED, S245 second thread)

CHANGE-ID: `http-client-inline-helper-closure-2026-07-07`
BASELINE: `5b5ca405` (current main). Compile + test against it.
DISPATCHED-BY: scrml PA (S245). AGENT: scrml-js-codegen-engineer · isolation:worktree · background.

## The bug (CONFIRMED — empirical + structural)
The client-runtime chunk inliner `_inlineSiblingShimImports` (`compiler/src/runtime-template.js:116-173`) copies
only a shim's imported EXPORTED symbols into the inlined client chunk — it does NOT copy the **same-file private
helpers** those exports call. `compiler/runtime/stdlib/http.js`'s `get`/`post`/`put`/`del`/`patch`/`uploadFile` all
call a private `_request` (unexported, line 34). The inliner extracts `get`'s definition (`_extractTopLevelDefinition`,
:152) and recurses ONLY into the sibling's cross-file `import` statements (:146) — it never scans `get`'s BODY for
same-file private helpers. Result: `get` inlines, calls `_request`, but `_request` is never defined →
`ReferenceError: _request is not defined` for ANY client-inlined `scrml:http` call. General (not auth-specific);
server bundling is unaffected (`bundleStdlibForRun` copies http.js whole).

**Reproduced at HEAD** via the exported inliner (this is your regression-test seed):
```
import { _inlineSiblingShimImports } from "compiler/src/runtime-template.js";
src = `import { get } from "./http.js";\nexport function useGet(u){ return get(u); }`
→ get inlined:true · _request defined:FALSE · get calls _request:true  ← BUG
```

## The fix — transitive same-file private-helper closure
In `_inlineSiblingShimImports`, after extracting an imported symbol's definition (`_extractTopLevelDefinition(...)`
at :152), ALSO inline the transitive closure of **same-file top-level private helpers** that definition references:
1. Compute the sibling file's top-level defined names (`_collectTopLevelDefinedNames(siblingSource)` already exists).
2. Scan the extracted definition body for identifiers that (a) are in that same-file defined-names set, (b) are NOT
   the symbol being imported, (c) are NOT already in `emitted`, (d) are NOT in the importing shim's `ownNames`
   (collision guard — the importing def wins, per the existing :143 rule).
3. For each such private helper, extract its definition (via `_extractTopLevelDefinition(siblingSource, helper,
   helper)` — **under its ORIGINAL name**, because `get`'s body references it by original name) and prepend it to
   the prelude BEFORE the importing def (dependency order); add to `emitted`; then recurse into THAT helper's body
   (a private helper may call further privates — e.g. transitively). Dedup via `emitted` throughout.
- **Renaming nuance:** the imported symbol `get` is renamed to `local` (`as`-alias support), but references inside
  its body to same-file privates use the ORIGINAL names, so privates inline under their original names (NOT renamed).
- **Over-approximation is SAFE, under-approximation is the bug:** a simple word-boundary identifier scan is fine even
  if it harmlessly pulls a helper only mentioned in a string/comment. Do NOT try to be clever with string/regex/
  comment-aware scanning here (that's a different, riskier problem); a conservative superset is correct and safe.
- Prefer this closure approach over "bundle the whole shim client-side" (that inlines unused exports → bloat).

## ACCEPTANCE
- The repro (`import { get } from "./http.js"` inlined) now emits `_request` (defined + before `get`).
- ALL of http.js's private-referencing exports client-inline correctly: `get`/`post`/`put`/`del`/`patch`/
  `uploadFile` → `_request` present. Spot-check `retry`/`withDefaults`/`multipart`/`uploadFile` for any further
  private helpers and confirm their closures resolve (no leftover undefined helper).
- A real client-inlined `scrml:http` compile emits a client chunk that `node --check` parses AND contains no
  reference to an undefined top-level helper (grep the emitted chunk).
- **Regression test** via the exported `_inlineSiblingShimImports` (mirror the S177 inliner test — synthetic shims in
  a temp dir + the real http.js): assert the private-helper closure is inlined + deduped + transitively-followed +
  original-named + collision-guarded (importing shim's own `_request` still wins). Cover a 2-level transitive case
  (export → private A → private B).
- Full suite `bun run test` → 0 fail (document any pre-existing browser/env-floor fails; do NOT fix unrelated).

## SCOPE FENCE (shared checkout — a sibling session owns other files)
- Touch ONLY `compiler/src/runtime-template.js` + its test file. Do NOT touch: `expression-parser.ts`,
  `route-inference.ts`, `literal-scan.ts`, `codegen/emit-client.ts`, `codegen/emit-each.ts`, `protect-analyzer.ts`,
  `codegen/emit-channel.ts`, `codegen/emit-server.ts`, `match-statechild-parser.ts` (other sessions/threads own these).
- Do NOT edit `docs/known-gaps.md` (the PA marks the gap resolved at landing).

## STARTUP + PATH DISCIPLINE (worktree)
`pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). `git
rev-parse --show-toplevel`==WORKTREE_ROOT; `git status --short` clean; `bun install`; `bun run pretest`. Apply ALL
edits via Bash on worktree-absolute paths (NOT Edit/Write). Never `cd` into main; use `git -C "$WORKTREE_ROOT"`.
First commit message includes your verbatim `pwd`. Commit incrementally; keep progress.md.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (Task-Shape Routing for a compiler-source codegen fix). Currency HEAD
`66a3afb1`/2026-07-04 — verify against current source. Report the Maps-consulted line.

## REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` (must be ONLY runtime-template.js + its test) · the R26 evidence
(the repro now emits `_request`) · any further private helpers you found beyond `_request` · the transitive/dedup/
collision test evidence · the Maps line.
