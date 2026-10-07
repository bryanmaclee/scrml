# BRIEF — s457-url-scheme-runtime-guard (S457, bryan ruling "a")

CHANGE-ID: `s457-url-scheme-runtime-guard`. Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (verbatim, user-voice-scrml.md §S457)
> a now with c discussed for later. dd that  and go
(a) = a RUNTIME scheme guard on every URL-valued attribute write whose literal prefix commits to no scheme — the quoted
`href="${url}"` form AND the expression form `href=${@u}` alike. Admitted: relative URLs and the safe-scheme set; anything
else writes a blocked placeholder (`about:blank`) and reports to the §19.6.8 logging surface. No compile refusal.
PA READING (recorded, veto window): the safe set is the SAME one §5.2 rule 2 already uses for literal prefixes —
`http`, `https`, `ftp`, `mailto`, `tel`, `sms`, plus raster `data:image/{png,jpeg,jpg,gif,webp,avif,bmp,x-icon,vnd.microsoft.icon}`
on image-source attributes (`src`, `srcset`, `imagesrcset`, `poster`). ONE set, ONE reader: share the constant with
`compiler/src/attr-injection-sink.ts`, do not write a second list.

## The gap
`docs/known-gaps.md` `g-quoted-url-attribute-data-supplied-scheme-s456` (MED). Its locus (hypothesis):
`compiler/src/attr-injection-sink.ts` (`readLiteralUrlScheme` → `kind:"none"` is admitted) +
`compiler/src/codegen/emit-bindings.ts` (top-level template-attr `setAttribute`) + `compiler/src/codegen/emit-each.ts`
(`renderTemplateAttrToJs`). The expression form `href=${@u}` was measured as `el.setAttribute("href", String(…))`.
Corpus at `20ce26bf5`: 3 sources write a URL attribute with an empty literal prefix.

## Governing text
SPEC §5.2 (`compiler/SPEC.md` ~:1792) rule 2, last bullet: "A value whose literal prefix commits to no scheme
(`href="${url}"`) is not covered by this rule; the scheme there comes from the data." — you AMEND this: add a normative
paragraph (new rule 3 under the executable-sink bullet, or immediately after) stating the runtime guard: which writes it
covers (URL-valued attributes, the §5.2 list, whose literal text before the first `${` is empty or has no complete scheme —
`readLiteralUrlScheme` kind "none" — plus every non-literal URL attribute value: `href=${expr}`, `href=@cell` if it binds,
`<each>` row attributes, component-expanded attributes, reactive re-writes on change), the scheme test (same browser-parser
reading as rule 2: strip leading C0/space, remove tab/LF/CR, scheme before first `:` if no `/?#` precedes), the admitted set,
the blocked behaviour (attribute set to `about:blank`; one report through the §19.6.8 logging surface naming the attribute
and element — NOT the value, it may be sensitive), and that it is evaluated on EVERY write including reactive updates.
Add `> **Provenance:** ruling:user-voice-scrml.md S457 "a now with c discussed for later" · supersedes: §5.2 rule 2's
"not covered by this rule" sentence (the data-supplied case is now guarded at runtime).` Read §5.2, §19.6.8 IN FULL first.
No new error code (it is runtime). If you add a runtime warning code, it needs a §34 row — prefer none.

## What to build
1. ONE runtime helper (in the runtime chunk system the client bundle already uses — find how `_scrml_*` helpers ship and
   tree-shake; follow that pattern) e.g. `_scrml_safe_url(attrName, value, el)` → returns value or `"about:blank"` + logs.
   Its scheme parser must mirror `attr-injection-sink.ts`'s literal-prefix reader (same steps). Values that are not strings:
   `String(v)` first (that is what setAttribute does). `srcset`/`imagesrcset` are comma lists of URLs — check EACH candidate URL.
2. Route EVERY emitted URL-attribute write that the compile-time rule cannot prove safe through it: top level, `<each>` rows,
   component-expanded instances, engine state-child / match-arm bodies, reactive effect re-writes, SSR/static HTML if any
   path emits a data-derived URL server-side (check: does any server render path write such an attribute? If yes, the guard
   must apply there too, or report it).
   ENUMERATE the emitters first — grep for every `setAttribute(` / attribute-template emission in `compiler/src/codegen/` and
   list them in progress.md with a verdict each. The S453 lesson: a fix at one emitter left 14 others untouched.
3. Do NOT guard writes whose literal prefix already proves a safe scheme or a relative path — keep them byte-identical.

## Verification
- Unit tests for the helper (javascript:, JaVaScRiPt:, `java\tscript:`, leading spaces/C0, `vbscript:`, `data:text/html`,
  `data:image/png` on src vs on href, relative `/x`, `?q`, `#h`, `//host` (protocol-relative = admitted, it is http(s)),
  mailto, empty string, srcset list with one bad entry).
- Browser (happy-dom) test: a cell holding `javascript:…` bound via `href=${@u}`, then reactively changed safe→unsafe→safe;
  same inside an `<each>` row and a component.
- EMPIRICAL: compile the corpus before/after (`samples/`, `examples/`, `conformance/`), diff emitted artifacts; report the
  count of artifacts that changed and confirm every change is a guard insertion at a URL attribute (direction: semantics-changed
  only for values that were executable — state this). Name the 3 corpus sources the gap entry counts and show their new output.
- Add a conformance case pinning the runtime behaviour (follow `conformance/README.md`).


## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457 && git checkout FETCH_HEAD -- docs/changes/s457-url-scheme-runtime-guard/` then commit it as your first commit:
   `WIP(s457-url-scheme-runtime-guard): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-url-scheme-runtime-guard/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it. (Brief 3 is the one exception, named there.)
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `ba2712973`, 2026-10-07; HEAD since then adds only the S456 wrap + maps PRs —
no source change), follow its Task-Shape Routing to the 2-4 maps for your task, treat map content as a hypothesis to verify
against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: run `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract)
  plus `bun conformance/run.ts`, and the empirical check named in your brief (an emitted-artifact check, not "tests pass").
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
