/**
 * Attribute Registry — per-element attribute schema for scrml-special elements.
 *
 * Companion to `compiler/src/html-elements.js`. Where html-elements.js focuses
 * on HTML element shapes (used by the type system), this registry focuses on
 * scrml-special elements (`<page>`, `<channel>`, `<machine>`, etc.) and the
 * attribute-validation passes (VP-1 / VP-3) that consume them.
 *
 * Each element entry declares:
 *   - allowedAttrs: Map<attrName, AttrSpec>
 *
 * Each AttrSpec declares:
 *   - supportsInterpolation: whether `${...}` in a `string-literal` value is
 *     evaluated at runtime. Default: true (most HTML attrs are reactive).
 *     Exceptions (channel name, machine name, page route, etc.) declare false
 *     so VP-3 can flag silent-interpolation cases.
 *   - allowedValues: optional array of recognized literal values for value-shape
 *     warnings. When set, VP-1 emits W-ATTR-002 if the attribute's literal
 *     string value (or the prefix before `:`) is not in the list. Used for
 *     `auth=` ("required" | "optional" | "none").
 *
 * The registry is intentionally narrow — only elements where attribute
 * semantics are LOAD-BEARING and the silent-acceptance window is sharp.
 * Plain HTML element attributes are not policed here; they keep the existing
 * forward-as-HTML behaviour. New scrml-special elements MUST be added here
 * before VP-1 / VP-3 can validate them.
 *
 * Per OQ-9 (deep-dive §10.9): per-element granularity is the right level —
 * coarser categories (e.g. "auth attrs everywhere") cannot express the
 * legitimate variation between `<page auth=>` and `<channel auth=>`.
 *
 * Per OQ-10 (deep-dive §10.10): VP-1 emits warnings (`W-ATTR-*`) — historic
 * scrml has accepted unknown attributes as forwarded HTML; warning surfaces
 * gaps without breaking. VP-3 emits errors (`E-CHANNEL-007` etc.) because
 * the silent-interpolation cases are unambiguously bugs (no reasonable adopter
 * intends `name="driver-${id}"` to mean a literal-with-dollar-brace string).
 *
 * Cross-reference:
 *   - SPEC §38 (channels): `name=` is literal — no interpolation supported.
 *   - SPEC §52 (auth): `required` | `optional` | `none` are recognized; `role:X`
 *     is unrecognized today (see F-AUTH-001 / W1).
 *   - SPEC §51 (machines): `for=` binds an enum reactive var; `name=` is literal.
 */

// ---------------------------------------------------------------------------
// AttrSpec helper
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} [opts.supportsInterpolation=true]
 * @param {string[] | null} [opts.allowedValues=null] — when non-null, the
 *   attribute's string-literal value (or the part before `:`) must be one of
 *   these or VP-1 emits W-ATTR-002.
 * @param {boolean} [opts.allowSubvalueColon=false] — when true, an unrecognized
 *   `prefix:rest` value is what the validator surfaces (e.g. `role:X` on auth).
 *   When false, exact match required.
 * @returns {{supportsInterpolation: boolean, allowedValues: string[] | null, allowSubvalueColon: boolean}}
 */
function attrSpec({ supportsInterpolation = true, allowedValues = null, allowSubvalueColon = false } = {}) {
  return { supportsInterpolation, allowedValues, allowSubvalueColon };
}

// ---------------------------------------------------------------------------
// Per-element registry
//
// Only scrml-special elements appear here. Plain HTML elements are NOT in
// this registry — VP-1 silently passes them through. (Plain HTML behavior
// is unchanged; the registry is opt-in per element.)
// ---------------------------------------------------------------------------

const ELEMENT_ATTR_REGISTRY = new Map();

