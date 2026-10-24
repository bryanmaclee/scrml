// grant-scan.js — s469-boot-tape-grants-2 (review F2): THE STRUCTURAL SCAN that
// keeps every read of a tape grant inside analyze.scrml's "THE TAPE GRANT
// READER" range.
//
// The round-2 scan matched spellings (`.grants.`, `grants.replace`, …) and was
// evaded by an alias, a helper outside the range, a destructure, a bracket
// read, a space before `.replace`, and `g.edits.length`. This scan works on
// TOKENS (comments and string text blanked) and is TYPE-shaped: outside the
// reader's range, a value of type GrantSet may not be named, held or read.
// Concretely, outside the range:
//   R1  `grants` read as a member (`x.grants`, `x .grants`) is allowed ONLY as
//       a whole argument of a call of a reader function (`grantsAdmit(f.grants,
//       …)`), or as the whole value of a `grants:` key of an object literal (a
//       copy into a construction: `{ …, grants: f.grants }`).
//   R2  `grants` as a key is allowed only in an object literal / struct type
//       body (NOT a destructuring pattern `{ grants: q } = f`, `{ grants } =
//       f`), or as a binder of a variant pattern (`.Seq(elem: e, grants: g)`,
//       which binds the TYPE's SeqGrants — whose `replace` / `edits` R3 then
//       guards). A bare `grants` (a local, a shorthand) is refused.
//   R3  a member read `.replace` / `.edits` (any receiver, any spacing) that is
//       not a method call is refused.
//   R4  the type name `GrantSet` is allowed only as the type of a struct type's
//       `grants` field, or in the import list. An annotation (`const g:
//       GrantSet`, a parameter, a return type) is refused.
//   R5  a call of a function that returns a GrantSet (`tapeGrants`, `noGrants`,
//       …) is allowed only where R1 allows a member read: as a whole reader-call
//       argument, or the whole value of a `grants:` key.
//   R6  a string literal "grants" / "replace" / "edits" used as a bracket key
//       (`f["grants"]`) is refused.
// Reader functions are the `fn`s declared inside the range.
//
// What it cannot see (stated, not hidden): a read that never spells `grants`,
// `replace`, `edits` or `GrantSet` and never calls a GrantSet-returning
// function — e.g. a computed key (`f["gr" + "ants"]`) or a host escape. The
// bootstrap's own dialect has no reflection, so those need deliberate host code.

export const READER_START = "THE TAPE GRANT READER (§66.12.3";
export const READER_END = "---- END OF THE TAPE GRANT READER";

/** Tokens of `src`: { t: "id" | "str" | "num" | "p", v, at } — comments skipped, string text kept as `v`. */
export function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const at = i;
      let v = "";
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") { v += src[i + 1] ?? ""; i += 2; continue; }
        v += src[i];
        i++;
      }
      i++;
      out.push({ t: "str", v, at });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const at = i;
      while (i < n && isId(src[i])) i++;
      out.push({ t: "id", v: src.slice(at, i), at });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const at = i;
      while (i < n && /[0-9.]/.test(src[i])) i++;
      out.push({ t: "num", v: src.slice(at, i), at });
      continue;
    }
    // multi-char punctuation that matters here
    const two = src.slice(i, i + 2);
    if (["=>", "==", "!=", ":>", "->", "||", "&&", ">=", "<=", "..."].includes(two) || src.slice(i, i + 3) === "...") {
      const v = src.slice(i, i + 3) === "..." ? "..." : two;
      out.push({ t: "p", v, at: i });
      i += v.length;
      continue;
    }
    out.push({ t: "p", v: c, at: i });
    i++;
  }
  return out;
}

const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = { ")": "(", "]": "[", "}": "{" };

/** For each token index, the index of its matching bracket (or -1). */
function matchBrackets(toks) {
  const m = new Array(toks.length).fill(-1);
  const stack = [];
  toks.forEach((k, i) => {
    if (k.t !== "p") return;
    if (OPEN[k.v]) stack.push(i);
    else if (CLOSE[k.v]) {
      // pop to the matching opener (tolerate stray closers)
      for (let s = stack.length - 1; s >= 0; s--) {
        if (toks[stack[s]].v === CLOSE[k.v]) { m[i] = stack[s]; m[stack[s]] = i; stack.length = s; break; }
      }
    }
  });
  return m;
}

