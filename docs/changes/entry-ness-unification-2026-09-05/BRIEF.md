Make "which document is the application entry" a FACT THE COMPILER RECORDS, once, and have every consumer read it instead of reconstructing it.

change-id: `entry-ness-unification-2026-09-05`

**DEFERRED TO THIS SESSION BY bryan, verbatim (S400): _"we will have to take that fix next session."_** The measurement below is his ruling's basis; it is not up for re-litigation. What IS open is the shape of the recorded fact — see "THE ONE DESIGN CALL" below, and STOP rather than guess if it does not resolve.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

Before anything else; if ANY check fails, STOP and report.

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean.
3. Assert base: `git merge-base HEAD origin/main` == `origin/main`.
4. `bun install` — a fresh worktree does not inherit `node_modules`.
5. `bun run pretest` — run it PLAINLY from the worktree CWD. ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts actually appeared.
6. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(entry-ness): start at <that pwd>`.

Edit via Edit/Write on **worktree-absolute paths only**. NEVER `cd` into the shared checkout; use `git -C "$WORKTREE_ROOT"` and run `bun` from the worktree CWD. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here and has crossed trees before; do base-vs-build flips by FILE COPY. ⚑ **NEVER a bare `pkill -f` / `killall`** — other agents run suites and every checkout shares the command string; kill by PID captured at launch. Commit after each meaningful unit; append to `docs/changes/entry-ness-unification-2026-09-05/progress.md` as you go.

## MAPS

Read `.claude/maps/primary.map.md` first, follow its Task-Shape Routing, then `structure.map.md` and `build.map.md`. Treat map content as a verify-against-source hypothesis. Report which was load-bearing; "not load-bearing" is a valid answer.

⚑ **The maps are stamped `10a4b045` (2026-09-04) and HEAD is `7e3eac37`. SIX compiler-source commits have landed since**, all codegen fixes, none in the classification region: `1a7f4ea6` shell-subdir route asset paths · `bedce535` timer/poll in if-chain branch · `8a68d960` boolean SQL column coercion · `de52df26` flat `#{}` style merge · `0952ac2b` each per-item call-ref §42 operator · `8f459481` static `${expr}` in if-branch. Factor those in; do not treat the map as current for codegen.

## THE MEASUREMENT — 11 sites, 6 rules, no rule correct on all three real shapes

