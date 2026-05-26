# Progress: ~snapshot codegen fix (S131 HU-5 Q-W35-1)

## 2026-05-25 — kickoff

- WORKTREE: $(pwd from startup)
- Brief: HU-5 Q-W35-1 (a) — `~snapshot` is NOT a new language form; only the codegen bug needs fix
- Bug: `~snapshot = {...}` tilde-decl with reactive deps emits `let _scrml_tilde_3 = ~;` (raw tilde sigil leak)
- SPEC ref: §32 (lines 15024-15233) — `~` is pipeline accumulator + lin variable; canonical surface is the unprefixed bare-decl form

## Phase 0 — root cause confirmation

Reproduced bug via fixture `~snapshot = { count: @count, name: @name }` with `<count> = 0; <name> = "alice"` reactive cells.

Output (`repro.client.js`):
```
let _scrml_tilde_2 = ~;
_scrml_derived_declare("snapshot", () => ({count: _scrml_reactive_get("count"), name: _scrml_reactive_get("name")}));
_scrml_derived_subscribe("snapshot", "count");
_scrml_derived_subscribe("snapshot", "name");
const result = _scrml_tilde_2;
```

The raw `~` leaks at line 1.

AST dump shows the live parser SPLITS `~snapshot = {...}` into TWO statements:
- `id: 6, kind: "bare-expr", expr: "~", exprNode: { kind: "ident", name: "~" }` — spurious leading bare-expr
- `id: 7, kind: "tilde-decl", name: "snapshot", init: "{ count : @count , name : @name }"` — the actual tilde-decl

Root cause trace:
1. Tokenizer emits `~` as TILDE token kind (tokenizer.ts:1135)
2. Statement-level parser (ast-builder.js:7150-9697) has NO `~ IDENT =` lead handler
3. Falls through to catch-all `collectExpr()` at line 9665, which returns just `~` (statement-boundary check at line 2588-2596 breaks on `IDENT =` after `~`)
4. Spurious bare-expr `~` pushed (id 6)
5. Next iteration: `snapshot = ...` matches the bare IDENT-`=` tilde-decl handler at line 9570
6. Codegen at `emit-logic.ts:1184` bare-expr branch sees `opts.tildeContext` is active (set by per-group pre-scan because `~` appears in the group)
7. Emits `let _scrml_tilde_2 = ${emitExpr(node.exprNode, prevExprCtx)};` where node.exprNode = `{kind:"ident", name:"~"}` and prevExprCtx.tildeVar is null (no prior tilde)
8. emit-expr.ts:emitIdent line 273: `name === "~" && ctx.tildeVar` — fails because tildeVar null
9. Falls to "Plain identifier — pass through" at line 292: returns `~` literally
10. Result: `let _scrml_tilde_2 = ~;` — invalid JS

Per pa.md Rule 4: SPEC §32 does NOT define `~name = expr` as a tilde-decl form (the canonical decl form is the bare `name = expr` per the existing live tilde-decl handler at ast-builder.js:9566). The brief disposition (Q-W35-1=a) is correct: this is a codegen bug, not a missing SPEC form.

Per pa.md Rule 5: this is parser+codegen interaction. The native parser correctly handles `~name = pipeline` as a unified tilde-decl (parse-stmt.js:3015), but the live parser does NOT. Cleanest fix would be parser-level (mirror native). However, the brief scopes the fix to "codegen path that's leaking the sigil" — applying defensive codegen-level fix; parser-level follow-up surfaceable to PA.

## Fix plan

Two-part defensive fix:
1. `emit-logic.ts:bare-expr` — when the bare-expr is exactly `~` (orphan accumulator-only) AND prior tilde is null, SKIP emission entirely (return "") to prevent the `let _scrml_tilde_N = ~;` leak from this specific bug
2. `emit-expr.ts:emitIdent` — when `name === "~"` and `ctx.tildeVar` is null, emit defensive marker `null /* ~ orphaned — codegen-fallback */` for any nested-expression orphan (defense in depth per SURVEY's pre-S125 recommendation Step 2)

## Test

`compiler/tests/integration/tilde-snapshot-codegen-fix.test.js`:
- Reproducer: `~snapshot = {...}` with reactive deps → assert NO raw `~` in output + derived-declare landed + result consumes derived

## 2026-05-25 — fix landed

Commit: `b29fb13e` `fix(codegen): ~snapshot tilde-decl no longer leaks raw ~ sigil (HU-5 Q-W35-1)`

Files touched:
- `compiler/src/codegen/emit-logic.ts` — bare-expr orphan-`~` skip in Phase 3 fast path
- `compiler/src/codegen/emit-expr.ts` — emitIdent defensive marker for orphan `~`
- `compiler/tests/integration/tilde-snapshot-codegen-fix.test.js` — 3-test regression suite (NEW)

Pre-commit: 14528 pass / 88 skip / 1 todo / 0 fail across 14617 tests (67.26s)
Post-commit (TodoMVC gauntlet + browser validation): all checks passed.

## Bug closure

`docs/known-gaps.md` Bug 15 entry rotated from §2 (MED open) to §7 (S131 closed). §0 inventory MED count 7 → 6.

## Out-of-scope follow-up (surfaceable)

The native parser (`compiler/native-parser/parse-stmt.js:3015` `tildeDeclLeadFollows`) recognises the unified `~ IDENT = expr` lead as a single tilde-decl. The live parser (`compiler/src/ast-builder.js`) does NOT — it peels the leading `~` as a spurious bare-expr. The CLEANEST fix would mirror native in live. That's a parser-level change, out of scope per the brief's "codegen path that's leaking the sigil" framing. Surfaceable as a follow-up if PA wants to retire the defensive codegen fallback in favor of parser parity.

Per [[feedback_stalled_investigation_tangential_cleanup]] this is also a candidate "tangential cleanup" surface — the parse split causes the lin-tracker to misread `~name = expr` as `name = expr` with `~` separately, surfacing E-MU-001 on the snapshot fixture (unrelated to the codegen leak but visible as friction). Live parser parity would close BOTH the codegen path AND the lin-tracker tension.
