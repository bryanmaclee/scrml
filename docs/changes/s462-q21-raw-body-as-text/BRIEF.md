You are a dispatched dev agent on the scrml repo (impl#1 compiler/src, plus the bootstrap compiler/self-host-v2). PA session S462. You are implementing ruling Q21. Read scrml-support/user-voice-scrml.md S462 Q21 "I like a." verbatim first.

FIRST:
1. `git fetch origin && git merge origin/main`. Main is at or after a9aa81eff and includes #1400 (element-refusal.ts, the raw-content scan, refuseRawContentLowering).
2. Archive this prompt verbatim to docs/changes/s462-q21-raw-body-as-text/BRIEF.md, then commit it together with a progress.md.

Commit rules:
- Commit incrementally.
- Code and its tests go in one commit.
- Never use --no-verify and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15. Use a 600000 timeout and run the commit in the foreground.

THE RULING:
- `<pre>` / `<code>` raw bodies are emitted with `<` and `>` entity-encoded. What you type is what's shown; nothing in a raw body can execute; no danger-name list.
- `&` is NOT encoded: 1,608 corpus bodies use `&lt;…&gt;` to display code.
- A nested `<code>` / `<pre>` element stays an element, because 326 corpus bodies are bare `<pre><code>…</code></pre>` wrappers. Measured breakage: 0 across 4,523 raw bodies in 12 repos.
- This supersedes §4.17's "author responsibility" for markup in raw content.

TASK:
- Implement the encoding at the point the raw body becomes output: static HTML, SSR, client createElement or textContent paths, component props substituted into a raw body (encode AFTER substitution), raw bodies inside each/match/lift/`^{}` emit.
- Find every emitter path. #1400's refuseRawContentLowering marks most of them.
- The nested `<pre>`/`<code>` exception needs care. Only a nested `<pre>`/`<code>` ELEMENT with no attributes stays structural, and its own text is encoded recursively. Decide whether to allow attributes on the nested `<code>` (e.g. `class="lang-js"`). Measure the corpus: if none carry attributes, refuse attributes there with a clear diagnostic or encode them as text. Report which you chose.
- `<script`/`<style>` start-tag text in a raw body (refused by #1400): with encoding it becomes harmless text. Keep the refusal anyway (defence in depth, and the code stays meaningful), or drop it as redundant? Recommend one and report it; do not drop it without saying so.
- SPEC: rewrite the §4.17 raw-content paragraph to the new rule, with provenance `ruling:user-voice-scrml.md S462 Q21 "I like a."`, and state it is newly-encoding: rendered output changes. Resolve the gap g-raw-content-static-active-html-executes-s462.
- Bootstrap: implement the same rule if the bootstrap has a raw-content path. It currently has none (g-bootstrap-raw-content-not-fail-closed-s462), so add a raw-content mode or record a precise gap.

TESTS: run every Chromium repro from the gap entry: onerror, svg onload, iframe srcdoc (both forms), link stylesheet, and the static component prop. Each must render as visible text and run nothing. Then:
- the `<pre><code>…</code></pre>` wrapper still renders a `<code>` element;
- `&lt;b&gt;` still displays as `<b>`;
- `a < b` displays correctly.
Add unit and conformance cases.

CORPUS: run an emit differential over every repo the gap measured. Expected: rendered output changes only where a raw body contained `<` or `>` outside the wrapper. List those sites, and confirm visually (via Chromium screenshot text or innerText comparison) that the corpus pages' displayed text is unchanged wherever the raw body contained no tags.

GATES (all):
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (re-run on the known "PARSER DISAGREES" flake)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate and corpus-compile-floor
- the self-host-v2 slices, if the bootstrap is touched

Resolve generated-doc conflicts by hunk and regenerate. Restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the emitter paths covered, the nested-code-attribute and script-refusal decisions, the corpus diff, and the gates table. Do NOT push.
