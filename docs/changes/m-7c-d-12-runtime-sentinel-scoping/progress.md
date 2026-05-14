## M-7C-D-12 Runtime Absence-Sentinel — SCOPING Progress

- 2026-05-13T16:00Z — Dispatch received. Verified worktree base, rebased onto main `78555f6`. `bun install` + `bun run pretest` clean.
- 2026-05-13T16:05Z — Read primary/structure/schema/error maps. Read null-audit (410L) + undefined-audit (485L). Cross-checked SPEC §42 (L18222-18567).
- 2026-05-13T16:10Z — Key finding: SPEC §42.5 + §42.8 explicitly state `not` literal compiles to `null` (compiled JS) with a "Rationale for null over undefined" subsection. The audit calls this "drift", but the SPEC currently NAMES it as the canonical runtime representation. This pivots the framing of Option α vs β/γ.
- 2026-05-13T16:15Z — Read pa.md Rule 3 + self-host-is-from-scratch rule. Confirmed scaffold framing: TS impl will be discarded; choose option that minimizes scaffold investment while honoring scrml-observable surfaces.
- 2026-05-13T16:25Z — Reading load-bearing code sites: emit-expr.ts L294-301 (`not` → `null`), emit-server.ts L928/934 (wire format `?? null`), emit-logic.ts L2138/2148 (SQL absence `?? null`), emit-engine.ts L985 (history cell init `null`), runtime-template.js L1709-1711 (structural-eq null/undefined paired check).
- 2026-05-13T16:40Z — SCOPING.md drafted: §1-§7 per dispatch spec. Surfaced options α/β/γ/δ + ε (hybrid). Recommendation: α-with-fences (SPEC §42.5/§42.8 are already-ratified canonical; runtime null IS scrml absence; tighten scrml-author surfaces only where leaks observably break scrml semantics — wire format encoding is the single load-bearing migration, NOT a runtime sentinel rebuild).
- 2026-05-13T16:50Z — Committing SCOPING + progress. Final report follows.

---

## S90 OQ disposition (2026-05-13)

- 2026-05-13T S90 — All 9 OQs ratified (commit `725e07c`):
  - OQ-1 (Option ε spec-canonical framing) — ratified S89 close
  - OQ-2 wire envelope shape → **(b) `{"__scrml_absent": true}`** (forward-compat with β; mirrors `__scrml_error` canonical precedent)
  - OQ-3 sequencing → **Parallel-aggressive** (T4 + T1 + T3 concurrent; T2 after T4; T5 last)
  - OQ-4 backwards-compat → **(b) dual-decoder** for scaffold; **(a) clean break at v1.0**
  - OQ-5 `?? "undefined"` fallback → **(a) replace with `"null"`**
  - OQ-6 error-code rename → **(a) `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` → `E-DERIVED-ENGINE-INITIAL-ABSENT-RT`**
  - OQ-7 DevTools experience → **(a) accept + document** (§12.5.1 / §42.8 Runtime Representation subsection)
  - OQ-8 schema-differ M-7C-D-15 → **DEFER** (§42.9 interop boundary sufficient)
  - OQ-9 spec-amend timeline → **Concurrent with Wave 4 A+R tracks**

## S90 dispatch — first attempt BLOCKED (CWD-routing finding)

- 2026-05-13T S90 — First-attempt T1/T3/T4 dispatches all reported BLOCKED at startup-verification. Harness `isolation: "worktree"` provisioned worktrees under `scrml-support/.claude/worktrees/` instead of `scrmlTS/.claude/worktrees/`. Root cause: PA's earlier `cd /home/bryan-maclee/scrmlMaster/scrml-support && git add ... && git commit ...` for the user-voice append persisted the shell CWD in scrml-support; subsequent `git -C` calls do NOT change CWD. F4 startup-verification block in each brief caught the wrong-repo `pwd` output; agents stopped without writes (zero work-lost).
- 2026-05-13T S90 — Recovery: TaskStop'd T4 (still in flight); cleaned scrml-support stale worktree; ran `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` to reset CWD; re-dispatched with retry briefs sharpening the F4 check to verify the `scrmlTS/.claude/worktrees/` path-prefix explicitly. All 3 retry worktrees correctly provisioned. Memory rule saved: `feedback_agent_isolation_cwd_routing.md`.

