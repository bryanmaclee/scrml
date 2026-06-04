# TASK — native lexer: recognize the `@.` contextual sigil (#2f unit C — final each piece)  ·  change-id: `native-each-contextual-sigil-2026-06-04`

> **Archived dispatch brief (S136).** Verbatim `prompt:` text passed to `scrml-js-codegen-engineer` (isolation:worktree, opus, background) on 2026-06-04 (S162). Third + final dispatch of the #2f each-promotion arc. Root-caused by survey agent `ab7a41ba8a1265dba` (scope verdict: NARROW — `@.` only); representation design-call resolved by PA (reuse `ident{name:"@.name"}` + the existing emit-each `rewriteContextualSigil`, symmetric to `@count`). Base: main `178cc5dc`.

---

You are closing the LAST piece of #2f. The native `<each>` structural promotion (main `39b1424a`) + the emit-each exprNode contract (main `178cc5dc`) already landed. The one remaining divergence: an `<each>` per-item body using the **`@.` contextual sigil** (`<li>${@.name}</li>`, `<li>${@.}</li>` count-form) still mis-compiles under `--parser=scrml-native` because **the native LEXER drops the `@` when it's followed by `.`**.

A Phase-0 survey already root-caused this + the PA has resolved the design call. Trust the findings; verify against source.

## ROOT CAUSE (survey — verify)
`compiler/native-parser/lex-in-code.js:351-358` recognizes `@` ONLY when followed by an ident-start char:
```js
// @ident -> ScrmlAt
if (c0 === "@" && isIdentStart(peekCharCode(cursor, 1))) {
    advance(cursor, 1);
    const { text } = scanIdentifier(cursor);
    ctx.tokens.push(makeToken(TokenKind.ScrmlAt, "@" + text, fullSpan, { name: text }));
    return true;
}
```
For `@.`, the next char is `.` (NOT ident-start), so this fails; the bare `@` falls through to the **"Unknown — skip"** fallback (`lex-in-code.js:812-813`) and is **silently discarded**. The trailing `.name` is then independently lexed as a `BareVariant` (the `.`-followed-by-ident value-position production ~`:713-722`), and bare `@.` becomes a stray `Dot`. Result exprNodes: `@.name` → `ident{name:".name"}` (the `@` gone); `@.` → malformed `member{object:MissingExpr, property:""}`.

**SCOPE IS NARROW — `@.` ONLY.** Every `@<ident>` form (`@count`, `@user.name`) preserves `@` cleanly (the `@ident` branch above). Do NOT touch the `@ident` path. The fix is contained to the `@`-followed-by-`.` case.

## THE FIX (PA-decided representation — implement this; it reuses ALL existing codegen)
The codegen side is ALREADY done. `rewriteContextualSigil` (`compiler/src/codegen/emit-each.ts:818`) is a STRING rewrite that already maps `@.name` → `iterVar.name` and bare `@.` → `iterVar`. And `emitStringFromTree` emits an `ident` node's `name` verbatim (that's how `@count` → `ident{name:"@count"}` → string `@count`).

**So produce an exprNode whose `emitStringFromTree` yields the literal string `@.name` / `@.`** — symmetric to how `@count` produces `ident{name:"@count"}`. Concretely the TARGET:
- `@.name`  → exprNode `ident{ name: "@.name" }`  → `emitStringFromTree` → `"@.name"` → existing `rewriteContextualSigil` → `iterVar.name` ✓
- `@.`      → exprNode `ident{ name: "@." }`        → `"@."` → `rewriteContextualSigil` (the `@\.(?![A-Za-z_$])` arm) → `iterVar` ✓
- `@.foo.bar` → `ident{ name: "@.foo.bar" }` → `"@.foo.bar"` → `iterVar.foo.bar` ✓ (verify rewriteContextualSigil handles the chained case — its first regex matches `@.foo` then the `.bar` rides along as literal; CONFIRM by compiling the fixture)

