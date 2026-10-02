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
