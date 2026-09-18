# s422-maps-refresh — progress

Append-only. Timestamps UTC.

## 2026-09-18 — orientation complete
- Worktree verified: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a83548a63b17c0d54`,
  clean; `git rev-parse --show-toplevel` agrees with `pwd`.
- Base == `origin/main` == `787d4cb4`. `bun install` exit 0.
- Old maps watermark: `e74f5423` (S405). `bun scripts/state.ts --check` BEFORE write printed:
  `maps: 112 commits behind HEAD (watermark e74f5423, HEAD 787d4cb4)  [WARN-only]`.
- Delta `e74f5423..HEAD`: **112 commits**; 53 source-relevant files; **+7543/-428**.
  `compiler/src`: **12 files, +1195/-79**. SPEC.md **+46**, SPEC-INDEX.md net **-47**.
- **NOT a no-op.** Refresh is owed and is substantive.

## 2026-09-18 — figures re-executed at `787d4cb4` (each by running the command)
- `compiler/src` **253,519 lines / 195 files** (FACTS agrees exactly; raw `find|cat|wc -l` agrees).
  vs S405 252,403/195 → **+1,116 lines, files FLAT for the 4th consecutive window**.
- `test files` **1,459** — FACTS, `find compiler/tests -name '*.test.js'`, and
  `git ls-files 'compiler/tests/**.test.js'` all return 1,459 (EXACT three-way reconcile). +19.
- `specification lines` **37,993** (+46). `conformance cases` **905** (FLAT); category dirs **54** (FLAT).
- `docs/changes/` **745** dirs (+11).
- Definition boundaries re-measured, both still exactly as recorded: `find compiler/src -type f`
  returns **197** vs FACTS **195** (gap 2); repo-wide `git ls-files '*.test.js'` returns **1,460**
  vs FACTS **1,459** (gap 1 = `conformance/conformance-corpus.test.js`, invariant 88).
- §34 census: **819 rows** (`19750..20640`), was 818/`..20639`. Buckets STRUCK 34 · PINNED 346 ·
  IMPL-SITES **307** (+1) · DECLARED-AHEAD 18 · RUNTIME-SURFACED 3 · FALSE-CLAIM 111.
  Dispositions BUILD-ARC 69 · HOME-NO-SHALL 26 · ORPHAN-INDEX 4 · NOMINAL-HOME 12 — all FLAT.
- Prefix series measured at **BOTH ends** and set-diffed: `^| E-` 921→**922**, `^| W-` 182 FLAT,
  `^| I-` 10 FLAT, `^| H-` 2 FLAT. UNIQUE 786→**787**.
  ADDED = {`E-CONDITION-HEAD-UNPARENTHESIZED`}; REMOVED = **EMPTY**.
- Census filesystem walk reads **1996 source files** here vs 2013 at S405 — it went DOWN because a
  fresh worktree carries no untracked scratch. Confirms the standing note: that figure is a
  FILESYSTEM walk, **not a repo fact**. Do not publish it as one.

## 2026-09-18 — symbol delta located BY SYMBOL (never by remembered line)
New top-level symbols in `compiler/src`, each grep-located at this HEAD:
- `REGEX_AFTER_CLOSE_PAREN_KEYWORDS` — `codegen/code-segments.ts:46` (consumed `tokenizer.ts:62,1586`)
- `closesControlFlowHead` — `tokenizer.ts:1573`
- `CONDITION_HEAD_CONTINUATION_PUNCT` — `ast-builder.js:10640`; `continuesConditionHead` — `ast-builder.js:10662`
- `blockScopedDeclaredNames` — exported from `codegen/emit-logic.ts`, consumed `emit-control-flow.ts:511,527`
- `unloweredMapSurfaceReads` — `codegen/emit-library.ts:262`; `blankStringLiteralContent` — `:329`;
  `containsIndexExpr` — `:148`; `MAP_RUNTIME_PROVIDED_NAMES` — `:89`; `MAP_RUNTIME_REFERENCED` — `:100`;
  `MAP_SET_SURFACE_METHODS` — `:117`
- `_lexicalBindingsAtInnerFunction` — `type-system.ts:18885`; `sameLevelDecls` — `type-system.ts:18889`
- `toDistRelPath` — `codegen/index.ts:328`; `distRelRef` — `codegen/index.ts:340`

## 2026-09-18 — the flagged prior-report claim, RE-DERIVED
- Brief's warning confirmed and it has drifted AGAIN. `grep -n 'const postRe' compiler/src/type-system.ts`
  → **THREE** sites at this HEAD: **`:27384`, `:28322`, `:28447`** (`postRe.test(...)` at
  `:27385`, `:28323`, `:28448`).
- The prior report's own *correction* published `:27224 / :28162 / :28287` — those have themselves
  gone stale. Re-derived, not carried.
- `sed -n '26048p'` at this HEAD → ` * @param structInstances      — map of bindingName → structTypeName (callers`
  — a **doc-comment line**. The brief said that line is `structInstances: Map<string, string>;`;
  that too has drifted — the real declarations are at `:26571, :26741, :26887, :26916`.
  Three different readings of `:26048` across three watermarks: the number carries no information.
- Finding **N8 is STILL LIVE**: `scripts/source-text-regex-census.ts` still bakes
  `type-system.ts:26048` at **`:38`** (doc comment) and **`:170`** (a runtime `console.log`).
  The file is `--name-only` EMPTY over `e74f5423..HEAD` — unchanged, and now wrong for the 3rd
  consecutive watermark.

## 2026-09-18 — N-S405-1 re-executed: STILL LIVE, 4 sessions on
- `E-CG-ENUM-BINDING-COLLISION` — `compiler/SPEC.md` mentions **0**; emitter live at
  `compiler/src/codegen/emit-library.ts:1517-1518`. Pinned by
  `compiler/tests/integration/export-enum-library-emit.test.js`.
- `E-CG-SQL-FN-UNVERIFIABLE-SPAN` — `compiler/SPEC.md` mentions **0**; emitter live at
  `compiler/src/codegen/emit-library.ts:713-714`; referenced in-file at `:1255`.
  **No test and no conformance case references it at all.**
- The four codes whose *emit sites* grew this window (`E-EQ-002`, `E-FN-003`, `E-MU-001`,
  `E-SCOPE-001`) all DO carry SPEC rows — checked, not assumed. Not a finding.

## 2026-09-18 — 12 maps spliced and committed (6f3f4a54)
- All 12 `*.map.md` advanced to `commit: 787d4cb4` on line 3 (the anchor `state.ts` parses).
- Verified BEFORE commit, as the brief demanded: `bun scripts/state.ts --check` went from
  `maps: 112 commits behind` to `maps: 1 commits behind (watermark 787d4cb4, HEAD 894da9c6)`.
  The `1` is this pass's own anchor commit — correct terminal state for a merge-base stamp.
- Commit verified NON-EMPTY: `12 files changed, 1055 insertions(+), 12 deletions(-)`.
- ⚠ `.claude/` is gitignored (`.gitignore:3`); the 13 maps are force-added. Staged with explicit
  pathspecs + `-f` so the 4 untracked `*.generated.md` were NOT swept in. Verified via
  `git diff --cached --name-only` before committing.

## 2026-09-18 — CORRECTION: a false finding caught before it was filed
- I began writing that the S405 note's `bun scripts/mapgen.ts` referenced a script that does not
  exist (`git log --all -- scripts/mapgen.ts` → empty; no `*.generated.md` tracked anywhere).
- **Searched wider before filing, and the premise was wrong**: `mapgen.ts` lives in a SIBLING repo
  (`/home/bryan-maclee/scrmlMaster/flogence/scripts/mapgen.ts`) and the four generated maps exist in
  the MAIN checkout, gitignored. They are absent from my worktree because a worktree checks out
  tracked files only.
- Filed instead as an accurate structural note: the nav-map refresh is split across two repos and one
  gitignored surface, so a worktree-isolated agent can only ever complete the tracked half.

## 2026-09-18 — non-compliance report re-executed and committed
- Every standing item RE-EXECUTED, none carried. Verdicts: N8 STILL LIVE (3rd watermark);
  N17 STILL LIVE (line drifted into §41.14.5); U5 STILL LIVE verbatim; N-S405-1 STILL LIVE after
  4 sessions. Location heuristic: all 5 dirs ENOENT. Name heuristic: 0 hits / 1,590 in-scope docs.
- **Two published CORRECTIONS found stale** — the `postRe` fix and invariant 78's §20.5 fix.
  Recorded as invariant 79.
- Retrospective class finding: the OLD watermark `e74f5423` was itself a commit with three raw
  conflict markers in `compiler/SPEC-INDEX.md` (57 rows each side, sides NOT identical). No map
  noticed. Closed in CI at S409; the map-side lesson recorded as invariant 80.

## 2026-09-18 — explicitly NOT done (named, not left to be rediscovered)
- The 4 `@generated` maps remain S405-era — structurally impossible from a worktree (see above).
- `bun scripts/state.ts --write` for the stale `@generated:recent-sessions` block in `master-list.md`
  — outside this pass's write scope (`.claude/maps/` + this progress file only).
- No source file was edited, so N-S422-2 (`source-text-regex-census.ts`) and N-S422-3
  (`PA-SCRML-REFERENCE.md`) remain open; both are reported with a concrete disposition.
