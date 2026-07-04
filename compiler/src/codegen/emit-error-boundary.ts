// emit-error-boundary.ts
// ---------------------------------------------------------------------------
// errorBoundary (SPEC §19.6) — compiler support for the markup-context error
// catch. Two complementary paths land here (see SPEC §19.6.3 + §19.6.8):
//
//   1. TYPED `!`-error path (PRIMARY, §19.6.3) — a `!`-function call inside the
//      boundary subtree returns the scrml error envelope
//      `{ __scrml_error, type, variant, data }`. The runtime dispatches on
//      `result.variant`: the variant's own `renders` markup (§19.2) is shown
//      first, else the boundary's `fallback=` markup, else E-ERROR-005 would
//      have fired at compile time (§19.6.6).
//
//   2. HOST-JS BACKSTOP (C-hybrid, §19.6.8) — the subtree render is additionally
//      wrapped in an emitted host-JS try/catch so a NON-`!` throw (a host
//      TypeError, a malformed-data exception) degrades to the boundary's
//      `fallback=` rather than corrupting the page. The backstop is
//      compiler-emitted host-JS — NOT a scrml-source try/catch (§19.9.8 is
//      unaffected) — a runtime sibling of the §2.2.1 emitted-JS parse gate.
//      It logs loudly and does NOT silently swallow (§19.6.8 B5).
//
// This module produces the compile-time data (fallback HTML, per-variant
// renders templates) consumed by emit-event-wiring.ts to emit the runtime
// dispatch + backstop. Markup-string-to-HTML uses a re-parse of the raw
// markup fragment through the BS -> TAB -> generateHtml sub-pipeline (the same
// recursion the boundary's own children take), so nested tags + the `</>`
// closer are handled correctly.
// ---------------------------------------------------------------------------

import { runBlockSplitter } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";

/**
 * A compiled markup template for a fallback / renders body.
 *
 * - `htmlTemplate` is the rendered HTML with each `${field}` interpolation
 *   replaced by a sentinel-delimited field marker. The runtime substitutes
 *   these from the error variant's `.data` payload. When `fields` is empty the
 *   template is pure static HTML.
 * - `fields` lists the payload field names referenced (in first-seen order).
 */
export interface BoundaryMarkupTemplate {
  htmlTemplate: string;
  fields: string[];
}

// Sentinel delimiting a runtime-substituted payload field inside the rendered
// HTML template. Chosen to never collide with source markup: a private-use
// Unicode codepoint that does not appear in scrml source or generated HTML.
const FIELD_SENTINEL = "";

/**
 * Convert a raw scrml markup fragment (the `fallback=` attribute value or a
 * variant `renders` body) into an HTML template string. Each `${expr}`
 * interpolation whose expr is a bare identifier (a variant payload field) is
 * captured as a runtime-substituted field; richer expressions are left as a
 * literal `${...}` marker in the HTML (best-effort — payload-field refs are the
 * canonical §19.2.2 shape).
 *
 * Re-parses the fragment through the BS -> TAB -> generateHtml path so nested
 * elements + the `</>` closer lower exactly as the boundary's own children do.
 * `generateHtml` is passed lazily (caller injects it) to avoid a static import
 * cycle with emit-html.ts.
 */
/**
 * Reverse the block-splitter's tokenizer spacing for a markup fragment so it
 * re-parses cleanly. A variant's `renders` markup arrives via the enum
 * type-decl's `raw` string in tokenized form (`< div class = err > ... < / >`);
 * the `fallback=` attribute value arrives already-compact. This normalization
 * is idempotent on already-compact markup, so it is safe for both sources.
 *
 *   `< div`  -> `<div`     (tag opener)
 *   `< /`    -> `</`       (close-tag opener)
 *   ` >`     -> `>`        (tag close)
 *   ` / >`   -> `/>`       (self-close, incl. the `</>` scrml closer)
 */
function normalizeTokenizedMarkup(s: string): string {
  return s
    .replace(/<\s+/g, "<")
    .replace(/\s*\/\s*>/g, "/>")
    .replace(/\s+>/g, ">");
}