// ---------------------------------------------------------------------------
// <program> — root element. Already has attribute knowledge in html-elements.js
// (used by the type system). Repeated here for VP-1 / VP-3 coverage.
//
// SPEC §6, §40, §52.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("program", {
  allowedAttrs: new Map([
    // §6 / §39 — program shape
    // §64 — Standalone Tool Target output-shape selector. `kind="tool"` re-targets
    // the top-level <program> emit from a web app to a plain runnable module.
    // Value validation (closed vocab: only "tool"; top-level only) is owned by the
    // typer (E-TOOL-002); registering here suppresses the W-ATTR-001 unknown-attr
    // warning so the recognized attribute flows cleanly to the tool-emit path.
    ["kind",          attrSpec({ supportsInterpolation: false })],
    ["db",            attrSpec({ supportsInterpolation: false })],
    ["tables",        attrSpec({ supportsInterpolation: false })],
    ["html",          attrSpec({ supportsInterpolation: false })],
    ["name",          attrSpec({ supportsInterpolation: false })],
    // §52 — auth/session
    ["auth",          attrSpec({
      supportsInterpolation: false,
      allowedValues: ["required", "optional", "none"],
      allowSubvalueColon: false,
    })],
    ["loginRedirect", attrSpec({ supportsInterpolation: false })],
    ["csrf",          attrSpec({
      supportsInterpolation: false,
      allowedValues: ["auto", "off"],
    })],
    ["sessionExpiry", attrSpec({ supportsInterpolation: false })],
    // §40.7 — documentary attributes (HTML head metadata, Phase A1a 2026-05-05)
    ["title",         attrSpec({ supportsInterpolation: false })],
    ["description",   attrSpec({ supportsInterpolation: false })],
    ["version",       attrSpec({ supportsInterpolation: false })],
    ["author",        attrSpec({ supportsInterpolation: false })],
    ["license",       attrSpec({ supportsInterpolation: false })],
    // §40.2 / §39.2 — compiler-auto middleware attrs (B6, 2026-05-11)
    ["cors",          attrSpec({ supportsInterpolation: false })],
    ["log",           attrSpec({
      supportsInterpolation: false,
      allowedValues: ["structured", "minimal", "off"],
    })],
    ["headers",       attrSpec({
      supportsInterpolation: false,
      allowedValues: ["strict"],
    })],
    ["ratelimit",     attrSpec({ supportsInterpolation: false })],
    // §39.2.6 — idempotency storage backend (A9 Ext 5, S76)
    ["idempotency-store", attrSpec({
      supportsInterpolation: false,
      allowedValues: ["auto", "sqlite", "postgres", "mysql", "redis", "none"],
    })],
    // §19.9.6 / §8.9.5 — S79 adopter-override knobs (duration / integer; malformed
    // is silently re-defaulted per spec — value not enforced here).
    ["idempotency-ttl",   attrSpec({ supportsInterpolation: false })],
    ["batch-in-list-cap", attrSpec({ supportsInterpolation: false })],
    // §39.2.1 / §38.3.1 — S81 adopter-override knobs (numeric; malformed silently
    // re-defaulted — value not enforced here).
    ["cors-max-age",      attrSpec({ supportsInterpolation: false })],
    ["channel-reconnect", attrSpec({ supportsInterpolation: false })],
    // §43 — nested-<program> worker/sidecar attributes
    ["lang",          attrSpec({ supportsInterpolation: false })],
    ["mode",          attrSpec({ supportsInterpolation: false })],
    ["callchar",      attrSpec({ supportsInterpolation: false })],
    ["build",         attrSpec({ supportsInterpolation: false })],
    ["autostart",     attrSpec({ supportsInterpolation: false })],
    // §43.4 — supervision strategy
    ["restart",       attrSpec({
      supportsInterpolation: false,
      allowedValues: ["always", "never", "on-error"],
    })],
    ["max-restarts",  attrSpec({ supportsInterpolation: false })],
    ["within",        attrSpec({ supportsInterpolation: false })],
    // MCP V0 Sub-unit D (2026-05-25) — opt-in attribute that auto-installs
    // the scrml:mcp DevTools server on the top-level <program>. Two recognized
    // values per SCOPING §3 Q3.4 ratification: "dev-only" (default when
    // attribute is bare-present, e.g. <program mcp>) gates the runtime boot
    // behind `process.env.NODE_ENV !== "production"`; "always" boots
    // unconditionally (CI / production introspection panels). Compile-time
    // effect: api.js auto-flips emitPerRoute and a boot import is injected
    // into the generated _server.js entry. Authority:
    // docs/changes/mcp-v0-devtools-scoping/SCOPING.md §3 Sub-unit D.
    ["mcp",           attrSpec({
      supportsInterpolation: false,
      allowedValues: ["dev-only", "always"],
    })],
    // §23.5.2 — capability DECLARATION (S232 SPEC; impl wave 2026-07-10). The
    // value is a bracketed list of capability tokens `{ network, fs-read,
    // fs-write, spawn, env, db }` (§23.5.3), NOT a general expression — the
    // ast-builder special-parses the `capabilities=[…]` value into a
    // capability-token list so its tokens never resolve as scope refs (no
    // E-SCOPE-001) and an unrecognized token fires E-FOREIGN-CAPABILITY-UNKNOWN.
    // Registering here suppresses the incidental W-ATTR-001 (the attribute is
    // recognized). Valid at top-level AND nested per the §4.12.2 attr-table row.
    // supportsInterpolation:false — the token list is a compile-time declaration,
    // not a runtime-interpolated value.
    ["capabilities",  attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <page> — page route. Currently flows through as a generic HTML element with
// no compile-time validation, which is the F-AUTH-001 silent-failure surface.
//
// VP-1 surfaces unknown attrs and `auth="role:X"` value-shape gaps here.
// SPEC §6, §40 (auth), §52 (state authority).
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("page", {
  allowedAttrs: new Map([
    ["route",         attrSpec({ supportsInterpolation: false })],
    ["auth",          attrSpec({
      supportsInterpolation: false,
      allowedValues: ["required", "optional", "none"],
      allowSubvalueColon: false,
    })],
    ["loginRedirect", attrSpec({ supportsInterpolation: false })],
    ["csrf",          attrSpec({
      supportsInterpolation: false,
      allowedValues: ["auto", "off"],
    })],
    ["title",         attrSpec({ supportsInterpolation: true })],
    ["class",         attrSpec({ supportsInterpolation: true })],
    ["id",            attrSpec({ supportsInterpolation: true })],
  ]),
});

// ---------------------------------------------------------------------------
// <channel> — WebSocket state type. SPEC §38.
//
// `name=` is the WebSocket URL key — LITERAL ONLY. Interpolation here is the
// F-CHANNEL-001 silent-failure surface.
// `auth=` is the canonical WS-upgrade gate per §38.5 + §52.13. Replaces the
// pre-S80 `protect=` channel attribute (renamed for vocabulary alignment —
// the upgrade gate is auth-shaped, not protect-shaped; field-level access
// control `protect=` remains on `<db>` and `<Type>`).
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("channel", {
  allowedAttrs: new Map([
    ["name",       attrSpec({ supportsInterpolation: false })],   // VP-3 surface (F-CHANNEL-001)
    ["topic",      attrSpec({ supportsInterpolation: false })],
    ["reconnect",  attrSpec({ supportsInterpolation: false })],
    // §38.13 — realtime feed over external DB writes. `watches=<table>` marks
    // the channel a server-fed read-only change-feed; `key=<column>` overrides
    // the PK used to key its deltas. Both are STATIC LITERAL identifiers (no
    // `${...}` interpolation — parallel to `name=`/`topic=` per §38.11), so both
    // declare supportsInterpolation:false (VP-3 flags a silent-interp value).
    ["watches",    attrSpec({ supportsInterpolation: false })],
    ["key",        attrSpec({ supportsInterpolation: false })],
    // §38.5 — auth= replaces the legacy `protect=` channel attribute (S80,
    // 2026-05-11). The WS upgrade gate is auth-shaped, not protect-shaped.
    ["auth",       attrSpec({
      supportsInterpolation: false,
      allowedValues: ["required", "optional", "none"],
      allowSubvalueColon: false,
    })],
  ]),
});

// ---------------------------------------------------------------------------
// <machine> — state machine declaration. SPEC §51.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("machine", {
  allowedAttrs: new Map([
    ["name",       attrSpec({ supportsInterpolation: false })],
    ["for",        attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <auth> — sub-page role-gate element (SPEC §40.9.9 worked example).
//
// Registered S90 wave A-3.1 — the §40 auth-graph derivation pass requires
// <auth> to be a known structural element so attribute validation gates
// silent-acceptance of malformed gates (e.g. `<auth roles="admin">` typo).
//
// `role=` is the closed-form predicate per SPEC §40.1.1 line 17150 ("closed-
// form boolean predicate over the role enum"). Per OQ-A3-A ratified S90
// (option (d) — full interpolation, user override of agent recommendation),
// the role attribute accepts the SAME value-shape range as every other
// value-bearing attribute in scrml: string-literal (`role="admin"`),
// variable-ref (`role=publicRoles`), and interpolation (`role=${expr}`).
// Per user-voice S90: "user defined state has full interpolation but first
// class compiler supported state doesn't is confusing, counter intuitive,
// and hints that the language is still in a 'toy' status." Per Rule 2
// (full-production-language fidelity) the role attribute MUST be no less
// expressive than user-state-bearing attrs.
//
// A-3.3 per-gate classifier decides closed-form vs runtime-fallback at
// compile time:
//   - `role="admin"` / `role="admin,dispatcher"` — closed-form (literals).
//   - `role=publicRoles` where `const <publicRoles>: RoleSet = "..."`
//     — closed-form via META constant-folder resolution.
//   - `role=publicRoles` where `<publicRoles> = "..."` (reactive cell)
//     — runtime-fallback (cell changes at runtime).
//   - `role=${a || b}` — closed-form when both operands fold; otherwise
//     runtime-fallback (per SPEC §40.9.5 line 17724; A-2.5 fires
//     W-AUTH-RUNTIME-FALLBACK on consumption).
//
// `check=` is the async server-fn form per SPEC §40.9.5 (`<auth check=
// "hasPermission">`). The function name is a literal reference; interpolation
// is not allowed at the attribute layer (the check= surface is a name-ref,
// not a value expression — distinct from role=).
//
// `else=` / `redirect=` are the fallback path. SPEC §40.9.9 worked example
// uses `else=`; `redirect=` is the explicit alias when only a redirect target
// is intended. Both are literal path strings; interpolation is not supported.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("auth", {
  allowedAttrs: new Map([
    ["role",       attrSpec({ supportsInterpolation: true })],
    ["check",      attrSpec({ supportsInterpolation: false })],
    ["else",       attrSpec({ supportsInterpolation: false })],
    ["redirect",   attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <errorBoundary> — error rendering boundary. Already in html-elements.js.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("errorboundary", {
  allowedAttrs: new Map([
    ["fallback",   attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <errors> — first-class validation errors element (SPEC §55.8, L13).
//
// Two attribute shapes:
//   - of=expr (REQUIRED) — references a per-field cell (`@signup.name`) or a
//     compound cell (`@signup`). The compiler reads `.errors` from the
//     referenced cell's runtime registry. The value is a scrml @-rooted
//     expression, NOT a string template — interpolation is not supported.
//   - all (optional flag) — when present, renders the FULL error array; absent,
//     renders the first error only.
//
// Codegen emits the runtime wiring; this registry entry exists so VP-1 can
// validate that `of=` and `all` are the only legal attrs (catches typos like
// `<errors for=...>`). New scrml-special structural elements MUST be added
// here per primer §12 amendment.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("errors", {
  allowedAttrs: new Map([
    ["of",         attrSpec({ supportsInterpolation: false })],
    ["all",        attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <formFor> — type-driven form generation (SPEC §41.14, S102).
//
// Markup-element form `<formFor for=StructType [onsubmit=fn] [as=@var]
// [pick=[...]] [omit=[...]] [partial=true|false] [error-strategy="..."]>`.
//
// All attribute values are bare scrml-native references / literals — no
// `${...}` interpolation. Per SPEC §41.14 the attribute grammar mirrors
// other compile-time structural elements (e.g. <engine for=Type>, <match
// for=Type>) where the type identifier is consumed verbatim at the
// type-system stage.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("formfor", {
  allowedAttrs: new Map([
    ["for",             attrSpec({ supportsInterpolation: false })],
    ["onsubmit",        attrSpec({ supportsInterpolation: false })],
    ["as",              attrSpec({ supportsInterpolation: false })],
    ["pick",            attrSpec({ supportsInterpolation: false })],
    ["omit",            attrSpec({ supportsInterpolation: false })],
    ["partial",         attrSpec({ supportsInterpolation: false })],
    ["error-strategy",  attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <tableFor> — type-driven `<table>` rendering (SPEC §41.16, S105).
//
// Markup-element form `<tableFor for=StructType rows=@cell [pick=[...]]
// [omit=[...]] [selectable=@cell] [selectedBy="field"]>`. Per §41.16 attribute
// grammar mirrors formFor's compile-time structural-element shape where the
// type identifier + cell-reference are consumed verbatim at the type-system
// stage.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("tablefor", {
  allowedAttrs: new Map([
    ["for",         attrSpec({ supportsInterpolation: false })],
    ["rows",        attrSpec({ supportsInterpolation: false })],
    ["pick",        attrSpec({ supportsInterpolation: false })],
    ["omit",        attrSpec({ supportsInterpolation: false })],
    ["selectable",  attrSpec({ supportsInterpolation: false })],
    ["selectedBy",  attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <column> — per-column slot inside tableFor (SPEC §41.16.3, S105).
// Slot grammar — `field=` is required; rest are optional per-column overrides.
// `:let=` is a parametric snippet binding parameter (§16.6).
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("column", {
  allowedAttrs: new Map([
    ["field",     attrSpec({ supportsInterpolation: false })],
    ["header",    attrSpec({ supportsInterpolation: false })],
    ["sortable",  attrSpec({ supportsInterpolation: false })],
    ["align",     attrSpec({ supportsInterpolation: false })],
    ["class",     attrSpec({ supportsInterpolation: false })],
    [":let",      attrSpec({ supportsInterpolation: false })],
    // The tokenizer drops the leading `:` at attribute-start position, so the
    // canonical `:let={(row) => ...}` reaches the validator as `let`. Recognize
    // both so the consumed parametric-slot attribute does NOT fire a spurious
    // W-ATTR-001 / leak to rendered HTML (Bug R28-2 / un-defer Bug 54).
    ["let",       attrSpec({ supportsInterpolation: false })],
  ]),
});

// ---------------------------------------------------------------------------
// <empty> — empty-state slot inside tableFor (SPEC §41.16.9, S105) AND
// inside <each> (S130 — iteration Landing 1; per HU-1 Q4 ratification).
// No attributes — body content is the entire payload.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("empty", {
  allowedAttrs: new Map([]),
});

// ---------------------------------------------------------------------------
// <each> — structural-element iteration (SPEC §17.X per S130 HU-1
// ratifications; Phase 2 Landing 1 of 5).
//
// Two shapes per Q6 ratification:
//   <each in=@cell [as name] [key=expr]>...</>   — collection iteration
//   <each of=N     [as name] [key=expr]>...</>   — count iteration
//
// All attribute values are bare scrml-native references / literals — no
// `${...}` interpolation. The `in=` source is a reactive expression (the
// codegen subscribes to its dependencies); the `of=` source is an integer
// expression (constant or `@cell` for runtime count). `as=` is the optional
// iteration-variable name override; `key=` overrides inferred diff-keying.
//
// Per Q3 RE-RATIFICATION, body composition leverages existing SPEC §4.14
// `:`-shorthand mechanism — per-item element openers admit `:`-shorthand
// body for single-expression bodies (`<li : @.name>`).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// <render> — render-expression primitive (SPEC §19.x, render-expr-primitive).
//
// Self-closing `<render of=X/>` fires the HELD enum value X's per-variant
// `renders` contract at this markup position (§19.2). The `of=` value is a bare
// scrml-native reference (commonly a `<match>` arm payload binding) — no
// `${...}` interpolation. Mirrors the <errors of=expr/> attribute shape.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("render", {
  allowedAttrs: new Map([
    ["of",  attrSpec({ supportsInterpolation: false })],   // required — the held enum value
  ]),
});

ELEMENT_ATTR_REGISTRY.set("each", {
  allowedAttrs: new Map([
    ["in",   attrSpec({ supportsInterpolation: false })],   // collection-iteration source
    ["of",   attrSpec({ supportsInterpolation: false })],   // count-iteration source
    ["as",   attrSpec({ supportsInterpolation: false })],   // iteration-variable name override
    ["key",  attrSpec({ supportsInterpolation: false })],   // diff-key override
  ]),
});

// ---------------------------------------------------------------------------
// <onchange> — the `<channel watches=>` change-feed handler (SPEC §38.13.3).
//
// A scrml-defined structural element valid ONLY inside a `watches=` `<channel>`
// body. It carries NO attributes — its body is per-variant arms over the
// compiler-synthesized `RowChange` enum (§38.13.2), reusing the §18.0.1 match-
// block arm grammar + §51.0.B.1 payload binding (the same inbound-typed-
// dispatch shape as `<endpoint accepts=:enum>`, §61.2). Registered here so
// VP-1 does not warn on the (attribute-less) element and so its misplacement
// outside a `watches=` channel is caught (`E-STRUCTURAL-ELEMENT-MISPLACED`,
// SYM pass). New scrml-special structural elements MUST be added here per
// primer §12 amendment.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("onchange", {
  allowedAttrs: new Map([]),
});

// ---------------------------------------------------------------------------
// <theme> — the scrml-native CSS token block (SPEC §65.3.2 / §65.6,
// css-wave1-theme-tokens).
//
// A scrml-defined structural element valid at program scope (§65.9). Its ONE
// optional attribute is `for=@cell` — the reactive-cell binding (§65.6, the
// engine `for=` pattern) whose variant set the `<theme>` OWNS (bare-variant
// inference §14.10). The value is a bare scrml-native `@cell` reference — no
// `${…}` interpolation. Registered here so VP-1 does not warn on `for=` and so a
// typo'd attribute is surfaced. The body-form (`name = value;` tokens +
// `.Variant { … }` + `@media (…) { … }`) is defined in §65.3 and parsed by the
// theme-body-parser, NOT the HTML attribute machinery.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("theme", {
  allowedAttrs: new Map([
    ["for", attrSpec({ supportsInterpolation: false })],   // §65.6 — the bound reactive cell
  ]),
});

// ---------------------------------------------------------------------------
// <defaults> — app-wide bare-element defaults (SPEC §65.3.3 / §65.9). Reserved
// as a structural element alongside `<theme>` (§65.9), but the body-form + the
// `E-DEFAULTS-*` behaviour are the Wave-2 impl. Registered here (no attributes)
// so VP-1 does not treat it as an unknown HTML element in the interim.
// ---------------------------------------------------------------------------

ELEMENT_ATTR_REGISTRY.set("defaults", {
  allowedAttrs: new Map([]),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up an element's attribute schema by tag name (lowercased).
 *
 * @param {string} tagName
 * @returns {{ allowedAttrs: Map<string, ReturnType<typeof attrSpec>> } | null}
 */
export function getElementAttrSchema(tagName) {
  if (!tagName || typeof tagName !== "string") return null;
  return ELEMENT_ATTR_REGISTRY.get(tagName.toLowerCase()) ?? null;
}

/**
 * @returns {string[]} all registered scrml-special element names (lowercased).
 */
export function getRegisteredElementNames() {
  return Array.from(ELEMENT_ATTR_REGISTRY.keys());
}

/**
 * Check whether a `name`-keyed bind/event/etc. attribute prefix should be
 * skipped from VP-1 unknown-attribute warnings. These are runtime-special
 * forms whose names are intentionally open-ended:
 *
 *   - `bind:foo` — two-way binding (§13)
 *   - `on:foo`, `onclick`, `onsubmit`, etc. — event handlers
 *   - `onserver:foo`, `onclient:foo` — channel lifecycle (§38)
 *   - `class:foo`, `style:foo` — conditional class/style toggles
 *   - `data-*` — data attributes (always allowed)
 *   - `aria-*` — ARIA attributes (always allowed)
 *
 * These are accepted on every element regardless of the per-element schema.
 *
 * @param {string} attrName
 * @returns {boolean}
 */
export function isOpenAttrPrefix(attrName) {
  if (!attrName || typeof attrName !== "string") return false;
  if (attrName.startsWith("bind:")) return true;
  if (attrName.startsWith("on:")) return true;
  if (attrName.startsWith("onserver:")) return true;
  if (attrName.startsWith("onclient:")) return true;
  if (attrName.startsWith("class:")) return true;
  if (attrName.startsWith("style:")) return true;
  if (attrName.startsWith("data-")) return true;
  if (attrName.startsWith("aria-")) return true;
  // `on*` event handlers (without colon) — onclick, onsubmit, etc.
  if (/^on[a-z]+$/i.test(attrName)) return true;
  return false;
}
