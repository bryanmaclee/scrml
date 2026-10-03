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

## Item 2 — unrecognized / non-literal auth= — 2026-10-02T~18:30-06:00
- validators/attribute-allowlist.ts: E-AUTH-ATTR-INVALID (error) for any <program>/<page> auth= not exactly required|optional|none (incl. "", bare, ${…}, @x, role:X); nested programs skipped via program-role (E-PROGRAM-NESTED-AUTH stays the one code); <channel> keeps W-ATTR-002. Replaces #1234's W-ATTR-002 for these shapes.
- Probed all 8 values x {program, page} + 3 legal values + nested + channel: exactly one E-AUTH-ATTR-INVALID each, none for legal, nested = E-PROGRAM-NESTED-AUTH only, channel = W-ATTR-002.
- SPEC §52.13.1/§52.13.2 amended (supersedes: spec:§52.13.2 (W-ATTR-002 + no gate)), §40.2 member-page sentence, §34 rows. Tests updated: auth-attr-invalid-or-dynamic-value (rewritten), program-auth-required-gates-member-pages r3 F1, uvb-w1 unit + pipeline. Conformance: 3 #1234 cases now assert the error; +4 new cases.
- Commit 0beb25221.

## Corpus (2240 units after; 2234 before = +6 new conformance case files)
- Newly failing on UNMODIFIED sources: 4 — conformance/cases/reactive/server-fn-ambient-identity-clean (E-SESSION-AMBIENT-SERVER + E-AUTH-ATTR-INVALID; the ruling's named file; migrated) and the three #1234 cases auth/auth-attr-nonliteral-page-pos, auth-attr-nonliteral-program-pos, auth-attr-unrecognized-literal-no-login-lint-pos (they assert exactly these shapes; updated per brief). No other file changed error set; warning-set changes only in those files.

## Adversarial follow-up — <endpoint> arm
- Probe: `@session.userId` in an <endpoint> arm body fired only the backstop (E-INTERNAL-...): arm bodies are raw text. Front end now scans bodyRaw (string literals blanked). Channel onserver: handlers already covered. Commit bd9606d46. Corpus re-swept: 0 changes.

## Gaps — commit (gaps(s449)): 4 markers flipped to status=resolved resolved-by=s449-auth-r1-r2-rulings + new section §S449-auth-r1-r2; gap-counts + FACTS regenerated (master-list.md regen reverted — PA-owned).

## Final verification
- bun test compiler/tests/{unit,integration,conformance}: 27545 pass / 58 skip / 12 todo / 0 fail (27615 tests, 1412 files).
- bun test compiler/tests/commands: 314 pass / 3 skip / 0 fail.
- bun conformance/run.ts: 1221/1248 + 27 xfail (all accounted).

## Merge origin/main (#1236, #1237) — commit 54e3cb542 (known-gaps both sections kept; FACTS/SPEC-INDEX regenerated)

## Fix round — S239 review of 54e3cb542 (LAND-WITH-NITS) — 2026-10-02 evening
- F2 reproduced first: component-local `${ <session> = {userId:"local"} }` + top-level CPS save() → 0 errors, `_scrml_body["session"].userId`. Root: CE inlines the component body, so the file-wide census saw the cell. Fix: fileScopeDeclaresSessionCell (skips component-def / `_expandedFrom` subtrees / function bodies) in both layers. Now E-SESSION-AMBIENT-SERVER; with the front end disabled the backstop fires too.
- F1: check moved after the CPS split; scans cpsSplit.serverStmtIndices only (includes reactive-server stmts). Client tail `@msg = @session.userId` compiles, client emits `_scrml_cs_reactive_set("msg", session.userId)`; a server-half read still fires once. Splitting by half IS reliable at this stage (the split is computed in the same loop iteration, before the FunctionRoute is built).
- F3: template-literal interpolations (nested), reactive-nested-assign, raw-text fields without a parsed counterpart. Lines: expression spans carry placeholder 1:1 and (for re-parsed substrings) relative offsets; resolved from `_sourceText` only when the offset lies inside the enclosing statement, else the statement span.
- F4: emit-expr update + assignment server paths guarded (verified with the front end disabled: "emit-expr assignment" / "emit-expr update").
- F5: text scan = rewriteCodeSegments + liveSqlInterpolations.
- F6: backstop context span set per server fn in emit-server's emission loops; hits resolve to the node line when inside it, else the fn span.
- Corpus: swept the current sources with the 54e3cb542 compiler and the new one — no unit gains an error. (11 stdlib units lose E-ASYNC/AWAIT-NOT-IN-SCRML under the archived compiler only — that compiler ran from .tmp/prev, outside the repo, so its stdlib-path exemption did not apply; environmental, not this change.)
- Filed (not fixed): g-api-compile-write-true-ignores-application-scope-refusal (executed), g-server-fn-default-parameter-silently-dropped (RELAYED), g-server-fn-calls-client-only-helper-inside-sql-undefined (RELAYED).
- Commit 676b08f5f (code+tests+SPEC): pre-commit 34158 pass / 0 fail. commands 314/3 skip/0 fail; conformance 1221/1248 + 27 xfail.
