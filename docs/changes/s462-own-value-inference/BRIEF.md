# BRIEF — s462-own-value-inference (dpa-065 / O35(d))

Change-id: `s462-own-value-inference`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote, do not reinterpret)
bryan S462 "go on the package" (scrml-support/user-voice-scrml.md §S462) = the dPA recommendation in `../scrml-support/docs/deep-dives/own-value-type-annotation-o35d-dpa-065-2026-10-08.md` §7, i.e. §8 rulings 1-10 all as recommended. READ THAT DEEP-DIVE IN FULL FIRST (it is in the sibling repo; read-only). Summary:
1. O35(d) — "must a non-literal own value carry a type?" — recorded as its own item beside O35(a)(b)(c) in §66.3 / §66.22 (and marked RULED).
2. Within a file, a non-literal own value's type is INFERRED from its initializer.
3. The inferable set is ENUMERATED normatively in SPEC §66.3: literals; a typed `@ref`; arithmetic, comparison, ternary and `.length` over members of the set; calls to functions with a declared or inferred-and-proven return. Inferred from the initializer only.
4. An inferred type is the BASE type (no literal singleton, no refinement).
5. An initializer outside the set (failed inference) is a HARD ERROR with a new §34 row; the fix named in the message is to write `:T` (or `:asIs`). This deliberately diverges from §7.5.2's `unknown` + W-TYPE-031-UNPROVEN for LOCALS — say so in SPEC.
6. When a declaration is both cyclic and unannotated, the cycle diagnostic wins.
7. `:T` REQUIRED on a non-literal `persist=` own value (§6.14). Literal persist cells unchanged (§6.14's own `= "all"` example stays legal).
8. `:T` REQUIRED on a non-literal server-authority own value (§52).
9. A non-literal EXPORTED own value: `:T` required by default, until O2/O39 rules (state the default + its reopening condition in §66.14 near O2/O39).
10. `:T` over an initializer the typer cannot prove (e.g. a call to an unannotated function) is reported UNPROVEN — never silently accepted. State whether that is an error or a W/I code and justify against §7.5.2 (prefer fail-closed; if you choose a non-error, flag it for bryan's veto).
Provenance line for every SPEC edit: `> **Provenance:** ruling:user-voice-scrml.md S462 "go on the package" · dd:scrml-support/docs/deep-dives/own-value-type-annotation-o35d-dpa-065-2026-10-08.md`.

## Scope
- §66 is Nominal on impl#1 (impl#1 does not compile §66 forms; its divergence is CARRIED). The build target is the BOOTSTRAP (`compiler/self-host-v2/`), plus SPEC text. Do NOT change impl#1 behaviour.
- New error codes: name them (e.g. `E-DECL-TYPE-NOT-INFERABLE`, `E-DECL-TYPE-REQUIRED-AT-BOUNDARY`, and the unproven code) — names are a PA-reading for bryan's veto; keep them few and consistent with the §66.20 diagnostic naming already in SPEC. §34 rows + §66.20 list.
- Bootstrap: implement the enumerated inference, the hard error, the boundary requirements (persist=, server, export as far as the bootstrap parses them — UNSUPPORTED shapes reported, not faked), the cycle precedence, the unproven report. The deep-dive says the bootstrap typer already infers 14 of the 19 corpus cases; 2 need typer coverage, 1 not inferable, 2 cycles — reproduce those numbers and report.
- Conformance: cases per ruling item the bootstrap can express (mark impl#1 as Nominal per the existing convention for §66 cases — find it; do not invent one). Regenerate SPEC-INDEX, FACTS, bootstrap-conformance.
- MEASURE: which corpus sites change outcome under the bootstrap (the `fix-s66.js` codemod corpus — the 159 type-only / 19 O35(d) cases in the deep-dive). Report.

## In-flight siblings (expect 3-way merges at landing; the PA merges)
s462-given-presence-deprecate, s462-is-some-deprecate, s462-narrowing-ends-on-write, s462-channel-006-inferred — they touch SPEC §34/§42/§38, `compiler/self-host-v2/analyze.scrml` and `parse.scrml`, and generated docs. Keep your edits to your loci; if you must edit analyze.scrml / check.scrml, keep hunks tight.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-own-value-inference): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-own-value-inference/` · run the ci.yml bootstrap steps + browser-tier step + `bun run types:check` before reporting · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · files · SPEC sections changed · code names chosen · inference set as written · corpus measurement · UNSUPPORTED shapes · direction-setting choices for bryan's veto.
