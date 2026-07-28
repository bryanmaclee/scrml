# scrmlTS — Session 39

**Date opened:** 2026-04-24
**Previous:** `handOffs/hand-off-39.md` (S38 closed)
**Baseline entering S39:** 7,463 pass / 40 skip / 2 fail / 347 files at `5bd7a38`.
**Current at checkpoint:** **7,562 pass / 40 skip / 0 fail / 354 files** at `1e304c8`.

---

## 0. Session-start state

Local was 331 commits behind origin (stuck at S5 split-era). Pulled to `5bd7a38`. Inbox had 10 items (4 messages + 6 reproducers) from S38 close.

---

## 1. Work completed this session

### Security
- **Boundary security deep-dive + 3-expert debate.** Approach C (Extended Interprocedural Taint) won 54/60. closureCaptures map + fixed-point taint propagation in RI, call-graph BFS for transitive reactive deps (Bug J fix), `_ensureBoundary` graduated to diagnostic fail-safe (NC-4). +15 tests.

### Bug fixes (all 6 inbox bugs resolved)
- **Bug I** (name-mangling bleed) — lookbehind `(?<!\.\s*)`. +7 tests.
- **Bug J** (markup-interp helper hides reactive) — in boundary security merge. +15 tests.
- **Bug H** (function-rettype match drops return) — `hasReturnType` flag + implicit return. +5 tests.
- **Bug K** (sync-effect throw halts caller) — try/catch in `_scrml_trigger`. +5 tests.
- **GITI-009** (relative-import forwarding) — `rewriteRelativeImportPaths()` post-processor. +16 tests.
- **GITI-011** (CSS at-rule handling) — `CSS_AT_RULE` token type + passthrough emission. +19 tests.

### ExprNode Phase 4d
- **Steps 1-7 merged** — ExprNode-first paths across body-pre-parser, component-expander, type-system, dependency-graph, meta-checker. bpp.test.js GIT_DIR fix.
- **Structured inline match arms merged** — `match-arm-inline` AST node replaces regex-parsed bare-expr strings for inline match arms. +19 tests.
- **Render preprocessor landed** — `render name()` → `__scrml_render_name__()` in `preprocessForAcorn`, same pattern as 6 existing preprocessor rules. Unblocks Step 8.
- **Step 8 (`.expr` field deletion)** — agent completed in worktree but merge conflicts prevented clean landing. CE ExprNode structural matching + emit-lift cleanup are ready; the actual field deletion needs a fresh dispatch from current main.

### Multi-DB SQL
- **Deep-dive complete** — Bun.SQL template literals (SPEC §44 mandate). Approach A (direct Bun.SQL target, no adapter). Phased plan: Phase 1 SQLite→Bun.SQL, Phase 2 Postgres, Phase 3 MySQL.
- **Bun.SQL Phase 1 code complete** — 6 source files + 8 test files changed, 7,477 tests passing in worktree. But worktree was based on pre-Bug-H/pre-match-arm-inline main → merge conflicts. **Needs fresh dispatch from current main next session.**

### Other
- README: giti link added, broken 6nz relative links fixed.
- Maps refreshed (11 maps + non-compliance report).
- State-of-language audit (13/14 examples compile, 250/274 compilation tests pass, all features verified).
- Dead code audit (3 dead files, 3 dead exports — none worth cleaning).
- master-list.md refreshed to S39.

---

## 2. Next priority for S40

1. **Bun.SQL Phase 1 re-dispatch** — code is known-correct, just needs fresh application on current main (has Bug H + match-arm-inline + boundary security). ~6 source files + ~8 test files. Well-scoped.
2. **Phase 4d Step 8 completion** — CE structural matching + `.expr` field deletion. Render preprocessor is landed. The `.expr` deletion agent's work is conceptually correct but needs clean merge.
3. **SPEC §8/§44 reconciliation** — merge the two conflicting SQL sections once Bun.SQL Phase 1 lands.
4. **Bun.SQL Phase 2 (Postgres)** — parse `postgres://` URI, add Postgres schema introspection.
5. **LSP enhancement** — diagnostics on save + document symbols + go-to-definition (highest-leverage DX).

### Carried from S38
- Auth-middleware CSRF mint-on-403 (session-based path, deferred)
- Phase 0 `^{}` audit continuation (4 items)
- `scrml vendor add <url>` CLI (not started)
- Example 05 E-COMPONENT-020 (forward-ref)

---

## 3. Standing rules in force

(Carried from S38 — see `handOffs/hand-off-39.md` §2 for full list.)

---

## 4. Session log

- 2026-04-24 — Session opened. Local 331 commits behind origin. Pulled. Inbox triaged.
- 2026-04-24 — the adopter's Claude.ai conversation analyzed. Initially misjudged as hallucinated — corrected after seeing real inbox reproducers.
- 2026-04-24 — Boundary security deep-dive + debate. Approach C won. Implemented + merged.
- 2026-04-24 — Bugs I, J, H, K, GITI-009, GITI-011 all fixed. Inbox cleared.
- 2026-04-24 — README giti link + maps refresh + state-of-language audit + dead code audit.
- 2026-04-24 — master-list refreshed to S39.
- 2026-04-24 — ExprNode Phase 4d steps 1-7 merged. Structured inline match arms merged (+19 tests).
- 2026-04-24 — Phase 4d Step 8 investigation: render patterns are irreducible at AST builder level (CE processes component body before codegen). Deep-dive found Approach A (preprocess to placeholder) as solution. Render preprocessor committed.
- 2026-04-24 — Multi-DB deep-dive complete. Bun.SQL Phase 1 code complete in worktree but merge conflicts with Bug H/match-arm-inline changes prevented clean landing. Deferred to S40.
- 2026-04-24 — `.expr` deletion agent completed but merge conflicts. Deferred to S40.
- 2026-04-24 — Final: **7,562 pass / 40 skip / 0 fail / 354 files** at `1e304c8`. +99 tests this session.

---

## Tags
#session-39 #active #boundary-security #bug-fixes #phase-4d #bun-sql #multi-db #render-preprocess #match-arm-inline

## Links
- [handOffs/hand-off-39.md](./handOffs/hand-off-39.md) — S38 closed
- [pa.md](./pa.md)
- [master-list.md](./master-list.md)
- [docs/deep-dives/boundary-security-indirect-refs-2026-04-24.md](./docs/deep-dives/boundary-security-indirect-refs-2026-04-24.md)
