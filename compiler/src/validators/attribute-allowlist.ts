/**
 * VP-1 — Per-Element Attribute Allowlist
 *
 * Walks the AST and emits warnings when an attribute is unrecognized on a
 * scrml-special element (registered in `attribute-registry.js`), or when
 * the attribute is recognized but its literal string-value is not on the
 * recognized-values list (e.g. `auth="role:X"`).
 *
 * Closes:
 *   - F-AUTH-001: `auth="role:X"` silently inert on `<page>` / `<program>` /
 *     `<channel>`. (Surfaces as W-ATTR-002.)
 *   - F-CHANNEL-005: `<channel auth="role:X">` silently inert at wire level.
 *     (Same surface.)
 *
 * Severity: WARNING (`W-ATTR-001`, `W-ATTR-002`). Per OQ-10 default
 * (deep-dive §10.10), VP-1 is warn-level because scrml has historically
 * accepted unknown attributes as forwarded HTML. Promoting to error would
 * regress every page that uses a forward-compat attribute (e.g.
 * `data-testid` on `<page>`). The warning surfaces gaps without breaking.
 *
 * Scope: only scrml-special elements registered in
 * `compiler/src/attribute-registry.js`. Plain HTML elements are NOT
 * policed — they pass through as before.
 *
 * Cross-reference:
 *   - SPEC §40 (auth) + §52 (state authority).
 *   - SPEC §6 (program), §38 (channels), §51 (machines).
 */

import type { Span, FileAST, MarkupNode } from "../types/ast.ts";
import { getElementAttrSchema, isOpenAttrPrefix } from "../attribute-registry.js";
import { walkFileAst } from "./ast-walk.ts";
import { connectionFragmentAttrs } from "../diagnostic-secrets.ts";

// ---------------------------------------------------------------------------
// Diagnostic shape
// ---------------------------------------------------------------------------

export interface AttrAllowlistWarning {
  code: string;
  message: string;
  span: Span;
  severity: "warning";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attrLiteralValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { kind?: string; value?: unknown };
  if (v.kind !== "string-literal") return null;
  if (typeof v.value !== "string") return null;
  return v.value;
}

/** A short author-facing name for a non-string-literal attribute value. */
function describeNonLiteral(value: unknown): string {
  const k = value && typeof value === "object" ? (value as { kind?: string }).kind : undefined;
  if (!value || k === "absent") return "it has no value";
  if (k === "variable-ref") return "it is a reactive/variable reference";
  if (k === "expr") return "it is a `${…}` expression";
  if (k === "call-ref") return "it is a call";
  return "it is not a quoted string";
}

