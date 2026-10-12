You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. Build phase 2 of `<md>`: the compiler lowers STATIC `<md>` bodies into elements at build time, using the single scrml reader.

READ FIRST, in full:
- SPEC §67 on main (landed in #1403);
- docs/changes/s462-md-phase1/progress.md, which contains the phase-2 design notes: U+FFFC slots plus a slot-offset list, `parseSlots`, the splitter half of MED-2, and E-MD-INTERP-UNCLOSED;
- the rulings at the end of /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md: Q21, `<md>` F1–F4 and Q22 "c is good";
- the deep-dive /home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/md-element-2026-10-11.md §7 (MD-SAFE).

FIRST:
1. `git fetch origin && git merge origin/main` (main is at or after 37e50e881).
2. Archive this prompt verbatim to docs/changes/s462-md-phase2/BRIEF.md, then commit it with a progress.md.
3. Commit rules:
   - Commit incrementally; code and its test go in one commit.
   - Never use --no-verify and never disable hooks.
   - Before each commit, wait until free memory is above 6GB and the load average is below 15.
   - Commit in the foreground with timeout 600000.
4. Use your own scratch subdir; never the shared scratchpad root or scratchpad/base.

PHASE 2 SCOPE:
A) Recognise `<md>` as a body-mode element (§67.2): the block-splitter / ast-builder body production. The body has exactly two exits, `${…}` and `</md>`.
   - The splitter takes each balanced `${…}` extent WITHOUT parsing it and records it as a slot.
   - An unbalanced `${` before `</md>` is E-MD-INTERP-UNCLOSED, and its message names `<pre>`.
   - Dedent per §67.2: the closer's line is not counted.
   - Raise E-MD-IN-PHRASING (`<md>` inside phrasing content, including `a`) and E-MD-OF-BODY (`of=` plus a body).
B) The compile-time hook (F4). impl#1 calls the scrml:md reader at compile time to parse the static body: `parseSlots(src, slots)` returns the node tree plus W-MD diagnostics.
   - Use the GENERATED shim (compiler/runtime/stdlib/md.js) or a compile of stdlib/md/index.scrml. Do not write a TS md parser (one reader).
   - Map the reader's diagnostics (offset, line, col) to source positions in the .scrml file, and surface them as compiler warnings. Static bodies only (Q22: strict for static).
C) Lower the tree to the CLOSED element set in §67.6:
   - Content reaches the page only as text nodes or the fixed attributes. Never build an HTML string for the browser to parse.
   - Static parts are emitted into HTML with every text character encoded.
   - `<md>` host attributes (class/id/style) come from the author only.
   - Heading ids: compiler slugs (`headingSlugs`) for static only, deduped page-wide against author ids.
   - `code class="language-…"` follows §67.6.
D) Slots (F1, text-only):
   - Each slot in inline text or link text becomes a reactive text binding: it updates when its cells change, and is never parsed as markdown or HTML.
   - A slot inside a destination makes the URL data-led. It is judged at runtime by the §5.2 rule 3 guard on the exact string written.
   - A slot inside code is restored as its exact source text and is never parsed or scope-checked.
   - Parse each slot's expression only AFTER the reader has placed it, so only non-code slots are scope-checked.
   - A literal static URL with an unadmitted scheme is E-MD-URL-SCHEME at compile time.
E) SSR and client paths, plus emitters: static HTML, SSR, `<each>`/`<match>`/`if=`/component positions where `<md>` can appear. Reuse the existing text-binding and attribute-guard machinery.
F) Update SPEC §67 for Q22:
   - static `<md>` is strict (a second spelling renders as text plus a lint, which is the current reader behaviour);
   - `of=` will be forgiving (phase 3: a second spelling renders as its canonical construct);
   - quote the ruling with provenance.
   Move every §34 E-MD/W-MD row from Nominal to Implemented where this phase implements it.
G) Bootstrap: impl#2 has no `<md>`. Record a precise known-gaps entry.

TESTS:
- Compile realistic `<md>` pages and run them in happy-dom AND in Playwright Chromium (it is in node_modules). Check the DOM structure equals the expected closed-set tree; check slots update reactively; check `${HOME:-/tmp}` in a fence compiles and shows literally.
- Hostile slot values: `**x**`, `<img onerror>`, `[a](javascript:…)`, newlines plus `## heading`. They render as text, never as structure, and nothing runs.
- A data-led `href` with a `javascript:` value is blocked at runtime.
- An author `javascript:` literal gives E-MD-URL-SCHEME.
- Add unit and conformance cases. The conformance harness is program-level, so add real `<md>` program cases with runtime halves.

CORPUS: no existing program uses `<md>`, so the expected diff is 0. Run the emit differential to confirm. Also convert ONE real article from scrml/docs/articles (pick a short one) into `<md>` as a sample under samples/. Compile it, render it in Chromium, and report it as a dog-food. Do not change the article source.

GATES (all):
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (re-run on PARSER DISAGREES)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate
- corpus-compile-floor
- gen-md-shim --check

Resolve generated-doc conflicts by hunk and regenerate; restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the design (where the hook lives, how slots are threaded, diagnostic position mapping), the emitter paths covered, the dog-food result, any decision the rulings didn't cover (each as a question with your recommendation), and the gates table. Do NOT push.
