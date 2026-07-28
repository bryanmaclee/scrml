# sPA ss19 — adopter-b (external-adopter auth-app battery)

**Launch:** `read spa.md ss19` · **Branch:** `spa/ss19` · **Worktree:** `../scrml-spa-ss19`

**Fill:** provenance cluster (an adopter ported a real auth'd app "Adopter-B" to v0.7.0) · NEW S220 · **10 findings, all PA-CONFIRMED on HEAD `26ffea4e`** (S215 dual-verify, agent acf456cb) · GitHub issues **#5–#14**

## Shared ingestion
**READ FIRST:** `(private — scrml-support/handOffs/adopter-confidential/)` — `VERIFICATION.md` (PA verdict table + roots + repro paths) · `RYAN-ISSUES.md` (paste-ready issues + repro shapes) · `RYAN-VALIDATION.md` (the adopter's codegen evidence). Repros live at `/tmp/ryan-verify/` (regenerate from RYAN-ISSUES if cleared). The whole battery is the **auth'd-login app flow + the codegen that serves it** — *you cannot build a working login on v0.7.0 today.* The findings split into THREE groups by shared sub-ingestion; **the PA may fire groups as separate sub-dispatches.**

## Core files
`route-inference.ts` · `auth-graph.ts` · `codegen/emit-server.ts` · `codegen/emit-client.ts` · `codegen/emit-bindings.ts` · `codegen/emit-html.ts` · `commands/generate*` · `protect-analyzer.ts` · `schema-differ`(`parseSchemaBlock`)

## ⚠ Coordination
- **Group B (render-codegen) OVERLAPS ss17** (each/markup-body codegen — emit-html / emit-each). ss17 is in-flight on 3 each gaps. **Do NOT dispatch Group B while ss17's worktree is live** — land ss17 first, then Group B (reconcile emit-html/emit-each by hand). flogence #1/#3 are the same family (filed separately, route to a post-ss17 each-codegen follow-on).
- Group A item `g-pure-fn-rpc-async-unawaited` (#8) is **adjacent to the adopter PR#1 territory** (server-fn→server-fn peer lowering, S215/S217 `b2bf9959`). Cross-check the peer-call lowering already landed before re-fixing; the S215 F1/F3 defects were in this exact area — run the S215 adversarial gate.

## Items

### Group A — auth / server-emit (the wall; fire first)
1. **AUTH-PRECEDENCE pair (FIRE FIRST)** `[status=open]` — `g-protect-overrides-page-auth` (#6, HIGH) + `g-login-rpc-auth-gated` (#7, HIGH). `protect=` on `<db>` overrides explicit `<page auth="optional">` → injects `auth="required"` + false `W-AUTH-001` (#6) → installs the `_scrml_auth_check` prologue on the login page's own RPC → 302 /login → can't authenticate (#7). **ONE fix — #6's precedence (respect explicit `auth="optional"`) — closes BOTH.** Loci: `route-inference.ts`/`auth-graph.ts` (precedence) + `emit-server.ts` (prologue); fix W-AUTH-001's wrong "no explicit auth=" message. Belt-and-suspenders: a redirect-target-RPC exemption in emit-server.
   > **Brief seed:** find where `protect=` derives page-auth (`auth-graph.ts`/`route-inference.ts`); make an explicit `<page auth=>` WIN over the protect-derived default. Verify on `/tmp/ryan-verify/proj-auth/` — login.server.js should drop to 0 `_scrml_auth_check` when `auth="optional"`.
2. **`g-stdlib-import-leaks-client`** (#5, HIGH) `[status=open]` — server-only stdlib import (`scrml:auth`/`store`/`crypto`) emitted into the CLIENT bundle → `_scrml_stdlib.store` undefined → page throws at load. Locus `codegen/emit-client.ts` — strip server-classified stdlib imports from the client bundle (the binding is used only in server-classified fns). Verify: grep client bundle for `_scrml_stdlib.store` absent.
3. **`g-pure-fn-rpc-async-unawaited`** (#8, HIGH) `[status=open]` — a pure `fn` peer-called by a server fn is RPC-routed + emitted `async`; the caller compares the unawaited Promise (no `await`) → silent-wrong (auth hash always mismatches). Locus `route-inference.ts`/`emit-server.ts` — either keep an in-process-only pure fn sync/inlined (no RPC) OR thread `await` into the peer-call lowering. **See Coordination (PR#1 adjacency + S215 gate).**
4. **`g-db-src-compile-vs-runtime-path`** (#9, MED) `[status=open]` — `<db src>` file-relative at compile, cwd-relative at runtime → multi-dir projects diverge. Resolve consistently (project-root-relative or normalize the emitted `sqlite:…` literal). Loci: db-resolver / emit-server.
5. **`g-generate-auth-redirect-mismatch`** (#14, MED) `[status=open]` — `scrml generate auth` scaffolds `/auth/login` but default `loginRedirect=/login` → `I-AUTH-REDIRECT-UNRESOLVED` + `W-AUTH-LOGIN-MISSING`. Align the generator scaffold path with the default redirect (`commands/generate*` vs `auth-graph.ts`).
6. **`g-schema-block-raw-ddl-silent-noop`** (MED, PA-found) `[status=open]` — raw `CREATE TABLE` inside `<schema>` not recognized by `parseSchemaBlock` → silent zero-tables → `E-PA-002`. Parse `CREATE TABLE` in `<schema>` OR diagnose the unrecognized form (don't fall through to E-PA-002).
7. **`g-sql-in-arrow-body-invalid-js`** (#12, MED) `[status=open]` — a `?{}` SQL block inside an arrow-function body emits JS the compiler can't parse (`E-CODEGEN-INVALID-JS`). Locus: emit-server / `?{}` SQL-lowering — lower it inside arrow bodies correctly, or reject the shape with a clear diagnostic. Repro `/tmp/ryan-verify/08-arrow-sql.scrml`.

### Group B — render-codegen — ⚠ MOVED to `ss20-each-codegen-followon` (S220, post-ss17); do NOT dispatch from here (kept for provenance)
7. **`g-compound-bind-value-not-two-way`** (#10, HIGH) `[status=open]` — compound `bind:value=@form.field` writes the DERIVED parent, not the source sub-field → input empty, isValid stuck. Locus `codegen/emit-bindings.ts:513-520` — dotted-path bind must target the source sub-field cell, not the root (derived) token. (Less ss17-overlap than #11, but render-codegen.)
8. **`g-if-guard-inner-effect-not-gated`** (#11, HIGH) `[status=open]` — `if=(@x is some)` only toggles `el.style.display`; inner `${@x.field}` effect runs on mount with `x===null` → null crash. Locus `codegen/emit-html.ts` — gate the subtree's inner interpolation effects on the guard condition. **EACH/MARKUP-BODY family — highest ss17 collision risk; land after ss17.**

### Group C — reply-only (no fix)
9. **`g-const-collides-state`** (#13, LOW/DX) `[status=open → REPLY]` — `E-NAME-COLLIDES-STATE` is BY-DESIGN (V5-strict bans shadowing state names; the diagnostic IS the feature). No code change. Disposition: reply to GH #13 explaining the rule + intent; close as working-as-intended (with the user's OK).

## Progress
`ss19.progress.md`. Land on `spa/ss19`; ping PA inbox when ready. Do not advance main / do not push. PA re-integrates per-group, reconciling Group-B vs ss17's emit-each/emit-html by hand. On each GH-issue close, comment with the landing SHA.
