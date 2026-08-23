FIX ROUND on `handle-onion-top-level-dispatch`. An adversarial pass returned **DO-NOT-LAND** with **two branch-introduced HIGH regressions** plus three MEDIUMs. The core work is sound; these are narrow.

## WORKSPACE — EXISTING worktree, already on the branch. Do NOT create a new one.
- work in: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a413f731596473f84`
- branch `handle-onion-top-level-dispatch`, currently at **`459003df`**

**STARTUP GATE — STOP and report if any fails:** `pwd` under that worktree · `git rev-parse --show-toplevel` equals it · branch correct · `git status --short` clean · HEAD == `459003dfc0bc85f12d8f83bbbdfd217b8f391044`.

**PATH DISCIPLINE.** Absolute paths under the worktree root. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`** (live). `git -C` / `bun --cwd=`. **Never `git stash`.** Never touch a sibling worktree. **STEP 0:** `git fetch origin && git merge origin/main` — MERGE, never rebase; on a delta-log collision the already-merged side keeps its numbers; resolve `@generated` by REGENERATING.

---

## HIGH-1 — §38 transitions are silently lost on EVERY soft navigation. **BLOCKER.**

Retiring the `'transitions'` runtime chunk moved keyframes into per-page CSS. But the soft-nav path never loads the target page's stylesheet, so a swapped-in element gets `scrml-enter-fade`/`scrml-exit-fade` naming animations **nothing defines**.

**PA-CONFIRMED structurally:** `_scrml_nav_sync_head` (`runtime-template.js:2842`) syncs `<title>`, `meta[name=description]`, `link[rel=canonical]` — and **not stylesheets**. Reviewer measured, A/B on the same input after `_scrml_navigate_soft("/anim")`:

| | base | branch |
|---|---|---|
| live `<link rel=stylesheet>` set | `["index.css"]` | `["index.css"]` |
| `<style>` elements in document | **1** | **0** |
| `scrml-fade-in` reachable | **true** | **false** |

`anim.css` carries the keyframes; `index.css` — the only stylesheet the shell loads — has zero.

⚑ **This is the DEFAULT path.** `_scrml_link_click_handler` intercepts every same-origin `<a href>` unless it carries `hard`/`download`/`target`/`rel=external`. Before this branch the keyframes shipped in the always-included runtime chunk, so they were present regardless of navigation.

⚑ **And it landed into a measurement blind spot** — all 14 `Transition directives (transition-001-basic)` browser tests are already in `compiler/tests/browser/FAILURE-BASELINE.json` and fail on both trees, so the tier could not have caught it. **Whatever you build, do not rely on that tier to prove it.**

**Two fix shapes named by the review — pick on merit and say why:** carry the target document's stylesheet links in `_scrml_nav_sync_head`, or emit the union of the app's transition CSS into the shell's stylesheet. Consider which behaves correctly for a page reached by soft nav, hard nav, AND direct load.

## HIGH-2 — `headers="strict"` + `scrml dev` now refuses the hot-reload script. **BLOCKER.**

Reviewer executed: `scrml dev` on a `<program headers="strict">` app now returns `Content-Security-Policy: default-src 'self'` **and** the body carries exactly one inline `<script>` — `HOT_RELOAD_SCRIPT`, no nonce. Chromium refuses it → **hot reload is dead for every strict-headers app in dev.** On base there was no CSP header on that request at all.

**PA-CONFIRMED:** the hot-reload script is an inline `<script>` with no `src=`.

⚑ **This is the exact defect class the branch set out to eliminate** — compiler-emitted content refused by the compiler-pinned CSP — created by the same hoist that fixed the other one. *Fix shape named by the review:* serve it from `/_scrml/hot-reload.js` (dev already owns that namespace) and reference it with `src=`.

## MEDIUM-3 — `E-MW-007` fires on files that declare no request pipeline, then describes them falsely.

