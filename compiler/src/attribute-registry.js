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
