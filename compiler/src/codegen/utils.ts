import { sep } from "node:path";
import { emitDestructurePatternText } from "./emit-destructure-pattern.ts";

/**
 * Build the HTTP route path for a server function.
 */
export function routePath(generatedRouteName: string): string {
  return `/_scrml/${generatedRouteName}`;
}

/**
 * Clean-URL page-prefix strip, separator-canonical (Issue #25).
 *
 * Both the dist WRITE path (`api.js` `pathFor`) and the served route URL
 * (`emit-server.ts` `computeServedPath`) strip a leading `pages/` segment from
 * `dirname(relative(outputBaseDir, source))` so filesystem-inferred routes
 * (§47.9.2) map `pages/customer/loads.scrml` → `/customer/loads`.
 *
 * The input is a `path.relative()` result → HOST separator (`\` on Windows).
 * The strip (`=== "pages"` / `startsWith("pages/")`) and every caller's later
 * `.split("/")` are `/`-oriented, so a raw Windows `pages\customer` misses BOTH
 * branches → nested pages keep the `pages\` prefix → the dist file lands under
 * `dist/pages/...` and the served route becomes `/pages\customer/...` → nested
 * routes 404 (top-level `pages\foo` has no separator, so `=== "pages"` fires and
 * it strips — hence the bug is nested-only). Normalize the HOST separator to `/`
 * FIRST, then strip the leading `pages` segment.
 *
 * We split on the platform `sep` (NOT a hardcoded `\`): on POSIX `sep === "/"`,
 * so this is a TRUE no-op — a literal backslash is a legal Unix filename char and
 * MUST be preserved unchanged (a hardcoded `\`→`/` would silently rename a POSIX
 * `we\ird` dir to `we/ird`, relocating output + routes). On Windows `sep === "\"`,
 * so the native backslashes normalize. Mirrors `migrate.js`'s `.split(sep).join("/")`.
 *
 * The strip stays segment-aligned: only an exact leading `pages` segment is
 * removed. `sub/pages/x` is NOT stripped (leading segment is `sub`), preserving
 * outputBase semantics for a non-`./` outputBase. Returns a `/`-separated
 * relative dir, or `"."` when it collapses to the output root.
 */
export function stripPagesPrefix(relDirRaw: string): string {
  const rel = relDirRaw.split(sep).join("/");
  if (rel === "pages") return ".";
  if (rel.startsWith("pages/")) return rel.slice("pages/".length);
  return rel;
}

/**
 * Escape a string for use in an HTML attribute value.
 */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace `@varName` references in a CSS value string with CSS custom property
 * references: `var(--scrml-varName)`.
 *
 * @param value — raw CSS value text potentially containing @var refs
 * @returns CSS value with @var replaced by var(--scrml-varName)
 */
export function replaceCssVarRefs(value: string): string {
  return value.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, "var(--scrml-$1)");
}

