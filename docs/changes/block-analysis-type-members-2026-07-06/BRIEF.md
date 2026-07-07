# DISPATCH BRIEF — `--emit-block-analysis`: field-level `members[]` + tight `bodySpan`  [change-id: block-analysis-type-members-2026-07-06]

You are extending the `--emit-block-analysis` sidecar (`compiler/src/block-analysis.ts`) with two ADDITIVE outputs for `type` blocks, requested (co-signed) by giti (§4.3 AST semantic merge) + flogence (same-file region-leasing). This is compiler-source. Ship the emit change + tests, all GREEN, byte-deterministic.

## ⚠️ SCOPE CORRECTION (read this — the ask's premise is partly wrong)
The consumers asked for per-`type` `members[]` on the belief that "you already hold this structure in-AST." **You do NOT.** I checked: `TypeDeclNode` (`compiler/src/types/ast.ts:1298`) is minimal — `{ name, typeKind: "struct"|"enum"|"", raw: string, span }`. The struct-fields / enum-variants are NOT structured on the type-decl node; only the **raw body text** (`raw`) is. The compiler resolves members separately (`parseStructBody` `type-system.ts:1530`, `parseEnumBody` `:1694`, `resolveTypeExpr` `:2475`) into SEMANTIC `ResolvedType`s — a resolution that **discards the source spans + the verbatim surface `typeText`** the consumers need. So this build is a **span-aware member parse of the raw type body**, not a field-plumb. That IS the right place for it (one span-aware parser in the compiler vs N hand-rolled re-parsers in consumers) — but scope it honestly.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; follow the §"Task-Shape Routing" for a compiler-source change (this touches the block-analysis sidecar + reads the type-body grammar). Map currency: HEAD `66a3afb1` as of `2026-07-04`; HEAD has moved — verify any map claim against current source. Report the Maps-consulted / load-bearing line.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S99: this class has leaked; do not be next)
Before ANY other tool call:
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If under any other repo, STOP + report (S90). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. `git status --short` clean.
4. `bun install` (worktrees don't inherit node_modules; pre-commit fails on "cannot find package 'acorn'" otherwise).
5. First commit message includes the verbatim `pwd` (e.g. `WIP(block-analysis): start at $(pwd)`).
- **Apply ALL edits via Bash** (perl/python3/heredoc) on worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment — NOT the Edit/Write tools (the S126 Edit/Bash divergence leaked to MAIN twice). Echo the path before each write; re-verify with `git diff` after.
- **NEVER `cd` into the main repo.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.

# REQUIRED READS (before writing)
1. `compiler/src/block-analysis.ts` IN FULL — the emitter you extend. Note: `projectBlock` (kind-switch), `collectBlocks` (types come from `fileAST.typeDecls`), `projectSpan` (the byte/line span logic), the DETERMINISM contract (source order, fixed key order, `JSON.stringify(_,null,2)+"\n"`, two compiles byte-identical), the artifact contract interfaces (`BlockAnalysisBlock` etc.).
2. `compiler/src/types/ast.ts:1298` — `TypeDeclNode` (`name`/`typeKind`/`raw`/`span`).
3. `compiler/src/type-system.ts` — `parseStructBody` (1530), `parseEnumBody` (1694), `resolveTypeExpr` (2475). **These are the CANONICAL type-body grammar.** Understand exactly how they tokenize a struct body (`name: type` fields) and an enum body (`Variant` / `Variant(arg: type, ...)` variants, incl. positional `_0`/`_1` per the parseEnumBody payload handling).
4. The block-analysis test suite (find it: `grep -rl block-analysis compiler/tests/`) — you extend it.

# THE TASK — two additive outputs on `type` blocks ONLY (fn/component/engine/channel blocks UNCHANGED)

## 1. [PRIMARY] `typeShape` + `members[]` per `type` block
For each `type` block, ADD:
- `typeShape`: `"struct" | "enum" | "refinement"` (derive from `typeKind` + the body shape; a `type X = number(>0)` style is `"refinement"`).
- `members`: an array, each `{ name, memberKind, typeText, span }`:
  - **struct field** → `memberKind: "field"`, `name` = field name, `typeText` = the verbatim source slice of the field's type, `span` = the FULL member span (name→type, absolute file offsets).
  - **enum variant** → `memberKind: "variant"`, `name` = variant name, `typeText` = the verbatim payload signature (or empty for a unit variant), `span` = the full variant span (absolute). Plus `args`: an array of `{ name, typeText, span }` for the variant's constructor arg-tuple (empty for unit variants; positional args get their positional name per `parseEnumBody`).
- `refinement` types: emit `typeShape:"refinement"` + a `members: []` (or a single predicate member if cheap) — do NOT force struct/enum shape onto them.

### The 3 consumer sharpenings (PIN THE SCHEMA — these are correctness, not nicety):
1. **Member spans are ABSOLUTE file char-offsets** — the SAME basis as the existing block `span.start`/`.end` (byte offsets into raw source). A consumer does `source.slice(member.span.start, member.span.end)` directly. State this basis in the emit doc-comment.
2. **Per-member `span` covers the FULL member** (name + type / arg-tuple), not just the `typeText` slice — the load-bearing consumer op is *splice-one-member* (copy one field/variant's source text verbatim into a merged type). Make it a pure slice+splice.
3. **`typeText` is load-bearing for correctness** — it lifts merge-collision detection from name-only to name+type ("both sides added the identical member" = auto-resolvable vs "same name, different type" = real conflict). Get the verbatim surface text right.

### THE DESIGN FORK (resolve it on merits; document your choice)
The member parse MUST NOT drift from the compiler's canonical type-body grammar (the corpus-ouroboros risk). Two approaches:
- **(A) Extend the canonical parsers** (`parseStructBody`/`parseEnumBody` in type-system.ts) to optionally also emit `{name, typeText, span}` alongside the resolved types, and have block-analysis consume that. Single source of truth; but touches load-bearing, heavily-tested type-system.ts.
- **(B) A span-aware member parser local to block-analysis** that parses `raw` (offsets = `typeDecl.span.start` + offset-in-`raw`). Keeps type-system.ts untouched; BUT you MUST validate its member NAMES/KINDS against the canonical parser's output on the corpus (a drift-guard test) so it can never disagree with the compiler's own view.
**Lean: (B) with the drift-guard test** (keeps the load-bearing type-system.ts untouched; the drift-guard closes the only risk). But if (A) is cleaner in practice, take it — justify in your report. Either way: ONE grammar of record, no silent divergence.

## 2. [SECONDARY, low-cost] tight `bodySpan`
The current block `span.end` runs PAST the entity's closing token into trailing trivia (both consumers carry an `indexOf`/`lastIndexOf` workaround; a splice over `[start,end)` welds `}appState>`). ADD a `bodySpan: { start, end }` per block (at least for `type` blocks; ideally all block kinds) bounded at the member-list CLOSE (the `}` / body-close), absolute offsets. This removes the consumers' re-derivation. Keep the existing `span` UNCHANGED (back-compat) — `bodySpan` is additive.

# CONSTRAINTS
- **ADDITIVE + back-compat:** existing fields (`id/kind/name/span/reads/writes/footprintDepth`) UNCHANGED on ALL block kinds; you only ADD `typeShape`/`members` (type blocks) + `bodySpan`. Existing consumers keep working.
- **DETERMINISM is the contract:** two compiles of the same source → byte-identical output. Members in SOURCE ORDER; fixed literal-key construction; the existing `JSON.stringify(_,null,2)+"\n"` shape. Add a determinism test if the suite doesn't already cover the new fields.
- Postgres/other: N/A. No SPEC change (this is a sidecar-artifact schema extension, not a language surface) — but ADD a schema note to the block-analysis.ts module doc-comment (the "What we project" block) documenting `typeShape`/`members`/`bodySpan` + the absolute-offset basis.

# TEST PLAN
- Extend the block-analysis test suite: a struct type → correct `members[]` (field names, `typeText`, full-member absolute spans that `source.slice` back to the exact field source); an enum type incl. a **payload-union** variant (`Pointer:enum = { Sha(hash:string), FileLine(path:string, lineNo:int), None }` — flogence's canonical case) → correct variant members + per-variant `args[]` with spans; a unit variant → empty `args`; a refinement type → `typeShape:"refinement"`; `bodySpan` bounds the body (no trailing trivia); determinism (two builds byte-identical); the additive-back-compat check (fn/component/engine/channel blocks unchanged).
- If you take fork (B): a **drift-guard test** — for a corpus of struct/enum types, your member names/kinds MUST equal the canonical `parseStructBody`/`parseEnumBody` output.

# COMMIT DISCIPLINE (S83) + VERIFY
- Commit incrementally (parser → emit wire-in → tests). After every edit: `git -C "$WORKTREE_ROOT" diff` → add → commit. `git status --short` clean before DONE.
- Run the FULL `bun --cwd "$WORKTREE_ROOT" run test` before DONE (0 failures the contract; note the ~7 env-floor browser-whitespace fails if they appear — not yours).

# REPORT FORMAT (final message = raw data for the PA)
`WORKTREE_PATH`, `FINAL_SHA`, `FILES_TOUCHED`, full-suite counts, WHICH fork (A/B) you took + why, a sample emitted `members[]` for the `Pointer:enum` case (so the PA can eyeball the schema), the determinism-test result, any deferrals, the Maps line. You CANNOT run `/code-review` in-agent — self-review thoroughly + name uncertain spots; the PA runs the adversarial `/code-review` on your diff before landing (S239).

# WHAT NOT TO DO
- Do NOT change existing block fields or perturb fn/component/engine/channel projections.
- Do NOT hand-roll a type-body parser that can silently drift from the canonical grammar (fork B REQUIRES the drift-guard).
- Do NOT `--no-verify`. Do NOT write outside `$WORKTREE_ROOT`. Do NOT `cd` into main.
