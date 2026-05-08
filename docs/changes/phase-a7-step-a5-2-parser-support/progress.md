# A5-2 progress log

Append-only timestamped log per pa.md global rule (Crash Recovery: Incremental
Commits + Progress Reports). Each entry: what was just done, what's next, any
blockers.

---

## 2026-05-08 — Phase 0 SURVEY started

- **Done:** Startup verification — pwd / git rev-parse / git status clean / bun install (114 packages) / bun run pretest (samples/compilation-tests/dist populated).
- **Done:** Fast-forwarded worktree branch `worktree-agent-ac20dd0bc553333e5` from `f59bbcc` to `cb73f41` to pick up BRIEF.md (BRIEF was on main but not on worktree HEAD when worktree was created).
- **Done:** Read full BRIEF.md (472 lines).
- **Done:** Read SPEC.md §51.0.M-Q (lines 20503-20988) — full sub-section text for all five S67 features.
- **Done:** Read symbol-table.ts:200-310 (EngineMetadata + EngineStateChildEntry shapes), 3680-3720 (PASS 10.A registration), 4209-4437 (PASS 11 B15 walker).
- **Done:** Read engine-statechild-parser.ts (full file — primary touch-point).
- **Done:** Read expression-parser.ts:680-910 (preprocessForAcorn + esTreeToExprNode bare-variant unmask).
- **Done:** Read ast-builder.js:119-142 (shouldSkipExprParse leading-dot relaxation), 8550-8730 (engine-decl construction).
- **Done:** Read primer §13.7 B14/B15/B17/B20 specifics (lines 664-768).
- **Done:** Verified tokenizer.ts has no closed prefix registry — `internal:` recognition is local to engine-statechild-parser.
- **Done:** Verified ast.ts does not declare an EngineDeclNode interface — engine-decl is plain JS object construction in ast-builder.js.
- **Done:** Verified lint-ghost-patterns.js W-LINT-004 catches `on[A-Z]=` HTML attributes, NOT `<onTimeout>` tag forms — zero churn.
- **Done:** Wrote SURVEY.md with locus confirmations, body-walk feasibility verdict, `.Variant.history` zero-source-change bet, tokenizer-not-touched verdict, EngineRuleForm Option A recommendation, 10-sub-step cost decomposition, scope-corrections (none), risk register.

**SURVEY VERDICT:** proceed as briefed. ~7-10h, ~150-200 LOC + 35-50 unit tests, single dispatch. No scope amendments. No tokenizer/ast.ts/BS churn.

**STOPPED at Phase 0 per BRIEF §5.** Awaiting PA acknowledgment + implementation authorization.

**Next (when authorized):** sub-step 1 — type extensions to symbol-table.ts (`OnTimeoutEntry`, `NestedEngineEntry`, `EngineStateChildEntry` +4 fields, `EngineRuleForm` +Option A flags). Compile-clean checkpoint.

---

## 2026-05-08 — Phase 1 implementation dispatched

