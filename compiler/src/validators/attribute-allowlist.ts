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
// `<each … as NAME>` — the alias bareword is NOT an attribute
// ---------------------------------------------------------------------------

/**
 * True when a lift-parsed markup attribute is a BAREWORD — present in the
 * opener with no `=value`. `parseLiftTag` (ast-builder.js) records those as
 * `{ name, value: { kind: "absent" } }`.
 */
function isBarewordAttr(attr: unknown): boolean {
  if (!attr || typeof attr !== "object") return false;
  const a = attr as { name?: unknown; value?: { kind?: string } | null };
  if (typeof a.name !== "string" || !a.name.trim()) return false;
  return a.value == null || a.value.kind === "absent";
}

/**
 * Indices of attribute records that are the ALIAS half of an `<each … as NAME>`
 * clause, and must therefore be exempt from the unknown-attribute check.
 *
 * ⚑ WHY THIS EXISTS. `as name` is a BAREWORD PAIR in the §17.7.2 grammar — all
 * four canonical shapes spell it `as conflict` / `as day` / `as row`, never
 * `as=conflict`. `parseLiftTag` tokenises an opener into `name[=value]`
 * attributes, so the pair arrives here as TWO ADJACENT VALUE-LESS attributes
 * and the alias half looks exactly like an unknown boolean attribute. VP-1 then
 * fired `W-ATTR-001: Attribute \`it=\` is not recognized on \`<each>\`` on
 * CORRECT, canonical scrml — and told the author it "is currently forwarded to
 * the rendered HTML as-is", which is false; it is the iteration binding.
 *
 * ⚠ It fired INCONSISTENTLY, which is the worse half: the same `<each … as it>`
 * warns when it reaches VP-1 through `lift-expr.expr.node`
 * (`${ if @show { lift <ul><each … as it> … } }`) and stays silent inside a
 * markup-returning `fn` body, because `walkFileAst` reaches one carrier and not
 * the other. So the warning was a property of WHERE the each sat, not of what
 * the author wrote.
 *
 * Only the lift-parsed `<each>` reaches here at all — the BS-structural path
 * promotes its each to a structural `each-block` (not `kind: "markup"`), so
 * `validateMarkup` never sees it and never warned on it.
 *
 * NOTE the deliberate omission: an alias that is NOT a valid identifier
 * (`as data-id` — `_parseLiftAttrName` merges the `-`) is NOT exempted here, so
 * it still surfaces. Refusing such source outright, with a diagnostic that
 * names `as` and the offending alias, needs a new `E-EACH-AS-ALIAS-INVALID`
 * code and the §34 row that CI's `s34-census --check-new` gate requires — see
 * the dispatch report. Today it still fails CLOSED downstream, which is the
 * correct direction.
 */
function eachAliasAttrIndices(node: MarkupNode): Set<number> {
  const exempt = new Set<number>();
  if ((node.tag ?? "") !== "each") return exempt;
  const attrs = (node.attrs ?? []) as Array<{ name?: string; value?: { kind?: string } | null }>;
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i]?.name !== "as") continue;
    // `as=NAME` (not canonical, but tolerated upstream) has no bareword half.
    if (!isBarewordAttr(attrs[i])) continue;
    const next = attrs[i + 1];
    if (!isBarewordAttr(next)) continue;
    // Exempt only a WELL-FORMED alias. A malformed one keeps its diagnostic.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(next!.name))) continue;
    exempt.add(i + 1);
  }
  return exempt;
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

  // `<each … as NAME>`: NAME is the iteration binding, not an attribute.
  const aliasIndices = eachAliasAttrIndices(node);

  const attrList = node.attrs ?? [];
  for (let attrIdx = 0; attrIdx < attrList.length; attrIdx++) {
    const attr = attrList[attrIdx];
    if (!attr || !attr.name) continue;
    if (aliasIndices.has(attrIdx)) continue;
    const name = attr.name;

    // Open-prefix attributes (bind:, on:, data-, aria-, etc.) are always
    // allowed — they are runtime-special forms with open-ended names.
    if (isOpenAttrPrefix(name)) continue;

    const spec = schema.allowedAttrs.get(name);
    if (!spec) {
      const span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
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
      if (literal === null) continue;
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
          `The attribute is currently accepted as-is with no compile-time enforcement. ` +
          (name === "auth"
            ? `For role-based access control, the \`role:X\` shape is documented in the dispatch ` +
              `app FRICTION ledger but is NOT yet implemented (see F-AUTH-001). The page is ` +
              `silently authorized for every authenticated user; gate roles via a server fn ` +
              `until the ergonomic completion lands.`
            : `Use one of the recognized values to ensure the attribute does what its name implies.`),
        span,
        severity: "warning",
      });
    }
  }
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