**Implementation shape (mirror the `@count` branch):** extend the `@` handling in `lex-in-code.js` so that when `c0 === "@"` AND `peekChar(cursor,1) === "."`, you consume `@.` plus the optional trailing dotted-ident chain as ONE token (a `ScrmlAt`-family token whose raw/meta makes the bridge produce `ident{name:"@.<chain>"}` / `ident{name:"@."}`). The KEY is that you consume the `@.` together so the `.name` does NOT fall to the BareVariant production. Then make the native→live bridge (`translate-expr.js` — note the survey flagged a `BareVariant` arm ~`:162`; you likely need a parallel `@.`-token arm OR the ScrmlAt arm to carry the `@.` name) yield the `ident{name:"@.name"}` shape.

**NO codegen change. NO emit-each change. NO new ExprKind unless strictly unavoidable** (the `ident{name:"@.name"}` reuse is the goal — if you find you must introduce a dedicated node kind, STOP and report rather than expanding scope).

## CRITICAL REGRESSION GUARD (survey STOP-FLAG 3)
Lowercase `@.name` currently shares the `BareVariant` lexer path with LEGITIMATE uppercase bare-variants (`.Idle`, `.Big`, `.Loading`). Your fix MUST key off the **preceding `@`**, NOT letter-case. A real bare-variant `.Idle` (no `@`) must STILL lex to `BareVariant` unchanged. Add a regression test proving `.Idle` / `.Loading` (uppercase, no `@`) are untouched.

