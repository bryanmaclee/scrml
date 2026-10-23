// template-slot-fuzz.js — s469 (logic backtick templates, SPEC §14.13.3): the
// bootstrap's ONE reader of a `${…}` slot (lex.scrml) fuzzed against acorn's.
//
// THE ORACLE is impl#1's rule (compiler/src/interpolation-extent.ts, S469: "ONE
// reader of a ${…} extent"), re-stated here over the same parser
// (compiler/src/scrml-acorn.ts ScrmlParser — acorn plus the `@` sigil):
//   - each slot is ONE expression followed by `}`, read under BOTH goals the
//     code runs as (a module with top-level await, and a classic script); the
//     slot is bounded only when both readings end it at the same `}`;
//   - a slot holding an HTML-like comment (`<!--`, a line-initial `-->`) is
//     unreadable (Annex B: a classic script reads it as a comment);
//   - and (stricter than the per-slot rule alone) the WHOLE template must parse
//     as one TemplateLiteral under both goals with the same slot extents — so a
//     malformed escape in the template's text is unreadable too.
//
// THE CANDIDATE is the bootstrap: lex.scrml's tokens (TemplateChunk /
// TemplateInterpStart / TemplateInterpEnd), refused when a chunk carries `bad`,
// a slot's `}` carries `why`, or the template's structure is incomplete; and
// then parse.scrml over `return <template>` in a function (any E- diagnostic is
// a refusal — the parser's E-PARSE-TEMPLATE / E-PARSE-EXPR / … are part of the
// one reader's verdict).
//
// THE BAR (asserted by templates-s469.test.js, reported by the CLI below):
//   A. both read            → the top-level slot extents are IDENTICAL;
//   B. acorn cannot read    → the bootstrap refuses;
//   C. acorn reads, the bootstrap refuses → fail-closed, COUNTED and classed
//      (never silently accepted the other way).
//
// CLI:  bun compiler/self-host-v2/slice-m4/template-slot-fuzz.js [count] [seed]

// @ts-ignore — acorn ships its own types but the plugin API is untyped
import * as acorn from "acorn";
import { ScrmlParser } from "../../src/scrml-acorn.ts";

const GOALS = [
  { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true },
  { ecmaVersion: "latest", sourceType: "script" },
];

// ---------------------------------------------------------------------------
// The oracle (acorn, both goals) — interpolation-extent.ts EXPRESSION mode.
// ---------------------------------------------------------------------------

export function hasHtmlLikeComment(text) {
  if (text.includes("<!--")) return true;
  for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const at = line.indexOf("-->");
    if (at < 0) continue;
    const before = line.slice(0, at);
    if (before.trim() === "" || before.includes("*/")) return true;
  }
  return false;
}

function closeUnder(opts, src, start) {
  try {
    const p = new ScrmlParser(opts, src.slice(start), 0);
    p.nextToken();
    p.parseExpression();
    return p.type === acorn.tokTypes.braceR ? start + p.start : -1;
  } catch {
    return -1;
  }
}

/** The `}` balancing a slot, read by acorn's TOKENIZER (impl#1's BLOCK-mode tokenCloseUnder). */
function tokenCloseUnder(opts, src, start) {
  try {
    const p = new ScrmlParser(opts, src.slice(start), 0);
    p.nextToken();
    const tt = acorn.tokTypes;
    let depth = 0;
    for (;;) {
      const type = p.type;
      if (type === tt.eof) return -1;
      if (type === tt.braceL || type === tt.dollarBraceL) depth++;
      else if (type === tt.braceR) {
        if (depth === 0) return start + p.start;
        depth--;
      }
      p.next();
    }
  } catch {
    return -1;
  }
}

function agreeClose(src, start, close) {
  const a = close(GOALS[0], src, start);
  const b = close(GOALS[1], src, start);
  if (a < 0 || a !== b) return -1;
  if (hasHtmlLikeComment(src.slice(start, a))) return -1;
  return a;
}

function interpolationClose(src, start) {
  return agreeClose(src, start, closeUnder);
}

/** Only white space and comments from `at` to the end, under a goal (the template is the whole input). */
function restIsTrivia(opts, src, at) {
  try {
    const p = new ScrmlParser(opts, src.slice(at), 0);
    p.nextToken();
    return p.type === acorn.tokTypes.eof;
  } catch {
    return false;
  }
}

