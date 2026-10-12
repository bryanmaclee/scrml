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

/**
 * S465 r4 — split the template literal whose opening backtick is at `open`:
 * its raw text parts and the source text of each `${ … }` substitution, plus the
 * index of the closing backtick. Null when it is not well formed.
 */
export function splitTemplateLiteral(t: string, open: number): { quasis: string[]; subs: string[]; end: number } | null {
  if (t[open] !== "`") return null;
  const quasis: string[] = [];
  const subs: string[] = [];
  let from = open + 1;
  for (;;) {
    const r = scanTemplate(t, from);
    if (r.end < 0) return null;
    if (!r.subst) { quasis.push(t.slice(from, r.end)); return { quasis, subs, end: r.end }; }
    quasis.push(t.slice(from, r.end - 2));
    const close = closingBraceIndex(t, r.end - 1);
    if (close < 0) return null;
    subs.push(t.slice(r.end, close));
    from = close + 1;
  }
}

/**
 * S465 r4 — the first CALL in source `text`, or null. Returns the callee's text
 * (`check`, `row.fn`, `xs[0]`; the tag of a tagged template).
 *
 * Server code lowered from TEXT is never seen by the await classifier (a call in it
 * ships un-awaited — a Promise, truthy — whatever its callee), so every server
 * text-lowering site asks this and either lowers the code from a tree or refuses it.
 *
 * A call is a `(` — or a template literal's opening backtick (a tagged template) —
 * directly after a VALUE: an identifier that is not a keyword, `)`, `]`, or a closed
 * literal. NOT calls: a keyword head (`if (`, `for (`, `return (` …), the parameter
 * list of `function f(` / `function (`, a constructor `new X(` (§ constructors never
 * return a Promise the program awaits), and a payload VARIANT constructor `.Found(…)`
 * (a leading-dot capitalised name that follows no value — an enum value, §19).
 * Strings, comments and regex literals are skipped; template substitutions are
 * scanned. A text the scan cannot finish (an unterminated literal) answers with
 * what it scanned — callers refuse on non-null only, so they also refuse to lower
 * a text that is not well formed only through their own reader.
 */
/**
 * S465 r5 — the FAIL-CLOSED form of the question: could `text` hold a call? Purely
 * lexical, nothing is skipped — no string, template, comment or regex literal is
 * recognised, so no mis-read of one can hide a call (r5: `firstCallInText` treated
 * `of(x)` as the keyword `of` and read `i++ / f(x) /` as a regex literal, and the call
 * shipped un-awaited). Returns the callee excerpt of the first `(` or backtick that
 * follows a value — an identifier, `)`, `]`, a backtick, `?.` — or null.
 *
 * The only `(`s that are NOT calls are the ones the grammar fixes as something else:
 * a reserved word's head (`if (`, `for (`, `return (`, `typeof (` …; reserved in an
 * ES module, so never a callee — `of`, `async`, `get`, `let` are not reserved and
 * count), a function's parameter list (`function f(`, `function* f(`), a constructor
 * (`new X(` — a scrml async function is not constructible; `new` on one throws), and a
 * payload VARIANT constructor `.Found(…)` (a leading-dot capitalised name with no value
 * before the dot, §19). A false positive (a `(` inside a string) refuses the text, which
 * the caller first tries to lower from a tree.
 */
const RESERVED_HEAD_WORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "await", "do", "else",
  "case", "void", "delete", "throw", "in", "instanceof", "new", "with", "yield", "function",
]);

