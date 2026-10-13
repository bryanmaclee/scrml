# BRIEF — s464-pure-fn-placement (dispatched by S464 PA, 2026-10-12). change-id: s464-pure-fn-placement

## Symptom (PA-reproduced on main 3cebd3387+, by compile)
A pure `fn` whose result is bound to a `const` inside a server-placed function becomes ITS OWN public server route, with a client fetch stub, and is emitted `async` on the server. Bound inline instead, it is not:
```
<program db="./x.db">
${
  type E:enum = { Bad }
  type L:struct = { q: int }
  fn dbl(n: int) -> int { return n * 2 }
  function save(n: int) { const t = dbl(n)
    ?{`INSERT INTO t (v) VALUES (${t})`}.run() }
  function go() { save(@n) }
}
<n> = 3
<button onclick=go()>s</button>
</program>
```
`bun compiler/bin/scrml.js compile x.scrml --output-dir out` → client JS references `__ri_route_dbl_1` AND `__ri_route_save_2`. Replace `const t = dbl(n)` + `${t}` with `${dbl(n)}` → only `__ri_route_save_1`. In a larger demo (a cart: `fn lineTotal`, `fn subtotal` with `.reduce`, `fn tax` with `scrml:math` `round`, `fn total`, all called only from a failable server `function checkout`), `subtotal`/`tax`/`total` each became routes and the server emitted `async function tax`, `async function total`, `async function subtotal`. Full demo source: `/home/bryan-maclee/.cache/purity-demo/shop.scrml` (read-only; copy into your .tmp).

## Why it matters (owner's framing, S464): "imagine if the color of your functions told you something real about your program." `fn` = pure: same input → same answer, touches nothing. A pure function has no reason to be a network call, an HTTP endpoint (public attack surface), or async. Placement must not depend on whether a result is bound to a `const`.

## Work
1. GOVERNING-SENTENCE GATE FIRST: read SPEC §12 (route inference), §48 (`fn` — incl. §48.11 and any placement text), §33, §13.2, and the `server fn` text (a `server fn` is the explicit pin: "pins a pure helper to the server"). Quote the sentence(s) that decide where a non-`server` `fn` is placed. If a sentence already says (or clearly implies) a plain `fn` is never escalated to its own route / never async → this is a conformance fix; proceed. If NO sentence decides it → STOP before changing behaviour and report: the searched sections, the proposed SPEC sentence (e.g. "A plain `fn` is placed wherever it is called — it is emitted into every bundle that calls it, it is never a route, and it is never async; only `server fn` pins a pure helper to the server"), and the measured corpus impact. The owner rules.
2. Root cause in route inference (`compiler/src/route-inference.ts`, PA-located-verify — the symptom is the evidence): why does binding the result to a `const` escalate the callee? Fix at the root, not the `const` position: a non-`server` `fn` never gets a route and is never coloured async; it is emitted into each side that calls it (client and/or server). `server fn` keeps its pin.
3. Tests: the repro, the inline/const pair (same placement), the shop demo (no `fn` routes, no `async function` for any `fn`), `server fn` still routed, an `fn` called from both sides emitted on both. Each new test fails without the fix.
4. Corpus emit differential vs origin/main (repo + `/home/bryan-maclee/scrmlMaster/{giti,flogence}` read-only): report every artifact change (routes removed = expected; anything else explained).
5. ⚑ Another queued branch (the CPS placement fix, `wip/s464-p0-cps-r1`) also edits route-inference.ts; keep your change minimal and localized and name the functions you touched in the report.

## Rules (all dispatches)
- Commit after each change (WIP commits fine); append timestamped lines to `docs/changes/s464-pure-fn-placement/progress.md`. First commit: archive THIS brief verbatim as `docs/changes/s464-pure-fn-placement/BRIEF.md`, message `WIP(s464-pure-fn-placement): start at $(pwd)`. Push branch `s464-pure-fn-placement` at least once mid-way and at the end.
- Any surface change carries a `> **Provenance:**` line at the amended SPEC section.
- Generated docs (`docs/known-gaps.md` §0, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/bootstrap-conformance.md`): regenerate with their scripts, never hand-edit. `git merge origin/main` before your final push.
- Keep tool output small. Scratch in `<worktree>/.tmp/`; TMPDIR=~/.cache/scrml-agent-tmp/s464-pure-fn-placement/ per command; delete .tmp before reporting. Never `git stash`; never a bare `pkill -f`/`killall`; never `--no-verify`. Do NOT open or merge a PR.
- MAPS: `.claude/maps/primary.map.md` (stamp 41af4153a — a hypothesis). Report whether load-bearing.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incidents so far this session: 0)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` must equal it; tree clean. If not → STOP and report.
2. `bun install`, then `bun run pretest` from the worktree CWD (NOT `bun --cwd <path> run`).
3. Every Read/Edit/Write uses an absolute path UNDER your worktree. Never write to `/home/bryan-maclee/scrmlMaster/scrml/<anything not under .claude/worktrees/agent-…>`. Never `cd` into the main checkout; use `git -C <worktree>`.

## Final report
Worktree path, final SHA, branch pushed, governing sentence (or the STOP report), root cause, files/functions touched, corpus differential, tests before/after, deferred items.