/**
 * Convert scrml's TERSE `/` markup-value closer into the explicit `</>` form so
 * the isolated re-parse (BS -> TAB -> generateHtml) can lower it.
 *
 * A `fallback={<markup/>}` (SPEC §19.6.2) or a `renders <markup/>` clause may use
 * the terse `/` closer — a `/` that closes the innermost open element, the value-
 * boundary analog of `</>` (SPEC §19.6.2's canonical form is `{<div>...text/}`,
 * the DOMINANT shape across the SPEC's boundary examples). The standalone re-parse
 * only understands `</>` / `</tag>` closers; a bare terse `/` yields ZERO nodes,
 * so the boundary's declared fallback markup silently compiled to an EMPTY string
 * (`fallbackExpr === '""'`) — the boundary caught the error but rendered nothing
 * (GitHub #22). Rewriting each terse `/` closer to `</>` restores the fallback.
 *
 * A `/` is a terse closer ONLY when an element is open (`depth > 0`) AND the `/`
 * is at a closer position: immediately followed (ignoring whitespace) by end-of-
 * fragment or by a `<` (the next sibling opener / an ancestor's `</>` closer).
 * This preserves literal text slashes (`and/or`, `http://x`) — a `/` with a
 * non-`<` character after it is text, not a closer. `${...}` interpolation spans
 * (which may legitimately contain `<` / `/`) are copied verbatim, and quoted
 * attribute strings are skipped. Idempotent on markup that already uses `</>`.
 */
