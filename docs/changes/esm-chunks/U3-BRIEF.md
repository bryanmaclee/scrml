# U3 dispatch brief (archived verbatim, S278) — ESM chunks: module <script> tags + build-hash fix + warning-narrow

Agent: scrml-js-codegen-engineer · opus · isolation:worktree · run_in_background · dispatched S278 on HEAD 62f2cf4f (after U1 #132 + U2 #133 landed).
Arc: docs/changes/esm-chunks/BRIEF.md. Verbatim instruction record.

SCOPE (under --module-format=esm; classic byte-identical): (A) emit `type="module"` on every client-chunk +
runtime `<script src>` tag — single-file (index.ts ~L1758 runtime / ~L1770 deps / ~L1772 entry), composed-MPA
(~L2051-2140 strip-and-readd), and the emit-html.ts role-bootstrap dynamic inject (~L4043-4085, add s.type=module);
(B) fix build+esm content-hash 404 — extend the hash-rewrite to in-chunk ES import URLs (close
g-esm-build-content-hash-import-urls; un-skip the §6 pinned test); (C) narrow W-MODULE-FORMAT-ESM-INCOMPLETE
(module-format-notice.js) from "not browser-loadable" to "functional but experimental/opt-in; classic is the
default+conformance-tested path; committed browser harness [U5] + default-flip [U6] pending" — keep the flag+notice,
keep the embed+esm note. OUT OF SCOPE: import() nav-time loader (U4), committed module-capable browser-harness
rebuild (U5 — full-app-runs proof is a PA/agent playwright real-Chromium check, not the eval/new-Function suite),
default-flip (U6). ACCEPTANCE: classic byte-identical (trucking + website diff); esm tags carry type=module
(classic none); a FULL --esm app RUNS in real Chromium end-to-end (compile AND build modes — reactivity + boot +
event handler; pick a client-only app shape if a server/db dep would error, since trucking's _scrml_stdlib.store is
a pre-existing classic-identical error); build+esm imports resolve (§6 test green, 0 on-disk 404s); full gate 0 fail.
F4 + MAPS(9481bc69→62f2cf4f, U1/U2-since) + refusal-welcome + crash-recovery(progress.md). PA runs S239 + R26
(real-Chromium full-app-run) at land. Do NOT touch BRIEF/U1-BRIEF/U2-BRIEF.
