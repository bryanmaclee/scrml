You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. Priority HIGH SECURITY: data reaches JS execution.

FIRST:
1. Run `git fetch origin && git merge origin/main`. Main is at or after d6820a607.
2. Archive this prompt verbatim to docs/changes/s462-impl1-script-style-everywhere/BRIEF.md, then commit it with a progress.md.

Commit rules:
- Commit incrementally.
- Code and its tests go in one commit.
- Never use --no-verify and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15. Use timeout 300000 and commit in the foreground.

GOVERNING SPEC, §4.17 (read it in full via SPEC-INDEX): "`<script>` and `<style>` are NOT raw-content in scrml because scrml does not admit those elements at all. Both are rejected symmetrically at the block-splitter level: `<style>` triggers E-STYLE-001 …, and `<script>` triggers E-SCRIPT-001 … The match on the tag name is exact, not a prefix — `<noscript>` is an ordinary element and is unaffected."

THE HOLE (Chromium-confirmed by review): impl#1 refuses `<script>`/`<style>` only on the block-splitter's markup-opener path. Everywhere else they pass:
- (a) `lift` emits createElement("script"/"style"):
  `<program> <code> = "window.pwned=7" <u> = "/evil.js" ${ lift <script>${@code}</script> } ${ lift <script src=@u></script> } ${ lift <style>${@code}</style> } </program>`
  Cell data runs as JS, and a data-chosen script loads. The only diagnostic is a W-LINT-001 lint on style.
- (b) Inside an `<each>` body, and in markup inside `${ … }`, the element is silently dropped (fail-safe, but it must be refused).
- (c) `<pre>`/`<code>` raw content passes a literal `<script>`/`<style>` through to the served HTML, and it executes. Author-static only.

TASK:
- Refuse `<script>`/`<style>` with E-SCRIPT-001/E-STYLE-001 at EVERY position where markup is parsed or built. That includes lift, each bodies, logic-block markup, match arms producing markup, components and slots, attributes holding markup, and anything else you find by reading the parser and codegen. Use the same exact-name, case-insensitive rule and the same recovery.
- Decide from parsed nodes, not text (Overlay Rule 7). The right place is wherever markup elements become AST nodes; consider one structural check over all element nodes.
- Defence in depth: the runtime/codegen element constructor should also refuse to create a script element from compiled code.
- For (c): §4.17 says both "author responsibility" (raw content) and "does not admit those elements at all". Measure the corpus for `<pre>`/`<code>` blocks containing a literal `<script`/`<style` tag.
  - If the measured count is ZERO, refuse it there too (newly-rejecting, PA-ruled by the governing sentence "does not admit those elements at all"). Amend §4.17's raw-content sentence to say so, with provenance `prov=pa-ruled:` naming the measurement.
  - If the count is NONZERO, implement (a) and (b) only and report the sites; do not decide (c).
- Bootstrap parity: the bootstrap now refuses at every opener (branch s462-bootstrap-script-style-refusal, landing soon). Keep codes aligned.

TESTS: compile and run in Chromium (Playwright Chromium is in node_modules) for (a), all three forms. They must refuse at compile time, and on base they must have executed. Unit and conformance cases for every position. No false refusals: noscript, scripts, style-x, script_x, the style= attribute, `#{}`, `_{}` foreign code, and `<script` inside strings, comments, text or attribute values.

GATES, all of them:
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (the "PARSER DISAGREES" refusal is a known flake; re-run it)
- `s34-census --check-new`
- host-global-scan --check
- facts / spec-index / bootstrap-conformance / severity --check
- snippet-gate and corpus-compile-floor
- a corpus differential, with every newly refused site listed

Resolve generated-doc conflicts by hunk, then regenerate, and restore master-list.md from origin/main. Write only inside your worktree. Resolve or update the known-gaps entries for these holes.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, every position covered, the (c) corpus measurement and decision, newly refused sites, and the gates table. Do NOT push.
