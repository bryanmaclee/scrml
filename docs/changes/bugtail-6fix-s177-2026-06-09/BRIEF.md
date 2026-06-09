# DISPATCH BRIEF — bug-tail 6-fix batch (S177, 2026-06-09)

You are fixing **6 confirmed compiler bugs** in the scrmlTS compiler. Each was empirically re-verified
on HEAD `0aa54fc2` during an R26 reverse-direction triage — the root locus, a minimal reproducer, and
the recommended fix are GIVEN below for each. Do NOT re-investigate from scratch; verify the root at
the named locus, implement the surgical fix, and prove it with the reproducer + a regression test.

Change-id: `bugtail-6fix-s177-2026-06-09`. Progress file: `docs/changes/bugtail-6fix-s177-2026-06-09/progress.md`.

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The
§"Task-Shape Routing" section tells you which additional maps to consult — this task is a
**compiler-source bug fix** (multiple loci: block-splitter, ast-builder, type-system, codegen/rewrite,
symbol-table). Follow that routing.

Map currency: maps reflect HEAD `35172d78` as of 2026-06-09 (1 commit behind the true HEAD `0aa54fc2`,
which is a docs-only wrap commit — no source drift). Treat map content as a starting hypothesis to
verify via grep/Read against current source.

Feedback: in your final report, include either "Maps consulted: [list]; load-bearing finding: <one
sentence>" or "Maps consulted but not load-bearing — [which map you expected to help but didn't]."

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is the output of `pwd` at startup. The path-discipline leak class has bitten this
project repeatedly (S42/S58/S88/S90/S99/S126; and S176 surfaced that the PreToolUse hook does NOT
catch Bash writes). Follow this exactly.

## Startup verification (BEFORE any other tool call)
1. Run `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.
   If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is
   the S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `git merge main` (or confirm your base is current HEAD `0aa54fc2`) — mid-session worktrees can branch
   stale (S112). If your base predates `0aa54fc2`, merge main before starting.
5. `bun install` — worktrees do NOT inherit node_modules; the pre-commit hook's `bun test` fails with
   "cannot find package 'acorn'" otherwise.
6. `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; empty in fresh
   worktrees → ~130 browser-test failures without it).

## Path discipline (EVERY edit) — S126 Bash-edit mitigation IN FORCE
- Apply ALL file edits via **Bash** (`perl -0pi`, `python3`, heredoc, `cp`) on **worktree-absolute
  paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools, and NOT
  bare `/home/bryan-maclee/scrmlMaster/scrmlTS/...` main-absolute paths. Echo the target path before
  each write; re-verify with `git diff` / `grep` after. (S176: the hook does NOT catch Bash writes, so
  self-enforce the worktree-absolute prefix on every Bash write — a main-absolute Bash write leaks
  silently.)
- NEVER `cd` into the main repo or anywhere else. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd
  "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively (S126 incident #14/#15).
- First commit message MUST embed your startup `pwd`: e.g. `WIP(bugtail): start at <pwd>`.

If you are about to write to a path NOT starting with WORKTREE_ROOT, STOP and re-derive from WORKTREE_ROOT.

