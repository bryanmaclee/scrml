# TASK — emit-each.ts per-item `${expr}` text-interp: honor the exprNode contract (#2f completion)  ·  change-id: `native-each-interp-codegen-2026-06-04`

> **Archived dispatch brief (S136).** Verbatim `prompt:` text passed to `scrml-js-codegen-engineer` (isolation:worktree, opus, background) on 2026-06-04 (S162). Second dispatch of the #2f arc — closes the bare-body `${...}` per-item text-interp gap left by the each structural-promotion landing (`39b1424a`). Map currency cited: main `39b1424a`; map baseline `9f01f6cd`.

---

You are closing the remaining half of #2f. The native-parser `<each>` structural promotion ALREADY landed (main `39b1424a`): `<each>` now produces the correct `each-block` FileAST node under `--parser=scrml-native`, with `_scrml_reconcile_list` + render-fn + per-item factory. **The one remaining gap:** a bare-body per-item text interpolation (`<li>${item.name}</li>` / `<li>${@.name}</li>`) is SILENTLY DROPPED under native — the per-item text node is missing from the emitted client.js.

**Confirmed root cause (from the prior survey + dispatch — verify it):** the native A1 bridge `compiler/native-parser/translate-stmt.js` `makeBareExpr` (~line 431-433) DELIBERATELY sets `expr: ""` on the bare-expr statement and populates `exprNode` instead. This is an INTENTIONAL, contract-blessed shape — the documented contract is **"codegen prefers exprNode."** `compiler/src/codegen/emit-html.ts` (~line 1015-1016) ALREADY honors it (plain `${...}` interpolation in markup is byte-identical native-vs-default). **`compiler/src/codegen/emit-each.ts` (~line 342-345) is the one place that does NOT** — it reads `stmt.expr` for a `bare-expr`, which is empty under native, so the per-item interpolation hits a "// each: empty logic interpolation skipped" path and the text is dropped.

**THE FIX (codegen-only, contract-aligned):** make `emit-each.ts` honor the same exprNode-preference contract `emit-html.ts` uses. When the per-item bare-expr's `stmt.expr` is empty/absent, fall back to the `exprNode` path (e.g. `emitStringFromTree(stmt.exprNode)` or whatever `emit-html.ts` calls). **Mirror `emit-html.ts`'s exact preference logic** so the two codegen sites agree. The legacy pipeline (where `stmt.expr` IS populated) MUST stay byte-identical — so prefer the non-empty `expr` when present, else use `exprNode`. If both are present and disagree, match emit-html.ts's resolution order.

**DO NOT** touch `translate-stmt.js` / the native bridge / the native parser — option (b) "populate expr in the bridge" DIVERGES from the established contract; you are implementing option (a) only. **DO NOT** change the AST shape, the SPEC, or anything outside `emit-each.ts` (and a shared emit helper ONLY if `emit-html.ts`'s exprNode path is a reusable function you should call — in which case import + call it, don't fork it).

---

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (~100 lines). §"Task-Shape Routing" → "compiler-source bug fix / codegen" shape: also consult `structure.map.md` (codegen §) + `dependencies.map.md`.
Map currency: maps reflect HEAD `9f01f6cd`; current main is `39b1424a` (the each-promotion landing — `compiler/native-parser/` + `emit-each.ts` are the relevant just-changed surface; verify against live source). Feedback line required in your report.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Your worktree path = whatever `pwd` reports — call it WORKTREE_ROOT.
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP + report (S90).
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **S112 MERGE-STARTUP (do NOT skip):** `git -C "$WORKTREE_ROOT" merge --ff-only main` (your worktree may branch from a session-start commit that LAGS the `39b1424a` each-promotion landing — you NEED that landing as your base). Verify `git -C "$WORKTREE_ROOT" log --oneline -1` shows `39b1424a` or a descendant. If ff impossible / conflict, report.
4. `git -C "$WORKTREE_ROOT" status --short` clean.
5. `cd "$WORKTREE_ROOT" && bun install`.
6. `cd "$WORKTREE_ROOT" && bun run pretest`.
If ANY check fails: STOP + report.