/** The whole template as ONE TemplateLiteral under a goal: its slot extents, or null. */
function wholeUnder(opts, tpl) {
  try {
    const node = ScrmlParser.parseExpressionAt(tpl, 0, opts);
    if (node.type !== "TemplateLiteral" || !restIsTrivia(opts, tpl, node.end)) return null;
    const slots = [];
    for (let i = 0; i < node.expressions.length; i++) slots.push([node.quasis[i].end + 2, node.quasis[i + 1].start - 1]);
    return slots;
  } catch {
    return null;
  }
}

/** The template's slot extents by acorn's reading, `close` per slot; `{ ok, slots }`. */
function sliceWith(tpl, close) {
  if (!tpl.startsWith("`")) return { ok: false, slots: [] };
  // per slot, impl#1's sliceTemplateText walk (a `\` escapes the next character)
  const slots = [];
  let i = 1;
  for (;;) {
    if (i >= tpl.length) return { ok: false, slots };
    const ch = tpl.charCodeAt(i);
    if (ch === 92) { i += 2; continue; }
    if (ch === 96) { if (!restIsTrivia(GOALS[0], tpl, i + 1) || !restIsTrivia(GOALS[1], tpl, i + 1)) return { ok: false, slots }; break; }
    if (ch === 36 && tpl.charCodeAt(i + 1) === 123) {
      const start = i + 2;
      const at = agreeClose(tpl, start, close);
      if (at < 0) return { ok: false, slots };
      slots.push([start, at]);
      i = at + 1;
      continue;
    }
    i++;
  }
  return { ok: true, slots };
}

/**
 * The template's STATIC text read by JavaScript: the template with every slot replaced by `${0}`
 * parses under both goals (a malformed escape, a raw `\1`, … do not).
 */
function quasisOk(tpl, slots) {
  let out = "";
  let at = 0;
  for (const [s, e] of slots) { out += tpl.slice(at, s) + "0"; at = e; }
  out += tpl.slice(at);
  return wholeUnder(GOALS[0], out) !== null && wholeUnder(GOALS[1], out) !== null;
}

/**
 * acorn's LEXICAL reading (where each slot ends, by tokens — strings, templates, comments,
 * regular expressions as JavaScript reads them; both goals; no HTML-like comment) — the extent
 * question, for scrml content too (`.V`, `is not`, `match … { … }` are JavaScript tokens).
 */
export function acornTokRead(tpl) {
  const r = sliceWith(tpl, tokenCloseUnder);
  if (!r.ok) return r;
  return { ok: quasisOk(tpl, r.slots), slots: r.slots };
}

/** acorn's EXPRESSION reading (impl#1's rule: each slot ONE JavaScript expression): `{ ok, slots }`. */
export function acornRead(tpl) {
  const r = sliceWith(tpl, closeUnder);
  if (!r.ok) return r;
  const slots = r.slots;
  const a = wholeUnder(GOALS[0], tpl);
  const b = wholeUnder(GOALS[1], tpl);
  if (a === null || b === null || JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(slots)) {
    return { ok: false, slots };
  }
  return { ok: true, slots };
}

// ---------------------------------------------------------------------------
// The candidate (the bootstrap).
// ---------------------------------------------------------------------------

const tag = (k) => (k && typeof k === "object" ? k.variant : k);

/** The bootstrap LEXER's reading: `{ ok, why, slots }` (top-level slot extents). */
export function bootLex(mods, tpl) {
  const toks = mods.lex.lex(tpl);
  const slots = [];
  let depth = 0;
  let open = -1;
  let closedAt = -1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const k = tag(t.kind);
    if (k === "TemplateChunk" && t.kind.data.bad !== "") return { ok: false, why: "chunk: " + t.kind.data.bad, slots };
    if (k === "TemplateInterpEnd" && t.kind.data.why !== "") return { ok: false, why: "slot: " + t.kind.data.why, slots };
    if (k === "TemplateInterpStart") { if (depth === 0) open = t.span.end; depth++; }
    if (k === "TemplateInterpEnd") { depth--; if (depth === 0) slots.push([open, t.span.start]); }
    if (i === 0 && k !== "TemplateChunk") return { ok: false, why: "not a template", slots };
    if (k === "TemplateChunk" && depth === 0 && closedAt < 0 && endsTemplate(t.text)) closedAt = i;
  }
  if (closedAt < 0) return { ok: false, why: "unterminated", slots };
  if (tag(toks[closedAt + 1].kind) !== "Eof") return { ok: false, why: "ends early", slots };
  return { ok: true, why: "", slots };
}

