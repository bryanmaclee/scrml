# BRIEF — s462-register-messages-templates

Change-id: `s462-register-messages-templates`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote, do not reinterpret)
bryan S462 "go on the package" (scrml-support/user-voice-scrml.md §S462, "no-function-in-value migration" entry): `registerMessages` (SPEC §41.12 / §55.10) values become MESSAGE TEMPLATES with named slots — e.g. `registerMessages({ .Required: "Please fill in {field}." })` — not functions. Consequence of "no value holds a function" (§14.3 extended S462).

## Scope
- Read SPEC §41.12, §55.5, §55.9 (ValidationError variants + payloads), §55.10 (the 4-level message chain) IN FULL first.
- Define the template grammar normatively in §41.12: slot syntax (`{name}` — check it doesn't collide with scrml `${}` interpolation inside a string literal; if `{…}` inside a scrml string is already meaningful, propose the least-surprising alternative and report), which slot names exist per ValidationError variant (`field`, and the variant's payload fields: `threshold`, `expected`, `set`, `re`, `predicate`…), escaping a literal `{`, unknown slot name = compile error when the template is a literal (name the code), and runtime behaviour for a non-literal template (render the slot names that exist; unknown ones? — fail-closed choice, report). Statically extractable for i18n: say so.
- Runtime: `scrml:data` `registerMessages` + `messageFor` + the compiler's message resolution (`emit-messages.ts`, `_scrml_message_for`, the `messages` runtime chunk — PA-located-verify) interpolate templates; remove the function-call path.
- The reserved `data.registerRenderer(TypeKey, renderFn)` (v1.next) follows the same pattern — add a one-line SPEC note that it must take a non-function form when specified (do not design it).
- Migrate: `conformance/cases/forms/msgchain-l2-registered-render/case.scrml`, the kickstarter `docs/articles/llm-kickstarter-v2-2026-05-04.md` ~:971 example, any stdlib/samples/examples/docs usage (grep `registerMessages`). Adopter repos (flogence/giti/6nz) READ-ONLY: report any call sites.
- Old function-valued form: refuse it now (it would be E-VALUE-FUNCTION-STORED later; for now a specific diagnostic from registerMessages' own argument check, or leave the refusal to the later E-VALUE-FUNCTION-STORED dispatch and report which) — PA reading: since the refusal lands soon, the function form may simply stop being SUPPORTED at runtime (templates only) with a clear compile-time error naming the template form. Measure corpus first.
- Conformance: template rendering per variant incl. payload slots, runtime-executed.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-register-messages-templates): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-register-messages-templates/` · full suite + conformance + browser-tier + types:check · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · template grammar as specified · runtime changes · migrated sites · adopter sites · direction-setting choices for bryan's veto.
