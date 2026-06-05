# TASK — native parser: populate `exprNode` on markup attribute values (native-parser-swap parity-closer; cross-cutting)

scrml is driving `--parser=scrml-native` to default (deleting legacy BS+Acorn at M6); the native parser must reach BYTE-IDENTICAL output parity with the legacy (default) pipeline. You are closing the single highest-leverage remaining native gap: **native markup attribute-values lack the `exprNode` field that codegen consumes.** This is cross-cutting (~162 corpus files) — `val.exprNode` is read for event handlers, `if=`/`show=`, `bind:`, props, body. Closing it at the root unblocks all of them.

change-id: `native-attrvalue-exprnode-population-2026-06-04`

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full → §"Task-Shape Routing" → "parser / grammar fix — NATIVE-PARSER swap-grind" (→ `domain.map.md` "Native-Parser Swap Orientation", `structure.map.md` "Native-Parser File Table"). The maps name THIS (native attr-value `exprNode` population) as THE NEXT DISPATCH with the locus + consumer list.
Map currency: after your startup merge your worktree is at HEAD `0aa94d2f` and the maps are fresh. Report a maps feedback line.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
S99/S126: 17+ path-discipline leaks where agent edits landed in MAIN.
BEFORE any other tool call:
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP+report (S90). Save as WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **`git -C "$WORKTREE_ROOT" merge 0aa94d2f`** — your worktree branches from origin/main (`f11db672`), BEHIND local HEAD. Commit `0aa94d2f` carries the §51.0.S message-arm parity fix `7cbad5dd` + fresh `.claude/maps/`. Merging it (fast-forward; no conflicts — different files) gives a current base. Confirm `log --oneline -1` shows `0aa94d2f`. If not a clean fast-forward, STOP+report.
4. `git -C "$WORKTREE_ROOT" status --short` clean.
5. `cd "$WORKTREE_ROOT" && bun install`.
6. `bun run pretest`.

## Path discipline (EVERY edit)
- ALL edits via Bash (`perl -i`/`python`/heredoc) on worktree-absolute paths including `.claude/worktrees/agent-<id>/` — NOT Edit/Write tools (S126). Echo path before; diff after.
- NEVER `cd` into main or outside WORKTREE_ROOT. Use `bun --cwd`, `git -C`, worktree-absolute paths.

# COMMIT DISCIPLINE (S83)
- After EVERY edit: diff; add; commit (per sub-step). FIRST commit includes startup `pwd`: `WIP(exprnode): start at <pwd>`.
- Before DONE: status clean. NEVER `--no-verify` without authorization.
- Write `docs/changes/native-attrvalue-exprnode-population-2026-06-04/progress.md`, append-only.

# THE TASK — verified anchors

## The gap
- Native (`compiler/native-parser/tag-frame.js` attr-value construction ~L1079/1095/1125/1130/1153) builds attr values `{kind:"expr"|"variable-ref", raw, refs, sourceText, span}` — but never sets `exprNode`.
- Live (`compiler/src/ast-builder.js`) sets `exprNode: safeParseExprToNodeGlobal(raw, filePath, valSpan?.start ?? 0, errors)` at every attr-value site: 1834 (variable-ref), 1857 (expr), 1878 (expr), 2217 (variable-ref).
- Consumers (`compiler/src/codegen/emit-html.ts`): handlerExprNode 1735, condExprNode 1718/1756 (if=/show=), body 1015, fv/ifVal 823/1414. Flows to emit-event-wiring/control-flow/match/bindings/form-for/table-for/variant-guard/scheduling/collect/usage-analyzer.
- Symptom: absent exprNode → string-fallback → `onclick=@x.advance(...)` emits raw `@` → E-CODEGEN-INVALID-JS. Confirmed on engine-message-dispatch-s6.scrml.

