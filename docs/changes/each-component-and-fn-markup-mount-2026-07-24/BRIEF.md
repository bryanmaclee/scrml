# BRIEF — #161 `g-each-component-and-fn-markup-not-mounted` (HIGH, silent codegen)

**Dispatched:** S284, 2026-07-24 · base `origin/main` `867971bd` · agent `scrml-js-codegen-engineer` (opus, isolation:worktree) · PARALLEL with the #162 fix (disjoint files — that agent owns `ast-builder.js`/parser-diagnostics/lexer; you own `emit-each.ts`/component/runtime).
**Change-id:** `each-component-and-fn-markup-mount-2026-07-24` · **Adopter issue:** GH #161 (pjoliver11) · **Gap:** `g-each-component-and-fn-markup-not-mounted`

---

## TASK — direction is "make it render" (LOWER-IT), not a ruling

Inside `<each>`, two documented markup-reuse mechanisms silently fail — both work OUTSIDE `<each>`:
- **(A) `<Component/>` in `<each>` renders NOTHING** — the component is never instantiated.
- **(B) `${fnReturningMarkup()}` in `<each>` emits the literal text `[object HTMLSpanElement]`** — the returned DOM node is stringified instead of mounted.

Clean build, 0 errors, NO warning for either. This is a **codegen completeness gap** in the per-item template, NOT a spec-ambiguity — the fix MAKES THEM RENDER. Governing principle (Rule 4): **Pillar 1** (markup is a first-class value — it renders wherever it lands) + **Pillar 5** (every body accepts the universal scrml grammar; the `<each>` per-item template is not a degraded subset) + the empirical fact that both render correctly OUTSIDE `<each>`. No widen/reject question here.

## CONFIRMED SYMPTOM (findings — PA-reproduced on `f28c35fb` via codegen inspection + matching the reporter's real-Firefox DOM verification)

Repro:
```scrml
const Row = <div class="row" props={ name: string }>
    <span class="n">${name}</span>
</div>

<items> = [{ k: "a", name: "Ada" }, { k: "b", name: "Bo" }]

${
    function rowMarkup(n) { return <span class="fn">${n}</span> }
}

<h1>component-in-each repro</h1>
<div id="c1"><each in=@items as it key=@.k><span class="plain">${it.name}</span></each></div>
<div id="c2"><each in=@items as it key=@.k><Row name=it.name /></each></div>
<div id="c3"><each in=@items as it><Row name="literal" /></each></div>
<div id="c4"><Row name="outside-each" /></div>
<div id="c5"><each in=@items as it key=@.k>${rowMarkup(it.name)}</each></div>
<div id="c6">${rowMarkup("outside")}</div>
```
Expected (real DOM): c1 → 2 `.plain`; c2 → 2 `.row` with names Ada/Bo; c3 → 2 `.row` name "literal"; c4 → 1 `.row`; c5 → 2 `.fn` with names Ada/Bo; c6 → 1 `.fn`.
Actual TODAY: **c2/c3 render nothing** (no `.row`); **c5 renders the text `[object HTMLSpanElement]`** (no `.fn`); c1/c4/c6 correct.

## MECHANISM (HYPOTHESIS — you VERIFY the exact loci; do not trust blindly)

Both loci are in `compiler/src/codegen/emit-each.ts` (the per-item template emitter). `emit-each.ts` currently imports NO component machinery.

- **(A) component-in-each — locus ~749-778 "Markup node — render via createElement".** It emits `document.createElement(JSON.stringify(tagName))` for EVERY markup child tag, including a PascalCase component (`Row` → a literal unknown `<row>` element; template never expanded, prop never bound). The fix must DETECT a user-component tag and INSTANTIATE the component per-item. `component-expander.ts` exports `isUserComponentMarkup(node)` (the predicate) + `runCE`/`runCEFile` (the expansion entry points the NON-each path uses). **THE HARD PART:** a component inside `<each>` is a PER-ITEM instance with a runtime-bound prop (`name=it.name` reads the iteration variable `it`). So this is NOT just "call the expander at compile-time" — you must compose component instantiation with the per-item RUNTIME scope. Survey how the non-each path emits a component instance (its DOM-construction + prop-binding shape) and how to reproduce it inside the per-item render fn with `it`-scoped props. This is the substantive part of the fix.
- **(B) fn-markup-in-each — locus ~685 `${indent}${_tnVar}.textContent = String(${rewritten});`.** A markup-valued interpolation result (a DOM node) is `String()`-ed into textContent → `[object HTMLSpanElement]`. **The correct guard ALREADY EXISTS in this same file at ~589:** `if (val instanceof Node) wrap.appendChild(val); else if (val != null && val !== "") wrap.appendChild(document.createTextNode(String(val)));`. Apply that same mount-or-text guard to the ~685 interpolation path (and any sibling interpolation path in emit-each that assigns `textContent = String(...)` for a `${expr}` whose value could be markup). Near-trivial relative to (A).

