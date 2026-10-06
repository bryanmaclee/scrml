# s456 — handle() + globalThis.Response ships protected columns — progress (append-only)

## Unit 1 — startup + governing text + base reproduction

Base: `2dd6d35d9` (== origin/main at dispatch). Worktree clean, bun install + pretest OK.

### Governing (SPEC §14.8.9, read in full, lines 11297-11996)

Closed-world precondition (SPEC.md:11836-11840):
> An egress path the compiler cannot analyze — a `_{}` foreign-code block (§23), an
> author-constructed `Response` (§40), or an `asIs`-typed value (§14.1.1) — that carries a
> protected-origin column SHALL **fail closed**. The compiler never silently ships a
> protected-origin column through a path it cannot redact.

The binding rule (S452, SPEC.md:11349-11358):
> the egress floor is **keyed on value ORIGIN** — ... never its surface name, its lexical position,
> or the path the value took; it is **enforced at every compiler-owned sink** ... and it is
> **fail-closed on an unknown origin**

Extracted values (S441, item 2, SPEC.md:11588-11590):
> a value whose provenance includes a `protect=` column and which reaches a client-egress sink
> OUTSIDE a descriptor-bearing row SHALL be rejected at compile time with **`E-PROTECT-006`**.

Unresolvable callees (SPEC.md:11623-11625):
> A call into code the compile does not contain — a host, stdlib or npm import, or a platform API —
> that receives a protected value (a scalar OR a whole row) returns a protected value, unless the
> callee is on the deriver allowlist.

Sinks (SPEC.md:11781-11784):
> Every compiler-emitted client-egress serializer, AND every argument of an author-built `Response`
> — its body AND its `init` ... — `Response.redirect`, `Response.json`, ...

Global names (S447 r8, SPEC.md:11530-11541): a value read from the global heap resolves to its
named path "whether the program spells the path (`globalThis.box.set(u)`) or reads it through an
alias (a binding, a destructure, ...)" and SHALL NOT narrow when the path cannot be named.

dpa-017 ruling (scrml-support/user-voice-scrml.md:10989-10995, S230, bryan "6go with your recos"):
> RATIFIED — HYBRID ... raw/FFI egress that drops the descriptor = fail-closed.

Direction: newly-rejecting toward an existing SHALL (conformance restoration).

### Base reproduction (2dd6d35d9), compile + run the emitted server's `fetch`

handle() body: `const u = ?{select id, name, passwordHash ...}.get() !{ _ :> not }` then:

| variant | spelling | rc | E-codes | HTTP body |
|---|---|---|---|---|
| bare | `new Response(JSON.stringify(u))` | 1 | E-PROTECT-006 | - |
| json | `Response.json(u)` | 1 | E-PROTECT-006 | - |
| gt | `new globalThis.Response(JSON.stringify(u))` | 0 | none | 200 `{"id":1,"name":"ada","passwordHash":"SECRET"}` |
| self | `new self.Response(...)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| gtidx | `new globalThis["Response"](...)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| alias | `const R = globalThis.Response; new R(...)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| destr | `const { Response: R } = globalThis; new R(...)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| gtjson | `globalThis.Response.json(u)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| aliasjson | `const R = globalThis.Response; R.json(u)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| destrjson | `const { Response: R } = globalThis; R.json(u)` | 0 | none | 200 ...`"passwordHash":"SECRET"` |
| negctl | `new globalThis.Response(JSON.stringify({id:1,name:"ada"}))` (unprotected) | 0 | none | 200 `{"id":1,"name":"ada"}` |

The relayed S456 auditor claim is CONFIRMED by execution: 8/8 non-bare spellings serve the hash.

Same spellings inside a SERVER FUNCTION (not handle()): `sf_gt`, `sf_alias`, `sf_destrjson`,
`sf_hdr_gt` (null body + `Location` header from the hash) all ALREADY fail with E-PROTECT-006 at
base — the fail-closed unknown-callee rule taints the result and the server-fn return reaches the
`_scrml_protect_redact` sink.

### Traced root (protect-flow.ts at 2dd6d35d9)

1. The handle() return is an egress the analysis has NO sink for. `emit-server.ts` emits the
   handle() body inside `const _scrml_mw_result = await (async () => { ... })();` and returns
   `_scrml_mw_result` to the host unredacted. Every other client-egress path is a sink
   (`_scrml_protect_redact` arg, Response args, publish/enqueue/send); this one is not. So in
   handle(), the ONLY thing that could reject was the spelled-`Response` sink recognizer.
2. That recognizer (`evalGlobalCall`: `path === "Response"`; method branch `path === "Response.json"`
   / `"Response.redirect"`) compares the dotted global PATH text, so `globalThis.Response`,
   `self.Response`, `globalThis["Response"]`, an alias and a destructure all miss it. The
   fail-closed unknown-callee rule DID taint the result (`new globalThis.Response(...)` returns a
   protected value) — but the tainted value then left through the un-sinked handle exit.
