// egress-field-scan.ts
// ---------------------------------------------------------------------------
// E-CG-001 protected-field egress scan — an ACORN-EXACT, FAIL-CLOSED backstop.
//
// §14.8.9 server→client confidentiality BACKSTOP: a protected DB column must
// NEVER reach the emitted client bundle. A genuine leak is an ACCESS of the
// protected field in CODE position (`row.ssn`, `row["ssn"]`, `const {ssn} =
// row`). The field NAME appearing inside a STRING LITERAL / COMMENT / REGEX is
// display text, not an access, and must NOT fire (the §ss22 over-fire fix).
//
// WHY A DEDICATED SCAN (not the shared `rewriteCodeSegments` fence):
//   The E-CG-001 check used to build its code-position view from the same
//   `rewriteCodeSegments` splitter that drives the fn-name mangle. That
//   splitter deliberately "errs toward masking" — the SAFE bias for a rewrite
//   (never corrupt the inside of a string/regex) but EXACTLY WRONG for a
//   security egress guard, where masking a span means NOT SEEING it, i.e.
//   LEAKING it. `regexAllowedAfter` treats `/` after `of`/`in`/`await`/`yield`/…
//   as a regex opener; those words are also valid VARIABLE NAMES, so
//   `const of = 2; const r = of / row.ssn / 2;` is DIVISION but was mis-scanned
//   as a regex literal, swallowing `.ssn` out of the view → the field test
//   returned false → E-CG-001 did not fire → the protected field shipped to the
//   client with no error. Regex-vs-division is UNDECIDABLE from raw pre-tokenized
//   text (two heuristic rounds were tried and reverted, each caught leaking).
//
//   The emitted client JS is VALID JavaScript by construction (it runs in the
//   browser). acorn knows `of` is an identifier value → `/` after it is
//   division. So this scan TOKENIZES via acorn instead of heuristically masking.
//   `code-segments.ts` is left untouched — its mask-bias stays correct for the
//   mangle. This DECOUPLES the two opposite-bias uses (the real root fix).
//
// FAIL-CLOSED: if acorn cannot parse the emitted client JS, the egress cannot be
// verified. A silent pass would be a NEW bypass (emit unparseable JS → skip the
// guard), so an unparseable bundle is reported as unverifiable and the caller
// fires E-CG-001. Security-conservative: when in doubt, error.
//
// acorn setup mirrors `codegen/validate-emit.ts` (same in-process acorn dep,
// same ecmaVersion 2022 / sourceType "module" — a safe superset for every
// emitted artifact, incl. the stdlib-import-rewritten client bundle).
//
// @module codegen/egress-field-scan

// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// elsewhere (expression-parser.ts:16, validate-emit.ts:28) for the same reason.
import * as acorn from "acorn";

/** Result of scanning the emitted client bundle for protected-field egress. */
export interface EgressScanResult {
  /**
   * Protected field names that were found in CODE position (a genuine leak).
   * A subset of the `protectedFields` passed in.
   */
  fieldsInCodePosition: Set<string>;
  /**
   * True when acorn could not parse the emitted client JS. The egress is then
   * UNVERIFIABLE — the caller must fail-closed (fire E-CG-001), never pass.
   */
  parseError: boolean;
  /** acorn's parse-error message, when `parseError` is true (for the diagnostic). */
  parseErrorMessage?: string;
}

// ecmaVersion 2022 / sourceType "module" — identical to validate-emit.ts's
// PARSE_OPTIONS. Module is a safe superset for every emitted artifact (it admits
// top-level import/export used by the stdlib-import-rewritten client bundle, and
// emitted JS never uses the script-only constructs a module goal rejects).
const PARSE_OPTIONS = { ecmaVersion: 2022 as const, sourceType: "module" as const };

/**
 * If `node` is a compile-time-constant STRING key, return its string value;
 * else null. Covers a plain string Literal (`"ssn"`) and a no-substitution
 * template literal (`` `ssn` ``) — both name a fixed property.
 */
function staticStringKey(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) && node.expressions.length === 0 &&
    Array.isArray(node.quasis) && node.quasis.length === 1
  ) {
    const cooked = node.quasis[0]?.value?.cooked;
    if (typeof cooked === "string") return cooked;
  }
  return null;
}

/**
 * acorn-parse `clientCode` and report which `protectedFields` appear in CODE
 * position — i.e. as an actual ACCESS of the protected column, not as inert
 * text inside a string/comment/regex.
 *
 * Access forms detected (all EXACT via the parsed AST, never heuristic):
 *   - Non-computed member access:            `row.ssn`, `row?.ssn`
 *   - Computed member, constant string key:  `row["ssn"]`, `` row[`ssn`] ``
 *   - Object-pattern destructuring:          `const {ssn} = row`, `{ssn: x} = row`
 *
 * NOT reported (correctly): the field name inside a string literal, a comment,
 * or a regex; an OBJECT LITERAL key (`{ssn: v}` — a name being WRITTEN, not the
 * column being read, exactly like a string label); an import/export specifier
 * binding of the same name.
 *
 * On a parse failure the result carries `parseError: true` — the caller fails
 * closed.
 */
export function scanClientEgress(
  clientCode: string,
  protectedFields: Set<string>,
): EgressScanResult {
  const fieldsInCodePosition = new Set<string>();
  if (!clientCode || protectedFields.size === 0) {
    return { fieldsInCodePosition, parseError: false };
  }

  let root: any;
  try {
    root = acorn.parse(clientCode, PARSE_OPTIONS);
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    return { fieldsInCodePosition, parseError: true, parseErrorMessage: msg };
  }

  // Iterative walk over the whole AST (no acorn-walk dependency). Visit every
  // node; record the protected field on any recognized code-position access.
  const stack: any[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (typeof node.type === "string") {
      if (node.type === "MemberExpression") {
        if (!node.computed) {
          // `obj.ssn` / `obj?.ssn` — property is an Identifier.
          const prop = node.property;
          if (prop && prop.type === "Identifier" && protectedFields.has(prop.name)) {
            fieldsInCodePosition.add(prop.name);
          }
        } else {
          // `obj["ssn"]` / `` obj[`ssn`] `` — constant string key.
          const key = staticStringKey(node.property);
          if (key !== null && protectedFields.has(key)) {
            fieldsInCodePosition.add(key);
          }
        }
      } else if (node.type === "ObjectPattern" && Array.isArray(node.properties)) {
        // Destructuring READ: `const {ssn} = row` (shorthand or renamed), and
        // the constant-string-key form `const {"ssn": x} = row`.
        for (const p of node.properties) {
          if (!p || p.type !== "Property") continue;
          if (p.key && p.key.type === "Identifier" && !p.computed && protectedFields.has(p.key.name)) {
            fieldsInCodePosition.add(p.key.name);
          } else {
            const key = staticStringKey(p.key);
            if (key !== null && protectedFields.has(key)) {
              fieldsInCodePosition.add(key);
            }
          }
        }
      }
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }

  return { fieldsInCodePosition, parseError: false };
}
