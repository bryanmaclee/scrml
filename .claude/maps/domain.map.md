# domain.map.md
# project: scrml
# updated: 2026-07-09  commit: fbb4d9fd

scrml is a single-file full-stack language + compiler (not a web app with a runtime business domain). "Domain concepts" here are the language's own primitives, normatively defined in `compiler/SPEC.md` (76 top-level sections, §1-§65). This map is a navigation index into that spec, grouped by concern — not a restatement of the normative text.

## Core Concepts (by SPEC section)

**Reactivity** — `@cell` reactive declarations (§6, V5-strict access model); a cell auto-subscribes every read site. Value-native maps/sets (§59) give `@cell:[K]V` / `set[K]` first-class reactive collection types.
**State machines** — `<engine for=Type>` (§51) governs variant-graph progression via `rule=`/`initial=`/`<onTransition>`/`<onTimeout>`/`<onIdle>`; `<engine server=@source>` gives server-authoritative hydration (§52.4.4). Sibling: §54 nested substates.
**Pattern matching / enums** — `match`/`is` over closed enum unions (§18); shorthand `.Variant` forms (§14.5); exhaustiveness is a compile error, not a runtime default.
**Absence** — `not` is the ONE canonical absence value (§42). `null` and `undefined` are NOT valid scrml tokens in ANY position (expression/attribute/type/identifier) — hard rule, W-ABSENCE-IN-SCRML-SOURCE lint + E-SYNTAX-042 hard error. Defined-but-empty values (`""`, `0`, `false`, `[]`, `{}`) are NOT absence.
**Logic contexts** — `${}` (logic), `?{}` (SQL), `#{}` (CSS), `_{}` (foreign/escape-hatch, §23), `^{}` (meta/compile-time eval, §22), `~{}` (test, §19.13), `!{}` (error-arm, §19). Each is a distinct parse context (§3-§4, §7-§9).
**SQL** — `?{}` inline SQL blocks (§8) resolve against `<db>`/`<schema>` (§39); `?{}` in a library context emits reactive-deps-aware client SQL (W5b).
**CSS — the §65 scrml-native model (flagship this window, V1.0 Wave-1 gate)** — deletes cascade specificity. `<theme>` (program-scope named-token block, lowers to §25 CSS custom properties) + `<defaults>` (app-wide bare-element defaults, the "base" @layer) are structural elements (NOT HTML; attribute-registry.js:454/472/485), Nominal/spec-ahead except the §65.2 conflict-checker itself which is LANDED. Resolution order: `style=` explicit value > co-located `#{}` scoped rule (conflict-checked) > `<defaults>` > native inheritance > built-in reset. `style=name` / `style=[a,b]` apply named/ordered style-values (§65.4). Fixed `@layer reset, thirdparty, base, tokens, utilities, author` (§65.8) — Tailwind utilities sit BELOW author rules (utilities-LOW). See error.map.md for the E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE checker detail.
**Realtime — §38.13 `<channel watches=table>`** — a change-feed-over-external-DB-writes primitive, distinct from the general §38 WebSocket `<channel>`. Phase 1 (front-end recognition + `RowChange` synthesis, `channel-watches.ts`) + Phase 2 (Postgres trigger DDL install + the bundled-`pg` LISTEN bridge + client `__change` frame dispatch) are both landed this window. `<onchange>` is the client-side handler element (attribute-registry.js:454). The `watches=` table shape composes with a §52 `authority="server"` collection, not just `<schema>` blocks.
**Auth / BaaS** — `scrml:auth` stdlib module: magic-link / email-verify / password-reset flows (`stdlib/auth/flows.scrml` — single-use namespace-per-purpose tokens, enumeration-resistant neutral responses, TTL-enforced) + HS256 JWT (`stdlib/auth/jwt.scrml`) + JWKS RS256 verification (`verifyJwtJwks`, alg-pinned before any JWKS fetch) + `generatePassword` (rejection-sampling for uniform charset selection, `stdlib/auth/password.scrml`). See auth.map.md.
**Server/client boundary** — inferred, not annotated: importing a server-tagged stdlib module (or DB/crypto/host access) escalates the importing function to server-only (§12.2). `E-CG-001` is the fail-closed backstop that blocks any protected DB column from reaching the emitted client bundle (acorn-exact scan, §14.8.9).
**Standalone tools — §64** — `<program kind="tool">` compiles to a CLI-style module with one `function main(args)` entry (E-TOOL-001..006); `<foreign lang="ts">` (§23.6) gives a library file its own foreign-language declaration.
**Typed API surfaces** — `<api>` (§60, typed EXTERNAL API consumption) vs `<endpoint>` (§61, typed INBOUND endpoint — the serve-side mirror).
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

## Domain Events (compiler-pipeline analogs)
`RowChange` — synthesized per §38.13 watched-table row mutation (INSERT/UPDATE/DELETE), dispatched client-side via the `__change` frame to `<onchange>` handlers.
Engine variant transition — an `<engine>` cell's `rule=`-governed state change, optionally observed via `<onTransition>`/`<onTimeout>`/`<onIdle>`.
Diagnostic emission — every pipeline stage (BS/TAB/CE/TS/CG, see dependencies.map.md) emits `{code, message, severity, span}` records partitioned into `result.errors`/`result.warnings` (see error.map.md).

## Aggregates (structural elements that own a bounded body)
`<engine>` in compiler/src/ast-builder.js — owns its variant-graph rules + state-child bodies (EngineDeclNode.bodyChildren).
`<channel>` in compiler/src/ast-builder.js — owns its watches= table binding + message/broadcast handlers (ChannelDeclNode).
`<theme>` in compiler/src/theme-body-parser.ts — owns its named-token bindings + `.Variant`/`@media` re-bind blocks (§65.6).
`<schema>` — owns its table/column DDL surface (§39), consumed by protect-analyzer.ts for the §14.8.9 protect-floor.

## Tags
#scrml #map #domain #language-primitives #css65 #theme #realtime #channel-watches #auth #baas #reactivity #engine #not-absence #e-style-conflict

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
