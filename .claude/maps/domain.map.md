# domain.map.md
# project: scrml
# updated: 2026-07-18T00:13:05-06:00  commit: bf316828

scrml is a single-file full-stack language + compiler (not a web app with a runtime business domain). "Domain concepts" here are the language's own primitives, normatively defined in `compiler/SPEC.md` (§1-§65+). This map is a navigation index into that spec, grouped by concern — not a restatement of the normative text.

## Core Concepts (by SPEC section)

**Reactivity** — `@cell` reactive declarations (§6, V5-strict access model); a cell auto-subscribes every read site. Value-native maps/sets (§59) give `@cell:[K]V` / `set[K]` first-class reactive collection types. §6.6.9 (new this window): server-fn / client-cell read — "THE SPLIT" — a server function reading a client cell now gets an explicit CPS-marshal boundary (E-REACTIVE-003 + W-SERVER-DERIVED-MARSHAL) instead of a silent value smuggle.
**State machines** — `<engine for=Type>` (§51) governs variant-graph progression via `rule=`/`initial=`/`<onTransition>`/`<onTimeout>`/`<onIdle>`; `<engine server=@source>` gives server-authoritative hydration (§52.4.4). Sibling: §54 nested substates. 44 E-ENGINE-* diagnostic codes (largest single family — see error.map.md).
**Client Router / soft navigation — §20.8 (NEW this window, Wave-1a/1b LANDED).** `<program>` is the persistent application shell (single-file `<page>` children or multi-file `pages/*.scrml`); it MAY contain exactly one `<outlet>` — the region into which the current route's SSR-fetched content swaps on navigation. Internal `<a href>` is soft-navigated by default (link-boost); `hard` opts out. Landed: outlet placement validation (E-OUTLET-DUPLICATE/-OUTSIDE-SHELL, W-OUTLET-ABSENT-SOFT-NAV-DISABLED — all firing, browser-tested), the soft-nav swap/hydrate/View-Transitions pipeline. NOT yet landed: `<page keep-alive>` client-side cache invalidation (§20.8.4, W-KEEPALIVE-* codes — no fire site, no tests) — the SPEC §20.8 status banner ("Nominal / spec-ahead, S250") is stale for the outlet/soft-nav core but still accurate for keep-alive specifically.
**Standalone tools — §64** — `<program kind="tool">` compiles to a CLI-style module with one `function main(args)` entry (E-TOOL-001..006). **§64.9 `serve=` listener-owning headless serve-target (NEW this window, Track A Fork 1A Units 1+2, LANDED)**: `<program kind="tool" serve=PORT>` emits a compiler-owned `Bun.serve({port, fetch, websocket?})` harness hosting the tool's `<endpoint>`(§61)/SSE(§37) routes via a headless (no CSRF, no cookie-session, no SSR) route emit; `main` becomes OPTIONAL when `serve=` supplies the live-process handle. Cookie-session `auth=` on a `serve=` tool is fail-closed rejected (E-TOOL-SERVE-AUTH-UNSUPPORTED). `<foreign lang="ts">` (§23.6) gives a library file its own foreign-language declaration.
**Pattern matching / enums** — `match`/`is` over closed enum unions (§18); shorthand `.Variant` forms (§14.5); exhaustiveness is a compile error, not a runtime default. New this window: E-TYPE-082 fail-arity ruling for enum-variant construction payload arity.
**Absence** — `not` is the ONE canonical absence value (§42). `null` and `undefined` are NOT valid scrml tokens in ANY position (expression/attribute/type/identifier) — hard rule, W-ABSENCE-IN-SCRML-SOURCE lint + E-SYNTAX-042 hard error. Defined-but-empty values (`""`, `0`, `false`, `[]`, `{}`) are NOT absence.
**Logic contexts** — `${}` (logic), `?{}` (SQL), `#{}` (CSS), `_{}` (foreign/escape-hatch, §23), `^{}` (meta/compile-time eval, §22), `~{}` (test, §19.13), `!{}` (error-arm, §19). Each is a distinct parse context (§3-§4, §7-§9).
**SQL** — `?{}` inline SQL blocks (§8) resolve against `<db>`/`<schema>` (§39); `?{}` in a library context emits reactive-deps-aware client SQL (W5b). New this window: E-SCHEMA-001/002/004 + W-SCHEMA-001 strict §39.4 `<schema>` column-type checks wired; a real-DB conformance adapter (Bun.SQL in-memory seam, `sqlEngine` opt-in) now exercises live-DB behavior in the D3 corpus.
**CSS — the §65 scrml-native model (V1.0 Wave-1 LANDED)** — deletes cascade specificity. `<theme>` (program-scope named-token block, lowers to §25 CSS custom properties) + `<defaults>` (app-wide bare-element defaults, the "base" @layer) are structural elements (NOT HTML; attribute-registry.js:503 theme / :516 defaults). §65 Wave-1 EMISSION is now LANDED (S265, was Nominal/spec-ahead): alongside the §65.2 conflict-checker, the emission half (codegen/emit-theme-reset.ts, fires E-THEME-TOKEN-UNKNOWN) does `<theme>` `@`-sigil token lowering (a `#{}` value `@ink`→`var(--ink)`; a bare identifier stays literal CSS), the built-in `@layer reset` (§65.3.4, opt out `<program reset="none">`), `:where()`-flat specificity wrapping of unconditional base selectors (§65.2.5), and runtime theme-switch. A reactive `#{}` CSS custom property (§25) is always bridged onto `document.documentElement` (emit-reactive-wiring.ts, PR #98). Resolution order: `style=` explicit value > co-located `#{}` scoped rule (conflict-checked) > `<defaults>` > native inheritance > built-in reset. Fixed `@layer reset, thirdparty, base, tokens, utilities, author` (§65.8) — Tailwind utilities sit BELOW author rules. See error.map.md for the E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE checker detail.
**Realtime — §38.13 `<channel watches=table>`** — a change-feed-over-external-DB-writes primitive, distinct from the general §38 WebSocket `<channel>`. Phase 1 (front-end recognition + `RowChange` synthesis, `channel-watches.ts`) + Phase 2 (Postgres trigger DDL install + the bundled-`pg` LISTEN bridge + client `__change` frame dispatch) are both landed. `<onchange>` is the client-side handler element (attribute-registry.js:485).
**Auth / BaaS** — `scrml:auth` stdlib module: magic-link / email-verify / password-reset flows + HS256 JWT + JWKS RS256 verification + `generatePassword`. See auth.map.md. A HIGH-severity jwt-auth-bypass regression (2026-07-11) was fixed this window (2 parser bugs; see dependencies.map.md's STDLIB-EXPORT-SEED note) — no auth-surface API change, but the fail-closed async-classification backstop is now standing infrastructure.
**Server/client boundary** — inferred, not annotated: importing a server-tagged stdlib module (or DB/crypto/host access) escalates the importing function to server-only (§12.2). `E-CG-001` is the fail-closed backstop that blocks any protected DB column from reaching the emitted client bundle (acorn-exact scan, §14.8.9). New this window: E-ASYNC-STDLIB-IN-SYNC-CALLBACK guards a sync-classified callback from silently swallowing an async stdlib call (issue #26/#27-class hardening); a Windows-path codemod (`.pathname` → `fileURLToPath`, 150 files) fixed a separator-agnostic auth-bypass class on Windows.
**Typed API surfaces** — `<api>` (§60, typed EXTERNAL API consumption) vs `<endpoint>` (§61, typed INBOUND endpoint — the serve-side mirror). §61/§64.9 now compose: an `<endpoint>` inside a `kind="tool"` program needs a `serve=` listener or it is unhosted (E-TOOL-ROUTE-NEEDS-SERVE).
**Linear types** — `lin` (§35) + the `~` pipeline-accumulator keyword (§32) for exactly-once-consumed values.
**Input state** — `<keyboard>`/`<mouse>`/`<gamepad>` (§36) are LIVE-READ, not reactive-subscribed; `<#id>.field` inside `${}` renders once at mount (W-INPUT-STATE-MARKUP-NONREACTIVE steers to the `@cell` bridge).

## Business Invariants (language axioms, not app rules)
- `null`/`undefined` do not exist in scrml source, in ANY position (§42). Absence is `not`.
- Specificity is deleted under §65: an unconditional same-property overlap on a provably-shared element is a COMPILE ERROR (E-STYLE-CONFLICT), never a silent cascade pick.
- A protected DB column can never reach the client bundle — fail-closed, acorn-exact (E-CG-001, §14.8.9).
- Server/client execution boundary is INFERRED from usage (import/API surface), never author-annotated.
- Match/enum coverage must be exhaustive at compile time (§18) — no runtime default-arm fallthrough.
- `async`/`await` are not scrml keywords (§19.9.8) — async is an inferred/desugared codegen concern, not surface syntax.
- Auth tokens (magic-link/verify/reset) are single-use (get-then-delete) and namespace-scoped per purpose — a reset token cannot replay as a magic link.
- A shell SHALL contain at most one `<outlet>` (§20.8) — no nested/multiple outlets in V1.
- A `serve=` headless tool target has NO cookie-session auth surface — fail-closed rejected, not silently unguarded (§64.9).
- An unresolved server-only `scrml:*` re-export's async classification defaults to async (fail-closed), never sync (the STDLIB-EXPORT-SEED backstop).

## Domain Events (compiler-pipeline analogs)
`RowChange` — synthesized per §38.13 watched-table row mutation (INSERT/UPDATE/DELETE), dispatched client-side via the `__change` frame to `<onchange>` handlers.
Engine variant transition — an `<engine>` cell's `rule=`-governed state change, optionally observed via `<onTransition>`/`<onTimeout>`/`<onIdle>`.
Soft navigation — a route swap into `<outlet>` (fetch → swap → hydrate → transition), NOT a shell re-boot (§20.8.2).
Diagnostic emission — every pipeline stage (BS/TAB/CE/TS/CG, see dependencies.map.md) emits `{code, message, severity, span}` records partitioned into `result.errors`/`result.warnings` (see error.map.md).

## Aggregates (structural elements that own a bounded body)
`<engine>` in compiler/src/ast-builder.js — owns its variant-graph rules + state-child bodies (EngineDeclNode.bodyChildren).
`<channel>` in compiler/src/ast-builder.js — owns its watches= table binding + message/broadcast handlers (ChannelDeclNode).
`<theme>` in compiler/src/theme-body-parser.ts — owns its named-token bindings + `.Variant`/`@media` re-bind blocks (§65.6).
`<schema>` — owns its table/column DDL surface (§39), consumed by protect-analyzer.ts for the §14.8.9 protect-floor.
`<outlet>` — owns the swappable route-content region inside a `<program>` shell (§20.8.1); NOT a dedicated AST node (see schema.map.md).

## Tags
#scrml #map #domain #language-primitives #css65 #theme #realtime #channel-watches #auth #baas #reactivity #engine #not-absence #e-style-conflict #outlet #soft-nav #server-shape #tool-serve

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