function endsTemplate(raw) {
  if (!raw.endsWith("`")) return false;
  let k = raw.length - 2;
  let n = 0;
  while (k >= 0 && raw[k] === "\\") { n++; k--; }
  return n % 2 === 0;
}

/** The bootstrap PARSER's verdict on `return <tpl>`: the E- codes it reports. */
export function bootParseCodes(mods, tpl) {
  return bootParse(mods, tpl).codes;
}

/**
 * The parser's verdict: its E- codes, and (review r1) whether what it built for a template it
 * accepted IS a Template node — a parse placeholder (Recovered) with no error would print as `null`.
 */
export function bootParse(mods, tpl) {
  const src = "<program>\n    fn f() -> string {\n        return " + tpl + "\n    }\n</program>\n";
  const r = mods.parse.parseFile("fuzz.scrml", src, 0);
  const json = JSON.stringify(r.ast);
  const codes = [...new Set(r.diags.map((d) => d.code).filter((c) => c.startsWith("E-")))].sort();
  return { codes, isTemplate: json.includes("\"variant\":\"Template\"") && !json.includes("\"Recovered\"") };
}

// ---------------------------------------------------------------------------
// END TO END (review r1's oracle): a template the bootstrap compiles CLEAN — through analyze,
// lower and print — is run, and its text compared with JavaScript's own evaluation of the
// same template in a sloppy script, with the same bindings. Only the names below are bound.
// ---------------------------------------------------------------------------
const E2E_PARAMS = [["a", "int", 7], ["b", "int", -2], ["n", "int", 3], ["total", "number", 0.1], ["x1", "string", "s}`"]];

export function e2e(mods, frontEnd, rt, tpl) {
  if (tpl.includes("@")) return { status: "skip" };
  // ruled language differences, not reader ones: `not` is scrml's absence (a JavaScript name), and a
  // string's `.length` counts code points (S469 "code points everywhere, `.length` included")
  if (/\bnot\b/.test(tpl)) return { status: "skip" };
  if (tpl.includes(".length") && /\\u\{[0-9A-Fa-f]{5,}\}|[\uD800-\uDFFF]/.test(tpl)) return { status: "skip" };
  const params = E2E_PARAMS.map(([nm, ty]) => nm + ": " + ty).join(", ");
  const src = "<program>\n    fn f(" + params + ") -> string {\n        return " + tpl + "\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n";
  let r;
  try { r = frontEnd(mods, [{ path: "e.scrml", src }]); } catch (e) { return { status: "CRASH", why: String(e).slice(0, 200) }; }
  if (r.diags.some((d) => !d.code.startsWith("W-") && !d.code.startsWith("I-")) || !r.core) return { status: "skip" };
  const js = mods.print.printProgram(r.core, "e.client.js", "scrml-runtime.js").js;
  const at = js.indexOf("function f(");
  const end = js.indexOf("\n}", at);
  if (at < 0 || end < 0) return { status: "NO-FN", got: js, want: "" };
  let got;
  try { got = new Function("rt", js.slice(at, end + 2) + "\nreturn f;")(rt)(...E2E_PARAMS.map((p) => p[2])); } catch (e) { got = "THROW " + String(e); }
  let want;
  try { want = new Function(...E2E_PARAMS.map((p) => p[0]), "return " + tpl + ";")(...E2E_PARAMS.map((p) => p[2])); } catch (e) { want = "THROW " + String(e); }
  return { status: got === want ? "same" : "DIFFER", got, want };
}

/**
 * One input, judged. `verdict`:
 *   agree-read        acorn reads it as JavaScript, the bootstrap reads it, same extents
 *   agree-refuse      neither reads it
 *   scrml-content     acorn's TOKENS bound it (same extents as the bootstrap's) but a slot is not
 *                     one JavaScript expression — the bootstrap read it with its own grammar (a
 *                     scrml form, or a word JavaScript reserves read as a name: see the report)
 *   conservative      acorn reads it, the bootstrap refuses (fail closed)
 *   DISAGREE-extent   both bound it, at different `}`s                       ← never allowed
 *   DISAGREE-lexical  acorn's tokens cannot bound it, the bootstrap reads it   ← never allowed
 */
