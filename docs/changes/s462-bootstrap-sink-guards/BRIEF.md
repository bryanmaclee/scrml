# BRIEF — s462-bootstrap-sink-guards (HIGH, security; prerequisite for X)

Change-id: `s462-bootstrap-sink-guards`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The finding (RELAYED-UNVERIFIED — reproduce FIRST)
The O46 deep-dive (`../scrml-support/docs/deep-dives/attribute-spread-o46-x-forwarding-2026-10-09.md`, read its security section) reports that the BOOTSTRAP compiler (`compiler/self-host-v2/`) writes data-bound executable sinks with no guard: `srcdoc=@cell` compiles and writes the data; `href=@cell` writes a `javascript:` URL unguarded (`runtime.js` ~L1050 a bare `setAttribute`). Confirmed by the deep-dive from emitted output + runtime source, NOT in a browser. **Step 1: reproduce on current origin/main — compile with the bootstrap, and EXECUTE in happy-dom or a real browser harness that a `javascript:` href / a `srcdoc` payload is actually written. If it does not reproduce, STOP and report (classify NOT-REPRODUCED with evidence).**

## What impl#1 already does (the contract to match)
impl#1 closed this class S456/S457: §5.2 rule 3 runtime URL scheme guard (`_scrml_safe_url` — allow-list http/https/mailto/tel/relative, element-scoped, 17 emitters, SSR first paint), E-ATTR-INTERP-EXECUTABLE (event attrs fail-closed `on…`, scheme-led URL attrs, srcdoc — judged as emitted), srcdoc / SVG animation / event-text sinks (S457). Read SPEC §5.2 IN FULL (grep `### 5.2` / "rule 3") and the S456/S457 known-gaps entries (grep `E-ATTR-INTERP-EXECUTABLE`, `srcdoc`) before designing. The bootstrap must satisfy the SAME normative sentences — quote them.

## Scope
- Bootstrap codegen + runtime: every data-bound URL attribute goes through the same scheme allow-list as impl#1 (one guard — reuse impl#1's runtime helper text if the bootstrap runtime can, else port it verbatim; do NOT invent a second allow-list); `srcdoc` and `on…` text from data are refused/handled exactly as impl#1 does (compile-time where impl#1 is compile-time, runtime where runtime). `style` url(): report what impl#1 does and match it.
- Fail-closed rule: exempt known-safe NAMES only; never a dangerous-name deny-list (S456 lesson — an `on…` deny-list re-opened 19 Chromium handlers).
- Conformance: twin the existing impl#1 sink cases for the bootstrap (bootstrap-conformance report must show them PASS, not NOT-TWINNED) — runtime halves executed.
- File the gap in docs/known-gaps.md (HIGH, locus=) and resolve it with evidence in the same change.

## In-flight siblings (expect merges; the PA merges)
s462-decl-use-attr-refuse (bootstrap analyze.scrml + §66), s462-own-value-inference (bootstrap typer + §66), s462-stmt-match-leave (bootstrap parse.scrml armEnd), narrowing/is-some/given (parse/analyze). Keep bootstrap hunks tight; you mostly own the bootstrap codegen + runtime.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-bootstrap-sink-guards): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-bootstrap-sink-guards/` · ci.yml bootstrap steps + browser-tier + `bun run types:check` · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · reproduction evidence (executed) · governing sentences quoted · sinks covered (table: sink × compile/runtime × impl#1 parity) · corpus/bootstrap-test measurement · anything left open.