## SCOPE + SEQUENCING

- (B) is near-trivial (reuse the existing `:589` guard). (A) is the substantive change.
- If (A) cannot be done CLEANLY in one dispatch (per-item component instantiation is genuinely deep), land (B) + a SURVEY.md scoping (A) precisely (the exact non-each component-emit shape, what runtime helper a per-item mount needs) rather than shipping a half-working component-per-item. State the call in `progress.md`. Prefer landing BOTH if (A) is tractable.
- Peter also reported a `snippet` prop rendering nothing EVEN OUTSIDE `<each>` — **do NOT chase it** (separate issue, he offered to split it out). Note it in `progress.md` only if it folds into your fix trivially; otherwise leave it.

## VERIFICATION BAR — EXECUTE THE BUNDLE, do not grep emitted text (S265)

Peter explicitly noted: "in a previous report the codegen looked correct while the render was not." A "renders nothing" bug is INVISIBLE to emitted-text inspection. So your empirical verify MUST **execute the compiled bundle in a real (or happy-dom) DOM** and count nodes — NOT grep the `.client.js`.

1. **DOM verification of the repro:** build + serve (`bun compiler/bin/scrml.js build . --output out && cp out/app.html out/index.html && PORT=<free> bun out/_server.js`) OR a happy-dom harness — then assert via `document.querySelectorAll`: `#c2 .row` == 2 (names Ada/Bo), `#c3 .row` == 2, `#c5 .fn` == 2 (names Ada/Bo), and NO `[object HTMLSpanElement]` text anywhere.
2. **Controls STILL work:** `#c1 .plain` == 2, `#c4 .row` == 1, `#c6 .fn` == 1.
3. **Full suite green:** `bun run test` — 0 new failures (report numbers). Watch for golden-file / e2e-render-map baseline changes (each codegen touches them) — if a baseline legitimately changes, regenerate + note it; if it's a shared baseline the #162 agent might also touch, flag it for the PA to 3-way-merge at land.
4. **R26:** recompile at least one real adopter each-using source (`scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`) post-fix; confirm no regression.
5. Unit test(s): component-in-each renders + binds a per-item prop; fn-markup-in-each mounts (not stringifies); the controls stay green. Put them where each-block codegen tests live (`compiler/tests/unit/each-block.test.js` or a new sibling).

Do NOT mark DONE without executed-DOM evidence for 1-2. The PA runs an independent adversarial `/code-review high` + its OWN DOM R26 on your branch before landing (S239 gate).

## F4 — CRITICAL STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST)

`[PATH-DISCIPLINE INCIDENT COUNTER: 0]`
1. **Confirm isolation.** `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` MUST equal that worktree root. If either is the shared checkout `/home/bryan-maclee/scrmlMaster/scrml`, STOP and report — do not write.
2. **Clean tree** (`git status --short` empty); note branch + base SHA.
3. **Deps + fixtures:** `bun install` (worktrees don't inherit `node_modules`). `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`). A fresh worktree also lacks gitignored `dist/` — symlink from main for browser tests. Use `bun run test` (chains pretest) for the baseline.
4. **Every write uses a worktree-ABSOLUTE path under the worktree root.** Never a relative path, never a main-rooted `/home/bryan-maclee/scrmlMaster/scrml/...` path. Never `cd` into the shared checkout — use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`.
5. **First commit:** `WIP(each-markup-mount): start at $(pwd)`.

## CRASH-RECOVERY (mandatory)

Commit after EACH meaningful change (WIP commits expected — the branch is the checkpoint). Append-only timestamped `progress.md`: what you did, what's next, blockers, and your survey (the non-each component-emit shape, the per-item-mount plan, whether (A) landed or is scoped, golden-file changes). If you die, branch + progress.md are the only recovery anchor.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first; follow Task-Shape Routing to the codegen maps. Map stamp `e8fdd44c` (~8 commits behind HEAD `867971bd`, low-risk S282 audits/test/SPEC). Treat map content as a verify-against-source HYPOTHESIS for anything you touch; report the load-bearing finding.

## REPORT ON DONE

Report: WORKTREE_PATH · final branch tip SHA · files-touched · the exact fix loci (file:line) for (A) and (B) · whether (A) landed or is scoped (with why) · the executed-DOM node counts for c1-c6 · full-suite numbers · golden-file changes (if any) · R26 result · deferred items. Your final text IS the return value — raw data, not a human-facing message.
