// ---------------------------------------------------------------------------
// theme-body-parser.ts — SPEC §65.3.2 / §65.6 (css-wave1-theme-tokens)
//
// Parses the raw body of a `<theme …> … </theme>` structural element into a
// structured shape the ast-builder wraps in a `theme-decl` node. The body is
// NOT markup — it is the scrml-native CSS token grammar:
//
//   <theme for=@mode>
//       brand = #2563eb;                 // §65.3.2 — a base (default) token
//       ink   = #0f172a;
//       .Dark {                          // §65.6 — a variant re-bind sub-block
//           ink = #e2e8f0;
//       }
//       @media (prefers-color-scheme: dark) {   // §65.6 — auto-bind sugar
//           ink = #e2e8f0;
//       }
//   </theme>
//
// Grammar (flat, no nesting inside variant / media blocks):
//   binding   := IDENT '=' VALUE ( ';' | EOL )
//   variant   := '.' PascalName '{' binding* '}'
//   media     := '@media' '(' condition ')' '{' binding* '}'
//
// The block-splitter captures the whole body raw (STRUCTURAL_RAW_BODY_ELEMENTS),
// so this parser owns the body tokenization end-to-end — no downstream re-parse.
//
// Phase A (recognition + typer): the parser produces the token/variant shape.
// Phase B (codegen) consumes it to lower base tokens → `:root` custom
// properties, variant/media sub-blocks → the reactive-switching machinery, and
// to resolve use-site token references (`color: brand` → `var(--brand)` /
// E-THEME-TOKEN-UNKNOWN).
// ---------------------------------------------------------------------------