/** The innermost bracket opener enclosing token `i` (or -1). */
function enclosing(toks, m, i) {
  let depth = 0;
  for (let j = i - 1; j >= 0; j--) {
    const k = toks[j];
    if (k.t !== "p") continue;
    if (CLOSE[k.v] && m[j] >= 0) { j = m[j]; continue; }
    if (OPEN[k.v]) return j;
  }
  return -1;
}

/**
 * The start index of the member/call chain that ENDS at token `end` (inclusive):
 * `p.decl.fields[p.idx].grants` → the index of `p`.
 */
function chainStart(toks, m, end) {
  let j = end;
  for (;;) {
    const k = toks[j];
    // step back over the current atom
    if (k.t === "p" && (k.v === ")" || k.v === "]") && m[j] >= 0) {
      j = m[j];
      // a call / index: the callee or object before it
      if (j - 1 >= 0 && (toks[j - 1].t === "id" || (toks[j - 1].t === "p" && (toks[j - 1].v === ")" || toks[j - 1].v === "]")))) { j = j - 1; continue; }
      return j;
    }
    // k is an id: preceded by `.`?
    if (j - 1 >= 0 && toks[j - 1].t === "p" && toks[j - 1].v === ".") { j = j - 2; continue; }
    return j;
  }
}

/** The end index of the chain starting at token `i` (the member token `grants`, or a callee) — follows `.x`, `(…)`, `[…]`. */
function chainEnd(toks, m, i) {
  let j = i;
  for (;;) {
    const nx = toks[j + 1];
    if (!nx) return j;
    if (nx.t === "p" && nx.v === "." && toks[j + 2] && toks[j + 2].t === "id") { j = j + 2; continue; }
    if (nx.t === "p" && (nx.v === "(" || nx.v === "[") && m[j + 1] >= 0) { j = m[j + 1]; continue; }
    return j;
  }
}

/** Is the expression spanning tokens [s, e] a WHOLE argument of a call of a reader function? */
function isReaderArg(toks, m, s, e, readers) {
  const before = toks[s - 1];
  const after = toks[e + 1];
  if (!before || !after) return false;
  if (!(before.t === "p" && (before.v === "(" || before.v === ","))) return false;
  if (!(after.t === "p" && (after.v === ")" || after.v === ","))) return false;
  const open = before.v === "(" ? s - 1 : enclosing(toks, m, s);
  if (open < 0 || toks[open].v !== "(") return false;
  const callee = toks[open - 1];
  if (!callee || callee.t !== "id" || !readers.has(callee.v)) return false;
  const kw = toks[open - 2];
  if (kw && kw.t === "id" && kw.v === "fn") return false;      // a declaration, not a call
  return true;
}

/** Is the expression spanning [s, e] the whole value of a `grants:` key in an object literal? */
function isGrantsSlotValue(toks, m, s, e) {
  const colon = toks[s - 1];
  const key = toks[s - 2];
  const after = toks[e + 1];
  if (!colon || colon.v !== ":" || !key || key.t !== "id" || key.v !== "grants") return false;
  if (!after || !(after.t === "p" && (after.v === "," || after.v === "}"))) return false;
  return isLiteralKey(toks, m, s - 2);
}

/** Token `i` (`grants`, followed by `:`) is a key of an object literal or a struct type body — not a destructuring pattern. */
function isLiteralKey(toks, m, i) {
  const open = enclosing(toks, m, i);
  if (open < 0 || toks[open].v !== "{") return false;
  const prev = toks[open - 1];
  if (prev && prev.t === "id" && (prev.v === "const" || prev.v === "let" || prev.v === "var")) return false;
  const close = m[open];
  const nx = close >= 0 ? toks[close + 1] : undefined;
  if (nx && ((nx.t === "p" && nx.v === "=") || (nx.t === "id" && (nx.v === "of" || nx.v === "in")))) return false;
  // must be at a key position: after `{` or `,`
  const b = toks[i - 1];
  return b && b.t === "p" && (b.v === "{" || b.v === ",");
}

/** Token `i` (`grants`, followed by `:`) binds in a variant pattern `.V(…, grants: g)`. */
function isVariantBinder(toks, m, i) {
  const open = enclosing(toks, m, i);
  if (open < 0 || toks[open].v !== "(") return false;
  const name = toks[open - 1];
  const dot = toks[open - 2];
  if (!name || name.t !== "id" || !dot || dot.v !== ".") return false;
  const b = toks[i - 1];
  return b && b.t === "p" && (b.v === "(" || b.v === ",");
}