function valueIsRecognized(
  literal: string,
  allowedValues: string[],
  allowSubvalueColon: boolean
): boolean {
  if (allowedValues.includes(literal)) return true;
  if (allowSubvalueColon) {
    const colonIdx = literal.indexOf(":");
    if (colonIdx > 0) {
      const prefix = literal.slice(0, colonIdx);
      if (allowedValues.includes(prefix)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-markup-node validation
// ---------------------------------------------------------------------------

function validateMarkup(
  node: MarkupNode,
  filePath: string,
  warnings: AttrAllowlistWarning[]
): void {
  const tag = node.tag ?? "";
  if (!tag) return;
  const schema = getElementAttrSchema(tag);
  if (!schema) return;

  // s432 F3 — an UNQUOTED connection value (`<program db=postgres://u:p/w@h>`)
  // is mis-tokenized: only its leading identifier is the value, and the rest
  // of it — the userinfo, i.e. the password — becomes a run of attribute NAMES
  // (`u:p`, `w@h`, ...). Echoing those names prints the password in pieces no
  // value-based redactor can recognise (a middle piece need carry no `:` or
  // `@`). So once a connection attribute on this element has an unquoted
  // TEXT value, every later UNRECOGNIZED non-string attribute is reported
  // without its name (connectionFragmentAttrs — shared with the chokepoint).
  // Positional, not a name-shape test: a fragment may look like any ordinary
  // name. The cost: a genuinely unknown attribute written after an unquoted
  // `db=` loses its name in W-ATTR-001 — on an element that already fails to
  // compile (the unquoted value is E-SCOPE-001).
  const frag = connectionFragmentAttrs(tag, node.attrs);
  const fragments = new Set(frag.fragments);
  const afterUnquotedConnection = frag.via;

  for (const attr of node.attrs ?? []) {
    if (!attr || !attr.name) continue;
    const name = attr.name;

    // Open-prefix attributes (bind:, on:, data-, aria-, etc.) are always
    // allowed — they are runtime-special forms with open-ended names.
    if (isOpenAttrPrefix(name)) continue;

    const spec = schema.allowedAttrs.get(name);
    if (!spec) {
      const span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      if (fragments.has(attr)) {
        warnings.push({
          code: "W-ATTR-001",
          message:
            `W-ATTR-001: An attribute (name <redacted>) is not recognized on \`<${tag}>\`. ` +
            `It follows the unquoted \`${afterUnquotedConnection}=\` value and is most likely a ` +
            `fragment of it: an unquoted attribute value is read only up to the end of its leading ` +
            `identifier, so the rest of a connection string (including any password) is read as ` +
            `further attribute names. Quote the value: \`${afterUnquotedConnection}="…"\`.`,
          span,
          severity: "warning",
        });
        continue;
      }
      warnings.push({
        code: "W-ATTR-001",
        message:
          `W-ATTR-001: Attribute \`${name}=\` is not recognized on \`<${tag}>\`. ` +
          `It is currently forwarded to the rendered HTML as-is and has no compile-time effect. ` +
          `If you intended a scrml-specific behavior (auth scoping, route binding, etc.), ` +
          `check the spelling against the documented attributes for \`<${tag}>\`. ` +
          `If you intended a plain HTML attribute, this warning is informational.`,
        span,
        severity: "warning",
      });
      continue;
    }

    if (spec.allowedValues && spec.allowedValues.length > 0) {
      const literal = attrLiteralValue(attr.value);
      if (literal === null) {
        // §52.13: `auth=` "accepts exactly three literal values". A NON-literal
        // `auth=` on a `<program>` / `<page>` — `auth=${mode}`, `auth=@mode`, a
        // bare `auth` — is not one of them, and nothing reads it as a gate: the
        // program applies no auth check and a page declares nothing (§52.13.2,
        // §40.2). Before S449 this was the one shape with NO diagnostic at all
        // (g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth), against
        // §52.13.2's "silent acceptance of attribute values that have no
        // compile-time effect is itself a P0 finding". Warn exactly as an
        // unrecognized literal does, stating the real effect. (`<channel>` is
        // excluded: any `auth=` there already gates the upgrade, §52.13.2.)
        if (name === "auth" && (tag === "program" || tag === "page")) {
          const span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          const recognized = spec.allowedValues.map((v) => `"${v}"`).join(" | ");
          warnings.push({
            code: "W-ATTR-002",
            message:
              `W-ATTR-002: \`auth=\` on \`<${tag}>\` is not a string literal ` +
              `(${describeNonLiteral(attr.value)}). \`auth=\` accepts exactly three literal ` +
              `values — ${recognized} — and is not interpolable: its value must be known at ` +
              `compile time because it decides which routes are gated. ` +
              authUnrecognizedEffect(tag),
            span,
            severity: "warning",
          });
        }
        continue;
      }
      if (literal === "") continue; // boolean-attribute idiom — recognized.
      if (valueIsRecognized(literal, spec.allowedValues, spec.allowSubvalueColon)) continue;
      const span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      const recognized = spec.allowedValues.map((v) => `"${v}"`).join(" | ");
      warnings.push({
        code: "W-ATTR-002",
        message:
          `W-ATTR-002: Value \`"${literal}"\` is not a recognized shape for ` +
          `\`${name}=\` on \`<${tag}>\`. ` +
          `Recognized values: ${recognized}. ` +
          (name === "auth"
            ? authUnrecognizedEffect(tag) +
              (literal.startsWith("role:")
                ? ` For role-based access control, the \`role:X\` shape is documented in the dispatch ` +
                  `app FRICTION ledger but is NOT yet implemented (see F-AUTH-001); gate roles via a ` +
                  `server fn until the ergonomic completion lands.`
                : "")
            : `The attribute is currently accepted as-is with no compile-time enforcement. ` +
              `Use one of the recognized values to ensure the attribute does what its name implies.`),
        span,
        severity: "warning",
      });
    }
  }
}

/**
 * What an UNRECOGNIZED `auth=` literal does today, per element (S443 r3) — so the
 * warning states the real effect instead of "accepted as-is".
 *   - `<page>`: it is not an auth declaration. The page inherits its application's
 *     `<program auth="required">` gate if the application's top-level `<program>`
 *     declares one (route-inference Step 8c); otherwise it gates nothing.
 *   - `<program>`: no auth gate is applied at all (the value is not "required").
 *   - `<channel>`: any `auth=` attribute gates the WebSocket upgrade as if required.
 */
function authUnrecognizedEffect(tag: string): string {
  if (tag === "page") {
    return `An unrecognized \`auth=\` value is not an auth declaration: this page inherits ` +
      `the application's gate if the application's top-level \`<program>\` declares ` +
      `\`auth="required"\` (it then requires authentication), and otherwise it gates nothing ` +
      `(the page is public). Write one of the recognized values.`;
  }
  if (tag === "program") {
    return `An unrecognized \`auth=\` value applies NO auth gate: this program and its pages ` +
      `are public. Write \`auth="required"\` if a login is intended.`;
  }
  if (tag === "channel") {
    return `On a \`<channel>\` any \`auth=\` attribute gates the WebSocket upgrade as if it ` +
      `were \`auth="required"\`. Write one of the recognized values.`;
  }
  return `The attribute is currently accepted as-is with no compile-time enforcement.`;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function runAttributeAllowlistFile(file: {
  filePath: string;
  ast: FileAST | null | undefined;
}): AttrAllowlistWarning[] {
  const warnings: AttrAllowlistWarning[] = [];
  const ast = file.ast;
  if (!ast) return warnings;

  walkFileAst(ast, (node) => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string };
    if (n.kind !== "markup") return;
    validateMarkup(node as MarkupNode, file.filePath, warnings);
  });

  return warnings;
}

export function runAttributeAllowlist(input: {
  files: Array<{ filePath: string; ast: FileAST | null | undefined }>;
}): { errors: AttrAllowlistWarning[] } {
  const all: AttrAllowlistWarning[] = [];
  for (const f of input.files) {
    all.push(...runAttributeAllowlistFile(f));
  }
  return { errors: all };
}