/** A source span (byte offsets + 1-based line/col), matching the AST convention. */
export interface ThemeSpan {
  file?: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

/** A single `name = value` token binding. */
export interface ThemeToken {
  name: string;
  value: string;
  span: ThemeSpan;
}

/** A `.Variant { … }` re-bind sub-block. */
export interface ThemeVariant {
  variant: string;         // the PascalCase variant name (no leading `.`)
  tokens: ThemeToken[];
  span: ThemeSpan;
}

/** An `@media (…) { … }` auto-bind sub-block. */
export interface ThemeMediaBind {
  condition: string;       // the raw parenthesized condition, incl. the parens
  tokens: ThemeToken[];
  span: ThemeSpan;
}

/** The parsed theme body. */
export interface ThemeBody {
  baseTokens: ThemeToken[];
  variants: ThemeVariant[];
  mediaBinds: ThemeMediaBind[];
  /** Names that appeared with a malformed / unrecognised shape (best-effort). */
  malformed: Array<{ text: string; span: ThemeSpan }>;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;

/**
 * Parse a `<theme>` body. `baseOffset` / `baseLine` / `baseCol` position the
 * FIRST char of `raw` in the original source (so spans point back into the
 * file). `filePath` is stamped onto every span.
 */
export function parseThemeBody(
  raw: string,
  baseOffset = 0,
  baseLine = 1,
  baseCol = 1,
  filePath = "",
): ThemeBody {
  const body: ThemeBody = { baseTokens: [], variants: [], mediaBinds: [], malformed: [] };
  const len = raw.length;
  let i = 0;

  // Line/col tracking: recompute lazily from a running counter.
  let line = baseLine;
  let col = baseCol;
  const advance = (to: number): void => {
    while (i < to && i < len) {
      if (raw[i] === "\n") { line++; col = 1; } else { col++; }
      i++;
    }
  };
  const spanAt = (start: number, end: number, ln: number, cl: number): ThemeSpan => ({
    file: filePath,
    start: baseOffset + start,
    end: baseOffset + end,
    line: ln,
    col: cl,
  });

  // Skip whitespace + `//` line comments + `/* */` block comments.
  const skipTrivia = (): void => {
    for (;;) {
      // whitespace
      while (i < len && /\s/.test(raw[i])) advance(i + 1);
      if (i + 1 < len && raw[i] === "/" && raw[i + 1] === "/") {
        while (i < len && raw[i] !== "\n") advance(i + 1);
        continue;
      }
      if (i + 1 < len && raw[i] === "/" && raw[i + 1] === "*") {
        advance(i + 2);
        while (i + 1 < len && !(raw[i] === "*" && raw[i + 1] === "/")) advance(i + 1);
        if (i + 1 < len) advance(i + 2);
        continue;
      }
      break;
    }
  };

  // Read an identifier (token name). Returns "" if none at the cursor.
  const readIdent = (): string => {
    if (i >= len || !IDENT_START.test(raw[i])) return "";
    const start = i;
    while (i < len && IDENT_CHAR.test(raw[i])) advance(i + 1);
    return raw.slice(start, i);
  };

  // Read a `name = value` binding starting at an identifier. Value runs to the
  // next top-level `;`, `}`, or newline (whichever comes first). Returns null
  // when the shape is not a binding.
  const readBinding = (): ThemeToken | null => {
    skipTrivia();
    const nameStart = i;
    const nameLine = line, nameCol = col;
    const name = readIdent();
    if (!name) return null;
    skipTrivia();
    if (i >= len || raw[i] !== "=") {
      // Not a binding — record best-effort + resync to the next `;`/newline.
      const badStart = nameStart;
      while (i < len && raw[i] !== ";" && raw[i] !== "\n" && raw[i] !== "}") advance(i + 1);
      const text = raw.slice(badStart, i).trim();
      if (text) body.malformed.push({ text, span: spanAt(badStart, i, nameLine, nameCol) });
      if (i < len && raw[i] === ";") advance(i + 1);
      return null;
    }
    advance(i + 1); // consume `=`
    skipTrivia();
    const valStart = i;
    // Value: to `;` / `}` / newline, tracking `(` `[` nesting so a `;`/newline
    // inside `rgb(…)` / a bracketed value does not truncate it.
    let paren = 0, bracket = 0;
    while (i < len) {
      const c = raw[i];
      if (c === "(") paren++;
      else if (c === ")") { if (paren > 0) paren--; }
      else if (c === "[") bracket++;
      else if (c === "]") { if (bracket > 0) bracket--; }
      else if ((c === ";" || c === "}") && paren === 0 && bracket === 0) break;
      else if (c === "\n" && paren === 0 && bracket === 0) break;
      advance(i + 1);
    }
    const value = raw.slice(valStart, i).trim();
    if (i < len && raw[i] === ";") advance(i + 1);
    return { name, value, span: spanAt(nameStart, i, nameLine, nameCol) };
  };

  // Read a `{ … }` block body (the inner text, balanced), positioned AT the `{`.
  // Returns { inner, innerStart } or null when no `{`.
  const readBraceBlock = (): { inner: string; innerStart: number; innerLine: number; innerCol: number } | null => {
    skipTrivia();
    if (i >= len || raw[i] !== "{") return null;
    advance(i + 1); // consume `{`
    const innerStart = i, innerLine = line, innerCol = col;
    let depth = 1;
    while (i < len && depth > 0) {
      const c = raw[i];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
      advance(i + 1);
    }
    const inner = raw.slice(innerStart, i);
    if (i < len && raw[i] === "}") advance(i + 1); // consume `}`
    return { inner, innerStart, innerLine, innerCol };
  };

  for (;;) {
    skipTrivia();
    if (i >= len) break;
    const c = raw[i];

    // Variant sub-block: `.Pascal { … }`
    if (c === "." && i + 1 < len && /[A-Z]/.test(raw[i + 1])) {
      const start = i, startLine = line, startCol = col;
      advance(i + 1); // consume `.`
      const variant = readIdent();
      const block = readBraceBlock();
      if (block) {
        const tokens = parseTokenBindings(block.inner, baseOffset + block.innerStart, block.innerLine, block.innerCol, filePath);
        body.variants.push({ variant, tokens, span: spanAt(start, i, startLine, startCol) });
      } else {
        body.malformed.push({ text: "." + variant, span: spanAt(start, i, startLine, startCol) });
      }
      continue;
    }

    // Media auto-bind: `@media (…) { … }`
    if (c === "@" && raw.slice(i, i + 6) === "@media") {
      const start = i, startLine = line, startCol = col;
      advance(i + 6); // consume `@media`
      skipTrivia();
      // condition: `(…)` — capture the full parenthesized text.
      let condition = "";
      if (i < len && raw[i] === "(") {
        const condStart = i;
        let depth = 0;
        while (i < len) {
          const ch = raw[i];
          if (ch === "(") depth++;
          else if (ch === ")") { depth--; advance(i + 1); if (depth === 0) break; continue; }
          advance(i + 1);
        }
        condition = raw.slice(condStart, i).trim();
      }
      const block = readBraceBlock();
      if (block) {
        const tokens = parseTokenBindings(block.inner, baseOffset + block.innerStart, block.innerLine, block.innerCol, filePath);
        body.mediaBinds.push({ condition, tokens, span: spanAt(start, i, startLine, startCol) });
      } else {
        body.malformed.push({ text: "@media " + condition, span: spanAt(start, i, startLine, startCol) });
      }
      continue;
    }

    // Any other stray `@`-rule or `{` — skip a balanced block or to `;` so a
    // best-effort recovery keeps the rest of the body parseable.
    if (c === "@" || c === "{") {
      const block = readBraceBlock();
      if (!block) {
        const badStart = i;
        while (i < len && raw[i] !== ";" && raw[i] !== "\n") advance(i + 1);
        const text = raw.slice(badStart, i).trim();
        if (text) body.malformed.push({ text, span: spanAt(badStart, i, line, col) });
        if (i < len && raw[i] === ";") advance(i + 1);
      }
      continue;
    }

    // Otherwise: a base `name = value;` binding.
    if (IDENT_START.test(c)) {
      const binding = readBinding();
      if (binding) body.baseTokens.push(binding);
      continue;
    }

    // Unrecognised char — advance to avoid an infinite loop.
    advance(i + 1);
  }

  return body;
}

/**
 * Parse a flat run of `name = value;` bindings (a variant / media sub-block
 * body). No nested variant/media blocks are recognised here (the grammar is
 * flat inside those sub-blocks).
 */
export function parseTokenBindings(
  raw: string,
  baseOffset = 0,
  baseLine = 1,
  baseCol = 1,
  filePath = "",
): ThemeToken[] {
  const sub = parseThemeBody(raw, baseOffset, baseLine, baseCol, filePath);
  // A sub-block should only carry base bindings; if it accidentally nested a
  // variant/media, fold nothing (best-effort — the outer parser owns nesting).
  return sub.baseTokens;
}
