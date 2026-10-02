# progress — s449-auth-session-fail-open (append-only)

- 2026-10-02T13:46:37-06:00 start; base 2d6d8cd43 == origin/main; bun install + pretest ok.

## Item 1 — g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth

- VERIFIED LIVE on 2d6d8cd43 (reproducers compiled via CLI):
  - `<program auth="Required">` / `auth=" required"`: W-ATTR-002 + W-AUTH-LOGIN-MISSING + I-AUTH-REDIRECT-UNRESOLVED, 0 `_scrml_auth_check` in server.js.
  - `<program auth=${mode}>` / `auth=@mode` / bare `<program auth>`: NO diagnostic at all, 0 auth check.
  - `<page auth="Required">` / `" required"`: W-ATTR-002 only; `<page auth=${mode}>`: no diagnostic.
  - HTTP (scrml build + _server.js): `auth="Required"` anon GET /app.html -> 200; control `auth="required"` -> 302 /login.
- GOVERNING-SENTENCE GATE: found TWO, and they disagree with the brief's fix direction.
  - §52.13: "The `auth=` attribute on `<page>`, `<program>`, and `<channel>` accepts exactly three literal values".
  - §52.13.2: "Any literal value not in the recognized set SHALL emit `W-ATTR-002`. … On a `<program>`, an unrecognized value applies no auth gate at all — the program and its pages are public (current behaviour; tracked as `g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth`)." + §34 W-ATTR-002 row severity "Warning".
  - => making it a compile ERROR contradicts a SHALL (W-ATTR-002 is a Warning). That half is a RULING (below).
- FIXED (governed half), direction = inert to pass/fail (diagnostic set only):
  - (a) auth-graph.ts: program gate built only for authConfig.auth in {"required","optional"} (was `!== "none"` over the RAW literal). Governing §52.13.2 "applies no auth gate at all" + §52.13 Login-page requirement ("When `auth=\"required\"` is declared … SHALL emit W-AUTH-LOGIN-MISSING"). Removes the false W-AUTH-LOGIN-MISSING / I-AUTH-REDIRECT-UNRESOLVED.
  - (b) validators/attribute-allowlist.ts: a NON-literal `auth=` on `<program>`/`<page>` (`${…}`, `@x`, bare) now emits W-ATTR-002 stating the real effect. Governing §52.13 "exactly three literal values" + §52.13.2 "silent acceptance of attribute values that have no compile-time effect is itself a P0 finding". `<channel>` excluded (any auth= gates there).
- CORPUS (measured, 2204 units: examples/ samples/ conformance/cases/ docs/readme-snippets/ stdlib/, like-for-like snapshot locations): newly failing 0; warn-set changes: the 3 new cases + `conformance/cases/reactive/server-fn-ambient-identity-clean` (+W-ATTR-002 — it is written `<program … auth>` BARE, so it never had auth on; relevant to item 2).
- LOCI: compute-program-config getAttrValue — HELD (returns null for non-literal so no authConfig); route-inference Step 8a exact-match — HELD (correct per §52.13; not changed); attribute-registry supportsInterpolation:false not enforced — HELD (no consumer reads it; VP-1 skipped non-literals). REFINED: the lint half lives in auth-graph.ts enumerateFile (program gate test), not listed in the locus.

### RULINGS NEEDED (bryan) — R1: unrecognized / non-literal `auth=` on `<program>` and `<page>`

§52.13.2 ratifies warning + public program. Options:
- (a) RECOMMENDED, fail closed: an `auth=` value that is not one of the three literals (any other literal, `${…}`, `@x`, bare) is a compile ERROR (new code, e.g. `E-AUTH-ATTR-INVALID`), on `<program>` and `<page>`; the build writes no server. Amend §52.13.2 + §34; W-ATTR-002 keeps covering `role:X` only if that stays a recognized-not-implemented shape (or `role:X` also errors).
- (b) fail closed by semantics: treat any `<program auth=…>` that is present but unrecognized as `"required"` (as `<channel>` already does and as unknown `csrf=` resolves to `"auto"`), keep W-ATTR-002.
- (c) status quo (current SPEC): warning, public app.
Worked example:
```scrml
<program db="./app.db" auth="Required">   // today: W-ATTR-002, app PUBLIC (anon GET /app.html 200)
                                           // (a): E-AUTH-ATTR-INVALID, no build
                                           // (b): gated (302 /login) + W-ATTR-002
```
Why (a) over (b): the author's intent behind `auth=@mode` is unknowable at compile time (it might be "none"); an error makes them say it. Corpus cost of (a) measured now: the only corpus program with a non-recognized `<program auth>` is `conformance/cases/reactive/server-fn-ambient-identity-clean` (bare `auth`) — 1 file.

## Item 2 — g-session-ambient-unlowered-trust-boundary-inversion — 2026-10-02T14:06-06:00