**Every locus below was PA-re-verified BY GREP AT HEAD `7e3eac37` for this brief** (the S400 hand-off's version had one line-number drift, corrected here). Loci are `PA-located-verify`: I located them and read them; I did **not** trace execution into most of them. Verify before relying on any of it, and report where I was wrong.

| rule | where (verified at HEAD) | flagship | `<program>`-less SPA | channel+page |
|---|---|---|---|---|
| **A** `hasProgramRoot` | `auth-graph.ts:971`, `:1084`, `:1163` · `api.js:1417` · `tool-program.ts:96` · `codegen/index.ts:1766`, `:2676` | ✓ | ✗ | ✓ |
| **B** 3-way shape | `ast-builder.js:19968` `isPureModuleFile` + `:19987` `isNonEntryPageFile`, consumed ONLY at `:19991` | ✗ | ✓ | ✗ |
| **C** pure-module + exports | `api.js:1405-1420` — a hand copy of B; **its own comment says so**: *"Mirrors the `isPureModuleFile` predicate in ast-builder.js"* | — | — | — |
| **D** not-a-top-level-`<page>` | the S400 prod-root-fallback arc (branch `worktree-agent-a7754ec5541a9ab8f` @ `b0e9469d`) | ✗ | ✓ | ✗ |
| **E** `inputs.length !== 1` | `dev.js:949` `resolveRootEntryCandidate` — **consults no AST at all** | — | — | — |
| **F** filesystem position | `route-inference.ts:6323` `ROUTE_PREFIXES` (hand-off said `:6392` — drift) | ✗ | ✓ | ✗ |

**Re-runnable census probe** (on the held branch, worktree-path-hardcoded at its top — repoint `WT` before use): `git show worktree-agent-a7754ec5541a9ab8f:docs/changes/prod-root-fallback-gated-2026-09-05/rulecensus.ts`.

## THE ROOT — verified by reading `ast-builder.js:19940-19991`

The FileAST is built as `const ast = { filePath, nodes, imports, exports, components, typeDecls, machineDecls, channelDecls, hasProgramRoot }`.

**`isPureModuleFile` and `isNonEntryPageFile` are local `const`s. They are computed, used in exactly ONE `if` (the `W-PROGRAM-001` suppression at `:19991`), and never written onto `ast`.** They are discarded when the function returns. `hasProgramRoot` — the *weakest* of the three signals — is the only one that survives, which is why six sites downstream reconstruct entry-ness from it and two more hand-copy the discarded part.

**That is the whole defect, and it is why the fix is smaller than "11 sites" suggests: stop discarding B.**

## WHAT TO BUILD

1. **Persist the classification on the FileAST**, computed once at the site that already computes it.
2. **Teach it the two shapes it currently gets wrong** (see below).
3. **Migrate the consumers to read it** — starting with `api.js`'s hand copy, which should be DELETED rather than kept in sync.

### ⚑ THE ONE DESIGN CALL — surface it, do not guess

Is the recorded fact **(i)** the two booleans as they stand (`isPureModuleFile` / `isNonEntryPageFile`, plus the existing `hasProgramRoot`), or **(ii)** a single closed classification — one field with an exhaustive variant set (entry · pure-module · non-entry-page · pure-channel-module) that consumers switch on?

I lean **(ii)** on fork-rule row 4 (root-vs-position: three independent booleans can express contradictory combinations that a closed set makes unrepresentable) and row 1 (a closed set LIMITS). **But (ii) is a bigger blast radius and I have not measured it.** Build (i) if (ii) turns out to require touching materially more than the consumer list above — and either way, **state which you built and why in your report.** If you find a third shape the classification cannot express, STOP and report; that is a design fork, not an implementation detail.

### The two shapes the current rule gets wrong

**(a) PURE-CHANNEL-FILE — and the governing sentence is unambiguous.** SPEC.md:21661, verbatim:

> **Dispensation (S87 — Insight 30):** A `<channel>` at file top in a MODULE FILE — a file that contains no `<program>` element anywhere — is canonical placement (PURE-CHANNEL-FILE per §38.12.6) and SHALL NOT fire `E-CHANNEL-OUTSIDE-PROGRAM`.

`isPureModuleFile` requires every top-level node to be non-markup; a file-top `<channel>` IS a markup node, so a canonical pure-channel file is neither pure-module nor non-entry-page, and **`W-PROGRAM-001` fires — telling the author to wrap SPEC-canonical code in `<program>`, which §38.1 would then make an error.**

⚑ **PA-REPRODUCED BY EXECUTION at HEAD.** All four canonical flagship channel files fire it, 1 each:
`examples/23-trucking-dispatch/channels/{customer-events,dispatch-board,driver-events,load-events}.scrml`.
Fixing this is **artifact-inert** (a suppressed spurious warning; no emit change) — prove that with the corpus differential, don't assert it.

**(b) Wrapper-less entries** — a `<program>`-less single-document SPA is the entry, and rule A says it is not. This is what disabled the multi-file half of the held prod-404 arc.

## SCOPE — out

- Do **NOT** land the prod root fallback itself. That is fork (b), already built and HELD at `b0e9469d`, and it unblocks *after* this. If your change makes it landable, say so; do not merge it in.
- Do **NOT** touch the dev-side root-path leak (`g-dev-root-path-fallback-serves-a-protected-document-unauthenticated`) — separate open HIGH.
- Do **NOT** rewrite `route-inference`'s filesystem-position rule (F) into the classification unless it falls out for free. Its job is route derivation, not entry identity; conflating them is a separate question.

## VERIFICATION

1. **The census, re-run.** Repoint the probe at your worktree and run it over all three real shapes. **Every rule must now agree, and you must show the before/after table.** If they cannot all agree, that is the finding — report it rather than forcing agreement.
2. **`W-PROGRAM-001` on the four flagship channel files: 1 → 0 each**, and NOT suppressed anywhere it should still fire (build a two-sided negative: a genuinely wrapper-less non-canonical file must still warn).
3. **Corpus differential** — `scripts/corpus-emit-differential.ts`. ⚑ Run both sides at the **same `--compiler-root`**: different absolute paths false-diff ~1027 of 7427 artifacts on a path-derived token and it prints the diff list under an INCOMPARABLE verdict (`g-corpus-emit-differential-incomparable-across-checkout-paths`). Report its **skipped populations**.
4. **Full `bun run test`** from the worktree CWD (not bare `bun test`), plus conformance. Zero newly-failing.
5. **R26 empirical** — recompile real adopter `.scrml` on your post-fix baseline.
6. **Permanent tests** for the classification itself and for the pure-channel suppression.

⚑ **Do not use `compiler/tests/commands/` green-ness as a signal** — five dev-server tests in it expire their `waitFor` budgets in cloud CI while passing locally (`g-dev-server-tests-expire-their-wait-budgets-in-cloud-ci-only`). Locally-green there means nothing about CI.

## REPORT BACK — under two pages, no narration

1. Which classification shape you built — (i) or (ii) — and why.
2. The census before/after table.
3. Which of the 11 sites you migrated, which you left, and why.
4. `W-PROGRAM-001` two-sided result; corpus differential incl. skipped populations; suite / conformance / R26.
5. Whether the `api.js` hand copy was deleted or retained.
6. Final branch + SHA + files touched.
7. **Anything that contradicts this brief.** Several loci here are PA-located, not PA-traced. If one is wrong, say so plainly — a brief that anchors you on the wrong file costs more than no brief.

Label every claim `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED — not measured`. Locate by SYMBOL, never a remembered line. No `--no-verify`.
