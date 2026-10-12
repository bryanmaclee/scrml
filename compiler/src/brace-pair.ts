/**
 * S465 r3 — does `text` (trimmed) consist of exactly ONE `{ … }` pair: its first
 * character `{` and the brace that CLOSES it is the last character?
 *
 * `{ A }⏎{ B }` starts with `{` and ends with `}`, but the first brace closes after
 * `A` — stripping "the outer pair" off it (`slice(1, -1)`) yields ` A }⏎{ B `, which a
 * probe-function reader then closes early and silently drops `B` (the S465 r3
 * finding). Every reader that strips a block's braces asks this first.
 *
 * The scan skips string literals (`"…"`, `'…'`), template literals (with nested
 * `${ … }` substitutions) and comments. A text the scan cannot account for (an
 * unterminated literal, an unbalanced brace) is NOT a whole pair — the caller
 * then does not strip, and its reader fails closed on the unparsed text.
 */
export function isWholeBraceBlock(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 2 || t[0] !== "{" || t[t.length - 1] !== "}") return false;
  return closingBraceIndex(t, 0) === t.length - 1;
}

/**
 * Index of the `}` that closes the `{` at `open` in `t`, or -1. Strings, template
 * literals and comments are skipped (see `isWholeBraceBlock`).
 */
export function closingBraceIndex(t: string, open: number): number {
  if (t[open] !== "{") return -1;
  // Stack of open contexts: "{" (a brace) or "${" (a template substitution).
  const stack: string[] = [];
  let i = open;
  while (i < t.length) {
    const c = t[i];
    const n = t[i + 1];
    if (c === "/" && n === "/") {
      const nl = t.indexOf("\n", i + 2);
      if (nl < 0) return -1;
      i = nl + 1;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = t.indexOf("*/", i + 2);
      if (end < 0) return -1;
      i = end + 2;
      continue;
    }
    if (c === "/" && regexMayStartAfter(t, i)) {
      const end = skipRegex(t, i);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === "\"" || c === "'") {
      const end = skipQuoted(t, i, c);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === "`") {
      // Scan the template's text; a `${` pushes a substitution context and
      // resumes the outer scan inside it.
      const r = scanTemplate(t, i + 1);
      if (r.end < 0) return -1;
      if (r.subst) { stack.push("${"); i = r.end; continue; }
      i = r.end + 1;
      continue;
    }
    if (c === "{") { stack.push("{"); i++; continue; }
    if (c === "}") {
      const top = stack.pop();
      if (top === undefined) return -1;
      if (top === "${") {
        // Back inside the enclosing template literal's text.
        const r = scanTemplate(t, i + 1);
        if (r.end < 0) return -1;
        if (r.subst) { stack.push("${"); i = r.end; continue; }
        i = r.end + 1;
        continue;
      }
      if (stack.length === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Can a `/` at `i` open a regular-expression literal? It can after an operator
 * or an opening punctuator (or at the start), and after a keyword such as
 * `return`; after a value (an identifier, a number, `)` / `]`) it is division.
 */
function regexMayStartAfter(t: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(t[j])) j--;
  if (j < 0) return true;
  const p = t[j];
  if ("(,=:[!&|?{};+-*%<>~^".includes(p)) return true;
  if (/[A-Za-z0-9_$]/.test(p)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(t[k])) k--;
    const word = t.slice(k + 1, j + 1);
    return ["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"].includes(word);
  }
  return false;
}

/** End index of the `/` closing the regex literal opened at `start`, or -1. */
function skipRegex(t: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") { i++; continue; }
    if (c === "\n") return -1;
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "/") return i;
  }
  return -1;
}

/** End index of the quote closing the literal opened at `start`, or -1. */
function skipQuoted(t: string, start: number, q: string): number {
  for (let i = start + 1; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") { i++; continue; }
    if (c === q) return i;
    if (c === "\n") return -1;
  }
  return -1;
}

/**
 * Scan template-literal text from `from`. Returns `{ end, subst }`: when the text
 * reaches a `${`, `subst` is true and `end` is the index just past it; otherwise
 * `end` is the index of the closing backtick. `end` is -1 when unterminated.
 */
function scanTemplate(t: string, from: number): { end: number; subst: boolean } {
  for (let i = from; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") { i++; continue; }
    if (c === "`") return { end: i, subst: false };
    if (c === "$" && t[i + 1] === "{") return { end: i + 2, subst: true };
  }
  return { end: -1, subst: false };
}