- VERIFIED LIVE on 2d6d8cd43. Reproducer (`<program db=…>` + `function saveNote(body)` doing `?{INSERT INTO notes (sid, body) VALUES (${@session.userId}, ${body})}`): compile exit 0, zero diagnostics; server.js emits `INSERT … VALUES (${_scrml_body["session"].userId}, ${body})`. HTTP (scrml build + _server.js): anonymous POST `{"body":"spoofed","session":{"userId":"victim"}}` (+ double-submit token) -> 200; notes row written `{"sid":"victim","body":"spoofed"}`.
- GOVERNING-SENTENCE GATE:
  - §6.6.9 exclusions: "`@session` is server-only identity and SHALL NEVER be marshalled from the client — doing so would be a spoofing hole." -> the emitted `_scrml_body["session"]` read violates a SHALL NEVER. The client-body read is unambiguously a bug.
  - But WHAT `@session.<f>` means server-side is NOT settled: §6.6.9 calls `@session` a "compiler-provided server-side singleton" (§20.5 / §52), while the compiler (type-system `RESERVED_AMBIENT_PROJECTION_NAMES`, emit-expr `_sessionProjectionActive`) and the SPEC's own cross-refs — §20.5 "the client `@session`-projection logout path", §52.15.1 "the `@session` projection precedent, §20.5" — treat `@session` as the CLIENT window projection `{ current, destroy() }`, a different shape from the server `session` object (`userId / isAuth / role / get / set / destroy`). §20.5 defines no server shape for `@session`. => the shape choice is a RULING.
  - Per brief, the interim fail-closed fix is "reject `@session` in a server context with an error naming `session.<field>`" = NEWLY-REJECTING.
- CORPUS for the interim reject (measured: grep of every `@session` in examples/ samples/ conformance/cases/ docs/readme-snippets/ stdlib/ — 2 hits): 1 server-context use — `conformance/cases/reactive/server-fn-ambient-identity-clean/case.scrml:4` (the green case that certifies the broken emit; it also writes a BARE `<program … auth>`, so its app has no auth at all). The other hit, `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-not-reactive-028.scrml:6`, is client markup. NON-ZERO (1) -> per brief this item STOPS -> RULING R2. Not landed.

### RULINGS NEEDED (bryan) — R2: what `@session` means in a server context

The client-body read must become impossible whichever way this goes. Options:
- (a) RECOMMENDED interim, fail closed: a `@session` read in any server context (a server-escalated fn body, CPS-split or not, including inside `?{}`) is a compile error (new code, e.g. `E-SESSION-AMBIENT-SERVER`) that names the replacement `session.<field>` (§20.5), unless the file declares its own `<session>` cell (then it is an ordinary client cell and E-REACTIVE-003 governs). Migration: 1 file. Rewrite the conformance case to `session.userId`, and make it assert that the emitted artifact does not read `_scrml_body["session"]`.
- (b) Lower `@session.<f>` server-side to the §20.5 server session (`_scrml_session_bind(_scrml_req._scrml_sess).<f>`), so `@session` and `session` become two spellings of one server accessor. Semantics change, no rejection. But `@session` then has two different shapes: the client `{current, destroy}` and the server `{userId, role, …}`. That confusion is what this gap grew from.
- (c) Settle the SPEC the other way: `@session` is client-only (the projection), and a server read is an E-REACTIVE-003-class "client value not transported" error that is never marshalled.
Worked example:
```scrml
function saveNote(body: string) {
    ?{`INSERT INTO notes (sid, body) VALUES (${@session.userId}, ${body})`}.run()
}
// today: compiles; writes the attacker's body.session.userId — measured 200 + row sid="victim"
// (a):   E-SESSION-AMBIENT-SERVER: "`@session` is not available in a server function; use `session.userId` (§20.5)"
// (b):   writes the server session's userId (NULL when anonymous)
```
Why (a): one spelling per meaning. `session.x` already exists, is bound by the server prologue (Direction B, S316) and is the documented §20.5 surface. (a) can later be relaxed to (b) without breaking anyone; going from (b) back to (a) would break code.

## Item 3 — g-session-store-keyed-per-compilation-unit-not-per-program — 2026-10-02T14:10-06:00

- ALREADY CLOSED by `bf3b111dc` (#1062, 2026-09-26); stale `status=open` marker. Verified by execution on 2d6d8cd43: two-unit fixture (index.scrml session.set + pages/admin/panel.scrml reading session.userId), scrml build + _server.js: both units resolve `<dist>/.scrml-sessions.db`; POST login -> 200 + `__Host-scrml_sid`; POST nested whoami with that cookie -> 200 "user=alice". Governing §20.5.1: "The default store location is `.scrml-sessions.db` at the **DIST ROOT** of the build, shared by every emitted server unit regardless of the subdirectory that unit lands in". Existing pin: compiler/tests/integration/session-program-scope-multi-unit.test.js (7 pass). Marker flipped to resolved. Direction: none (docs only).
- Locus (emit-server.ts `_scrml_session_db_path` emit): HELD as the historical locus.