function convertTerseClosers(s: string): string {
  let out = "";
  let i = 0;
  const n = s.length;
  let depth = 0;             // open markup element depth
  let inD = false, inS = false; // inside a "..." / '...' attribute string
  while (i < n) {
    const c = s[i];
    if (inD) { out += c; if (c === '"') inD = false; i++; continue; }
    if (inS) { out += c; if (c === "'") inS = false; i++; continue; }
    // Copy a `${ ... }` interpolation span verbatim (brace-balanced) — its
    // interior may hold `<` / `/` that are NOT markup structure.
    if (c === "$" && s[i + 1] === "{") {
      let j = i + 2;
      let braceDepth = 1;
      while (j < n && braceDepth > 0) {
        if (s[j] === "{") braceDepth++;
        else if (s[j] === "}") braceDepth--;
        j++;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"') { inD = true; out += c; i++; continue; }
    if (c === "'") { inS = true; out += c; i++; continue; }
    if (c === "<") {
      if (s[i + 1] === "/") {
        // Explicit closer `</...>` or `</>` — copy through, pop one level.
        let j = i + 2;
        while (j < n && s[j] !== ">") j++;
        if (j < n) j++; // include the closing `>`
        out += s.slice(i, j);
        if (depth > 0) depth--;
        i = j;
        continue;
      }
      if (/[A-Za-z]/.test(s[i + 1] ?? "")) {
        // Opener `<tag ...>` or inline self-close `<tag/>` — scan to its `>`.
        let j = i + 1;
        let d = false, sq = false, selfClose = false;
        while (j < n) {
          const cc = s[j];
          if (d) { if (cc === '"') d = false; j++; continue; }
          if (sq) { if (cc === "'") sq = false; j++; continue; }
          if (cc === '"') { d = true; j++; continue; }
          if (cc === "'") { sq = true; j++; continue; }
          if (cc === "/" && s[j + 1] === ">") { selfClose = true; j += 2; break; }
          if (cc === ">") { j++; break; }
          j++;
        }
        out += s.slice(i, j);
        if (!selfClose) depth++;
        i = j;
        continue;
      }
      // A `<` not opening markup (e.g. a stray less-than) — copy literally.
      out += c; i++; continue;
    }
    if (c === "/" && depth > 0 && s[i + 1] !== ">") {
      // Terse closer only when the next non-whitespace char is end-of-fragment
      // or a `<` markup token; otherwise it is a literal slash in text.
      let k = i + 1;
      while (k < n && /\s/.test(s[k] ?? "")) k++;
      if (k >= n || s[k] === "<") {
        out += "</>";
        depth--;
        i++;
        continue;
      }
    }
    out += c; i++;
  }
  return out;
}

export function compileBoundaryMarkup(
  rawMarkup: string,
  generateHtmlFn: (nodes: any[], ctxOrErrors: any) => string,
): BoundaryMarkupTemplate {
  const trimmed = normalizeTokenizedMarkup((rawMarkup ?? "").trim());
  if (trimmed === "") return { htmlTemplate: "", fields: [] };

  // Capture `${ident}` payload-field interpolations BEFORE re-parse so they do
  // not become `<span data-scrml-logic>` placeholders (which the re-parse would
  // otherwise produce for an unbound identifier). Replace each with a sentinel-
  // delimited field marker embedded in a plain text node, then re-parse.
  const fields: string[] = [];
  const fieldInterp = /\$\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}/g;
  const withFields = trimmed.replace(fieldInterp, (_m, name: string) => {
    if (!fields.includes(name)) fields.push(name);
    return `${FIELD_SENTINEL}${name}${FIELD_SENTINEL}`;
  });
  // Rewrite scrml's terse `/` markup-value closer to the explicit `</>` form the
  // standalone re-parse understands (SPEC §19.6.2's `{<div>...text/}` shape);
  // without this the fallback markup silently compiled to "" (GitHub #22). Run
  // AFTER the field-interp pass so any remaining literal `${...}` span is opaque.
  const prepared = convertTerseClosers(withFields);

  let html: string;
  try {
    const bs = runBlockSplitter({ filePath: "<errorBoundary-markup>", source: prepared });
    const built = buildAST(bs) as { ast?: { nodes?: any[] } };
    const nodes = built?.ast?.nodes ?? [];
    html = generateHtmlFn(nodes, null);
  } catch {
    // If the fragment does not re-parse cleanly (e.g. an exotic body the sub-
    // pipeline cannot lower in isolation), fall back to escaping the raw text
    // so the runtime still renders SOMETHING readable rather than emitting
    // invalid JS. The boundary still catches; only the displayed markup is the
    // raw text. This is conservative — the parse gate (§2.2.1) never sees a
    // broken template because the output is a plain JS string literal.
    html = escapeHtmlText(prepared);
  }

  return { htmlTemplate: html, fields };
}

/**
 * Emit a JS string-concatenation expression that reconstructs the boundary
 * markup template at runtime, substituting each field sentinel with
 * `String(<dataExpr>.<field>)`. `dataExpr` is the JS expression that yields the
 * error variant's `.data` payload object (e.g. `result.data`).
 *
 * - Static template (no fields)  -> a single quoted string literal.
 * - Field template               -> `"prefix" + String(data.field) + "suffix"`.
 *
 * Field values are coerced with `String(...)` and the surrounding HTML is a
 * compile-time-known literal, so the result is always valid JS.
 */
export function emitBoundaryMarkupExpr(
  tpl: BoundaryMarkupTemplate,
  dataExpr: string,
  payloadFields?: string[],
): string {
  if (tpl.fields.length === 0) {
    return JSON.stringify(tpl.htmlTemplate);
  }
  // §51.3.2 — the error envelope stores EVERY payload variant's fields as a
  // field-keyed object on `.data`, for BOTH single- AND multi-field variants
  // (matching the enum constructor `Shape.Circle(10)` -> `data:{r:10}`,
  // emitFailExpr, parseVariant, and the `!{}` / `match` payload binders). So a
  // `${field}` reference lowers to `(data).field` uniformly. (`payloadFields`
  // is retained for caller-signature stability; the field name comes from the
  // sentinel segment, so no arity discrimination is needed.)
  void payloadFields;
  // Split on the sentinel. The split alternates literal-HTML and field-name
  // segments: even indices are HTML, odd indices are field names.
  const segments = tpl.htmlTemplate.split(FIELD_SENTINEL);
  const pieces: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) {
      if (segments[i] !== "") pieces.push(JSON.stringify(segments[i]));
    } else {
      const field = segments[i];
      pieces.push(`String((${dataExpr}) != null ? (${dataExpr}).${field} : "")`);
    }
  }
  if (pieces.length === 0) return '""';
  return pieces.join(" + ");
}

/** Minimal HTML-text escape for the re-parse fallback path. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


// ---------------------------------------------------------------------------
// Variant -> `renders` markup extraction (§19.2).
//
// The `renders` clause survives into the AST only inside the enum type-decl's
// `raw` string (the type system's parseEnumBody extracts it into VariantDef,
// but that structured form is not threaded back onto the codegen-side AST
// node). For the boundary's per-variant render dispatch we parse the raw
// directly — mirroring emit-client.ts:getAllVariantInfo's raw-fallback split —
// and capture each variant's `renders <markup>` body as a raw string.
// ---------------------------------------------------------------------------

/** A single enum type's variant -> renders-markup map, keyed by enum type name. */
export interface EnumRendersInfo {
  /** Enum type name (e.g. "LoadError"). */
  typeName: string;
  /** variantName -> raw `renders` markup string (only variants that HAVE a renders clause). */
  renders: Map<string, string>;
  /**
   * variantName -> ordered payload field names. Per §51.3.2 the error envelope
   * stores EVERY payload variant's fields as a field-keyed object on `.data`
   * (single- AND multi-field alike, matching the enum constructor / emitFailExpr
   * / parseVariant / the `!{}` + `match` payload binders), so a `${field}`
   * interpolation lowers to `_eb_result.data.{field}` uniformly. The ordered
   * field list is retained for arity diagnostics / potential future use.
   */
  variantFields: Map<string, string[]>;
}

