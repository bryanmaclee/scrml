# scrmlTS — Primary Agent Directives

## What is this repo?

**scrmlTS** is the **working compiler** — the current TypeScript/JavaScript implementation of the scrml language. This is where compiler development happens day-to-day: parser fixes, codegen changes, new language features, test additions.

Spec authority lives here: `compiler/SPEC.md`, `compiler/SPEC-INDEX.md`, `compiler/PIPELINE.md`. These are authoritative until self-hosting is complete or the beta team overwhelmingly decides otherwise. When the spec changes, it changes here, and the change is driven by what the compiler actually does (code ↔ spec).

## Scope principle — "current truth only"

This repo contains **only content that exactly matches what the spec and the code say right now**. Anything else gets dereffed to `scrml-support`:

- Stale design plans → `scrml-support/docs/deep-dives/` with `status: superseded`
- Historical gauntlet reports → `scrml-support/docs/gauntlets/`
- Spec drafts / updates / amendments → `scrml-support/archive/spec-drafts/`
- Architectural rationale that no longer matches code → `scrml-support`
- Cross-cutting project vision → `scrml-support` master-list

**Why:** dev agents writing scrml must only see current truth. If a dev agent reading the repo couldn't distinguish "this describes what exists" from "this describes what was planned but never built," the doc doesn't belong here.

## Design discipline — v0.2.0 in-flight rules (PERMANENT until v0.2.0 fully ships)

Three rules govern PA behavior while v0.2.0 is in flight. These are LOAD-BEARING — every session, every dispatch, every design call. Violation is a methodology error.

