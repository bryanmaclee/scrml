# progress — s458-sinks-land (append-only)

## 2026-10-07 — start
- Worktree verified (agent- prefix, toplevel == pwd, clean). origin/main = 0c1a1b081 (includes #1345); ff-only: already up to date.
- Source change: worktree-agent-a885fd5687d9b5ebe @ 847719d0a, base b6a6b64f0 (id s457-executable-sinks-srcdoc-svg).

## 2026-10-07 — apply + adapt
- 3-way apply of the source diff (excl. the 4 PA-owned/generated docs): 1 conflict, runtime-url-guard.d.ts — kept both (#1347 `_scrml_url_shape_ok` + the 4-arg `_scrml_safe_url` + SVG sets).
- Audit for bare compiler locals: sinks emitters take elVar / EL / tplElemId as parameters; emitValueAttrApply defaults to `_scrml_el`; refusal emits a comment only. None introduced.
- Tests adapted: integration §4 two pins `el` -> `_scrml_el` (#1345); browser `mount` reads in-memory outputs on an erroring compile (#1348 writes no artifact).
- Change's tests: unit+integration+url-guard 223/0; browser 9/0. conformance/run.ts 1353/1403 + 50 xfail, 0 fail. types-gate OK unchanged. browser-baseline --check PASS (x2; harness parser self-check aborts intermittently under load, 2 of 5 runs).
- Regenerated SPEC-INDEX, FACTS, bootstrap-conformance.

## 2026-10-07 — landing commit + verification
- Landing commit hook: 32409 pass / 0 fail (unit+integration+conformance). facts --check PASS; SPEC-INDEX --check OK.
- Change's suites on base (origin/main 0c1a1b081, files copied into a git-archive tree) vs head: base 29 pass / 134 fail (integration + browser); head 132/0 (integration 123 + browser 9).
- Compile probes base -> head: `srcdoc=${@doc}` / `SRCDOC=` / each-row srcdoc: compiles + setAttribute("srcdoc", data) -> E-ATTR-INTERP-EXECUTABLE. `<set attributeName="href" to=${@u}>`: dropped -> bound + `_scrml_safe_url(.., "to", .., "href")`. `to="${@u}"`, `values="${@u}"`: unguarded -> guarded with target "href". `to="javascript:${@u}"`: compiles -> refused. `ONCLICK=${@code}`: setAttribute text -> refused. lift `<Btn onClick=it.code/>` (declared) and `<button onClick=it.code>`: setAttribute("onClick", it.code) -> addEventListener("click", ...).
- Corpus differential (scripts/corpus-emit-differential.ts capture base=.tmp/base git-archive 0c1a1b081, head=worktree, --concurrency 4; then diff): sources 2425/2432 (+7 new cases); compile-failure delta 0/0; diagnostic CODE changes 0; syntax 0/0/0; bare server-fn 233/233. 184 artifact diffs: 177 path/hash-only, 5 runtime files (urlguard chunk gained the SVG sets + 4th param; the 5 sources that load the urlguard chunk), 2 OTHER = trucking dispatch/load-detail (2 lines) + dispatch/load-new (6 lines), each `setAttribute("onX", fnRef)` -> addEventListener. The 3rd review file, samples/compilation-tests/gauntlet-r10-ts-components, has 9 pre-existing E-COMPONENT errors on BOTH sides -> since #1348 it writes no artifact, so the disk differential cannot see it; in-memory compile shows the same intended `setAttribute("onDismiss", ..)` -> addEventListener("dismiss", ..) delta. No other delta.