/**
 * Parse one enum type-decl's `raw` body and return its variant -> renders-markup
 * map. Only variants that carry a `renders` clause appear in the map; a variant
 * with no `renders` is absent (it falls through to the boundary's `fallback=`).
 *
 * Recognises both shapes:
 *   Name           renders <markup>      (unit variant)
 *   Name(f:T, ...) renders <markup>      (payload variant)
 * Variants are split at top-level newline / comma / pipe (depth-tracked), so a
 * `renders` body containing nested elements / commas stays with its variant
 * until the next top-level separator.
 */
export function extractVariantRenders(decl: { name?: string; raw?: string }): EnumRendersInfo {
  const typeName = decl?.name ?? "";
  const renders = new Map<string, string>();
  const variantFields = new Map<string, string[]>();
  let body = (decl?.raw ?? "").trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return { typeName, renders, variantFields };

  // Top-level split on newline / comma / pipe (depth-tracked so payload parens
  // and `renders` markup angle-brackets do not split a variant prematurely).
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    // A top-level newline / comma / pipe ends the current variant. Inside a
    // `renders` body the separators are part of markup text; but the canonical
    // §19.2 shape places each variant (with its renders) on its own logical
    // line, and the depth guard keeps payload + bracketed markup intact.
    if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
      if (buf.trim()) parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  // The split above breaks a multi-line variant (`Name(...)\nrenders <markup>`)
  // into two parts. Re-join a bare `renders <markup>` continuation onto the
  // immediately-preceding variant-name part.
  const merged: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (t.startsWith("renders ") && merged.length > 0) {
      merged[merged.length - 1] = merged[merged.length - 1].trim() + " " + t;
    } else {
      merged.push(part);
    }
  }

  for (const part of merged) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    const rendersIdx = trimmed.indexOf(" renders ");
    if (rendersIdx === -1) continue; // no renders clause on this variant
    const markup = trimmed.slice(rendersIdx + " renders ".length).trim();
    let head = trimmed.slice(0, rendersIdx).trim();
    // Strip payload parens from the variant name + capture the payload field
    // names (in declared order) for arity-aware substitution.
    const parenIdx = head.indexOf("(");
    const name = (parenIdx === -1 ? head : head.slice(0, parenIdx)).trim();
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
    const fields: string[] = [];
    if (parenIdx !== -1) {
      const closeParen = head.lastIndexOf(")");
      if (closeParen > parenIdx) {
        const payloadStr = head.slice(parenIdx + 1, closeParen).trim();
        if (payloadStr) {
          for (const fp of payloadStr.split(",")) {
            const colon = fp.indexOf(":");
            const fieldName = (colon === -1 ? fp : fp.slice(0, colon)).trim();
            if (fieldName) fields.push(fieldName);
          }
        }
      }
    }
    if (markup) {
      renders.set(name, markup);
      variantFields.set(name, fields);
    }
  }

  return { typeName, renders, variantFields };
}

/**
 * Walk a file AST and collect every enum type-decl's variant -> renders map,
 * keyed by enum type name. type-decl nodes appear both at top level and inside
 * `logic` bodies (the `${ type X:enum = {...} }` shape), so the walk descends
 * into logic/children/body containers.
 */
export function collectEnumRenders(fileAST: any): Map<string, EnumRendersInfo> {
  const out = new Map<string, EnumRendersInfo>();
  const seen = new Set<any>();
  const visit = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (n.kind === "type-decl" && (n.typeKind === "enum") && typeof n.name === "string") {
      const info = extractVariantRenders(n);
      if (info.renders.size > 0) out.set(info.typeName, info);
    }
    for (const k of ["nodes", "children", "body", "branches", "arms", "armBody"]) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  const root = fileAST?.nodes ? fileAST : (fileAST?.ast ?? fileAST);
  if (Array.isArray(root?.nodes)) root.nodes.forEach(visit);
  // Also consult an explicit typeDecls list when present (TAB attaches it).
  if (Array.isArray(root?.typeDecls)) root.typeDecls.forEach(visit);
  return out;
}
