# TASK — i29e session pass-2 (B4 + B5), bryan-authorized (S266)

Second hardening pass on the §20.5 `session` primitive. Pass-1 (B1 cookie-anchoring / B2 context-gate / B3 role⇒auth) is LANDED on main `1e63bbb1` — DO NOT re-touch it. This pass adds B4 (`__Host-` cookie + `session-secure=` opt-out) + B5 (reserved-key guard). Design ruled by bryan.

## STARTUP + PATH DISCIPLINE (hard gate)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` == that worktree, else STOP.
2. Base on CURRENT main: `git fetch origin && git checkout -B i29e-secfix-pass2 origin/main` (tip `1e63bbb1`). `bun install` + `bun run pretest`.
3. Worktree-absolute paths only; never `cd` into main; `git -C`/`--cwd`. Commit incrementally + append-only `progress.md`. First commit `WIP(i29e-pass2): start at <pwd>`. Commit this brief to `docs/changes/i29e-session-pass2-b4b5-2026-07-18/BRIEF.md` early.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `99ae45ca`) + task-shape routing for codegen. The §20.5 session code is recent (landed `1e63bbb1`); verify against actual source. Report load-bearing findings.

## B4a — `__Host-` conditional cookie name (defense-in-depth over B1's parse anchor)
Introduce a compile-time boolean `_secureCookieMode = authMiddlewareEntry?.sessionSecure !== false` (default TRUE).
- **Name:** `__Host-scrml_sid` when `_secureCookieMode`, plain `scrml_sid` when opted out. `__Host-` forbids Domain (we set none), requires Path=/ and REQUIRES the Secure attribute.
- **Set-Cookie sites in `emit-server.ts`** (all currently emit `scrml_sid=`): the establishment commit identity-path (~line 1881 `scrml_sid=${_newSid}`), preference-path (~1892 `scrml_sid=${_sid}`), the commit destroy-clear (~1862), the destroy route (~1967). Use the conditional name.
- **Secure in secure-mode:** when `_secureCookieMode`, ALWAYS emit `; Secure` (drop the `_scrml_is_secure_req` localhost carve-out for the SESSION cookie — `__Host-` needs Secure, and browsers accept a Secure cookie over `http://localhost` since localhost is a secure context). Opt-out mode → no Secure (uses `_scrml_is_secure_req` or none).
- **Read side (parses were anchored by B1):** the middleware `sessionId` parse, `_scrml_session_begin` `sid` parse, destroy `_dsid` parse — make each try `__Host-scrml_sid` FIRST then `scrml_sid` (both boundary-anchored `/(?:^|;\s*)NAME=([^;]+)/`), so a mode switch or either name resolves. Costs nothing.
- VERIFY (execute): secure-mode → `__Host-scrml_sid` round-trips over `http://localhost` in the roundtrip test (native Request); opt-out mode → plain `scrml_sid`, no Secure.

## B4b — `session-secure=` opt-out attribute (fix the silent bare-http login-fail)
- **`attribute-registry.js`** (beside `sessionExpiry` at ~line 114 page-level AND the ~207 program-level section): add `["session-secure", attrSpec({ supportsInterpolation: false })]`, closed value set `{true,false}` (default true). Mirror how `sessionExpiry`/`csrf` are registered on BOTH the page and program attribute surfaces.
- **`route-inference.ts`**: thread `sessionSecure` into the AuthConfig/authMiddlewareEntry struct exactly like `sessionExpiry`/`csrf` (the fields at ~295-296, ~3578-3591, ~3609-3624). Parse `session-secure` (a boolean-ish string; default true; `"false"` → false).
- **Runtime warn (NOT build — the compiler can't know the deploy host):** in the emitted commit path, when `_secureCookieMode` AND the request is non-https AND non-localhost (the cookie WILL be browser-rejected), `console.warn` ONCE per process: "scrml: session cookie set Secure over http on a non-local host — the browser will reject it. Front with TLS, or set `session-secure=false` to run without Secure (insecure)." Rate-limit via a module flag.
- **SPEC §20.5.1**: document `session-secure=` (default true → `__Host-` + always-Secure; false → plain `scrml_sid` no-Secure for a conscious TLS-less deployment) + the `__Host-` behavior. §34: no new code unless a bad attribute value needs one (reuse the attribute-value diagnostic).

## B5 — reserved-key guard (close the `csrfToken` mass-assign CSRF-bypass)
- **Runtime (load-bearing — the mass-assign key is dynamic):** in `_scrml_session_begin`'s `set(key, value)` method (~line 1849 `set(key, value) { this._rec[key] = value; ... }`), refuse compiler-owned keys: `if (key === "csrfToken") return;` (no-op; optionally a runtime warn). Keep `userId`/`role` writable (login primitive). `csrfToken` is the concrete vector; if there are other compiler-owned session fields, reserve them too.
- **Compile-time (nice-to-have, not required):** a LITERAL `session.set("csrfToken", ...)` → a clean diagnostic (E-SESSION-RESERVED-KEY or reuse the E-SESSION-* family; §34 row with impl per Rule 4). Won't catch dynamic keys — the runtime guard does.

## REGRESSION TESTS (mandatory)
- B4a: emitted secure-mode cookie name is `__Host-scrml_sid` + always `; Secure`; opt-out (`session-secure="false"`) → plain `scrml_sid`, no Secure; read side resolves BOTH names; a full HTTP round-trip in secure-mode over `http://localhost` still authenticates.
- B4b: `session-secure="false"` on `<program>`/`<page>` parses + threads to `sessionSecure=false`; a bad value is rejected.
- B5: `session.set("csrfToken","known")` cannot overwrite the synchronizer token (the middleware-minted token survives; the CSRF gate still enforces the real token) — EXECUTE this against the real emitted server.

## EMPIRICAL (EXECUTE — the S265 "emitted ≠ runs" rule)
Compile + import + drive: `__Host-scrml_sid` round-trips over http://localhost; opt-out plain-name works; the B5 csrfToken guard holds. Reference: `compiler/tests/integration/session-establishment-roundtrip.test.js`.

## DO NOT TOUCH
B1/B2/B3 (landed): the anchored parses, the E-SESSION-VALUE / context-gate, the emitIndex session case, the shadow flag, the role⇒auth getters. The SOUND set (fixation-on-login, isAuth-requires-record, durable store, TOCTOU). Optional: csrf-cookie `__Host-`/Secure is OK if trivial (note in report; don't force the `__Host-csrf` rename).

## GATE + REPORT
`bun run test` baseline; fix any regression you introduce. Report: final SHA on `i29e-secfix-pass2`, files-touched, per-item disposition (B4a/B4b/B5 — done + how + the pinning test), full-suite pass/fail vs base, empirical results. WIP commits + progress.md are your recovery anchor. Your final message IS your report to the PA.