- **Done:** Worktree refresh + verification. PWD = `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a771e96db480b3eb4`. Branch `worktree-agent-a771e96db480b3eb4`. Fast-forwarded from `f59bbcc` → `efe57ba` (PA's landed-survey baseline).
- **Done:** `bun install` (114 packages), `bun run pretest` (samples populated).
- **Done:** Baseline test confirmation — 9565 pass / 60 skip / 1 todo / 0 fail / 9626 total at HEAD `efe57ba`. Matches BRIEF §6.3.

### Sub-step 1 — Type extensions (no logic)

- **Done:** Extended `EngineRuleForm` (Option A) — added `historyForm?: boolean` to `single` and `historyForms?: boolean[]` to `multi`. Transparent to existing consumers.
- **Done:** Added new exports `OnTimeoutEntry { after: string; to: string; rawOffset: number }` and `NestedEngineEntry { rawText: string; rawOffset: number }` to `symbol-table.ts`.
- **Done:** Extended `EngineStateChildEntry` with 4 new fields: `historyAttr: boolean`, `internalRule: EngineRuleForm`, `onTimeoutElements: OnTimeoutEntry[]`, `innerEngines: NestedEngineEntry[]`.
- **Done:** Verified `bun build compiler/src/symbol-table.ts` succeeds (compile-clean).
- **Note:** PASS 10.A engine-meta builder still has stub initial values for the existing `historyAttr`/`internalRules`/`parallelAttr`/`onTimeoutElements` fields — those are EngineMetadata-level (declared B14, populated A5-2 sub-step 8). Sub-step 1 only landed the structured types.

**Next:** sub-step 2 — `parallel` bare attribute on file-scope `<engine>` (ast-builder.js + symbol-table.ts PASS 10.A flow-through).

### Sub-step 2 — `parallel` bare attribute on file-scope engine

- **Done:** Added `parallelMatch` regex (`/\bparallel\b(?!\s*=)/`) and `parallel` boolean to ast-builder.js engine-decl block (mirrors the `pinnedMatch` pattern verbatim).
- **Done:** Added `parallelAttr: parallel` to engine-decl AST construction.
- **Done:** Wired through to PASS 10.A engineMeta builder (`parallelAttr: engineDecl.parallelAttr === true`).
- **Done:** Updated B14 test assertion `engine-binding-b14.test.js:310-326` — `parallelAttr` is now populated as `false` for engines without `parallel` keyword (was `undefined` pre-A5-2). Test expectation amended to `expect(rec.engineMeta.parallelAttr).toBe(false)` per §51.0.P contract.
- **Done:** Full regression sweep — 9565 pass / 0 fail. Tests at baseline.

**Next:** sub-step 3 — `history` bare attribute on engine state-child openers.

### Sub-step 3 — `history` bare attribute on state-child openers (§51.0.N)

- **Done:** Added negative-lookahead bareword regex in opener-attribute scan: `/\bhistory\b(?!\s*=)/.test(afterTag)`. Mirrors the `pinned` recognition pattern verbatim.
- **Done:** Pipes `historyAttr` into the EngineStateChildEntry construction.

### Sub-step 4 — `internal:rule=` prefix on state-child openers (§51.0.O)

- **Done:** Strip-and-rerun pattern (per Phase 0 SURVEY §1.3): `internal:rule=` regex extracts FIRST, captured substring REMOVED from a working copy of `afterTag`, THEN the canonical `rule=` regex runs.
- **Done:** Reuses `parseRuleAttrValue` helper for the value (admits same six EngineRuleForm shapes including the new `.history` form).
- **Done:** Default `internalRule: { kind: "absent" }` when prefix is absent.

### Sub-step 5 — `.Variant.history` recognition in `parseRuleAttrValue` (§51.0.N)

- **Done:** Single-target regex extended: `^\.([A-Z][A-Za-z0-9_]*)(\.history)?$`. When the suffix matches, `historyForm: true` is set on the form.
- **Done:** Multi-target list-item regex extended identically. `historyForms` parallel array populated when at least one item uses the history form (defensive shape per Phase 0 SURVEY §7.6 — keeps canonical-multi shape unchanged for the all-non-history case).
- **Done:** Bare-form (no leading dot) extension added for symmetry.

### Sub-step 6 — `<onTimeout>` body-scan helper (§51.0.M)

- **Done:** Added exported helper `scanForOnTimeoutEntries(bodyRaw, skipRegions): OnTimeoutEntry[]`. Regex `/<onTimeout\b([^>]*?)\/>/g` matches the spec-canonical self-closing form.
- **Done:** Captures `after` and `to` raw values. `to` value strips leading `.` for variant-name normalization. Quoted values stripped.
- **Done:** Skip-regions parameter excludes nested-engine body regions to avoid mis-attribution.

### Sub-step 7 — Nested `<engine>` body-scan helper (§51.0.Q.1)

- **Done:** Added exported helper `scanForNestedEngineEntries(bodyRaw): NestedEngineEntry[]`. Walks bodyRaw for `<engine\b` openers (with ident-boundary check to avoid `<engineering>` etc.), then `findEngineCloser` traverses to the matching `</engine>` or `</>` closer with proper depth tracking for deeper-nested engines.
- **Done:** Self-closing `<engine .../>` is rejected as not a legal nested-engine form (engines must contain state-children) — A5-3 typer can flag if observed.
- **Done:** Wired both body-scans into `parseEngineStateChildren` after `bodyRaw` is captured. Nested-engine scan runs FIRST so its body regions are passed as skip-regions to the `<onTimeout>` scan. Skipped entirely for `:`-shorthand and self-closing forms.

- **Done:** Full regression sweep — 9565 pass / 0 fail / 9626 total. Tests still at baseline.

**Next:** sub-step 8 — PASS 10.A flow-through for `parallelAttr` (already done in sub-step 2). Move on to sub-step 9 — unit tests.

### Sub-step 8 — PASS 10.A flow-through (NO-OP for A5-2; handled inline)

- **Done verification:** `parallelAttr` flow-through was completed in sub-step 2 (`engineMeta.parallelAttr = engineDecl.parallelAttr === true`). Other state-child fields (`historyAttr`/`internalRule`/`onTimeoutElements`/`innerEngines`) live on `EngineStateChildEntry` which already flows through PASS 11 (`symbol-table.ts:4357 — meta.stateChildren = parseEngineStateChildren(rulesRaw)`); no PASS 10.A change needed beyond sub-step 2.
- **Note:** EngineMetadata-level fields `historyAttr`/`internalRules`/`onTimeoutElements` remain `undefined` at PASS 10.A — they're FILE-SCOPE engine summary fields. Per BRIEF §3.1, A5-2 is "parser surface for state-children + parallel"; FILE-SCOPE summary aggregation belongs to A5-3 typer. Confirmed with PA's BRIEF §3.1 wording.

### Sub-step 9 — Unit tests

- **Done:** Created `compiler/tests/unit/a5-2-parser-support.test.js` with 63 unit tests (above BRIEF §6.1 target of 35-50). Coverage:
  - §A5-2.1 — `<onTimeout>` parsing (11 tests)
  - §A5-2.2 — `history` bare attribute (5 tests)
  - §A5-2.3 — `internal:rule=` prefix (7 tests, including strip-and-rerun verification)
  - §A5-2.4 — `parallel` bare attribute (6 tests)
  - §A5-2.5 — Nested `<engine>` recognition (9 tests, including `<onTimeout>` mis-attribution edge-case)
  - §A5-2.6 — `.Variant.history` target form (8 tests, including expression-RHS zero-source-change ANCHOR)
  - §A5-2.7 — Composition (2 tests carrying ALL extensions)
  - §A5-2.8 — AST shape contract (3 tests)
  - §A5-2.9 — Span integrity (4 tests)
  - §A5-2.10 — Negative cases / parse-error shapes (7 tests)

- **Key bug surfaced and fixed during test development:** `findStateChildCloser` did NOT skip past nested `<engine>` blocks → nested engine's `</>` closers (state-child closers + engine closer) were spuriously decrementing the OUTER state-child's depth counter, causing the outer state-child to be mis-closed at the inner engine's first `</>`. Fix: extended `findStateChildCloser` to recognize `<engine` opener and skip via `findEngineCloser` to its matching closer. ALSO required `findEngineCloser` to track in-flight state-child openers separately from engine depth (LIFO `scDepth` stack) so that state-child `</>` closers don't terminate the engine prematurely.
- **`.Variant.history` zero-source-change BET CONFIRMED:** the expression-RHS smoke test (§A5-2.6 ANCHOR) compiles cleanly without any expression-parser source changes — B20's bare-variant infrastructure naturally extends to `.Playing.history` as MemberExpr.

### Sub-step 10 — Full-suite regression check

- **Done:** `bun test compiler/tests/` — 9628 pass / 60 skip / 1 todo / 0 fail / 9689 total. Delta: +63 tests, +0 regressions. Baseline 9565/9626 → final 9628/9689.