## PHASE 0 — survey first
1. Which function produces the exprNode shape emit-html expects — live uses `safeParseExprToNodeGlobal` (find def/signature/export). Native MUST produce the IDENTICAL live ExprNode shape (NOT native parse-expr.js AST). Confirm function + args.
2. WHERE to populate — (a) tag-frame.js construction or (b) native-walker (compiler/src/native-walker/) translation where safeParseExprToNodeGlobal is importable + other native→live fixups live. Pick the site that can call the live function AND has the correct SOURCE OFFSET (so spans match live; within-node SPAN-COORD). Survey how native attr-values carry source offset (span.start/valStart).
3. Scope — cover BOTH kind:"expr" AND kind:"variable-ref" (live sets both); skip plain string literals (match live exactly).
Decision gate: localized population reusing the live parse fn with available offset → PROCEED. Multi-stage offset-threading infra change → STOP+report. Record in progress.md.

## Implementation (if proceed)
- Populate exprNode using the SAME safeParseExprToNodeGlobal live uses, at the surveyed site, threading the correct offset. Mirror live per-kind (expr + variable-ref; skip string literals).
- Localized + minimal. Do NOT touch codegen/emit-* (they consume exprNode correctly once native populates it).

## TESTS
- Native-path test: attr-value exprNode populated + `onclick=@x.method()` lowers under native (no raw @, no E-CODEGEN-INVALID-JS).
- Pre-commit subset 0-fail.
- Within-node parity (bun test compiler/tests/parser-conformance-within-node.test.js; currently 1005/0): native now carries exprNode → should REDUCE MISSING-FIELD (convergence) but parsed subtree may add FIELD-SHAPE/SPAN-COORD if offset differs. Run it. Rebump ONLY benign SPAN-COORD/EXTRA-FIELD; FLAG any non-benign FIELD-SHAPE/KIND-NAME/MISSING-FIELD-increase — don't mask a real divergence (exprNode subtree must MATCH live, not just be present).

## PHASE 3 — R26 (byte-compare EMIT). Run BOTH:
(A) exprNode-isolated fixture — minimal `onclick=@x.method()` (or `if=(@a && @b)`) that DEFAULT compiles clean, native currently fails; after fix diff -r byte-identical + node --check + zero E-CODEGEN-INVALID-JS.
(B) message-dispatch full-fixture (unblockable — base has message-arm fix via startup merge):
```
mkdir -p /tmp/r26-exprnode/{default,native}
bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile "$WORKTREE_ROOT"/compiler/tests/fixtures/engine-message-dispatch-s6.scrml --output-dir /tmp/r26-exprnode/default              > /tmp/r26-exprnode/default.log 2>&1
bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile "$WORKTREE_ROOT"/compiler/tests/fixtures/engine-message-dispatch-s6.scrml --output-dir /tmp/r26-exprnode/native --parser=scrml-native > /tmp/r26-exprnode/native.log 2>&1
diff -r /tmp/r26-exprnode/default /tmp/r26-exprnode/native
grep -c '_scrml_engine_dispatch_message\|_msg_arms' /tmp/r26-exprnode/native/*.client.js
node --check /tmp/r26-exprnode/native/*.client.js && echo "native JS parses"
grep -cE 'E-CODEGEN-INVALID-JS|E-UNQUOTED' /tmp/r26-exprnode/native.log
```
PASS = both (A)+(B) byte-identical native==default (modulo I-PARSER-NATIVE-SHADOW info line), node --check exit 0, zero E-CODEGEN-INVALID-JS/E-UNQUOTED. (B) closing is the headline (message-dispatch family FULLY native-parity end-to-end). DO NOT mark DONE without R26 byte-identical on BOTH. If drift remains, report (don't claim closed).

## OPTIONAL cross-cutting confirmation
Spot-check 2-3 broader flip-failure E-CODEGEN-INVALID-JS sources (grep `onclick=@`/`if=(@`); confirm reduction. Report counts. Not a gate.

# FINAL REPORT (data)
- WORKTREE_PATH, FINAL_SHA, BRANCH, FILES_TOUCHED, startup-merge confirmation (HEAD == 0aa94d2f)
- Phase-0 finding + placement decision (site, parse fn, offset source) + gate decision
- What changed (file/fn/line)
- Test delta (+N; pre-commit count; within-node result + rebump justification + any FLAGGED mismatch)
- R26 (A)+(B) verbatim
- Optional spot-check counts
- Deferred/residual
- Maps feedback line
