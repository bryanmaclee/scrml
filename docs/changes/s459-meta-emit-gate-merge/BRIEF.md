# s459-meta-emit-gate-merge — merge the final ^{} allow-list round into the runtime meta.emit gate, then build the `data-scrml-*` refusal

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do first; stop and report if any check fails)
Path-discipline incidents to date: several (S99 ×4, S456 ×1). Do not add one.
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Call it WT.
2. `git -C "$WT" rev-parse --show-toplevel` == WT; `git -C "$WT" status --porcelain` is empty.
3. `bun install` in WT; then `bun run pretest` run PLAINLY from WT (never `bun --cwd <path> run`, which silently no-ops) and confirm `samples/compilation-tests/dist/` was produced.
4. Every Read/Write/Edit uses an ABSOLUTE path under WT. NEVER `cd` into /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WT"`.
5. NEVER `git stash` (shared across all worktrees). NEVER `pkill -f`/`killall` by pattern — kill only PIDs you started.
6. TMPDIR=$HOME/.cache/scrml-agent-tmp/s459-meta-emit (set per command; never inside a repo). Delete your scratch before the final report.
7. First commit: `WIP(s459-meta-emit): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
Read `$WT/.claude/maps/primary.map.md` first (stamp `8ce6d61b5`, 2026-10-08; main has since moved only by docs/SPEC-text commits #1355–#1358) and follow its Task-Shape Routing for codegen + meta. Treat map content as a hypothesis to verify against source. Report whether the maps were load-bearing.

## Brief archival
Copy this entire brief verbatim to `$WT/docs/changes/s459-meta-emit-gate-merge/BRIEF.md` and commit it as your second commit. Keep `$WT/docs/changes/s459-meta-emit-gate-merge/progress.md` (append-only, timestamped). Commit after EVERY meaningful change (WIP commits expected) — your branch + progress.md are your crash-recovery anchor. Context budget: if you pass ~650k tokens, commit, write progress.md, and report.

## Step 1 — base
`git -C "$WT" fetch origin` then `git -C "$WT" checkout -B s459-meta-emit-gate worktree-agent-aed308bedcd0a3822` (local branch in the shared repo; tip 228b0be22 — the runtime `meta.emit` gate, S458 ruling "a"). Read its `docs/changes/s458-runtime-meta-emit-gate/{BRIEF,progress}.md`.

## Step 2 — merge the final allow-list round
`git -C "$WT" merge worktree-agent-a8630d8539c6308b0` (tip a55464de4 — the `^{}` allow-list final fix round F1–F7; read `docs/changes/s458-meta-final/{BRIEF,progress}.md`). Then `git merge origin/main`. Resolve conflicts as real 3-way merges — never take a side wholesale on a source file. Generated docs (docs/FACTS.md, compiler/SPEC-INDEX.md, docs/known-gaps.md §0, docs/bootstrap-conformance.md): take either side then REGENERATE with their scripts (`bun scripts/facts.ts --write`, `bun run scripts/regen-spec-index.ts`, `bun scripts/state.ts --write`, and the bootstrap-conformance regen named in .github/workflows/ci.yml) and confirm each `--check` passes. Run the core suite. Commit.

## Step 3 — build the `data-scrml-*` refusal (bryan ruling S458, "your recs on all four", item 3 — verbatim)
> **`data-scrml-*` in emitted markup:** the `data-scrml-` attribute namespace is compiler-owned (runtime markers: `data-scrml-meta`, `-outlet`, `-each-mount`, `-gated`, …), like the `_scrml_` / `__scrml_` name reservation — a `data-scrml-*` attribute in `emit()` output (compile-time) and in runtime `meta.emit` output is REFUSED (compile-time: E-META-EVAL-002; runtime: the meta.emit gate refuses + §19.6.8 log). Whether author-written SOURCE markup may carry `data-scrml-*` is not ruled here — measure and surface at build.

- Compile-time: the allow-list branch already refuses non-plain `emit()` output with E-META-EVAL-002 — add `data-scrml-*` attribute names (case-insensitive, as the HTML parser would read them) to that refusal on the SAME reader that judges the rest of emit output. No second reader.
- Runtime: the meta.emit gate (this branch) judges `meta.emit(html)` output — add the same rule there, same reader as its other attribute checks; refusal = nothing written + §19.6.8 log, exactly like its existing refusals.
- Exempt-by-name lists are forbidden; this is a prefix rule over attribute names as the HTML tokenizer sees them (watch: uppercase, attributes with no value, attributes split by `/`, entity-encoded names are NOT decoded by HTML attribute-name tokenizing — confirm behaviour with the real parser your gate uses).
- SPEC: amend §22.4.1 / §22.5.1 (and E-META-EVAL-002's §34 row) with the rule, with a `> **Provenance:** ruling:user-voice-scrml.md S458 "your recs on all four"` line. Also apply the two CONFIRMED text changes from the same ruling item 4 if not already on the branch: (a) §22.5.1's `meta.emit` row drops the "escape-sequence normalization" claim; (b) §22.5's impl#1 note admitting a function for the bindings argument.
- Conformance: add a negative case for each (compile-time + runtime) and a positive case showing ordinary `data-*` attributes still pass, following the conformance/ data format already used for E-META-EVAL-002.
- MEASURE (do not change): how many corpus SOURCE files (samples/, examples/, stdlib/, conformance/) carry author-written `data-scrml-*` attributes outside `^{}`; list them in progress.md and the report — that is a separate ruling for bryan.

## Step 4 — verify
- Core suite: `bun test compiler/tests/{unit,integration,conformance} --bail` = 0 fail. Browser tier: run the browser-tier gate step exactly as `.github/workflows/ci.yml` invokes it.
- `bun conformance/run.ts` — no regressions vs the merged base.
- Corpus differential: compile the samples/examples corpus at the merged base (before Step 3) vs your tip; every diff must be explained (expected: none outside the new refusal).
- Pre-commit hook runs the core suite: never `--no-verify`, never touch core.hooksPath.

## Final report
WT path · final SHA · branch name · merge conflicts and how each was resolved · files touched by Step 3 · test/conformance/differential results (executed) · the source-markup `data-scrml-*` count · anything not done. Do NOT push.

## S459 addendum

PA addendum to your brief (s459-meta-emit-gate-merge) — add this as Step 3b after the data-scrml-* work; append it verbatim to your BRIEF.md under "S459 addendum". The base allow-list branch (a55464de4) is now PR #1359, landing to main as-is; these are its review nits, to land on YOUR branch:

1. MED (pre-existing, also on main): in a COMPILE-TIME `^{}`, `while`, `function` and `match` statements are silently dropped — `meta-eval.ts` `serializeNode` returns "" in its `default:` while reader 1 admits them (e.g. a `while (i<3)` loop building `<li>`s renders `<ul></ul>` with no diagnostic). Reproduce first. Then: grep SPEC §22 (esp. §22.4, §22.12) for whether these statements are legal in compile-time meta. If a governing sentence admits them → make the serializer EMIT them (conformance restoration). If none → refuse every statement kind the serializer cannot emit, with a diagnostic naming the kind (fail closed), and measure the corpus count. Either way: no statement kind admitted by reader 1 may be dropped — make that true by construction (the serializer's default case must refuse, not return "").
2. LOW: a `function wrap(){}` inside compile-time `^{}` reports "E-META-001 'wrap' is not available … not a local binding" — wrong cause; falls out of #1.
3. LOW: a runtime `^{}` reading `window` reports E-META-001 twice (both checkers) — report once.
4. LOW: the E-META-001 message for a plain `x = …` reassignment is broken ("…or declare a new `const` is not admitted…") — fix the wording.
5. LOW docs: §22.5.2 still says "The compiler SHALL emit `capturedBindings` as an object literal" while the ruled form emits a function (the §22.5 note) — reconcile §22.5.2 to the ruled form.
6. LOW (open from the prior review): `_SCRML_DEFAULT_MESSAGES` / `_SCRML_TAG_TO_VALIDATOR` are plain `{}` at runtime-template.js (~:4948, ~:4986) — use null-prototype objects (or the same author-keyed registry shape) so a key like "constructor" cannot read Object.prototype.
Report each with executed evidence. Rebase note: when #1359 merges, `git merge origin/main` should be a no-op for those files since you already merged a55464de4.

## S459 addendum 2

PA: accepted your recommendation (PA-ruled consequence of the S458 ruling, bryan veto window). Widen the compiler-owned attribute rule at BOTH sites (compile-time checkEmittedNodes + runtime meta.emit gate, same single predicate) to: name (ASCII-case-folded) is exactly `data-scrml` OR starts with `data-scrml-`. Update the SPEC sentences you added (§22.4.1, §22.12, §22.5.1 row, §34 E-META-EVAL-002 row) to say so, with provenance `ruling:user-voice-scrml.md S458 "your recs on all four" · PA-ruled S459 consequence (bare data-scrml = the component CSS scope root, emit-css @scope)`. Add negative cases (compile-time + runtime) for bare `data-scrml="Card"`, and keep `data-scrmlx` / `x-data-scrml-y` admitted (positive). Re-run core + conformance + browser tier. Also: confirm which SHA is your final tip — your report says 3dc711edf but the differential names 4a8fd119a; state the full commit list on the branch with `git log --format='%h %s' 228b0be22..HEAD`. Append this message to your BRIEF.md addendum. Report the new final SHA.

## S459 addendum 3

PA: S459 review of a7480c675 = DO-NOT-LAND on one HIGH (reviewer-executed in Chromium; recorded output at /home/bryan-maclee/.cache/scrml-agent-tmp/s459-rev-metaemit/harness/head.out, harness run.cjs — read-only, copy it). bryan RATIFIED your §22.4 "SHALL NOT be dropped" sentence. Next round on the same branch, same rules (commit after each change; progress.md "S459 round 3"; no push). Append this message verbatim to BRIEF.md as "S459 addendum 3".

1. HIGH — DOM clobbering defeats the runtime gate. `_scrml_meta_emit_violation` walks with `node.lastChild`, `c.previousSibling`, `node.attributes`; on an HTMLFormElement ([LegacyOverrideBuiltIns]) a named control in the emitted string shadows those, so the gate approves a tree it never fully read. Four inputs inserted with 0 logs and executed (head.out: clobber-lastChild, clobber-prevSibling, clobber-attributes [form action=javascript:], clobber-attributes-on [form onclick]). Governing: §22.12 "judge the parsed tree, every descendant … the tree judged is the tree inserted". FIX AT THE ROOT: (a) traverse and read ONLY through unforgeable accessors captured at chunk load — `Object.getOwnPropertyDescriptor(Node.prototype,'firstChild'|'nextSibling'|'nodeType'|'parentNode').get`, `Element.prototype` getters for `attributes`/`localName`/`namespaceURI`, `NamedNodeMap.prototype.item`/`length` getters, `Element.prototype.getAttribute` etc. via `.call` — or a `document.createTreeWalker`/`NodeIterator` obtained from captured prototype methods; never a property read on a node the data shaped. (b) Same for every `document.*` the gate and `_scrml_meta_emit` call (`implementation.createHTMLDocument`, `querySelector`) — capture at load (F2: `name=`/`id=` in data can clobber `document.querySelector` / `document.implementation`). (c) Belt-and-braces, fail closed: refuse any `name`/`id` value that equals a DOM/HTMLFormElement/Document member (or simply refuse `name=` on form controls and `id`/`name` colliding with `document` members) — measure corpus impact.
2. MAKE THE ATTRIBUTE TEST CLOSED (fork rule: fail-closed wins; S456 lesson — never a deny-list for an injection sink). Today elements are an allow-list but attributes are a deny-list (`on*`, `srcdoc`, `data-scrml*`, URL-valued judged by scheme; everything else passes). Replace with an allow-list: the standard global + per-element HTML/SVG/MathML presentation attributes known to be non-executing, `data-*` (minus `data-scrml*`), `aria-*`, with URL-valued attributes still judged by §5.2 scheme; anything not on the list refused. Use the SAME predicate for compile-time `emit()` output (the S458 ruling: "held to the same closed rule as compile-time emit()") — check whether the compile-time rule is closed today; if it is also a deny-list, close both in one shared predicate. Measure corpus impact of the narrowing (count + files); if any legit corpus emit loses, list it and stop for the PA.
3. One predicate, not two copies: move the data-scrml rule (and ideally the whole attribute judge) into ONE shared file inlined into the runtime the way runtime-url-guard.js is, imported by meta-eval.ts — so compile-time and runtime cannot drift.
4. F3 LOW: `^{ function item(s) { emit("<li>" + s + "</li>") } item("q") }` → E-META-001 "Runtime variable 's'" + E-META-005 (meta-checker misclassifies a function PARAMETER read in an emitting block). Fix the param classification (or, if larger than a round, document it as a carried gap beside the `lin` one and say so).
5. Conformance cases for each of the four clobbering shapes (rt cases: nothing written, one log) + F2 shape + an allow-list negative + positives that legit attributes (class, title, href=https, data-x, aria-label, svg viewBox) still pass.
Gates: core, browser tier, conformance, corpus differential vs a7480c675. Report final SHA + per-item evidence. Note: the reviewer's harness needs a Chromium (playwright chromium_headless_shell-1223 + puppeteer 24.40.0 were used) — re-run all 41 inputs on your tip and report the table.

## S459 addendum 4 — PA-ruled S459: meta descriptive attrs; http-equiv refused

PA decision on the one corpus loss (samples/compilation-tests/meta-conditional-markup.scrml, `<meta name="robots" content="…"/>` refused): ADMIT `<meta>`'s descriptive attributes in the closed list — `name`, `content`, `charset`, `property`, `itemprop`, `media` (for theme-color) — and keep `http-equiv` REFUSED outright (`http-equiv="refresh"` + `content="0;url=javascript:…"` is the executable navigation sink; S456 filed meta refresh as a URL sink). Because `content` is only inert when `http-equiv` is absent, refusing `http-equiv` on the element is what makes admitting `content` safe — encode it that way (element-scoped, not a global `content` admit). The id/name clobbering belt still applies to `name` values (e.g. `<meta name="querySelector">` → refused; `robots` fine). Add a conformance positive (meta name/content renders) and a negative (`<meta http-equiv="refresh" content="0;url=https://x">` refused, compile-time and runtime). Re-run the corpus differential: compile-failure delta must be 0. Record in progress.md + BRIEF addendum as "PA-ruled S459: meta descriptive attrs; http-equiv refused". Then report the final SHA with the 41-input Chromium table.