## S90 Track 1 — AST internal cleanup (LANDED, commit `850a298`)

- 2026-05-13T S90 — Track 1 retry dispatch agent `a72b73107987faddd`. Worktree at `scrmlTS/.claude/worktrees/agent-a72b73107987faddd/`. Base `725e07c`.
- D-12.1a landed at agent SHA `e37d932`: deprecation comments + new `"not"` documentation in `compiler/src/types/ast.ts` LitExpr + BinaryExpr.right.
- D-12.1b+c+d+e landed at agent SHA `b728189`: parser sites all migrated (`expression-parser.ts` 6 manufacturing sites — user-source `null` + is-not/is-some/is-not-not RHS + reset() fallback + array-hole + empty-expression placeholder + emitStringFromTree round-trip). Detector migrated (`gauntlet-phase3-eq-checks.js` raw-aware discrimination with legacy litType fallback). Component-expander default="null" path migrated. Type-system BUILTIN_TYPES `"null"` removed; LOGIC_SCOPE_GLOBAL_ALLOWLIST `"null"`/`"undefined"` removed.
- D-12.1f landed at agent SHA `225c3ec`: 22 new tests (lit-not-canonical-discriminator.test.js 11 tests + lit-not-detector-coordination.test.js 11 tests). 3 fixture-shape updates for consistency.
- Discriminator strategy: `raw` field discriminates user-source forbidden tokens from synthetic absence (user `null` → `litType:"not", raw:"null"`; canonical `not` keyword → `litType:"not", raw:"not"`; synthetic → `litType:"not", raw:"not"`).
- Semantic refinement: array holes `[1,,3]` now emit JS `null` instead of `undefined` (aligned with §42.5/§42.8 "compiles to null" for any absence).
- Scope-notes / NOT migrated: `route-inference.ts` JS_KEYWORDS (defensive filter); `tokenizer.ts` / `ast-builder.js` VALUE_KEYWORDS (lexer-level — removing breaks statement-boundary detection); `type-system.ts` L3882/L3888 `tPrimitive("null")` (JS-host DOM ref type).
- Pre-existing gap surfaced (NOT closed): component PropDecl `defaultValue:"null"` raw-attribute-string bypasses GCP3 walker. Track 1 preserves current behavior; out-of-scope follow-up.
- Tests at agent FINAL_SHA: 12,088 pass / 117 skip / 1 todo / 0 fail (+23 vs baseline 12,065).
- **PA landing commit `850a298`** — file-delta excluded progress.md (this file) for unified merge.

## S90 Track 3 — `?? "undefined"` codegen fix + lint (LANDED, commit `887f420`)

- 2026-05-13T S90 — Track 3 retry dispatch agent `acb3b94dfdfe860c6`. Worktree at `scrmlTS/.claude/worktrees/agent-acb3b94dfdfe860c6/`. Base `725e07c`.
- D-12.3a: 16 sites migrated (emit-server.ts ×3 at L882/L1047/L1139; emit-logic.ts ×10 — 7 emission + 3 consumer guards at L612/L1906/L1921 in **lockstep** per SCOPING risk register; scheduling.ts ×3 at L300-L302). One pre-existing test (`error-handling-codegen.test.js:79` asserted legacy `data: undefined`) migrated to assert canonical `data: null` per OQ-5 (a) cascade.
- D-12.3b: NEW `compiler/src/codegen/lint-undefined-interpolation.ts` (~280 LOC). Diagnostic code `W-CG-UNDEFINED-INTERPOLATION` (W-CG-* family). Idiom-aware exemptions: paired `null && undefined` absence-detection (§42.5/§42.8); `typeof X !== "undefined"` env-detection; comments; string literals; template-literal text; embedded runtime block (M-7C-D-14 scope) masked via `// --- scrml reactive runtime ---` / `// --- end ---` markers.
- D-12.3c: 28 new tests across 7 sections (scanner / paired-check / typeof / comments+strings / runtime-mask / integration / negative). Corpus sanity sweep: 289 samples + 45 stdlib = 334 files compiled, **0 W-CG-UNDEFINED-INTERPOLATION findings**.
- Tests at agent FINAL_SHA: 11,351 pass (pre-commit gate subset, +28 vs baseline 11,323).
- **PA landing commit `887f420`** — file-delta excluded progress.md.

