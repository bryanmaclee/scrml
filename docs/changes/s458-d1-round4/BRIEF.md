# BRIEF — s458-d1-round4 (D1 declared props: one scope model; the previous agent is out of context)

CHANGE-ID: `s458-d1-round4`. Agent: scrml-js-codegen-engineer, isolation worktree.
BASE: after the F4 checks, `git reset --hard 540bc7f1e` (tip of local branch `worktree-agent-ae6f33d76a517d33c`; confirm it starts with 540bc7f1e), then `git merge origin/main` (real 3-way merges; generated docs: take main's then regenerate by script), then your F4 step-3 BRIEF commit.

READ FIRST: `docs/changes/s458-declared-props-d1/progress.md` (rounds 1–3: what D1 is, why, what was built — `_callSiteProps`, `substituteExprText`, `component-prop-js-substitute.ts` `substitutePropsInJsSource`, the bind-only write rule, tokenizer `delim` / `exprSource`) and SPEC §15.10, §15.11.1, §15.13, §66.15. D1 (owner ruling): a declared component prop never reaches the root as a DOM attribute; prop values are substituted into the body STRUCTURALLY, respecting every scope/shadowing form; only a caller `bind:` makes a prop writable.

Round-3 differential review (base main c4eb2c589 vs 540bc7f1e) = DO-NOT-LAND. Root cause: there are TWO scope models — the structured logic-body walker (`substitutePropsInLogicStmt` in component-expander.ts) and the acorn JS substituter (`component-prop-js-substitute.ts`) — and they disagree. BOUNDARY for this round: ONE binding/scope model. Extract one function (e.g. `boundNamesOf(patternOrName)`) that returns every name a binding position binds (identifier, object/array destructuring incl. nested, defaults, rest, params), and make BOTH paths use the same scope rules; better still, route the structured path's shadow bookkeeping through the same scope analysis the JS substituter uses. Fix:
F5 HIGH (new in this branch, silent): destructured locals named like a `bind` prop write the parent's cell — with `props={ bind n: number }`, `<C bind:n=@v/>`, `<v> = 7`: `let { n } = { n: 1 }; n = 100` → emits `_scrml_cs_reactive_set("v", 100)`; `let [n] = [1]; n++`; `function f({ n }) { n = 50 }`; `for (let [k, n] of [[1,2]]) { n = 77 }` — all write `@v`. Cause: the let/const-decl case does `shadowed.add(n.name)` but `name` can be a DestructurePattern (types/ast.ts ~450); the for-stmt `variable` likewise (~1052); destructured function-decl params too.
F3 (same root, pre-existing, silent wrong value): by-value `n=@v` — `const { n } = {n:1}; return n+1` gives 8 not 2; `const [n]`, `function f({ n })`, `f([n])`, `f(a, { n })`, `for (const [k, n] …)`, `for (const {n} of …)`, `for (const [n,m] …)` all read the caller's value; and `function f({ n }) { n = n + 1 }` is falsely refused E-ASSIGN-004.
F7 MED: `<each … as label>` inside a component with a prop `label` rewrites the loop variable (`(L, idx) => …` while the body keeps `label`) → ReferenceError at load, compiles clean. A binder is a declaration — never substitute it; it shadows the prop inside the each body.
F9 MED: `lift <li>${label}</li>` inside a component's logic block (bare, in `if`, in `for`) never substitutes the prop → ReferenceError at load. The `lift-expr` case returns markup targets unchanged ("handled by recursion" — it is not).
F1 MED: the acorn substituter cannot parse scrml operators (`is some`, `is not`, `not`), so `x => { return label is some }` / `if (label is not) …` in a block arrow (and in a `when` body) are refused with a misleading E-SCOPE-001 "could not parse…". Parse with the SAME parser front the expression parser uses for scrml-in-JS (its preprocessing / plugins for `is`/`not`/`@`/`::`/`.Variant`) — one parser for scrml expression text, then substitute on that tree.
F2 LOW: bare `for (n of xs)` is a binder in the structured path but an assignment target in the JS substituter (false E-ASSIGN-004 / `for(@v of …)` invalid JS) — falls out of the one scope model; decide per SPEC (§49/§50.8.5: a keywordless loop binder — quote it) and make both paths agree.
F4 LOW: unquoted `title=${label + 'it\'s'}` / `${label + "\"q"}` in a component body → E-COMPONENT-021 "Unterminated tag" (works outside a component); quoted `title="${label + "\\"}"` → E-SCOPE-001 on a truncated `label +`. Escapes inside string literals in component attribute values must round-trip in every form.
N1 LOW: `bind:n=v` emits two contradictory E-ATTR-010 messages — one message, consistent with the `bind:n=@v.k` refusal.
Do NOT fix in this round (file as gaps with the reviewer's text, in your report): F6 `g-component-block-lambda-emits-empty-body` — any block arrow/function expression in a component body containing `< identifier` (even a LOCAL: `x < k`) prints as `{ /* block body */ }` (silent; HIGH; pre-existing, HEAD neither better nor worse); F8 destructured arrow param re-emitted from the parsed tree as `__destructured__` (pre-existing printer bug, also outside components); F10 props in `<match>` arm bodies inside a component → E-SCOPE-001 (loud, pre-existing); `function f(k = 2)` in a component loses its default (silent, pre-existing); `@out = risky() !{…}` in a component function emits `reactive_set("out", )`; `when @t changes` in component markup dropped. Two code choices remain the owner's: E-ASSIGN-004 for a body write to a non-bind prop; E-SCOPE-001 for unparseable text referencing a prop — keep them as they are.
Prove with executed conformance cases (happy-dom) for b1–b4 (F5), the F3 table, F7, F9, F1, F2, F4; re-run the round-3 cases; corpus emit differential base c4eb2c589 vs head (0 newly failing; every delta classified); full gates incl. browser tier. Report FINAL_SHA + gap texts.

[SHARED BLOCK FOLLOWS]
## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Base: `git fetch origin`; follow the BASE line of your brief exactly.
3. Your FIRST commit archives this entire prompt verbatim to `docs/changes/<CHANGE-ID>/BRIEF.md` with the message
   `WIP(<CHANGE-ID>): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/<CHANGE-ID>/progress.md` (append-only, timestamped) and append a pointer entry to `docs/changes/s458-declared-props-d1/progress.md`.
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
   The pre-commit hook runs the core suite (~4-8 min under load) — long timeout; never read a commit's success from a piped exit code, check `git log`. Before any full-suite run or commit, wait until `free -g | awk '/Mem/{print $7}'` ≥ 4 (poll every 30s, max 20 polls). A test failing only under load: re-run alone, retry, report.
   CONTEXT BUDGET: the previous agent ran out. Keep tool output small (pipe through tail/grep; never dump whole files or logs); past ~70% of your budget, commit, write a precise next step in progress.md, and report.
9. Do NOT edit PA-owned docs: `docs/known-gaps.md`, `docs/changelog.md`, `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. FACTS / SPEC-INDEX / bootstrap-conformance: regenerate by script only if their --check fails.
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first; follow its Task-Shape Routing; treat it as a hypothesis. Report which entry was load-bearing.

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative; quote the governing sentence in progress.md before changing behaviour.
- A locus named in this brief is a PA HYPOTHESIS; verify it.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Final report: worktree path · branch · FINAL_SHA · files touched · tests + results · empirical check output · direction-of-change with measurement · gap-entry text · anything deferred.