3. The E-PROTECT-005 detector (`protect-egress.ts findAuthoredResponseConstruction`) has the same
   bare-name-only recognition (`sf_gt_clean`: `new globalThis.Response(JSON.stringify({ok:1}))`
   in a server fn compiles clean at base; bare spelling is E-PROTECT-005). No leak there — the
   runtime limb 3 refuses an unmediated body-carrying Response at the server-fn sink — but a SHALL
   compile error is missed.

### Runtime half

The handle() exit (`return _scrml_mw_result;`) has NO runtime guard at all — no redact, no
`_scrml_protect_mediated` check. For handle(), the static analysis is the only guard.

## Unit 2 — fix landed (14c836010)

- `protect-flow.ts`: (1) `HANDLE_RESULT_BINDING` + `isHandleResultDeclarator` — handle()'s return is a
  sink (kind "handle", naked semantics like the serializer, so a row routed through `resolve()` is
  not a false positive); (2) `responseCtorOf(t)` — Response recognized by the constructor VALUE's
  global names (`Taint.gn`), exact vs maybe (fail closed on gnAny); applied to `new X(...)`,
  `X.json/redirect/<unreadable key>(...)`, `Reflect.construct(X, ...)`. The spelled
  `path === "Response"` branch in `evalGlobalCall` is removed (subsumed).
- `emit-server.ts`: the wrapper's declarator uses the shared constant.
- Spoofing check: an author `const _scrml_mw_result = …` is `E-NAME-COLLIDES-RESERVED-PREFIX`.

### Head repro (same fixtures, HEAD compiler)

| variant | base | head |
|---|---|---|
| gt / self / gtidx / alias / destr / gtjson / aliasjson / destrjson | rc=0, 200 with `"passwordHash":"SECRET"` | rc=1 E-PROTECT-006 (Response recognizer) |
| bindjson (`.bind`-ed `Response.json`) | rc=0, 200 with hash | rc=1 E-PROTECT-006 (handle exit sink) |
| hdrpost (`r.headers.set("x-h", u.passwordHash)` after resolve) | rc=0, onion 404 `x-h=SECRET` | rc=1 E-PROTECT-006 (handle exit sink) |
| negctl (unprotected value via `new globalThis.Response`) | rc=0, 200 `{"id":1,"name":"ada"}` | rc=0, same |
| gt_name_only (`u.name` body) / gt_reveal / resolve_clean | rc=0 | rc=0 (reveal ships deliberately; x-name=ada) |
| sf_* (server fn, every spelling) | rc=1 E-PROTECT-006 | rc=1 E-PROTECT-006 |

### Corpus differential (scripts/corpus-emit-differential.ts, roots examples,samples,conformance,stdlib)

2368 sources both sides; compile-failure SET identical (0 newly failing / 0 newly passing);
0 diagnostic-CODE changes. Text/byte deltas are the base copy's `.tmp/base/` path prefix only
(server.js -10 bytes = the embedded db path). Textual hits for `globalThis.Response` /
`self.Response` / aliases: 0; `Response.json`: 1 (bare, in an endpoint arm — unchanged path).
Files pairing `function handle(` with `protect=`: 0. Newly rejected: NONE.

### Tests

Pre-commit gate on 14c836010: 31426 pass / 58 skip / 12 todo / 0 fail. New integration test
26/26; run against the base compiler the 11 leak tests fail and the 15 others pass (bite).
11 conformance cases: 10 base rc=0 -> head E-PROTECT-006; the clean control compiles on both.

### Runtime half — static is the only guard for handle(); NOT closed (fork for the PA)

The handle() exit returns `_scrml_mw_result` with no runtime guard. Closing it with the
`_scrml_protect_mediated` check would refuse (a) every legitimate author body in handle()
(§40's escape hatch; adopter #471 PDF egress) and (b) every `resolve()`-path response that is
not marked — verified: the SSR compose `new Response(_scrml_html, …)` is unmarked, and
`build.js` / `dev.js` contain no mediation marking for static files. E-PROTECT-005's SPEC scope
is "a server function, `<endpoint>` arm or `server function*`" — handle() is not in it. So a
runtime refusal at the handle() exit is a language-surface change (extend limb 2/3 to
handle()), not a conformance fix. Recommendation: keep handle() bodies author-owned; the static
sink is the guard; if a runtime belt is wanted, it needs a ruling + mediation marks on every
resolve()-path response first.

### Residual filed

`g-protect-005-recognizes-response-by-bare-name-only` (MED): E-PROTECT-005 detector
(`protect-egress.ts findAuthoredResponseConstruction`) is bare-name only —
`new globalThis.Response(JSON.stringify({ok:1}))` in a server fn compiles clean (a SHALL error
missed; runtime limb 3 still refuses it, no leak). Not fixed here (scope; newly-rejecting).