## S90 Track 4 — SPEC amendments (LANDED, commit `8cef7f5`)

- 2026-05-13T S90 — Track 4 retry dispatch agent `adb60dde9579cd067`. Worktree at `scrmlTS/.claude/worktrees/agent-adb60dde9579cd067/`. Base `725e07c`.
- D-12.4a §12.5.1 amendment: `T | not` server-fn returns wire-encoded as `{"__scrml_absent": true}` envelope; non-`T | not` types continue raw JSON null; dual-decoder rule referenced; cross-refs §42.1 + §42.5 + §42.8 + new §57. SPEC.md +13 lines.
- D-12.4b NEW §57 Wire Format normative section. Slot note: SCOPING used working label `§50.x`; §50 was already occupied by Assignment-as-Expression, so new section parks at canonical §57 at end-of-document. Contents: §57.1 scope; §57.2 envelope shape (OQ-2 (b)); §57.3 encoder rules; §57.4 dual-decoder (OQ-4 (b)); §57.5 v1.0 clean break (OQ-4 (a)); §57.6 forward-compat with β; §57.7 cross-refs. SPEC.md +99 lines.
- D-12.4c rename: `E-DERIVED-ENGINE-INITIAL-UNDEFINED` → `E-DERIVED-ENGINE-INITIAL-ABSENT`. Three SPEC sites: §34 catalog row (L14688); §51.0.J rules table (L21758); §55 validators-summary (L26851). Pre-S90 name preserved in row prose for forensics. (Audit-doc cited `-RT` suffix but SPEC code lacked it; surgical rename preserves existing shape. Runtime-emission rename in compiler/src/* is Track 2 territory.)
- §42.8 "Runtime Representation — DevTools / debugger experience" subsection added (OQ-7). Documents JS bit-pattern visibility; scrml-language predicates classify correctly regardless of surface; native scrml debugger deferred to post-v1.0 self-host.
- D-12.4d SPEC-INDEX.md refresh: 47 section rows touched (line ranges shifted by cumulative +7/+15/+30); NEW §57 row inserted; 5 Quick-Lookup entries added; E-DERIVED-ENGINE Quick-Lookup row renamed. SPEC.md final size 27,144 lines (was 27,037).
- **PA AMENDMENT during landing**: §34 catalog row for `W-CG-UNDEFINED-INTERPOLATION` added directly to T4's SPEC.md before landing. Both T3 and T4 agents punted the row to each other; PA writes it sitting in the W-CG-* family between W-CG-001 and E-ERRORS-001.
- **PA landing commit `8cef7f5`** — file-delta excluded progress.md.

## S90 M-7C-D-12 Tracks 1+3+4 — landing summary

- **Three commits landed in main** at S90:
  - `850a298` — T1 AST cleanup
  - `887f420` — T3 codegen fix + lint
  - `8cef7f5` — T4 SPEC amendments + W-CG-UNDEFINED-INTERPOLATION §34 row
- **Tests:** baseline 12,065 → expected post-T1+T3 cumulative +51 (T1 +23 + T3 +28). T4 SPEC-only adds 0. Full-suite verification pending the final progress-merge commit's post-commit gate.
- **Process flag (agent self-reported, NOT carried into main):** T1 agent's per-step chain included one `--no-verify` commit (its `e37d932`) on a worry about a post-commit hook regex false-positive. Subsequent agent commits ran the full pre-commit gate cleanly. PA file-delta lands only the final tree shape through PA-authored commits — no `--no-verify` in main's history. Surfaced for transparency.
- **Coordination gap (closed PA-side):** §34 catalog row for `W-CG-UNDEFINED-INTERPOLATION` was un-claimed by both T3 and T4 (each punted to the other). PA added the row directly during T4 landing.
- **Worktrees retained for forensic until S90 wrap:** `agent-a72b73107987faddd`, `agent-acb3b94dfdfe860c6`, `agent-adb60dde9579cd067`.
- **Remaining M-7C-D-12 work:** Track 2 (wire envelope codegen, 10-12h; gated on §57 SPEC text which now lives at HEAD) and Track 5 (audit closure docs, 2-4h).