## Crash recovery
Commit after EACH bug fix (don't batch) — `git add <files> && git commit`. Update
`progress.md` after each step (append-only, timestamped). Before reporting DONE, `git status` MUST be
clean. "work in worktree, no commits" is NOT an acceptable terminal report (S83).

---

# SCOPE CONSTRAINTS (read before touching anything)

1. **These are LIVE-pipeline fixes** (`block-splitter.js`, `ast-builder.js`, `type-system.ts`,
   `codegen/rewrite.ts`, `symbol-table.ts` — the default Acorn-backed front-end). The
   `compiler/native-parser/**` + `.scrml` mirrors are FEATURE-STALE (they replace this front-end
   wholesale under charter-B; S115 lockstep is moot for live-path fixes per S162). **Do NOT sync any
   `.scrml` mirror** for these fixes. If you find an analogous native-parser locus, note it in the
   report but do NOT edit it.
2. **Each fix is SURGICAL at the named locus.** Do NOT refactor adjacent code, do NOT "improve" nearby
   logic, do NOT widen scope. Preserve every currently-guarded behavior (each bug below names the
   behavior you must NOT break).
3. **Do NOT touch `docs/known-gaps.md`** — the PA owns the gap re-marking; you fix code + add tests only.
4. **Parser-shape canary:** bugs 74/4/48 touch `block-splitter.js`/`ast-builder.js`. After those, run
   `bun test compiler/tests/parser-conformance-within-node.test.js`. If it fails ONLY because the parser
   SHAPE changed (within-node allowlist drift), rebump `compiler/tests/parser-conformance-within-node-allowlist.json`
   per the established procedure and note the rebump + its justification in the report. If it fails for
   any OTHER reason, that is a regression — fix it or STOP and report.
5. **Acceptance gate per fix (S138 R26 forward-direction):** the GIVEN reproducer must now produce the
   CORRECT outcome (named per-bug below), AND you add a regression test (mirror the nearest existing
   test file's style), AND the pre-commit subset (`bun test compiler/tests/unit compiler/tests/integration
   compiler/tests/conformance`) stays green. Before final DONE, run the FULL `bun run test` suite and
   report pass/skip/fail.

---

# THE 6 BUGS

## Bug 1 — bug-74 (LOW) — `/>` + `:`-shorthand should fire E-CLOSER-001, not swallow the body
**Root:** `compiler/src/block-splitter.js:2558` — gate `if (shorthand && !selfClosing)` lets `selfClosing`
win whenever `/>` co-occurs with a detected `:`-shorthand; control falls to the self-closing-leaf branch
(~:2589) which SWALLOWS the `:`-shorthand body and never emits E-CLOSER-001. The comment block at
~:2551-2557 intentionally lets `selfClosing` win to avoid mis-reading the `:let={...}/>` directive-prefix
case — your fix MUST preserve that guard (do NOT regress `:let.../>`).
**Reproducer (writes `<span @thing />` swallowing the body today):**
```scrml
<program>
  <thing> = "hello"
<div class="container">
  <span :@thing />
</>
</program>
```
**Today:** exit 0, WRONG `W-DG-002 @thing never consumed`, emitted HTML has a bogus `<span @thing />`.
**Fix:** at :2558, when `shorthand && selfClosing` is a GENUINE `/>` alongside a recognized `:`-shorthand
body (distinct from the `:let.../>` directive-prefix the comment guards), emit **E-CLOSER-001** (per
SPEC §4.14:987 — "closer present on `:`-shorthand body — choose one form"). NOTE: confirm E-CLOSER-001
exists as a fireable code in the LIVE `compiler/src/` pipeline; the triage agent noted it currently
exists only in `compiler/native-parser/` — if it is NOT wired in the live pipeline, wire the diagnostic
(add the §34 catalog row if missing, mirror an adjacent BS-stage error emit).
**Correct outcome:** the reproducer fires E-CLOSER-001 (a clean, actionable error). Canonical
`<span :@thing>` (no `/>`) MUST still compile clean.

## Bug 2 — bug-4 (LOW) — trailing literal `/` before a tag false-fires E-SYNTAX-050
**Root:** `compiler/src/block-splitter.js:2898` — `const looksLikeCloser = nextNonWs === "" || nextNonWs === "<";`
The `nextNonWs === "<"` arm false-positives: a literal `/` in markup text whose next non-ws char is `<`
(an opener like `</>` or `<li>`) is mis-read as a legacy element closer. (The `?{` half was closed
S108/S109 `204b5633`; this slash recognizer was explicitly left in place.)
**Reproducer:**
```scrml
<program>
  <article class="prose">
    <ul>
      <li>The values "" / 0 / [] are all defined /</>
      <li>second item</>
    </ul>
  </article>
</program>
```
**Today:** exit 1, false `E-SYNTAX-050` at the trailing `/` before `</>`.
**Fix:** require the next-non-ws `<` to be an ACTUAL closer pattern (`</` or `</>`), not any `<`. Single-
branch change. This MUST KEEP the legitimate E-SYNTAX-050 for a real bare-closer like `<p>hi/</p>`
(a `/` immediately before `</p>` is still… actually verify: the spec'd diagnostic is for a bare `/` used
AS a closer — `<p>hi /` then `</p>`; ensure your refined predicate still fires E-SYNTAX-050 for the
genuine bare-`/`-as-closer shape and only suppresses the literal-`/`-then-opener-tag false positive).
**Correct outcome:** the reproducer compiles clean (the `/` is text); a genuine bare-`/`-closer still
fires E-SYNTAX-050. Add regression tests for BOTH directions.

## Bug 3 — bug-48 (LOW) — inline `=>` arrow in `<match>`/`<engine>`/`<machine>` opener truncates
**Root:** three opener-finder functions lack the `parenDepth`+`bracketDepth` tracking that the fixed
`_findEachOpenerEnd` (`ast-builder.js:12136`) already has: `_findMatchOpenerEnd` (~:11959),
`_findOpenerEnd` for `<machine>`/`<engine>` (~:12757), and the second `_findMatchOpenerEnd` (~:13184).
They scan braces+quotes only, so a `>` inside an `=>` arrow in an `on=`/attribute expression is read as
the opener's closing `>`, truncating the header.
**Reproducer:**
```scrml
<div>
    ${
        type Phase:enum = { Idle, Loading, Ready }
        <nums>: list of int = []
        <phase>: Phase = .Idle
    }
    <h1>Loader</h1>
    <match for=Phase on=@nums.filter(c => c == 1)>
        <Idle><p data-arm="idle">Press to load</p></>
        <Loading><p data-arm="loading">Loading now</p></>
        <Ready><p data-arm="ready">All set</p></>
        <_><p data-arm="fallback">Something else</p></>
    </match>
</div>
```
**Today:** exit 1, `E-CODEGEN-INVALID-JS` — header truncated at `@nums.filter(c =`.
**Fix:** mechanical port of the `_findEachOpenerEnd` parenDepth+bracketDepth pattern to the three
siblings (~30L). Keep behavior identical for all currently-passing openers.
**Correct outcome:** the reproducer compiles clean; the `<match on=...>` arrow is preserved. Add a
regression test exercising an arrow in a `<match>` opener AND an `<engine>`/`<machine>` opener.

## Bug 4 — r28-7b (LOW) — predicated primitive base inside a `| not` union loses recovery
**Root:** `compiler/src/type-system.ts:15559-15576` — the `[asIs, not]` conflict-case recovery block only
calls `_schemaForRecoverEnumSubset` (needs an `oneOf`/`notIn` head; returns null for a predicated
primitive base like `string req length(<=200)`). The non-`not` member stays `asIs`, then
`classifyFieldForSql` maps `[asIs, not]` → no-mapping → bogus `E-SCHEMAFOR-NO-SQL-MAPPING`. A leading-
primitive-token recovery exists at :15532-15537 but ONLY for the whole-field-`asIs` case, not the
`[asIs, not]` union-member case.
**Reproducer:**
```scrml
${
  import { schemaFor } from 'scrml:data'
  type Profile:struct = {
    name: string req length(>=2, <=80)
    bio:  string req length(<=200) | not
  }
}
<program db="./db.sqlite">
  <schema>
    ${ schemaFor(Profile) }
  </>
</program>
```
**Today:** exit 1, `E-SCHEMAFOR-NO-SQL-MAPPING` on `bio`. (Control `bio: string | not` — no predicate —
works clean.)
**Fix:** in the :15568 conflict-case block, when `_schemaForRecoverEnumSubset` returns null, fall back to
recovering the leading primitive token from the raw clause's non-`not` portion (mirror :15532-15537) and
re-synthesize `[resolvedPrimitive, not]` so it rides the existing nullable path.
**Correct outcome:** `bio` lowers to a nullable `bio TEXT` column (base T's column WITHOUT NOT NULL/req,
per §41.15.8a) — same as the working `string | not` control but with the predicate's CHECK constraints
applied. Verify the emitted DDL is correct; add a regression test.

## Bug 5 — s169-map-inline-insert (LOW) — inline `onclick=${@m = @m.insert(...)}` RHS not lowered
**Root:** `compiler/src/codegen/rewrite.ts:2025-2028` (`rewriteReactiveAssign`) re-emits the assign RHS
VERBATIM in `_scrml_reactive_set("<var>", <rhs>)` — no `emitExpr`/map-method lowering, and `mapVarNames`
is never threaded into `rewrite.ts`. Routing cause: `codegen/emit-event-wiring.ts:480` excludes
`exprNode.kind === "assign"` from the emitExpr path, sending inline map-assign handlers to the string
pipeline. Result: `@m.insert(k,v)` emits a bare `.insert(...)` call on the map object — but the runtime
map is a plain `{entries,ordered,order}` with NO `.insert` method (insert is the free fn
`_scrml_map_insert(m,k,v)`), so it's a runtime TypeError on click.
**Reproducer:**
```scrml
<div class="fare-board">
    ${
        <fareByLane>: [string: int] = ["DAL-001": 4500]
    }
    <h1>Fares by lane</>
    <p>DAL-001: ${@fareByLane["DAL-001"]}</>
    <button onclick=${@fareByLane = @fareByLane.insert("HOU-002", 3800)}>Add HOU-002</>
</div>
```
**Today:** exit 0, emitted handler `..set("fareByLane", get("fareByLane").insert("HOU-002",3800))` —
bare `.insert` (TypeError at click). Control: named-fn handler emits the correct
`_scrml_map_insert(get("fareByLane"), "HOU-002", 3800)`.
**Fix:** thread `mapVarNames` into `rewriteReactiveAssign` and re-parse the `=` RHS through `emitExpr` for
the assign case (so the map-method lowering that the named-fn path already does, applies to the inline
path too). Match the named-fn handler's emitted shape EXACTLY (the control output is the target).
**Correct outcome:** the inline handler emits `_scrml_map_insert(_scrml_reactive_get("fareByLane"),
"HOU-002", 3800)` (byte-identical to the named-fn control). Add a regression test that the inline
map-assign handler emits `_scrml_map_insert`.

## Bug 6 — r27-c6 (MED, medium) — formFor synth-cell unresolvable when nested in an engine state-child
**Root:** `compiler/src/symbol-table.ts:88-93` (B1 scope walker) constructs only "file"/"function"/
"compound" scopes and does NOT walk engine state-children ("engine + component scope construction defers
to B14+/B17+"). B11/B12 register the formFor validity-surface synth cell (`newExpense` + `.isValid`/
`.errors`/…) via the `_scope` back-pointer, but no engine-state-child scope exists for it to land in /
be looked up from. E-SCOPE-001 for the `bind:value` path fires from `type-system.ts` (one of the 5
E-SCOPE-001 sites).
**Reproducer (E-SCOPE-001 ONLY when nested in the engine; top-level identical formFor works clean):**
```scrml
${
    import { formFor } from 'scrml:data'
    type ExpenseCategory:enum = { Travel, Meals, Lodging, Supplies, Other }
    type ReportStatus:enum = { Draft, Submitted, Approved }
    type NewExpense:struct = { merchant: string req length(>=2), category: ExpenseCategory req }
}
<program>
    <engine for=ReportStatus initial=.Draft>
        <Draft rule=.Submitted>
            <h2>Draft</h2>
            <formFor for=NewExpense onsubmit=${} pick=["merchant", "category"]>
                <slot name="category">
                    <select bind:value=@newExpense.category>
                        <option value="Travel">Travel</option>
                    </select>
                </slot>
            </formFor>
        </>
        <Submitted rule=.Approved><h2>Submitted</h2></>
        <Approved><h2>Approved</h2></>
    </engine>
</program>
```
**Today:** nested → exit 1, `E-SCOPE-001 @newExpense ... cannot be resolved`. Top-level control → exit 0.
**Fix (two viable approaches — pick the one with the smaller blast radius after reading the code):**
(a) extend the B1 walker to construct engine-state-child scopes; OR
(b) have B11/B12 register the formFor synth cell into the enclosing engine-state-child's scope when the
formFor's owning markup ancestor is an engine state-child.
This is the MEDIUM-effort fix — be careful not to regress the 5 E-SCOPE-001 sites or the existing
state-child SYM walkers (B14/B15/B17). Run the full engine + formFor test suites.
**Correct outcome:** the nested reproducer compiles clean (same as the top-level control); `bind:value=
@newExpense.category` resolves inside the engine state-child. Add a regression test for the nested case.

---

# FINAL REPORT (return all of this)
- WORKTREE_PATH (your `pwd`), FINAL_SHA (branch tip), BRANCH name.
- FILES_TOUCHED (every file, worktree-absolute).
- Per bug (74/4/48/r28-7b/s169/r27-c6): root confirmed Y/N · fix summary · the reproducer's NEW outcome
  (paste the actual compile result) · regression test file + count.
- Parser-shape canary: did `parser-conformance-within-node.test.js` pass? If you rebumped the allowlist,
  state why.
- Full `bun run test`: pass / skip / fail counts.
- Any bug you could NOT fix surgically (with the reason) — do NOT force a broad fix; report and defer.
- Maps feedback line.
- Confirm `git status` clean + each fix committed separately.