Trigger is `middlewareConfig != null`, and `compute-program-config.ts:203-207` sets that for **`batch-in-list-cap=`** (a §8.10.6 SQL batching cap) and **`cors-max-age=`** too. Reviewer executed: two files whose only `<program>` attribute is `batch-in-list-cap="999"` → branch exits **1**, base exits 0, and the message says *"this build declares the request pipeline in 2 different sources"* while listing attributes neither file has. **Gate on the pipeline attributes + `handle()` — i.e. on what the SPEC sentence and the error message already say.**

## MEDIUM-4 — CORS preflight moved below `handle()` PRE, contradicting §39.3.3.

`_scrml_cors_options_route` is a registered route, so it is now downstream of `resolve()`. §39.3.3 pins `[CORS preflight] → [rate limit] → handle() PRE`. Reviewer executed an OPTIONS preflight: branch runs `handle()` on it (`X-H: 1`), base does not. **An author `handle()` that early-returns 403 for unauthenticated requests would block browser preflights.** F1 explicitly preserved the rate-limit's position; the preflight's was not considered. Restore the ordering, or if you conclude the SPEC sentence should change instead, **STOP and report — that is a ruling, not your call.**

## MEDIUM-5 / LOW-7 — the SPEC text is FALSE in the dangerous direction, and its anchor does not exist.

The new sentence says `E-MW-007` fires when a build presents more than one module declaring a request pipeline. **The implementation rejects a superset** (see MEDIUM-3), so the normative text under-describes what the compiler refuses. Fix the text to match the code once MEDIUM-3 lands. **Separately:** the amended block lives under `#### 39.3.4` at `compiler/SPEC.md:22642` while four new references, the §40.6 row, the §34 registry row and the LSP string all cite **"§40.3.4"** — a section number with no heading. Pre-existing drift; you added four references on top. Fix the citations.

## ALSO — cheap, do if it stays cheap
- **LOW-8:** `_scrml_ssr_seed_from_document` uses `getElementById` with no tag/type guard — a `<div id="__scrml_ssr_state">` is parsed as the seed. Require `SCRIPT` + `type="application/json"`.
- **LOW-9:** `docs/FACTS.md` says 1,371 test files; actual is 1,373. Regenerate.
- **LOW-10:** `runtime-template.js:6070` still describes the OLD inline-script wire format twelve lines above the paragraph that corrects it.

## OUT OF SCOPE — do not touch
`ratelimit=` scoping (LOW-6 is PRE-EXISTING on both trees — do not "fix" it here). `auth=`/`protect=` semantics. Building the reserved `E-PROGRAM-002` (a separate ruling).

## VERIFICATION — do not report DONE without it
- **HIGH-1 and HIGH-2 each need an A/B execution table** on the same input, before vs after, driving the real artifact — not a grep. For HIGH-1 that means an actual soft navigation with the keyframes reachable in the live document afterward; for HIGH-2 an actual `scrml dev` request whose script the CSP would accept.
- **HIGH-1 needs an EXECUTING regression test that does not depend on the baselined browser tier.**
- `bun --cwd="$WORKTREE" run test` + `conformance/run.ts`. Baseline at `459003df` is **53 failures / 883-883**. Report branch-only NEW failures; separate timeouts from assertions **by duration** (the four dev-watcher tests legitimately run ~10.5 s).
- **Measure exit codes DIRECTLY (`cmd; echo $?`), never through a pipe.**

## COMMIT DISCIPLINE
First commit: this brief verbatim to `docs/changes/handle-onion-csp-and-onion-composition/FIX-ROUND-2-BRIEF.md` + a `progress.md` append. Crash anchor. Commit per unit. NEVER `--no-verify`. Clean `git status` before DONE.

## REPORT
Per-finding: fixed/deferred + the A/B evidence. Which HIGH-1 shape you chose and why. Gate numbers with the NEW-failure name set. Final SHA. Anything you stopped on.