export const VOID_ELEMENTS = new Set<string>([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * i81 — HTML BOOLEAN attributes, excluded from the reactive VALUE-attr emitter.
 *
 * A boolean attribute's semantics are carried by its PRESENCE, not its value:
 * `checked="false"` is still checked. Lowering one through the value path
 * (`setAttribute(name, String(v))`) is therefore actively WRONG — it would
 * render a `checked=(@isSelected)` checkbox permanently checked. Caught by R26
 * on examples/27-type-derived-table.scrml, where `<input checked=(@a && @b)>`
 * began emitting `setAttribute("checked", "false")`.
 *
 * These are NOT routed to the bool path either: `REACTIVE_BOOL_ATTRS`
 * (emit-html.ts) is a deliberate 3-element allowlist (disabled/readonly/
 * required) and widening it is a separate, out-of-scope decision — bool and
 * value are different lowerings. Excluding them here preserves the pre-i81
 * behavior (attribute dropped) rather than introducing a NEW wrong one.
 * Promoting the rest of this set onto the bool path is a follow-up.
 */
export const HTML_BOOLEAN_ATTRS = new Set<string>([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls",
  "default", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap",
  "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open",
  "playsinline", "readonly", "required", "reversed", "selected", "shadowrootclonable",
  "shadowrootdelegatesfocus", "shadowrootserializable",
]);

/**
 * A scrml function parameter — either a bare string (legacy "name:Type" form)
 * or a structured object produced by `parseParamList` in `ast-builder.js`.
 *
 * Structured shape (post-§7.3.2 — A3 default-parameter support):
 *   { name: string, typeAnnotation?: string, defaultValue?: string, isLin?: boolean, isRest?: boolean }
 *
 * Post-A5-FUP (2026-05-17): `name` may also be a structured DestructurePattern
 * AST node (`kind: "destructure-array" | "destructure-object"`) for params
 * shaped `function f([a, b])` or `function f({a, b})`. Codegen serializes
 * the pattern back to JS via emitDestructurePatternText.
 *
 * Param.defaultValue, when present, is the RAW source text of the default
 * expression (`"0"`, `"start"`, `'"hello"'`, `"() => 42"`). It compiles
 * directly into the emitted JS via `${name} = ${defaultValue}` per §7.3.2.
 */
export type ParamLike = string | {
  name?: unknown;
  typeAnnotation?: string;
  defaultValue?: string;
  isLin?: boolean;
  isRest?: boolean;
  [key: string]: unknown;
};

/**
 * Extract the bare parameter NAME (no type annotation, no default value).
 * Used at call sites (e.g. `fetchStub(${paramNames.join(", ")})`) where we
 * want the identifier only.
 *
 * Destructured params: returns a synthesized `_scrml_arg_N` placeholder since
 * the pattern has no single canonical name. Call sites that pass destructured
 * args to server-stubs need to switch to a separate argument-forwarding
 * strategy; the synthesized name preserves the existing JS-arity invariant.
 *
 * @param p the param entry from `fnNode.params`
 * @param i the param's index in the list (for synthesizing `_scrml_arg_N`)
 */
export function paramName(p: ParamLike, i: number): string {
  if (typeof p === "string") return p.split(":")[0].trim();
  if (typeof p.name === "string") return p.name;
  // Destructured (or otherwise non-string) param: use a synthetic placeholder.
  return `_scrml_arg_${i}`;
}

/**
 * Format ONE parameter for a function-DECLARATION signature.
 *
 * §7.3.2: default parameters compile directly to JavaScript default parameter
 * syntax. When `p.defaultValue` is present, the output is `name = defaultValue`;
 * otherwise the bare `name` is emitted. Rest-parameter (`...name`) prefix is
 * applied when `p.isRest === true`.
 *
 * A5-FUP (2026-05-17): when `p.name` is a structured DestructurePattern, the
 * pattern is serialized via emitDestructurePatternText for direct emission as
 * a JS destructuring binding pattern. Default-for-entire-pattern composes:
 * `function f({a, b} = {a: 0, b: 0})` → `function f({ a, b } = {a: 0, b: 0})`.
 *
 * NOT for call-site argument lists — use `paramName()` there.
 *
 * @param p the param entry from `fnNode.params`
 * @param i the param's index in the list (for synthesizing `_scrml_arg_N`)
 */
export function paramSignature(p: ParamLike, i: number): string {
  if (typeof p === "string") return p.split(":")[0].trim();
  const rest = p.isRest ? "..." : "";
  const def = typeof p.defaultValue === "string" && p.defaultValue.trim().length > 0
    ? ` = ${p.defaultValue}`
    : "";
  // A5-FUP: structured destructure-pattern in `p.name`. Serialize via the
  // shared codegen helper (also used by emit-logic / emit-control-flow /
  // emit-lift for let/const/for-stmt destructuring).
  if (p.name && typeof p.name === "object") {
    const pat = p.name as { kind?: unknown };
    if (pat.kind === "destructure-array" || pat.kind === "destructure-object") {
      return `${rest}${emitDestructurePatternText(pat as Parameters<typeof emitDestructurePatternText>[0])}${def}`;
    }
  }
  const name = typeof p.name === "string" ? p.name : `_scrml_arg_${i}`;
  return `${rest}${name}${def}`;
}
