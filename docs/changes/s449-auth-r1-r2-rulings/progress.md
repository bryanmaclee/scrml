# progress — s449-auth-r1-r2-rulings

- 2026-10-02T16:51:53-06:00 start; base 8b58ed588 == origin/main; bun install + pretest ok

## Item 1 — @session in a server context — 2026-10-02T~17:40-06:00
- Corpus baseline (.tmp/sweep.ts, 2234 units: examples/ (subdirs = one program each), samples/, conformance/cases/, docs/readme-snippets/, stdlib/) captured on base before any edit.
- Reproduced on base: server.js emits `_scrml_body["session"].userId`. Probes: wholly-server fn, CPS fn, SSE generator, nested fn, no-auth bare `@session` all read the body; a `<cell server>` load query gets W-AUTH-004 (query not emitted).
- Front end: route-inference.ts `detectServerAmbientSessionReads` + E-SESSION-AMBIENT-SERVER (server-placed fn bodies incl. handle(), nested fns, `?{}` interpolations; `<cell server>` load queries). A user `<session>` cell is exempt (E-REACTIVE-003 governs).
- Backstop: codegen/server-session-guard.ts on emitIdent / rewriteServerAtRef / serverRewriteEmitted / expression-parser AST path -> `_scrml_server_session_refused` + E-INTERNAL-SESSION-AMBIENT-SERVER (api.js drops it when RI reported). Verified by temporarily disabling the RI check: all 5 fn shapes fired the internal code; no body read emitted.
- refusal-gate: the new codes refuse the write.
- HTTP evidence (.tmp/http-evidence.ts):
  - BEFORE (8b58ed588 compiler): 0 errors; emitted ``VALUES (${_scrml_body["session"].userId}, ${body})``; authed as u-real, POST saveNote {body:'spoofed',session:{userId:'victim'}} -> 200; rows [{"sid":"victim","body":"spoofed"}]
  - AFTER, `@session` form: E-SESSION-AMBIENT-SERVER; emitted text uses `_scrml_server_session_refused`.
  - AFTER, migrated `session.userId` form: 0 errors; POST -> 200; rows [{"sid":"u-real","body":"spoofed"}]
- Commits c5fbd6818 (code+tests+conformance), 0d3d6a6eb (SPEC).