export function judge(mods, tpl) {
  const a = acornRead(tpl);
  const t = acornTokRead(tpl);
  const l = bootLex(mods, tpl);
  const bp = l.ok ? bootParse(mods, tpl) : { codes: [], isTemplate: false };
  const codes = bp.codes;
  const bootReads = l.ok && codes.length === 0;
  const same = (x) => JSON.stringify(x.slots) === JSON.stringify(l.slots);
  let verdict;
  if (bootReads && !bp.isTemplate) verdict = "DISAGREE-not-a-template";
  else if (l.ok && ((a.ok && !same(a)) || (t.ok && !same(t)))) verdict = "DISAGREE-extent";
  else if (!t.ok && bootReads) verdict = "DISAGREE-lexical";
  else if (a.ok && bootReads) verdict = "agree-read";
  else if (bootReads) verdict = "scrml-content";
  else if (!a.ok) verdict = "agree-refuse";
  else verdict = "conservative";
  return { tpl, acorn: a, tok: t, lex: l, codes, verdict };
}

// ---------------------------------------------------------------------------
// The generator — templates whose slots mix scrml expressions with every
// token class that can move a `}`: strings, nested templates, regular
// expressions, comments, braces, division-vs-regex words, bad escapes,
// HTML-like comments, unbalanced closers.
// ---------------------------------------------------------------------------

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const IDENTS = ["a", "b", "n", "total", "@count", "@s", "x1", "of", "await", "yield", "let", "async", "match", "not", "is", "from", "as", "case", "typeof", "void", "this", "true", "null", "undefined", "new", "in", "static", "enum"];
// scrml forms a JavaScript EXPRESSION reader refuses but its TOKENIZER bounds (`.V`, `is given`, a
// `match` with arms — braces and `:>` inside the slot)
const SCRML = [".Red", "n is given", "@s is not", "match n { .A :> \"}\" .B :> 2 }", "match n { 1 :> `x${a}` _ :> \"y\" }",
  "@s.length", "f(.B)", "{ a: 1, b: \"}\" }"];
const STRINGS = [
  "\"}\"", "'}'", "\"`\"", "'${'", "\"${x}\"", "\"\\\"}\"", "'\\''", "\"\\\\\"", "\"a\\nb\"", "\"\\u{7D}\"", "\"\\x7D\"",
  "\"\\u{\"", "\"\\x4\"", "\"\\1\"", "\"\\0\"", "\"\\08\"", "\"\\8\"", "\"<!--\"", "\"-->\"", "\"a\nb\"", "\"un", "''", "\"\"",
  "\"/*\"", "\"//\"", "\"{\"",
];
const REGEXES = ["/}/", "/[/}]/", "/\\//g", "/a/", "/`/", "/\"/", "/${/", "/(/", "/a/gg"];
const COMMENTS = ["/* } */", "/* ` */", "// }\n", "/**/", "/* <!-- */", "\n--> x\n", "<!-- x\n", "/* a */ --> b\n"];
const QUASI = ["a", " ", "typed ", " chars", "\\`", "\\${", "$", "{", "}", "\\\\", "\\n", "\\t", "$ {", "\\u0041", "\\u{1F600}", "\\x41",
  "\\1", "\\0", "\\08", "\\x4", "\\u{", "\\u{110000}", "\n", "\r\n", "\r", "<!--", "-->", "/", "//", "/*", "'", "\""];

function quasi(r) {
  let s = "";
  const n = Math.floor(r() * 3);
  for (let i = 0; i < n; i++) s += pick(r, QUASI);
  return s;
}

function atom(r, d) {
  const x = r();
  if (x < 0.2) return pick(r, IDENTS);
  if (x < 0.25) return pick(r, SCRML);
  if (x < 0.35) return pick(r, ["1", "0", "2.5", "1e21", "0x1F", "-0", "0.1"]);
  if (x < 0.55) return pick(r, STRINGS);
  if (x < 0.65 && d < 3) return template(r, d + 1);
  if (x < 0.72) return pick(r, REGEXES);
  if (x < 0.8 && d < 4) return "(" + expr(r, d + 1) + ")";
  if (x < 0.86 && d < 4) return "[" + expr(r, d + 1) + ", " + expr(r, d + 1) + "]";
  if (x < 0.92 && d < 4) return "{ " + pick(r, ["a", "\"}\"", "b"]) + ": " + expr(r, d + 1) + " }";
  if (d < 4) return pick(r, ["x => ", "(a, b) => ", "() => { return ", "() => { if (a) "]) + expr(r, d + 1) + pick(r, ["", " }", ""]);
  return "a";
}