export function lexicalCallInText(text: string): string | null {
  const t = String(text ?? "");
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  const skipWsBack = (j: number): number => { while (j >= 0 && /\s/.test(t[j])) j--; return j; };
  const wordEndingAt = (j: number): { word: string; start: number } => {
    let k = j;
    while (k >= 0 && isWord(t[k])) k--;
    return { word: t.slice(k + 1, j + 1), start: k + 1 };
  };
  const excerptAt = (end: number): string => {
    const s = t.slice(Math.max(0, end - 40), end + 1).replace(/\s+/g, " ").trim();
    const m = /[A-Za-z_$@][\w$.@?]*$/.exec(s);
    return m ? m[0] : s.slice(-20) || "a function";
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c !== "(" && c !== "`") continue;
    const j = skipWsBack(i - 1);
    if (j < 0) continue;
    const p = t[j];
    if (c === "`") {
      // A backtick after a value: a tagged template (a call) — or the CLOSING backtick
      // of a template whose text ends in a word character. Lexically the two are the
      // same; both refuse (fail closed).
      if (isWord(p) || p === ")" || p === "]") return excerptAt(j);
      continue;
    }
    if (p === ")" || p === "]" || p === "`") return excerptAt(j);
    if (p === "." && t[j - 1] === "?") return excerptAt(j - 2);
    if (!isWord(p)) continue;
    const { word, start } = wordEndingAt(j);
    const b = skipWsBack(start - 1);
    const before = b >= 0 ? t[b] : "";
    if (before === "." && t[b - 1] !== ".") {
      // A member call — unless it is a payload variant constructor `.Found(…)`: a
      // capitalised name after a dot that follows no value.
      if (/^[A-Z]/.test(word)) {
        const d = skipWsBack(b - 1);
        if (d < 0 || !/[A-Za-z0-9_$)\]`'"]/.test(t[d])) continue;
        // `return .Found(…)`, `case .A(…)` — a reserved word is not a value.
        if (isWord(t[d]) && RESERVED_HEAD_WORDS.has(wordEndingAt(d).word)) continue;
      }
      return excerptAt(j);
    }
    if (/^[0-9]/.test(word)) return excerptAt(j);
    if (RESERVED_HEAD_WORDS.has(word)) continue;
    // `function f(` / `function* f(` — a parameter list; `new X(` — a constructor.
    let pb = b;
    if (before === "*") pb = skipWsBack(b - 1);
    if (pb >= 0 && isWord(t[pb])) {
      const pw = wordEndingAt(pb).word;
      if (pw === "function") continue;
      if (pw === "new" && before !== "*") continue;
    }
    return excerptAt(j);
  }
  return null;
}

const NOT_CALLEE_WORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "await", "in", "of", "do", "else",
  "case", "void", "delete", "throw", "yield", "function", "with", "instanceof", "new",
]);

export function firstCallInText(text: string): string | null {
  const t = String(text ?? "");
  // The previous significant token: a value (`v`), a keyword (`k:<word>`), a member
  // dot (`.`), or anything else (`o`).
  let prev = "o";
  // What the last identifier was introduced by: `function` / `new` / a variant dot.
  let intro = "";
  const stack: string[] = [];
  const callee = (end: number): string => {
    let e = end;
    while (e > 0 && /\s/.test(t[e - 1])) e--;
    let k = e;
    for (;;) {
      while (k > 0 && /[A-Za-z0-9_$.@?\])[]/.test(t[k - 1])) k--;
      // Cross whitespace only inside a member chain (`row . pw`), never between words.
      let w = k;
      while (w > 0 && /[ \t]/.test(t[w - 1])) w--;
      if (w === k || w === 0) break;
      if (t[k] === "." || t[w - 1] === ".") { k = w; continue; }
      break;
    }
    const s = t.slice(k, e).replace(/\s+/g, "").replace(/^[^A-Za-z_$@(\[]+/, "");
    return s.length > 40 ? s.slice(-40) : s;
  };
  // A call directly under `await` whose result is the end of its chain
  // (`await f(x)`, `(await f(x))`) is already awaited: not a finding.
  const endsChainAfterCall = (open: number): boolean => {
    let depth = 0;
    let j = open;
    for (; j < t.length; j++) {
      const ch = t[j];
      if (ch === "\"" || ch === "'") { const e = skipQuoted(t, j, ch); if (e < 0) return false; j = e; continue; }
      if (ch === "`") { return false; }
      if (ch === "(" ) depth++;
      else if (ch === ")") { depth--; if (depth === 0) break; }
    }
    if (j >= t.length) return false;
    let k = j + 1;
    while (k < t.length && /\s/.test(t[k])) k++;
    const nx = t[k] ?? "";
    return !(nx === "." || nx === "(" || nx === "[" || nx === "`" || (nx === "?" && t[k + 1] === "."));
  };
  let chainAwaited = false;
  let chainCalled = false;
  let chainSql = false;
  const closeValue = (next: number): void => { i = next; prev = "v"; intro = ""; };
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    const n = t[i + 1];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && n === "/") { const nl = t.indexOf("\n", i + 2); if (nl < 0) break; i = nl + 1; continue; }
    if (c === "/" && n === "*") { const e = t.indexOf("*/", i + 2); if (e < 0) break; i = e + 2; continue; }
    if (c === "/" && prev !== "v" && regexMayStartAfter(t, i)) {
      const e = skipRegex(t, i);
      if (e >= 0) { closeValue(e + 1); continue; }
    }
    if (c === "\"" || c === "'") {
      const e = skipQuoted(t, i, c);
      if (e < 0) break;
      closeValue(e + 1);
      continue;
    }
    if (c === "`") {
      if (prev === "v") return callee(i);
      const r = scanTemplate(t, i + 1);
      if (r.end < 0) break;
      if (r.subst) { stack.push("${"); i = r.end; prev = "o"; intro = ""; continue; }
      closeValue(r.end + 1);
      continue;
    }
    if (/[A-Za-z_$@]/.test(c)) {
      let j = i + 1;
      while (j < t.length && /[A-Za-z0-9_$]/.test(t[j])) j++;
      const word = t.slice(i, j);
      if (prev === "k:function" || prev === "k:new") intro = prev;
      else if (prev === "." && /^[A-Z]/.test(word)) {
        // A dot that follows no value opens a variant constructor: `.Found(…)`.
        let k = i - 1;
        while (k >= 0 && /\s/.test(t[k])) k--; // the dot
        k--;
        while (k >= 0 && /\s/.test(t[k])) k--;
        intro = k < 0 || !/[A-Za-z0-9_$)\]`'"]/.test(t[k]) ? "variant" : "";
      } else intro = "";
      if (prev !== ".") { chainAwaited = prev === "k:await"; chainCalled = false; chainSql = false; }
      prev = NOT_CALLEE_WORDS.has(word) && prev !== "." ? "k:" + word : "v";
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < t.length && /[0-9A-Za-z_.]/.test(t[j])) j++;
      closeValue(j);
      continue;
    }
    if (c === "(") {
      if (prev === "v" && intro !== "k:function" && intro !== "k:new" && intro !== "variant") {
        // A `?{ … }` query's driver chain (`.get()`, `.run()`, `.acrossTenants()`) is
        // the SQL lowering's own call (rewriteSqlRefs emits it awaited), not an author call.
        // Inside an unbackticked `?{ … }` body the text is SQL (`count(*)`), not code.
        const inSqlText = stack.lastIndexOf("?{") > stack.lastIndexOf("${");
        if (!inSqlText && !chainSql && !(chainAwaited && !chainCalled && endsChainAfterCall(i))) return callee(i);
        chainCalled = true;
      }
      stack.push("("); i++; prev = "o"; intro = ""; continue;
    }
    if (c === ")" || c === "]") { stack.pop(); closeValue(i + 1); continue; }
    if (c === "{" && t[i - 1] === "?") { stack.push("?{"); i++; prev = "o"; intro = ""; continue; }
    if (c === "[" || c === "{") { stack.push(c); i++; prev = "o"; intro = ""; continue; }
    if (c === "}") {
      const top = stack.pop();
      if (top === "?{") { closeValue(i + 1); chainSql = true; chainAwaited = false; chainCalled = false; continue; }
      if (top === "${") {
        const r = scanTemplate(t, i + 1);
        if (r.end < 0) break;
        if (r.subst) { stack.push("${"); i = r.end; prev = "o"; intro = ""; continue; }
        closeValue(r.end + 1);
        continue;
      }
      i++; prev = "o"; intro = ""; continue;
    }
    if (c === "?" && n === "." && !/[0-9]/.test(t[i + 2] ?? "")) {
      // `a?.b` member, `f?.(x)` optional call.
      if (t[i + 2] === "(" && prev === "v") return callee(i);
      i += 2; prev = "."; continue;
    }
    if (c === "." && n !== ".") { i++; prev = "."; continue; }
    i++; prev = "o"; intro = ""; continue;
  }
  return null;
}
