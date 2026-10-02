change-id: s447-retire-self-host-v1

## Task (verbatim from PA dispatch, S447)
bryan RULED at S447 (scrml-support/user-voice-scrml.md, S447 entry "RULED — \"your recs, except expound 3b\" …", TS accounting item 3): retire dead weight — remove the FROZEN `compiler/self-host/` (~22k lines; frozen by the S437 dpa-051 ruling; it survives in git history). The live bootstrap is `compiler/self-host-v2/` — DO NOT touch it.

Step 1 — survey (record in progress.md before deleting anything): every reference to `compiler/self-host/` outside itself. Classify each: (a) parse/compile corpus -> coverage would be LOST (re-point at a living corpus; report before/after counts); (b) tests self-host behaviour itself -> delete; (c) tooling to rebuild self-host dist -> delete; (d) compiler/src runtime dependency -> remove carefully (prove dead first).
Step 2 — remove compiler/self-host/, (b)/(c), (d) shim; re-point (a).
Step 3 — docs: PRIMER §12 shim note, master-list sections, FACTS (`bun scripts/facts.ts --write`), SPEC-INDEX if any. Leave .claude/maps/. No changelog.
Step 4 — gates: unit/integration/conformance + root-level compiler/tests/*.test.js per ci.yml + commands tier + bootstrap slices. Failing-test NAME set must equal origin/main's minus only deleted tests. Update CI workflow if it references self-host paths.
Push `git push origin HEAD:refs/heads/chore/s447-retire-self-host-v1`. No PR.