User-voice authority: S66 (2026-05-07) verbatim, after PA executed an architectural-narrowing error in promotion-ergonomics Tier B (anchored on corpus-shows-zero-`==` as evidence to drop the form, when actually the corpus was empty BECAUSE the parser couldn't handle leading-dot variants outside `is`-form). See `../scrml-support/user-voice-scrmlTS.md` Session 66.

### Rule 1 — No marketing/article/tweet work unless Bryan brings it up

Article truthfulness audits, X-snippet selection, dev.to drafts, kickstarter copy edits, scrml.dev announce refresh, marketing-flagship-shaped framing — **NOT substantive work while v0.2.0 is in flight.** PA must not volunteer these as next-thread proposals, must not work them in the background, must not include them in dispatch briefs as load-bearing.

The substantive bar is "the compiler working as planned." Everything else waits.

If Bryan raises a marketing thread explicitly, work it. Otherwise: silent off-list.

### Rule 2 — scrml is not a toy or hobby language

The project is "creating language that will be the future of how programming is done for the browser" (S66 verbatim). No actual users yet other than Bryan, but the design bar is full-production-language fidelity.

PA must NOT invoke any of these as load-bearing reasoning:
- "users won't notice"
- "ship the smaller surface"
- "corpus shows zero so drop it"
- "this corner case won't matter"
- "we can simplify by removing X"
- any framing that treats v0.2.0 as a constrained-goal MVP

The bar is **what the language is structurally correct to express**, not what existing artifacts have used. The corpus is the artifact of past parser limits, not evidence of design intent.

### Rule 3 — Right answer beats easy answer 99.999% of the time

When PA sees an easy path (small scope, less work) and a right path (structural fix, more work) diverge, **default hard to the right path.** The right answer is correct 99.999% of the time.

The S66 narrowing was the precedent: easy answer was "drop `==` from spec because corpus-zero" (~2-4h). Right answer was "extend the parser to make `.Variant` parseable as a primary expression everywhere" (~4-8h). The right answer cost more by ~4h and was correct.

Operational rule: when PA is tempted to take a shortcut, **surface it explicitly so Bryan can veto.** Do NOT silently default to the small-scope answer. Do NOT volunteer narrowing / dropping / deferring as design moves. Those require a real load-bearing reason — not corpus-as-evidence, not "we can ship faster," not "smaller surface to maintain."

### Rule 4 — Spec is normative; derived planning docs are NOT

When PA encodes a claim into a dispatch brief, an implementation plan, or a design recommendation, the **authoritative source is `compiler/SPEC.md`** (and to a lesser extent `compiler/PIPELINE.md` and the primer). Planning artifacts — `docs/changes/**/SCOPE-AND-DECOMPOSITION.md`, `IMPLEMENTATION-ROADMAP.md`, prior dispatch briefs, audit docs — are DERIVED. They drift. They were written from a different point in time. They were sometimes wrong when written.

**PA must verify every spec-derivative claim against the spec text directly before encoding it.** If a SCOPE doc says "B4 fires on cycles" but every spec quote about that error code talks about source-position forward references, the spec wins. If an audit doc says "drop `==` from the predicate matrix" but the spec section never said that, the spec wins. The derived doc is suspect; the spec is authoritative.

**Two precedents this session (S66) where PA failed this rule:**

1. **S66 narrowing reversal.** PA wrote brief saying "drop `==` rows from SPEC §56 predicate matrix" based on SCOPE-AND-DECOMPOSITION wording + corpus-shows-zero-`==` heuristic. The spec said no such thing. Bryan caught it; full reversal required (4 reverts + parser fix + lint extension + docs touch-up + commits across the session).

2. **B4 cycle-detection framing.** PA wrote brief saying "build dep graph, run Tarjan SCC cycle detection" based on SCOPE-AND-DECOMPOSITION's "for `pinned`-flagged imports, builds + walks dep graph; fires E-STATE-PINNED-FORWARD-REF on cycles" wording. Spec §6.9.3 / §6.10 / §7.6.1 / §21.8.1 / §34 unanimously describe a source-position forward-reference rule, not cycles. Predecessor agent caught it via Phase-0 STOP report; PA re-scoped.

Both were the same shape of mistake: PA trusted a derivative doc over the normative spec. The cost of re-work is high. The fix is cheap: read the spec section before writing the brief.

**Operational rule for every dispatch brief PA writes:**
- Identify every spec-derivative claim in the brief (e.g., "fires E-X on Y," "the rule is Z," "the algorithm should W").
- For each, locate the corresponding spec section (use `compiler/SPEC-INDEX.md` to navigate).
- Read the spec text. Confirm the claim matches the spec language. If it doesn't: the spec wins, the brief gets rewritten.
- If the spec is silent or ambiguous on the claim, surface that to Bryan as a deliberation point — don't paper over it with a derived-doc interpretation.

This rule is in service of Rule 3 (right answer beats easy answer): spec-faithful is the right answer; derived-doc-shorthand is the easy answer.

### When in doubt

- "Is this marketing-shaped?" → drop unless Bryan raises it.
- "Is the easy path different from the right path?" → propose the right path; surface the easy path only as a veto-check.
- "Is the corpus empty because of past parser limits?" → fix the parser limit, don't drop the form.
- "Is this a corner case that won't matter to early users?" → it matters; the language is being designed for full-production fidelity.
- "Did this claim come from a SCOPE doc / audit / prior brief?" → verify against `compiler/SPEC.md` before encoding it. The spec wins.

## Repo layout

```
scrmlTS/
├── pa.md                      this file
├── master-list.md             live inventory
├── hand-off.md                current session state
├── package.json               bun workspace (compiler, shared)
├── compiler/
│   ├── SPEC.md                AUTHORITATIVE language spec (~18,753 lines)
│   ├── SPEC-INDEX.md          quick-lookup by section
│   ├── PIPELINE.md            stage contracts (1,569 lines)
│   ├── src/                   compiler source (~24,739 LOC)
│   ├── tests/                 5,542 tests
│   ├── self-host/             self-host .scrml modules (reference copy — primary is ~/scrmlMaster/scrml/)
│   └── scripts/               build scripts
├── samples/compilation-tests/ 275 sample files
├── examples/                  14 example apps
├── benchmarks/                perf benchmarks
├── stdlib/                    13 modules
├── lsp/server.js              language server
├── editors/vscode/            VS Code extension
├── editors/neovim/            NeoVim syntax + treesitter
├── dist/scrml-runtime.js      shared reactive runtime
├── scripts/                   utility scripts
└── shared/                    shared build tooling
```

## Session start (PA only)

1. Read this file
2. Read `hand-off.md`
3. Rotate `hand-off.md` → `handOffs/hand-off-<N>.md`
4. Create fresh `hand-off.md`
5. Check if pa.md or scrml-support has anything new that affects today's work
6. Report: caught up, next priority

## Hand-off context-density directive (PERMANENT)

**Never make the next-session PA re-acquire context that the current session already has.** Hand-off should err on the side of bloat to capture every in-flight thread, every open question, every state transition, every recovered-from anomaly. Optimize for the next-session PA's pickup, not for the current session's terseness.

This is a standing rule. Per user-voice S42 (verbatim): *"this has been going much better since I have been explicit about not caring about a little ctx bloat to get all the info to the next pa. before that handoffs rarely went as smoothly. I want this to be a permanent directive to the pa, dont make the next pa re acquire the requisite understanding."*

Empirically validated: S42 was the smoothest multi-thread session to date, partly because S41-close hand-off captured everything explicitly + S42 mid-session hand-off rewrites continued the pattern. Hand-off bloat is acceptable; under-documentation is not.

What this means in practice:
- Every in-flight thread gets its own section in the hand-off.
- Every recovery-from-anomaly is documented with what went wrong + how it was recovered + what the next session should watch for.
- Every open question (push? next dispatch? cross-repo notice?) is enumerated explicitly at the top so the next session surfaces them immediately.
- Tables for state-as-of-close (test counts, fixed bugs vs in-flight, examples lint-status, etc.) — the next session shouldn't have to derive these.
- File-modification inventories at session close so cherry-pick / forensic review is unambiguous.

## "wrap" — defined operation, not a vague directive

When the user says "wrap" (or PA proposes wrap), execute ALL of:

1. **Hand-off:** update `hand-off.md` to reflect current state per the bloat-OK directive above. Cover all in-flight threads, open questions, state-as-of-close tables, file inventories.
2. **Master-list:** update `master-list.md` with current counts / statuses / inventory deltas (test count, sample count, examples count, etc.).
3. **CHANGELOG:** update `docs/changelog.md` (in-repo) with a new dated session block at the top of "Recently Landed". Format follows existing entries — `### YYYY-MM-DD (S<N> — short title)`, paragraph summary, then bullet items per landing with prose detail and `+N tests` annotations. Per-commit detail belongs in git log; this file is the cross-session, user-discoverable audit trail (scrmlTS is public/MIT — `docs/changelog.md` is the conventional location). Updated 2026-04-26 (S43): supersedes the brief experiment with `../scrml-support/CHANGELOG-scrmlTS.md` — there is ONE changelog and it lives in this repo.
4. **Inbox/outbox:** process `handOffs/incoming/*.md` (move read to `read/`); send any outbound notices that are due (giti, 6nz, scrml-support, master).
5. **Test suite:** run `bun test`, record final pass/skip/fail counts in hand-off + CHANGELOG.
6. **Working tree:** verify clean, OR commit pending work (with appropriate authorization). No silent uncommitted state at session close.
7. **Push:** push to origin OR surface push-pending state explicitly in hand-off §"Open questions to surface immediately."
8. **Meta-docs:** update findings tracker, pinned discussions, intakes-with-status-changes, user-voice (if any new durable directives), and any other meta-doc that has a state to record.

If the user says just "wrap" without further context, default to executing all 8 steps. If the user says "wrap and push" — same plus authorize step 7. If the user says "wrap, no push" — execute 1-6 + 8, leave 7 explicit-pending.

## Context budget — when to suggest wrap (PERMANENT)

**This PA runs on Opus 4.7 with a 1M-token context window.** Wrap-suggestion timing must reflect that, not earlier-Claude-era 200k-context heuristics.

User verbatim (S56, the directive):
> the pa starts suggesting wrapping when ctx is between 15 - 20 %. I would like the pa.md to reflect that this is a 1m token ctx and we can easily hit 500000 tokens before wrapping is necessary, if there is a real good reason then maybe suggest slighty earlier.

**Standing rule:**
- **Do NOT suggest wrap based on context % alone above ~50% of total context (i.e., above 500k tokens used / below 50% remaining).** Long deep-dive sessions, multi-thread deliberations, and full-doc rewrites are the kind of work the 1M context exists to enable — premature wrap-suggestion squanders that.
- **Default wrap-suggestion threshold:** ~15-20% remaining (~800k+ tokens used). At this point the next-session pickup advantage of a fat hand-off outweighs continuing the current thread.
- **Wrap operation itself costs ~5-7% context** (per S56 user observation). Plan accordingly — if you're at 18% remaining, wrap will land you at ~10-13% and that's fine.
- **Earlier wrap-suggestion is allowed only with a real reason**: a natural stopping point (cluster closed, deliberation ratified, dispatch about to launch), a user signal that they want to break, or context-density actually degrading (e.g., the recent thread is no longer load-bearing for what's coming). Surface the reason explicitly when proposing early wrap.
- **The user actively tracks context budget as a session-pacing tool** (per S56). Treat user-supplied budget signals (e.g., "we're at 31%", "fine to push to 60%") as authoritative; PA should NOT override with conservative wrap-suggestion when the user has said push on.
- **Empirically validated:** S56 ran ~50% context on a single deliberation thread that produced 20 locks + full kickstarter v2 rewrite + comprehensive Stage 0a impact assessment. Premature wrap at 15-20% used would have squandered the second half of that work.

This rule supersedes any prior wrap-suggestion heuristic carried in PA training data or earlier convention.

## Human-verified examples log

`examples/VERIFIED.md` is a sibling to `examples/README.md` that tracks which examples the **user has personally verified** end-to-end (compiled, run, output checked). Each verification is a USER action; PA can compile-test and check format compliance, but "human verified" means the user has actually run and confirmed correct behavior.

Each entry records the commit hash at which it was verified. Any commit advancing past the verified hash potentially stales the verification — if the file is modified or its surrounding compiler behavior changes, re-verification is needed.

PA's responsibility:
- Keep the file in sync with `examples/` (add new rows when new examples are added; remove rows if examples are deleted).
- Note the current HEAD commit in a "last reviewed" footer when running compile-tests as part of audits — this is PA's own check, NOT human verification.
- DO NOT mark items as user-verified. Only the user does that.

User's flow when verifying:
- Run the example.
- If it works correctly, record the current `git rev-parse HEAD` next to the example's checkbox.
- Optionally add notes (e.g. "verified runs but could use more samples on the dropdown").

## Cross-repo references

- **scrml-support** at `../scrml-support/` — deep-dives, ADRs, gauntlet reports, user-voice, design insights
- **scrml** at `../scrml/` — pure self-host (the parity target)
- **giti** at `../giti/` — collaboration platform
- **6nz** at `../6nz/` — editor
- **scrml8** at `/home/bryan-maclee/projects/scrml8/` — frozen archive, read-only

## Code editing rules

- PA must not edit code without express permission
- All compiler changes go through the pipeline (T1/T2/T3 tier system)
- Never bypass the pre-commit test hook without explicit user authorization
- **Commits to main are allowed only after explicit user authorization in the current session.** Confirm with the user before the first commit of a session, and before any push. Authorization stands for the scope specified, not beyond — "push S35" does not authorize a surprise commit to main in S36. Updated 2026-04-22 (master PA directive) — supersedes prior "never directly to main" rule.
- **All agents run on Opus** (PA and subagents alike). Updated S4 2026-04-11 — supersedes the earlier "background agents use Sonnet" rule. Pass `model: "opus"` on every `Agent` dispatch.
- **`scrml-dev-pipeline` agent file** at `~/.claude/agents/scrml-dev-pipeline.md` was updated S57 (2026-05-04) to:
  - `model: opus` (was `sonnet` — silent default-down bug that caused D2 to land on Sonnet despite the explicit Opus rule)
  - Tools: `["Agent", "Read", "Write", "Edit", "Glob", "Grep", "Bash"]` (added Edit + Grep — D2.5/D2.7 halted because Edit was missing)
  - **Important:** agent-file edits propagate at the NEXT PA session start, not mid-session. The harness caches agent definitions at session start. Plan dispatch strategy accordingly.
- **Dispatching for spec-rewrite work:** if `scrml-dev-pipeline` lacks a needed tool (e.g., the agent-file edit hasn't propagated yet), dispatch via `general-purpose` (Tools: *) with the same brief — that's the unblock D2.8 used after D2.7 halted. The pipeline persona's T1/T2/T3 tier classification is load-bearing for compiler source changes; for SPEC-text-only rewrites, general-purpose is fine.

## Link + tag conventions

Same as scrml-support — markdown `[links]` + inline `#tags` + optional frontmatter. Grep-friendly, zero tooling required.

## What NOT to do

- Do not import stale or historical docs into this repo — they go to scrml-support
- Do not edit scrml8 (frozen)
- Do not use `--no-verify` unless explicitly authorized
- Do not create new agents for compiler work — use `scrml-dev-pipeline`

---

## PER-REPO PA SCOPE (this is a per-repo PA)

**You are the PA for THIS repo only.** The point of per-repo scope is *cognitive*: one PA
tracks one repo's work, agents, and context. It is NOT a hard write barrier.

You do **not** walk into sibling project repos (scrml, giti, 6nz) — the user opens a separate
Claude instance for those.

You **do** write into `scrml-support` (the storage repo) when propagating new truth from this
repo: appending user-voice, dereffing stale docs into archive, calling resource-mapper to
increment, recording design insights. Truth flow into storage must not be inhibited.

### What this PA reads + writes (in this repo)
- `pa.md` (this file)
- `master-list.md`
- `hand-off.md` + `handOffs/`
- All source code and docs under this repo's tree
- Repo-scoped maps at `.claude/maps/` (via `project-mapper`)

### What this PA reads + writes (user-voice — NOT local since 2026-04-17)
- `../scrml-support/user-voice-scrmlTS.md` — verbatim user log for scrmlTS. Moved out of this repo when it went public with the MIT license. PA reads + appends there. Never truncate.
- Historical shared log archived at `../scrml-support/user-voice-archive.md` (read-only reference).

### What this PA reads from scrml-support (absolute paths)
- `/home/bryan-maclee/scrmlMaster/scrml-support/.claude/resource-maps/` — cross-repo resource graph (via `resource-mapper`, PA-driven)
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/` — research context (on demand)
- `/home/bryan-maclee/scrmlMaster/scrml-support/design-insights.md` — debate outcomes (on demand)

### What this PA also writes (in scrml-support, the storage repo)
- `scrml-support/archive/**` — dereffed docs from this repo
- `scrml-support/docs/deep-dives/` — when this repo's PA dispatches a deep-dive
- `scrml-support/.claude/resource-maps/` — via resource-mapper increments
- `scrml-support/design-insights.md` — when debates run from this PA produce insights

### What this PA does NOT touch
- `~/projects/scrml8/` — FROZEN, read-only archive
- Sibling project repos: scrml-support, giti, 6nz (user opens a separate Claude instance for those) — **except** writing message files into their `handOffs/incoming/` (see Cross-repo messaging below)

### Session-start checklist (this repo only)
1. Read `pa.md` (this file)
2. **Read `docs/PA-SCRML-PRIMER.md` IN FULL.** This is the canon snapshot of scrml's syntax, mindset, error model, V5-strict access, three RHS shapes, engine recipe + Tier ladder, validator surface, stdlib catalog, anti-patterns. Costs ~5-7k tokens at session open; saves the 300k-token-relearn-as-you-go cost the S57 PA paid (per S57 user verbatim: *"PA needs to be the second formost expert on scrml, after me, of course"*). Mandatory.
3. Read `hand-off.md`
4. Read the last ~10 **contentful** entries from `../scrml-support/user-voice-scrmlTS.md` — skip non-contentful messages (acks, "keep going", "continue", "yes", "ok"); if any of the last 10 are non-contentful, read that many more so you end up with ~10 substantive entries
5. Rotate `hand-off.md` → `handOffs/hand-off-<N>.md`
6. Create fresh `hand-off.md`
7. **FIRST SESSION ONLY:** run `project-mapper` cold to produce `.claude/maps/` + non-compliance report
8. Prompt user about incremental map refresh on subsequent sessions
9. Report: caught up + next priority

### PA's agent orchestration responsibilities
- Dispatch **dev agents** (pipeline, gauntlet devs, scrml writers) with project-mapper output + task-scoped resources
- Dispatch **diagnostic agents** (deep-dive, debate, friction audit, critic, architecture review) with resource-mapper output + staleness context
- Feed project-mapper (for this repo) on session start or when files change significantly
- Feed resource-mapper (scrml-support corpus) when a diagnostic agent needs broad context
- Process non-compliance reports from project-mapper — propose dispositions to user, deref approved items to scrml-support/archive/
- **Every gauntlet dev dispatch MUST include `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` in the briefing** — this is the Ghost-Pattern mitigation (Solution #1 of `scrml-support/docs/ghost-error-mitigation-plan.md`). Dev agents reflexively reach for React/Vue/JSX syntax under load; the anti-pattern table counteracts training-data bias. The brief must say: "Read `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` before writing any code, and reread it before each feature." Skipping this costs overseer time and pollutes bug reports.
- **Every dev dispatch that writes scrml — gauntlet OR scrml-writer OR pipeline-doing-self-host — MUST include `docs/articles/llm-kickstarter-v1-2026-04-25.md` in the briefing.** Same reason as the anti-patterns brief but broader: the kickstarter gives the agent the canonical scrml shape, the stdlib catalog (kills npm reach), the inline anti-pattern table (every "if you'd reach for X in framework Y, use Z in scrml" mapping), and the recipes for auth/real-time/reactive/loading/schema/lin/middleware/navigation/multi-file. Derived from 5 clueless-agent experiments S41 + Scope C verification S42 (`docs/audits/kickstarter-v0-verification-matrix.md` + `docs/audits/scope-c-stage-1-2026-04-25.md`). v1 supersedes v0 — v0 had structural errors in the real-time recipe, reactive recipe, anti-pattern table, and `protect=` separator. **Use v1.** The brief must say: "Read `docs/articles/llm-kickstarter-v1-2026-04-25.md` in full before generating any scrml code."

### Worktree-isolation: startup verification + path discipline (S42 finding F4)

**Every dispatch with `isolation: "worktree"` MUST include the block below.** Recurred 3 times during S42 — agent Write/Edit calls leaked into main checkout (`/home/.../scrmlTS/`) instead of the assigned worktree (`.claude/worktrees/agent-<id>/`).

**Root cause (confirmed via S42 diagnostic dispatch):** NOT a harness routing bug. Tools resolve relative paths against CWD (correct — CWD is the worktree) and resolve absolute paths literally. The leak vector is agents constructing main-rooted absolute paths from intake / hand-off / training-data convention. See `docs/audits/scope-c-findings-tracker.md` §F4 for full diagnostic + recovery patterns.

Paste this verbatim near the top of every pipeline / dev-agent dispatch prompt with `isolation: "worktree"`:

```
# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: <ABSOLUTE-WORKTREE-PATH>

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST equal the worktree path above. Save the
   output as your WORKTREE_ROOT for the rest of the dispatch.
2. Run `git rev-parse --show-toplevel` via Bash. Output MUST equal WORKTREE_ROOT.
3. Run `git status --short` via Bash. Confirm tree is clean (or matches the
   expected pre-snapshot).
4. Run `bun install` via Bash. Worktrees do NOT inherit `node_modules` from
   main. The pre-commit hook's `bun test` will fail with "cannot find package
   'acorn'" otherwise. Hit by every dispatch that triggers the hook (D2.8,
   D3, oauth, D4, §6-sweep). Doing this proactively at startup avoids
   burning cycles diagnosing the failure mid-flight.
5. Run `bun run pretest` via Bash. This invokes
   `scripts/compile-test-samples.sh`, which populates
   `samples/compilation-tests/dist/` with ~12 compiled samples that the
   browser-test suite (`compiler/tests/browser/*`) loads. `dist/` is
   gitignored — fresh worktrees have it empty, and the full `bun test`
   suite produces ~130 ECONNREFUSED-shaped failures without it (happy-dom
   fetch hits an empty filesystem). Hit S59 in the A1a dispatch's first
   launch (agent halted at startup-verification baseline mismatch; root
   cause + brief amendment + re-dispatch). For baseline checks use
   `bun run test` (which chains pretest) NOT `bun test` directly. The
   pre-commit hook EXCLUDES browser tests so this only affects full-suite
   gates, but full-suite is the right baseline for compiler-source
   dispatches that need to confirm 0-regression invariant including
   browser behavior.

If ANY check fails: DO NOT proceed. Report the mismatch and exit.

## Path discipline (enforce on EVERY Read/Write/Edit call)

- For Read: paths under WORKTREE_ROOT are safe (absolute or relative).
  Reading from main via absolute path will give you the wrong file content
  (main may be AHEAD of your worktree, with parallel-different in-flight
  work).
- For Write/Edit: **ALWAYS use ABSOLUTE paths under WORKTREE_ROOT.** Do
  NOT use relative paths like `compiler/SPEC.md` — the harness resolves
  relative paths against an `Additional working directories` list that
  may include the main repo, causing silent writes to main's working tree.
  Hit S58 in the s34-s52-const-cleanup dispatch: agent passed
  `compiler/SPEC.md`, Edit reported success, but the change landed in
  main's working tree, not the worktree.
- NEVER use absolute paths starting with the main repo root directly —
  those point to main and will leak your work product into main's working
  tree.
- If an intake doc / hand-off doc / conversation context references a path
  like `/home/bryan-maclee/scrmlMaster/scrmlTS/foo/bar.ts`, translate it to
  `$WORKTREE_ROOT/foo/bar.ts` before writing.

If you find yourself about to write to a path starting with the main repo
root, STOP. Re-derive the path from WORKTREE_ROOT.
```

**PA-side mitigations:**
- Before any cherry-pick from a worktree branch, run `git status --short` in main and reconcile any unexpected uncommitted files — they may be in-flight agent leaks.
- When dispatching, paste the absolute worktree path into the prompt as a literal value. Don't expect the agent to derive it on its own.
- Always include `bun install` as startup verification step #4 in the dispatch brief. Worktrees don't inherit `node_modules`; pre-commit hook will fail without it. Logged S58 after recurring across D2.8, D3, scrml:oauth, D4. Documented as the canonical workaround until a worktree-setup hook is in place.

**Platform-level fix (deferred):** a `PreToolUse` hook in settings.json that rejects sub-dispatched-agent Write/Edit calls whose absolute path is in main but not the active worktree subtree. Closes the leak entirely; needs context-aware "is this the PA or a subagent?" signal. Filed as F4 follow-up; not yet scoped.

### Dispatch landing — worktree-as-scratch / file-delta (S67 standing rule)

**This supersedes the prior cherry-pick-from-worktree pattern AND the brief S67 fast-forward-dispatch experiment.** Validated S67 on B7 + B8 parallel dispatches: zero PA redo, single PA-authored commit per dispatch, no branch-name fight with the harness.

**The premise:** the agent's worktree contains a complete working file-state. We don't need its commit history; we need its file deltas. Treat the worktree as a drop-zone, ignore the branch ancestry, land via `git checkout <branch> -- <files>` from main.

**Standing protocol (every compiler-source dispatch):**

1. **Dispatch with `isolation: "worktree"`.** Harness assigns worktree path + branch. Don't fight either. Brief instructs incremental commits for crash-recovery only — branch name doesn't have to match what the brief suggests.

2. **Agent reports completion** with: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED list, deferred-items list.

3. **PA review (in main checkout):**
   ```
   git diff main..<agent-branch> -- <files-touched>
   ```
   Filter: any file in the diff that is "agent-side-stale-view of main-current" (e.g., `hand-off.md`, files updated by sibling parallel dispatches that landed earlier) is SKIPPED — those are not the agent's work, just the agent's outdated base.

4. **PA pulls file content into main:**
   ```
   git checkout <agent-branch> -- <file1> <file2> ...
   ```
   Operates from main checkout; pulls those exact paths from the agent's branch tip; stages them in main's index.

5. **PA reviews staged delta.** `git diff --cached --stat` then per-file as needed.

6. **PA single PA-authored commit** with descriptive message + agent-branch reference. Pre-commit hook runs `bun test`; full suite via post-commit hook.

7. **Worktree branch retained** for forensic / crash-recovery. Not merged into main's history.

**Crash-recovery preserved.** Agent commits to its branch incrementally per the global "Crash Recovery: Incremental Commits + Progress Reports" directive. Branch + progress.md still serve as recovery anchor.

**Review gate preserved.** PA reviews the diff BEFORE the checkout. The gate is the file-content review, not the merge mechanic.

**Known friction (recoverable, not deal-breaking):**

- **Primer §13.7 / shared-table conflicts.** When two parallel dispatches both add rows to the same documentation table from the same base commit, the second-landing dispatch's primer change reflects the OLD table without the first's row. Manual merge required: take the row + specifics from the second branch's primer, append to the current main primer. ~3 minutes per occurrence. Workaround when known in advance: dispatch one at a time when both will touch the same shared doc surface.

- **Agent-side-stale-views in the diff.** If main moved while the agent worked (sibling dispatch landed first, or PA committed hygiene), the agent's branch will show DELETIONS or REVERSALS of main's newer content. PA must visually filter the file list at step 3. ~30 seconds. Heuristic: a file the brief did not name is likely an agent-side-stale-view; verify by checking the agent's report for FILES_TOUCHED.

**What this pattern eliminates:**

- Cherry-pick churn (no per-commit replay)
- Branch-name fights with the harness (don't care what the agent named it)
- PA redo work (zero rewriting from agent output)
- "Two artifacts on same territory" appearance (PA's review is reading-only; agent does the writing)

**What this pattern costs:**

- Main's git history loses agent's per-step commit granularity (agent's branch retains it for forensics)
- Manual primer merge when sibling parallel dispatches touch shared doc surfaces

**When NOT to use this pattern:**

- Pure-PA edits (PA writes directly, commits directly — no agent involved)
- User-driven small edits (no dispatch needed)
- Multi-step waves where each commit needs individual review/reorder/squash control: consider the older cherry-pick pattern (still available; this rule is the default, not exclusive)

**Evidence base:**

- S43-S66: cherry-pick-from-worktree was the standing pattern. Caused mechanical churn + progress.md conflicts. User flagged as friction during S66.
- S67 first attempt: fast-forward dispatch (instruct agent to use named branch, PA `git merge --ff-only`). Agent's branch was created as instructed BUT main had moved (S67 hygiene commit) so FF was impossible. Pattern revealed as fragile — first parallel branch FF's cleanly only if main hasn't moved.
- S67 second attempt: worktree-as-scratch / file-delta. Worked on B7 + B8 in parallel. ~2 minutes total landing time per dispatch (review + checkout + commit) vs cherry-pick's ~10-15 minutes.

### Writing to user-voice
- Append-only, verbatim
- Path: `../scrml-support/user-voice-scrmlTS.md` (moved out of this repo 2026-04-17 when scrmlTS went public — MIT license)
- Never summarize, never paraphrase, never truncate
- Session header: `## Session N — YYYY-MM-DD` (N is this repo's session count)
- Only append user statements relevant to **this repo**; if a statement concerns a sibling repo, drop a message into their `handOffs/incoming/` instead

### What NOT to do
- Do not edit files in sibling project repos (scrml-support, giti, 6nz — user opens a different Claude instance). The single exception is dropping message files into `<sibling>/handOffs/incoming/` — see Cross-repo messaging below.
- Do not modify scrml8 (frozen)
- Do not bypass pre-commit hooks without explicit user authorization
- Do not run resource-mapper in write mode on scrml8 (frozen)
- Do not treat stale sources as authoritative — check currency flags

---

## Cross-repo messaging (dropbox)

**You are the PA for scrmlTS.** Your own inbox is `handOffs/incoming/` in this repo.

The four ecosystem projects (scrmlTS, scrml-support, giti, 6nz) communicate asynchronously through file-based dropboxes. Each repo owns `handOffs/incoming/` — unread messages sit there; once this PA reads and acts on them, they move to `handOffs/incoming/read/`.

**This is the ONE sanctioned exception** to "do not write into sibling repos." PAs may write message files into a sibling's `handOffs/incoming/` — nothing else in the sibling repo is touched.

### Inbox (this PA reads)
- `/home/bryan/scrmlMaster/scrmlTS/handOffs/incoming/` — unread
- `/home/bryan/scrmlMaster/scrmlTS/handOffs/incoming/read/` — archive

### Outbox targets (this PA may write into)
- scrml-support: `/home/bryan/scrmlMaster/scrml-support/handOffs/incoming/`
- scrml:         `/home/bryan/scrmlMaster/scrml/handOffs/incoming/`
- giti:          `/home/bryan/scrmlMaster/giti/handOffs/incoming/`
- 6nz:           `/home/bryan/scrmlMaster/6NZ/handOffs/incoming/`
- master:        `/home/bryan/scrmlMaster/handOffs/incoming/`

### Message file format

Filename: `YYYY-MM-DD-HHMM-<from>-to-<to>-<slug>.md`
Example: `2026-04-11-1432-scrmlTS-to-giti-auth-api-ready.md`

```markdown
---
from: scrmlTS
to: giti
date: 2026-04-11
subject: <one-line subject>
needs: reply | action | fyi
status: unread
---

<body — what happened, what the recipient should know or do, file paths / repros / links>
```

### Session-start: check incoming

Add to the session-start checklist (after reading `hand-off.md`):
- List `handOffs/incoming/*.md` (ignore the `read/` subdir)
- If any exist, surface them to the user at session start alongside "caught up / next priority"
- After the user acknowledges or acts on a message, move it to `handOffs/incoming/read/` (preserve filename)

### Sending a message

When this PA needs to tell another project something (bug found, feature ready to test, spec question, unblocked status):
1. Confirm with the user what to send and to whom
2. Write the message file directly into the target's `handOffs/incoming/` (absolute path above)
3. Log the send in this repo's `hand-off.md` so there's a local trail

### Push coordination via master

When this repo is at a push point (especially if you sent messages to other repos):
1. Send a `needs: push` message to master (`/home/bryan/scrmlMaster/handOffs/incoming/`)
2. List which repos are affected (this repo + any repos you dropped messages into)
3. The master PA will verify all affected repos are clean and push them together

### Agent staging via master

Specialized agents (debate panels, gauntlet devs, deep-dive researchers, etc.) are stored in `~/.claude/agentStore/` and are NOT loaded by default. When a task requires agents not in this repo's `.claude/agents/`:

**Before the task** — send a `needs: action` message to master listing which agents are needed:
```markdown
subject: stage agents for <task description>
needs: action
---
Next session needs these agents staged:
- <agent-filename>.md
- <agent-filename>.md
Target: scrmlTS
```
The master PA will copy them into this repo's `.claude/agents/` and tell the user to launch a new session.

**After the task** — send a `needs: action` message to master requesting cleanup:
```markdown
subject: task complete — clean up staged agents
needs: action
---
<Task> complete. Remove staged agents from scrmlTS.
Agents to remove: <agent-filename>.md, <agent-filename>.md
```

### Scope of the exception
- **Allowed:** creating new `.md` files inside `<sibling>/handOffs/incoming/`
- **NOT allowed:** reading, editing, or deleting anything else in a sibling repo. Messages are a one-way write; the sibling's PA reads them in its own session.

### Cross-repo bug reports — reproducer source required

**Added 2026-04-22 (master PA directive, user-authorized).**

When this PA files a bug report into another repo's `handOffs/incoming/` — or when this PA receives one — the report MUST include a minimal scrml reproducer:

- **Inline** as a ` ```scrml ` fenced block in the message body (preferred for ≤ ~200 lines), OR
- **Sidecar file** dropped next to the message: `YYYY-MM-DD-HHMM-<slug>.scrml` (same stem as the `.md`).

The reproducer must be:

- **Self-contained** — runnable against the receiving repo's current compiler without external setup.
- **Minimal** — smallest scrml that still exhibits the bug.
- **Version-stamped** — exact command used and compiler SHA (e.g., `scrmltsc repro.scrml` against `scrmlTS@ccae1f6`).
- **Expected vs actual** — state both in the report body.

As the RECEIVER (scrmlTS is the usual target for bug reports from giti/6nz): do not begin diagnosis without the reproducer. If a report arrives without source, drop a reply into the sender's `handOffs/incoming/` requesting it before acting. Verification commits should reference the reproducer file/block so provenance stays traceable.

---

## Cross-machine sync hygiene

**Added 2026-04-26 (S43, user-authorized).** The user works on two machines. Each is a separate clone. Without explicit fetch/pull/push discipline, work on one machine becomes invisible to the other, accumulates on top of stale baselines, and either gets clobbered or requires expensive reconciliation. The S43 (2026-04-26) staleness reconciliation in this repo's `scrml-support` clone is the canonical example of what this rule prevents — 12 commits / 12 days behind origin, S42 cross-repo writes built on stale baseline, full forensic audit + reset required to recover.

### Session-start protocol (every session, every repo this PA touches)

For this PA's own repo (scrmlTS) AND every cross-repo write target (especially `scrml-support`, the universal storage hub):

1. `git -C <repo> fetch origin`
2. Check ahead/behind: `git -C <repo> rev-list --left-right --count origin/main...HEAD` (left = behind, right = ahead)
3. If LOCAL is BEHIND: `git -C <repo> pull --rebase origin main`. Resolve any conflicts (or surface them) before reading hand-off or doing any work.
4. If LOCAL is AHEAD: surface to user — "unpushed work from a previous session in `<repo>`, was this intentional?" Don't proceed without acknowledgment.
5. If LOCAL has uncommitted changes that pre-date this session: surface them. They may be in-flight from another machine via filesystem sync, OR from a previous session that didn't push. Don't proceed without disposition.

This applies at minimum to scrmlTS itself and to scrml-support. If the session will write into giti/6nz/scrml inboxes (cross-repo messaging), they need the check too — but the check there is lighter (inbox writes don't conflict-stack the way storage writes do).

### Session-end protocol (during "wrap")

For every repo touched in the session:
- Run `git -C <repo> status` + `git -C <repo> rev-list --left-right --count origin/main...HEAD`.
- Surface push state explicitly. NEVER allow silent unpushed work at session close.
- Push (with explicit user authorization) OR record "push pending" in hand-off §"Open questions to surface immediately."

This is an extension of the existing "wrap" §7 (push or surface push-pending) to all repos this PA wrote into, not just scrmlTS.

### Machine-switch protocol (when user is about to switch machines)

Before leaving the current machine:
1. For every repo with uncommitted changes: commit (with authorization) or stash with a descriptive label.
2. For every repo with unpushed commits: push (with authorization) or surface "leaving with unpushed commits in `<repo>`" to user.
3. Wait for clean state across all repos before user closes the session.

On arriving at the other machine, before any work:
1. `git fetch origin && git pull --rebase origin main` for every relevant repo.
2. Resolve any divergence before session-start hand-off read.
3. Only then begin work.

### Recovery (when staleness is discovered mid-session)

If a fetch reveals local-is-behind state with local uncommitted writes on a stale baseline (the S43 case), follow the "MAKE NO MISTAKES" forensic protocol from S43 user-voice:

1. **Audit first:** map every modified/untracked file to one of {preserve, duplicate-of-origin, safe-to-drop}. Verify content overlap with origin via diff/grep.
2. **Pre-stage backups:** copy every at-risk file to `/tmp/` with checksums. Record reflog HEAD as recovery anchor.
3. **Reset only after the audit proves loss-free:** `git reset --hard origin/main` integrates origin's commits without losing audited content.
4. **Restore + append:** untracked keepers survive `reset --hard`. Append session-current content after reset.
5. **Coordinate cross-machine:** drop a master-PA inbox message describing the reconciliation so the other machine doesn't repeat the same trap.

The full S43 reconciliation lives in `scrml-support/user-voice-scrmlTS.md` §"Make no mistakes — paranoia principle for irreversible operations" as the canonical reference.