/** Token `i` (`GrantSet`) is the type of a struct type body's `grants` field: `grants: GrantSet` in `type X:struct = { … }`. */
function isStructGrantsField(toks, m, i) {
  const colon = toks[i - 1];
  const key = toks[i - 2];
  if (!colon || colon.v !== ":" || !key || key.v !== "grants") return false;
  const open = enclosing(toks, m, i);
  if (open < 0 || toks[open].v !== "{") return false;
  // `type NAME:struct = {`
  const eq = toks[open - 1];
  const kind = toks[open - 2];
  return eq && eq.v === "=" && kind && kind.v === "struct";
}

/** Token `i` (`GrantSet`) inside the `import { … }` list. */
function isImportName(toks, m, i) {
  const open = enclosing(toks, m, i);
  return open >= 1 && toks[open].v === "{" && toks[open - 1].t === "id" && toks[open - 1].v === "import";
}

/** The names of the functions that return a GrantSet (`fn name(…) -> GrantSet …`). */
export function grantSetFns(...sources) {
  const out = new Set();
  for (const s of sources) {
    for (const m of s.matchAll(/\bfn\s+(\w+)\s*\([^)]*\)\s*->\s*GrantSet\b/g)) out.add(m[1]);
  }
  return out;
}

/**
 * Every place OUTSIDE the reader's range of `src` (analyze.scrml) where a
 * GrantSet is named, held or read — `{ line, rule, text }`. `libs`: the other
 * module sources whose GrantSet-returning functions `src` may call (core.scrml).
 */
export function grantReadsOutsideReader(src, libs = []) {
  const START = src.indexOf(READER_START);
  const END = src.indexOf(READER_END);
  if (START < 0 || END < START) return [{ line: 0, rule: "range", text: "the reader's range markers are missing" }];
  const toks = tokenize(src);
  const m = matchBrackets(toks);
  const inside = (k) => k.at > START && k.at < END;
  const readers = new Set();
  toks.forEach((k, i) => { if (inside(k) && k.t === "id" && k.v === "fn" && toks[i + 1]?.t === "id") readers.add(toks[i + 1].v); });
  const gsFns = grantSetFns(src, ...libs);
  const out = [];
  const lineOf = (at) => src.slice(0, at).split("\n").length;
  const report = (k, rule) => out.push({ line: lineOf(k.at), rule, text: src.slice(src.lastIndexOf("\n", k.at) + 1, src.indexOf("\n", k.at)).trim().slice(0, 160) });
  toks.forEach((k, i) => {
    if (inside(k)) return;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (k.t === "id" && k.v === "grants") {
      if (prev && prev.t === "p" && prev.v === ".") {
        const s = chainStart(toks, m, i);
        const e = chainEnd(toks, m, i);
        if (e === i && (isReaderArg(toks, m, s, e, readers) || isGrantsSlotValue(toks, m, s, e))) return;
        report(k, "R1 member read of `grants`");
        return;
      }
      if (next && next.t === "p" && next.v === ":") {
        if (isLiteralKey(toks, m, i) || isVariantBinder(toks, m, i)) return;
        report(k, "R2 `grants` key in a pattern");
        return;
      }
      report(k, "R2 bare `grants`");
      return;
    }
    if (k.t === "id" && (k.v === "replace" || k.v === "edits") && prev && prev.t === "p" && prev.v === ".") {
      if (next && next.t === "p" && next.v === "(") return;      // a method call (`s.replace(…)`)
      report(k, "R3 member read of `" + k.v + "`");
      return;
    }
    if (k.t === "id" && k.v === "GrantSet") {
      if (isStructGrantsField(toks, m, i) || isImportName(toks, m, i)) return;
      report(k, "R4 `GrantSet` named");
      return;
    }
    if (k.t === "id" && gsFns.has(k.v) && next && next.t === "p" && next.v === "(" && !(prev && prev.t === "id" && prev.v === "fn")) {
      const e = m[i + 1];
      if (e >= 0 && (isReaderArg(toks, m, i, e, readers) || isGrantsSlotValue(toks, m, i, e))) return;
      report(k, "R5 a GrantSet-returning call `" + k.v + "(…)` held or read");
      return;
    }
    if (k.t === "id" && gsFns.has(k.v) && prev && prev.t === "id" && prev.v === "fn") {
      report(k, "R4 a GrantSet-returning function declared outside the reader");
      return;
    }
    if (k.t === "str" && (k.v === "grants" || k.v === "replace" || k.v === "edits") && prev && prev.t === "p" && prev.v === "[") {
      report(k, "R6 bracket read of `" + k.v + "`");
    }
  });
  return out;
}