## Path discipline (EVERY write)
- ALL writes use ABSOLUTE paths under WORKTREE_ROOT (incl. the `.claude/worktrees/agent-<id>/` segment). NEVER the bare main root.
- **S126 — apply edits via Bash** (`perl`/`python`/heredoc on worktree-absolute paths); echo the target path before each write; re-verify via `git -C "$WORKTREE_ROOT" diff` after. The Edit/Write tools have leaked to MAIN (S126 #12/#13).
- **NEVER `cd` into the main repo.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.
- First commit message includes verbatim `pwd`: `WIP(each-interp): start at <pwd>`.

# COMMIT DISCIPLINE (S83)
- Commit per logical step. Update `"$WORKTREE_ROOT"/docs/changes/native-each-interp-codegen-2026-06-04/progress.md` after each step.
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean (all committed).
- **NEVER `--no-verify`** without explicit authorization. Investigate gate failures; don't bypass.

---

# PHASE 1 — SURVEY (small; confirm before editing)
- Read `emit-each.ts` ~line 320-380 (the per-item body statement-emit loop + the bare-expr interpolation handling). Find the "empty logic interpolation skipped" path + how it reads `stmt.expr`.
- Read `emit-html.ts` ~line 1000-1030 (the markup `${...}` interpolation handling) — find the exprNode-preference logic + the helper it calls (`emitStringFromTree`? `emitExprToString`? note the exact name + import).
- Confirm the legacy path: under the DEFAULT parser, is `stmt.expr` populated for an each per-item `${...}`? (It should be — the legacy ast-builder populates `expr`.) Your fix must preserve that path byte-identical.
- Report the exact preference logic you'll mirror BEFORE editing if anything is ambiguous; otherwise proceed.

# PHASE 2 — FIX (emit-each.ts only)
Apply the exprNode-fallback. Keep it minimal + mirror emit-html.ts.

# PHASE 3 — EMPIRICAL VERIFICATION (S138 — MANDATORY; this is a codegen fix)
Re-compile real each source under BOTH parsers; the 3 previously-divergent bare-body shapes must now match:
```
mkdir -p /tmp/each-interp-verify && cd /tmp/each-interp-verify
# write minimal fixtures: each-as-name (<li>${item.name}</li>), each-empty (<li>${@.name}</li> + <empty>), each-key (key=@.id + ${item.x}), plus a colon-shorthand control + a count-form <each of=N>${@.}</li>
for fx in as-name empty key colon-shorthand of-count; do
  bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/each-interp-verify/$fx.scrml --parser=scrml-native --output-dir /tmp/each-interp-verify/native/$fx > /tmp/each-interp-verify/native-$fx.log 2>&1
  bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/each-interp-verify/$fx.scrml --output-dir /tmp/each-interp-verify/default/$fx > /tmp/each-interp-verify/default-$fx.log 2>&1
  diff <native-client.js> <default-client.js>   # expect byte-identical OR id-offset-only
done
```
MUST pass:
- The per-item `${item.name}` / `${@.name}` text now PRESENT in the native client.js (was dropped) — `.name` ref count matches default.
- All 8 #2f shapes (the 5 already-passing + the 3 previously-divergent as-name/empty/key) now byte-identical or id-offset-equivalent native-vs-default.
- `node --check` exit 0 on every emitted client.js.
- **0 regression on the LEGACY path:** the existing each tests under the DEFAULT parser (`compiler/tests/unit/each-block.test.js` 32, `each-colon-shorthand-r25-bug-40.test.js` 20, `engine-body-render.test.js` 31, `native-each-promotion.test.js` 24) all stay green.
**DO NOT mark DONE without Phase 3 passing.** Report the per-shape native-vs-default diff verdict.

# WITHIN-NODE PARITY (S125)
This is an emit-time fix (NOT an AST-shape change), so within-node parity should be UNAFFECTED. Run `bun test "$WORKTREE_ROOT"/compiler/tests/parser-conformance-within-node.test.js` to confirm GREEN with NO allowlist change. If it changes, STOP and report (an emit fix shouldn't move AST-diff counts — that would mean you touched the parser/bridge, which is out of scope).

# TEST GATE
- Add unit test(s) asserting native each per-item interpolation now emits the text (a focused test in `native-each-promotion.test.js` or a new `native-each-interp.test.js`).
- Full pre-commit gate 0 fail on every commit. Report final pass/skip/fail.

---

# FINAL REPORT (raw, for PA file-delta landing)
- Maps feedback line.
- WORKTREE_PATH, FINAL_SHA, branch, FILES_TOUCHED.
- The exact preference logic landed (and the emit-html.ts helper you mirrored/called).
- Phase 3: per-shape native-vs-default verdict (all 8 #2f shapes — confirm the 3 previously-divergent now match).
- within-node parity: GREEN + no allowlist change (or STOP-report if it moved).
- Test counts: added + full-suite pass/skip/fail + legacy each tests 0-regression confirmation.
- Any surprise / residual divergence.
- `git -C "$WORKTREE_ROOT" status` clean at report time.

Scope: `emit-each.ts` ONLY (+ importing an existing emit-html helper if applicable). NO native-parser / bridge / SPEC / AST-shape changes. If the fix appears to need any of those, STOP and report the coupling.