function expr(r, d) {
  let s = atom(r, d);
  const n = Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const y = r();
    if (y < 0.5) s += " " + pick(r, ["+", "-", "*", "/", "%", "==", "!=", "<", ">", "&&", "||", "??", "===", ","]) + " " + atom(r, d);
    else if (y < 0.62) s += "." + pick(r, ["length", "b", "x"]);
    else if (y < 0.72) s += "(" + (r() < 0.5 ? "" : expr(r, d + 1)) + ")";
    else if (y < 0.8) s += " ? " + atom(r, d) + " : " + atom(r, d);
    else if (y < 0.88) s += pick(r, COMMENTS);
    else if (y < 0.93) s = pick(r, ["!", "-", "typeof ", "void "]) + s;
    else s += pick(r, [")", "]", "}", " /", "/", "++", " x"]);
  }
  return s;
}

export function template(r, d = 0) {
  let s = "`" + quasi(r);
  const slots = Math.floor(r() * 3);
  for (let i = 0; i < slots; i++) {
    const pad = pick(r, ["", " ", "\n"]);
    s += "${" + pad + (r() < 0.04 ? "" : expr(r, d)) + pad + "}" + quasi(r);
  }
  return s + (r() < 0.03 ? "" : "`");
}

/** Run `count` generated templates from `seed`; returns { tally, disagreements, conservative }. */
export function runFuzz(mods, count, seed, run = null) {
  const r = rng(seed);
  const tally = {};
  const disagreements = [];
  const conservative = {};
  const content = [];
  const seen = new Set();
  let unique = 0;
  for (let i = 0; i < count; i++) {
    const tpl = template(r);
    if (seen.has(tpl)) continue;
    seen.add(tpl);
    unique++;
    const j = judge(mods, tpl);
    tally[j.verdict] = (tally[j.verdict] ?? 0) + 1;
    if (j.verdict.startsWith("DISAGREE")) disagreements.push(j);
    if (j.verdict === "scrml-content") content.push(j.tpl);
    if (run && j.verdict === "agree-read") {
      const x = e2e(mods, run.frontEnd, run.rt, tpl);
      const k = "e2e-" + x.status;
      tally[k] = (tally[k] ?? 0) + 1;
      if (x.status !== "same" && x.status !== "skip") disagreements.push({ verdict: "DISAGREE-" + k, tpl, acorn: x.got, lex: x.want, codes: [] });
    }
    if (j.verdict === "conservative") {
      const cls = !j.lex.ok ? "lex: " + j.lex.why.replace(/`[^`]*`/g, "`…`").slice(0, 70) : "parse: " + j.codes.join(",");
      conservative[cls] = (conservative[cls] ?? 0) + 1;
    }
  }
  return { unique, tally, disagreements, conservative, content };
}

if (import.meta.main) {
  const { loadM2 } = await import("../slice-m2/harness.js");
  const { frontEnd } = await import("../slice-m2/lowered.js");
  const rt = await import("../slice-m1/runtime/runtime.js");
  const { mods } = loadM2();
  const count = Number(process.argv[2] ?? 20000);
  const seed = Number(process.argv[3] ?? 469);
  const t0 = performance.now();
  const res = runFuzz(mods, count, seed, { frontEnd, rt });
  console.log(`generated ${count}, unique ${res.unique}, seed ${seed}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(res.tally, null, 2));
  console.log("conservative refusals by class:");
  for (const [k, v] of Object.entries(res.conservative).sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);
  console.log("scrml-content (first 25):");
  for (const c of res.content.slice(0, 25)) console.log("  " + JSON.stringify(c));
  for (const d of res.disagreements.slice(0, 20)) console.log("DISAGREE", d.verdict, JSON.stringify(d.tpl), JSON.stringify(d.acorn), JSON.stringify(d.lex), d.codes);
}