## S115 PREDICATE-DRIFT DISCIPLINE (survey STOP-FLAG 2)
The lexer fix lands in BOTH `compiler/native-parser/lex-in-code.js` (~:351) AND its mirror `compiler/native-parser/lex-in-code.scrml` (~:525) — they are currently identical and MUST stay in lockstep. Any token-kind / bridge change in `.js` mirrors to `.scrml`. After editing, grep the touched `.scrml` for malformed predicates (`is not given` / `is given` / `is not not`) you may have introduced — use `!`-prefix / `== ""` / `is some` canonical forms (NB there is PRE-EXISTING `is given` drift in these mirrors; do NOT introduce MORE, and do NOT mass-fix the pre-existing — that's a separate tracked LOW).

---

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (~100 lines). §"Task-Shape Routing" → "compiler-source / native-parser" shape: also consult `structure.map.md` (native-parser §). Map currency: maps reflect HEAD `9f01f6cd`; current main is `178cc5dc`. Feedback line required.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Your worktree path = whatever `pwd` reports — call it WORKTREE_ROOT.
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP + report (S90).
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **S112 MERGE-STARTUP (do NOT skip):** `git -C "$WORKTREE_ROOT" merge --ff-only main` — you NEED the `178cc5dc` each-codegen landing as your base (the emit-each exprNode contract your fix relies on). Verify `git -C "$WORKTREE_ROOT" log --oneline -1` shows `178cc5dc` or a descendant. Report if ff impossible/conflict.
4. `git -C "$WORKTREE_ROOT" status --short` clean.
5. `cd "$WORKTREE_ROOT" && bun install`.
6. `cd "$WORKTREE_ROOT" && bun run pretest`.
If ANY check fails: STOP + report.

## Path discipline (EVERY write)
- ALL writes use ABSOLUTE paths under WORKTREE_ROOT (incl. `.claude/worktrees/agent-<id>/`). NEVER the bare main root.
- **S126 — apply edits via Bash** (`perl`/`python`/heredoc on worktree-absolute paths); echo the target path; re-verify via `git -C "$WORKTREE_ROOT" diff` after. The Edit/Write tools have leaked to MAIN (S126 #12/#13).
- **NEVER `cd` into the main repo.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.
- First commit message includes verbatim `pwd`: `WIP(each-sigil): start at <pwd>`.

# COMMIT DISCIPLINE (S83)
- Commit per logical step. Update `"$WORKTREE_ROOT"/docs/changes/native-each-contextual-sigil-2026-06-04/progress.md` after each step.
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status` clean.
- **NEVER `--no-verify`** without explicit authorization.

---

# PHASE 3 — EMPIRICAL VERIFICATION (S138 — MANDATORY)
Re-compile the contextual-sigil each shapes under BOTH parsers; they must now match:
```
mkdir -p /tmp/sigil-verify && cd /tmp/sigil-verify
# fixtures: each-empty (<li>${@.name}</li> + <empty>), of-count (<each of=N><li>${@.}</li>), chain (<li>${@.foo.bar}</li>), plus a control with a real bare-variant .Idle in a match (must NOT regress)
for fx in empty of-count chain barevariant-control; do
  bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/sigil-verify/$fx.scrml --parser=scrml-native --output-dir /tmp/sigil-verify/native/$fx > /tmp/sigil-verify/native-$fx.log 2>&1
  bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/sigil-verify/$fx.scrml --output-dir /tmp/sigil-verify/default/$fx > /tmp/sigil-verify/default-$fx.log 2>&1
  diff <native-client.js> <default-client.js>   # expect byte-identical OR id-offset-only
done
```
MUST pass:
- `${@.name}` / `${@.}` / `${@.foo.bar}` now emit the iter-var-resolved text under native (was dropped/malformed); native client.js byte-identical or id-offset-equivalent to default.
- **ALL 8 #2f each shapes** now byte-identical/equivalent native-vs-default (the 5 prior + as-name + key + these contextual-sigil ones). Re-run the prior shapes too.
- The real bare-variant control (`.Idle` etc., no `@`) UNCHANGED — no regression.
- `node --check` exit 0 on every emitted client.js.
**DO NOT mark DONE without Phase 3 passing.** Report per-shape verdict.

# WITHIN-NODE PARITY (S125)
This CHANGES the native AST for `@.`-bearing each files (BareVariant `.name` → faithful `@.name` ident) — should REDUCE divergence vs legacy (KIND-NAME/FIELD-SHAPE). Run `bun test "$WORKTREE_ROOT"/compiler/tests/parser-conformance-within-node.test.js`. If the allowlist baseline changes, it should be REDUCTIONS — rebump + report the delta + direction. Do NOT mask an INCREASE without explaining.

# TEST GATE
- New conformance test: `@.name`/`@.`/`@.foo.bar` lex to the faithful token + produce `ident{name:"@.name"}`-shaped exprNode; `.Idle`/`.Loading` (no `@`) STILL bare-variant (regression guard).
- **happy-dom each-render CANARY (S140/S152 blind-spot):** the unit each-tests are emit-string-only. Add a test that loads the emitted client.js of a `${@.name}` each in a REAL DOM (happy-dom, like `each-block` browser tests) and asserts the per-item text renders the field value — emit-string parity alone has historically masked render bugs.
- Full pre-commit gate 0 fail on every commit. Report final pass/skip/fail.

---

# FINAL REPORT (raw, for PA file-delta landing)
- Maps feedback line.
- WORKTREE_PATH, FINAL_SHA, branch, FILES_TOUCHED (expect lex-in-code.js + lex-in-code.scrml + maybe translate-expr.js + tests + progress).
- The lexer/bridge shape landed + confirmation the exprNode is `ident{name:"@.name"}` (or whatever you produced) + that emitStringFromTree round-trips it.
- Phase 3: per-shape verdict (all 8 #2f shapes + the bare-variant regression control).
- within-node parity: GREEN + allowlist delta/direction (reduction expected).
- happy-dom canary: pass.
- Test counts: added + full-suite pass/skip/fail + bare-variant 0-regression.
- Any surprise / residual.
- `git -C "$WORKTREE_ROOT" status` clean at report time.

Scope: native-parser lexer (`lex-in-code.js`/`.scrml`) + bridge (`translate-expr.js`) + tests ONLY. NO codegen / emit-each / SPEC changes. If the fix appears to need a new ExprKind or a codegen change, STOP and report the coupling.
