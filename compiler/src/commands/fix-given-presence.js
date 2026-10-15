/**
 * @module commands/fix-given-presence
 * The `scrml fix` rule `given-presence` — §42.2.3 / §63 (S462): the soft-deprecated in-place
 * presence guard → the S460 a′ presence test. Ruling: user-voice-scrml.md S462 "a, go".
 * Lint it clears: W-GIVEN-PRESENCE-DEPRECATED (reserved E-GIVEN-PRESENCE-DEPRECATED).
 * change-id: s462-given-presence-deprecate.
 *
 * ═══ THE REWRITE ═══
 *
 *   - A guard: `given x :> { … }` → `if (x is given) { … }`; several names
 *     `given x, y :> { … }` → `if (x is given && y is given) { … }` (§42.4 statement 7: a
 *     compound spells presence explicitly). Names keep their spelling (`@user` stays `@user`).
 *     The legacy `=>` separator goes with the head. The body, from its `{`, is untouched.
 *   - A match arm: `given x :> body` → `else :> body`, when the arm is the LAST arm, the
 *     match has a `not` arm, no other `else` / `_` arm, and the arm names the scrutinee itself
 *     (`match x { not :> …  given x :> … }`). The separator and body are left as written.
 *   - The rebind head `given c = @h :> { … }` (§66.7.5) is NOT in the window and never touched.
 *
 * The test written is the explicit `x is given` (§42.2.4), not the bare `if (x)` (§42.4): both
 * are canonical, but impl#1 still lowers a bare condition to JavaScript truthiness
 * (g-impl1-condition-rule-s460), so on impl#1 only `is given` runs identically to the guard
 * (an empty string or a 0 is present, §42.1.1).
 *
 * ═══ HOW IT LOCATES SITES (structurally, never by regex over source text) ═══
 *
 * impl#1's own front end (splitBlocks + buildAST) parses the file. Every `given-guard` node
 * carries its `span.start` (the `given` keyword), its names as written (`spellings`) and the
 * `rebind` flag (ast-builder.js). A node that is a direct child of a `match-stmt` / `match-expr`
 * body is an arm. Each located head is confirmed against the source: `given`, the names exactly
 * as recorded separated by commas and whitespace, the separator the node recorded, and (for a
 * guard) the `{` that opens its block. Anything else — a comment inside the head, a missing
 * brace, or a head impl#1 refuses as not an identifier-list (E-SYNTAX-044: a property path,
 * `given id < 0 :> fail …`, no separator; the node's `malformedHead`) — is a blocker: left as
 * written and reported. A refused head has no mechanical rewrite: its author meant a condition
 * (`if (<cond>) { … }`), and which one is theirs to say.
 *
 * A completeness net reports any `given <name>` head (outside comments) the tree did not
 * locate — inside a component body or an attribute value, say — rather than leaving it silently.
 *
 * ═══ HOW IT VERIFIES (per file) ═══
 *
 *   1. Structural: impl#1 re-reads the rewritten file; exactly the rewritten heads are gone.
 *   2. (opts.verify, default on) impl#1 compiles the file before and after, at the same path
 *      with its project beside it. The diagnostic codes must be identical aside from the
 *      W-GIVEN-PRESENCE-DEPRECATED instances cleared, and every emitted artifact (source maps
 *      aside) identical once a parenthesised presence check `(x !== null && x !== undefined)`
 *      standing as an `if` test or an `&&` operand is read without its parentheses — the only
 *      difference between the guard's lowering and `x is given`'s (and, for an artifact with no
 *      template literal, each line's leading indentation — `normalizeForCompare`).
 *      A markup guard is the one rewrite that is MEANT to emit differently: its `${ if … }`
 *      takes the arm-selector lift group since #1397 (g-impl1-markup-if-branch-memo-stale-render-s462,
 *      resolved). For a subset holding markup guards, each changed group is cut from both sides
 *      and checked to be exactly that change (same presence test, one arm) and the rest compared
 *      as above — see "The markup-guard compare" below. The diagnostic codes must match all the same.
 *      Only a markup guard whose body is MARKUP OF PURE READS is rewritten (markupBodyIsPure,
 *      decided from the tree; html-fragment text is parsed, never accepted wholesale). The guard's
 *      plain group re-runs its whole body on every read change; the arm selector re-runs a binding
 *      only on its own reads — so anything with an effect would run a different number of times:
 *        · a statement (a declaration, an assignment, an `if`, a nested guard) is refused —
 *          "guard body has statements whose re-run frequency differs …";
 *        · a call anywhere at render time (an interpolation `${f(@n)}`, a non-handler attribute
 *          value `title="${f(@n)}"` / `data-x=f(@n)`), a template literal with interpolations, and
 *          a component use (its definition may interpolate a call) are refused — "guard body
 *          evaluates a call or a component at render time …". An interpolation must be cell /
 *          field / index reads, literals and operators. Handler attributes (`onclick=…`) are not
 *          checked: a handler does not run at render time. "Handler" is the compiler's own reading,
 *          isExecutableEventHandlerAttrName (attr-injection-sink.ts): `one=` / `online=` /
 *          `onboarding=` are plain attributes and ARE checked.
 *      A rewrite whose own compile reports an error (incl. the emitted-JS parse gate) is refused.
 *      ACCEPTED DIFFERENCES of a rewritten markup guard — the rewrite follows §7.4.2 ("the
 *      interpolation site SHALL re-render whenever any referenced cell changes") as #1397
 *      implements it, updating each markup binding in place where the guard re-creates its body:
 *        · an input inside the guard keeps its text and focus when another read in the body
 *          changes (the guard re-created the input, losing both);
 *        · after a read in the body throws, the rewrite renders again on the next write (the
 *          guard's group went blank for good — a runtime effect that throws loses its
 *          subscriptions).
 *      Executed in compiler/tests/browser/browser-fix-given-presence-markup-s462.browser.test.js.
 *   3. A file whose original compile reports an error-severity diagnostic is refused ("file does
 *      not compile; cannot verify", fix-verify-shared.js): impl#1 emits no artifacts for it, so
 *      the compare would pass for any rewrite. This is checked FIRST: a site in such a file gets
 *      this reason even when its body would also be refused.
 *   When the whole file does not verify, each site is verified alone and the sites that verify
 *   alone are re-verified together; a site that does not is left as written with the reason.
 *   That is how a site impl#1 compiles differently today is refused: the rewrite would change
 *   what runs (a `given` arm, lowered as `else if (<presence>)` where `else :>` is `else` — a follow-up;
 *   a markup guard whose group is not the recognised shape; a site whose diagnostic codes change).
 *
 * Idempotent: the output has no `given` head at a rewritten site, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { captureTrailingContentWarnings, parseExprToNode } from "../expression-parser.ts";
import { isUserComponentMarkup } from "../component-expander.ts";
import { isExecutableEventHandlerAttrName } from "../attr-injection-sink.ts";
import { compileScrml } from "../api.js";
import { LIFT_BRANCH_RUN_BANNER, LIFT_BRANCH_RUN_HELPER } from "../codegen/emit-reactive-wiring.ts";
import { errorSeverityCodes, scratchRefusalReason, writeScratchProject } from "./fix-verify-shared.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";

export const GIVEN_PRESENCE_RULE = "given-presence";
const LINT = "W-GIVEN-PRESENCE-DEPRECATED";

const IDENT_RE = /^@?[A-Za-z_$][A-Za-z0-9_$]*$/;

// ---------------------------------------------------------------------------
// impl#1's reading of a file
// ---------------------------------------------------------------------------

/**
 * impl#1's front-end reading: the AST (or null) and the E- codes its BLOCK SPLITTER raised — the
 * errors after which a region of the file may have been read as text or dropped.
 */
function frontEnd(filePath, source) {
  try {
    return captureTrailingContentWarnings(() => {
      const bs = splitBlocks(filePath, source);
      const built = buildAST(bs);
      const codes = (bs.errors ?? [])
        .map((e) => e?.code).filter((c) => typeof c === "string" && c.startsWith("E-"));
      return { ast: built?.ast ?? null, codes: [...new Set(codes)].sort() };
    }).result;
  } catch {
    return { ast: null, codes: ["(front end threw)"] };
  }
}

/** Visit every object node of the AST once. */
function walk(root, fn) {
  const seen = new WeakSet();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    if (!Array.isArray(n)) fn(n);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
}

/**
 * Every `given-guard` node of the tree, deduplicated by `span.start`, each with the match it
 * is an arm of (or null). Rebind heads are included (flagged) so callers can skip them.
 */
function givenSites(ast) {
  const armOf = new Map(); // node -> match node
  walk(ast, (n) => {
    if ((n.kind === "match-stmt" || n.kind === "match-expr") && Array.isArray(n.body)) {
      for (const c of n.body) if (c && typeof c === "object" && c.kind === "given-guard") armOf.set(c, n);
    }
  });
  const byStart = new Map();
  walk(ast, (n) => {
    if (n.kind !== "given-guard" || typeof n.span?.start !== "number") return;
    const prev = byStart.get(n.span.start);
    // The same guard reached twice: prefer the reading that knows it is an arm.
    if (!prev || (!prev.match && armOf.has(n))) byStart.set(n.span.start, { node: n, match: armOf.get(n) ?? null });
  });
  return [...byStart.values()].sort((a, b) => a.node.span.start - b.node.span.start);
}

/** Non-rebind `given-guard` heads at these offsets (for the structural self-check). */
function presenceStarts(ast) {
  const out = new Set();
  if (!ast) return out;
  for (const s of givenSites(ast)) if (s.node.rebind !== true) out.add(s.node.span.start);
  return out;
}

// ---------------------------------------------------------------------------
// Source confirmation
// ---------------------------------------------------------------------------

function lineOf(source, off) {
  let n = 1;
  for (let i = 0; i < off && i < source.length; i++) if (source.charCodeAt(i) === 10) n++;
  return n;
}
function lineStartOf(source, off) {
  const i = source.lastIndexOf("\n", off - 1);
  return i === -1 ? 0 : i + 1;
}
function skipWs(source, i) {
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
}
const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);
/** Does a `//` or `/* … *\/` comment start at `i`? */
const startsComment = (source, i) => source[i] === "/" && (source[i + 1] === "/" || source[i + 1] === "*");
/**
 * Skip whitespace AND comments — the source-side twin of the parser's `skipGivenComments`
 * (ast-builder.js; S462 review N2 / delta-review D1): a comment between `:>` and the `{` of the
 * block is whitespace. An unterminated block comment stops the skip (fail closed).
 */
function skipWsAndComments(source, i) {
  for (;;) {
    i = skipWs(source, i);
    if (source[i] === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return source.length;
      i = nl + 1;
    } else if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return i;
      i = end + 2;
    } else {
      return i;
    }
  }
}
const COMMENT_IN_HEAD = "a comment inside the `given` head — the rewrite replaces the head and would delete it; left for a human";

/**
 * Confirm a `given` head against the source. Returns
 * `{ ok: true, names, sepStart, sepEnd, sep, braceAt }` or `{ ok: false, reason }`.
 * Only whitespace may separate the head's parts; a comment there, a property path or any other
 * token is a reason to leave the site alone. Between the separator and the `{` a comment is whitespace.
 */
function readHead(source, node) {
  const start = node.span.start;
  if (source.slice(start, start + 5) !== "given" || isWordChar(source[start - 1]) || isWordChar(source[start + 5])) {
    return { ok: false, reason: "the recorded `given` position does not hold `given` in the source (a re-based span) — left for a human" };
  }
  const recorded = Array.isArray(node.spellings) ? node.spellings : null;
  if (!recorded || recorded.length === 0 || !recorded.every((s) => typeof s === "string" && IDENT_RE.test(s))) {
    return { ok: false, reason: "the guard's names are not a plain identifier list — left for a human" };
  }
  let i = start + 5;
  const names = [];
  for (let k = 0; k < recorded.length; k++) {
    const at = skipWs(source, i);
    if (startsComment(source, at)) return { ok: false, reason: COMMENT_IN_HEAD };
    if (k > 0) {
      if (source[at] !== ",") return { ok: false, reason: "the guard's head is not a comma-separated identifier list in the source — left for a human" };
      i = skipWs(source, at + 1);
      if (startsComment(source, i)) return { ok: false, reason: COMMENT_IN_HEAD };
    } else {
      if (at === i) return { ok: false, reason: "no whitespace after `given` — left for a human" };
      i = at;
    }
    const name = recorded[k];
    if (source.slice(i, i + name.length) !== name || isWordChar(source[i + name.length])) {
      return { ok: false, reason: `the guard's name \`${name}\` is not where impl#1 recorded it — left for a human` };
    }
    names.push(name);
    i += name.length;
  }
  const sepStart = skipWs(source, i);
  if (startsComment(source, sepStart)) return { ok: false, reason: COMMENT_IN_HEAD };
  const sep = source.slice(sepStart, sepStart + 2);
  if (source[sepStart] === ".") {
    return { ok: false, reason: "a property path in a `given` head (E-SYNTAX-044) — there is nothing to rewrite to; left as written" };
  }
  if (sep !== ":>" && sep !== "=>") {
    return { ok: false, reason: "the `given` head is not a list of names followed by `:>` or `=>` (E-SYNTAX-044) — a condition is written `if (<cond>) { … }`; left for a human" };
  }
  if (typeof node.separatorGlyph === "string" && node.separatorGlyph !== sep) {
    return { ok: false, reason: "the separator in the source is not the one impl#1 recorded — left for a human" };
  }
  // A comment between the separator and the block is whitespace (it stays: only the head up to
  // the separator is replaced).
  const braceAt = skipWsAndComments(source, sepStart + 2);
  return { ok: true, names, sepStart, sepEnd: sepStart + 2, sep, braceAt };
}

/** The test the scrutinee header names, whitespace removed (`@ x` and `@x` read alike). */
function compactHeader(match) {
  return typeof match.header === "string" ? match.header.replace(/\s+/g, "") : "";
}

/** Is this match body arm the `not` arm / an `else` or `_` arm? */
function armKind(arm) {
  if (!arm || typeof arm !== "object") return "other";
  if (arm.kind === "given-guard") return "given";
  if (arm.kind === "match-arm-block") {
    if (arm.isNotArm) return "not";
    if (arm.isWildcard) return "else";
    return "pattern";
  }
  if (arm.kind === "match-arm-inline") {
    const t = String(arm.test ?? "").trim();
    if (t === "not") return "not";
    if (t === "else" || t === "_") return "else";
    return "pattern";
  }
  return "other";
}

/** Plan one site's edit, or return a blocker reason. */
function planSite(source, site, filePath) {
  const { node, match } = site;
  if (node.malformedHead === true) {
    // impl#1 refuses the head (E-SYNTAX-044); the reason names what is wrong where it can.
    const head = readHead(source, node);
    return { reason: head.ok ? "the `given` head is refused by impl#1 (E-SYNTAX-044) — left for a human" : head.reason };
  }
  const head = readHead(source, node);
  if (!head.ok) return { reason: head.reason };
  if (match) {
    if (head.names.length !== 1) return { reason: "a `given` arm with several names — left for a human" };
    const arms = (match.body ?? []).filter((a) => a && typeof a === "object" && typeof a.kind === "string");
    const kinds = arms.map(armKind);
    // impl#1 reads a brace-less arm body (`given x :> expr`) as a guard with an EMPTY body
    // followed by the expression as a sibling node in the match body, so the arm is "last" when
    // no ARM follows it — the siblings after it are its own body.
    const at = arms.indexOf(node);
    if (at < 0 || kinds.slice(at + 1).some((k) => k !== "other")) {
      return { reason: "the `given` arm is not the match's last arm, so `else :>` would not take its place — left for a human" };
    }
    if (!kinds.includes("not")) {
      return { reason: "the match has no `not :>` arm, so `else :>` would cover the absent case the `given` arm does not (E-MATCH-012 today) — left for a human" };
    }
    if (kinds.includes("else") || kinds.filter((k) => k === "given").length > 1) {
      return { reason: "the match already has an `else` / `_` arm or a second `given` arm — left for a human" };
    }
    const name = head.names[0];
    if (compactHeader(match) !== name) {
      return { reason: `the \`given ${name}\` arm does not name the match's scrutinee (\`${match.header ?? ""}\`); \`else :>\` would drop the name the arm body reads — left for a human` };
    }
    // `given x` → `else`; the whitespace before the separator, the separator and the body stay.
    const nameEnd = source.indexOf(name, node.span.start + 5) + name.length;
    return {
      edit: { start: node.span.start, end: nameEnd, text: "else", line: lineOf(source, node.span.start), detail: `\`given ${name}\` arm → \`else\`` },
    };
  }
  if (source[head.braceAt] === "{" && skipWs(source, head.sepEnd) !== head.braceAt) {
    // S462 delta review D1: the comment is fine in the guard (the parser skips it), but impl#1
    // reads `if (…) // c⏎{ … }` as an `if` whose body is a nested block (an extra `{ … }`, and
    // the declarations in it lose their typing) — the verify compile sees different codes.
    // Moving the comment is the author's call.
    return { reason: "a comment between `:>` and the guard's block — impl#1 reads `if (…) /* c */ { … }` as a nested block, so the rewrite would not compile the same; move the comment inside the block (or above the guard) and run `scrml fix` again" };
  }
  if (source[head.braceAt] !== "{") {
    return { reason: "the guard's body is not a `{ … }` block (E-SYNTAX-044: a guard body is a block; braces decide what the guard covers) — left for a human" };
  }
  if (isMarkupGuard(site)) {
    const why = markupBodyRefusal(site.node.body, filePath);
    if (why) return { reason: `${why} — left as written`, needsCompileCheck: true };
  }
  const cond = head.names.map((n) => `${n} is given`).join(" && ");
  return {
    edit: { start: node.span.start, end: head.sepEnd, text: `if (${cond})`, line: lineOf(source, node.span.start), detail: `\`given ${head.names.join(", ")} ${head.sep}\` → \`if (${cond})\`` },
  };
}

// ---------------------------------------------------------------------------
// Completeness net
// ---------------------------------------------------------------------------

/** Blank out `// …` line comments (at a line start or after whitespace) and `/* … *\/` blocks. */
function maskComments(source) {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/(^|[ \t])\/\/[^\n]*/gm, (m, lead) => lead + " ".repeat(m.length - lead.length));
  return out;
}

/**
 * Blank out the CONTENTS of string literals — `"…"`, `'…'`, `` `…` `` — on one line (S462 fix round 1,
 * F5): a guard-shaped string (`const s = "given x :> y"`) is not a guard, and a net hit inside one
 * would be a blocker no rewrite can clear (`scrml fix --check` would exit 2 forever). The net only
 * REPORTS, so a string the masking misjudges (an apostrophe in markup text) can only hide a hit on
 * that line, never invent one.
 */
function maskStrings(source) {
  return source.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, " ") + m[m.length - 1]);
}

/** Offsets of `given <name>` heads followed by `,`, `:>` or `=>` (comments and strings masked). Reporting only. */
function netSites(source) {
  const masked = maskStrings(maskComments(source));
  const out = [];
  const re = /(?<![A-Za-z0-9_$.@-])given\s+@?[A-Za-z_$][A-Za-z0-9_$]*\s*(?:,|:>|=>)/g;
  for (let m; (m = re.exec(masked)); ) out.push(m.index);
  return out;
}

// ---------------------------------------------------------------------------
// Verify-by-compile
// ---------------------------------------------------------------------------

/**
 * The guard lowers to `if (x !== null && x !== undefined && …)`; `x is given` lowers to the same
 * check in parentheses. `x` is a JS name, or a cell read `_scrml_cs_reactive_get("name")` (a
 * `given @cell` guard since #1380). Read a parenthesised check without its parentheses where it stands as a
 * whole `if (…)` test or as an `&&` operand — the only places the rewrite puts one, and places
 * where the parentheses carry no meaning (`&&` is associative). Applied to BOTH sides.
 */
export function normalizePresenceParens(js) {
  return js.replace(
    /(?<=\(|&& )\(([A-Za-z_$][A-Za-z0-9_$]*(?:\("[^"\\\n]*"\))?) !== null && \1 !== undefined\)(?=\)| &&)/g,
    "$1 !== null && $1 !== undefined",
  );
}

/**
 * The comparison form of an emitted artifact: the presence-check parentheses read alike, and —
 * only when the artifact holds no template literal (no backtick anywhere) — each line's leading
 * indentation dropped. The guard's body and an `if` body are emitted at different depths (a
 * markup body lifted inside a `given` is nested one level deeper); indentation carries no meaning
 * in JavaScript except inside a multi-line template literal, which is why an artifact with a
 * backtick is compared with its indentation intact (fail closed).
 */
export function normalizeForCompare(js) {
  const t = normalizePresenceParens(js);
  return t.includes("`") ? t : t.replace(/^[ \t]+/gm, "");
}

// ---------------------------------------------------------------------------
// The markup-guard compare (S462 s462-fix-rule-followups)
// ---------------------------------------------------------------------------
//
// A markup guard `${ given @u :> { <p>${@u.name}</p> } }` and its rewrite `${ if (@u is given)
// { … } }` do NOT emit the same client JS, and are not meant to: since #1397
// (g-impl1-markup-if-branch-memo-stale-render-s462, resolved) a lift group that is exactly one
// `if` takes the arm-selector shape (`_scrml_lift_if_group`, emit-reactive-wiring.ts
// emitLiftIfChainGroup), while the guard keeps the plain one-effect group. Both re-render a read
// that changes while the presence test stays true (§7.4.2) — executed in
// compiler/tests/browser/browser-fix-given-presence-markup-s462.browser.test.js.
//
// So for a subset holding markup guards the client JS is compared with each CHANGED group cut
// out of both sides, and each cut pair is checked to be what the rewrite must produce:
//   - before: the plain group anchored at `[data-scrml-logic="X"]`
//       `const T = _scrml_g.document.querySelector('[data-scrml-logic="X"]');⏎_scrml_effect(function() {`
//       … through the first column-0 `});`, whose first `if (C) {` is the guard's presence test;
//   - after: the selector group anchored at the same X
//       `_scrml_lift_if_group(_scrml_g.document.querySelector('[data-scrml-logic="X"]'), function A() { return (C') ? 0 : -1; }, …`
//       … through the first `}, _scrml_effect, _scrml_effect_static);`, with ONE arm, and C' the
//       same presence test as C (the same names, each `!== null && … !== undefined`);
//   - the number of cut pairs is at most the number of markup guards rewritten (a guard that
//     shares its `${ }` with other statements keeps the plain group and is compared as text);
//   - the file-local arm-run appendix (LIFT_BRANCH_RUN_BANNER + LIFT_BRANCH_RUN_HELPER, exactly)
//     is cut from the after side when the before side has none;
//   - what remains is identical once compiler-generated counter names (`_scrml_<kind>_<n>`) are
//     renumbered in order of first appearance (the rewrite shifts the shared counter) and read
//     through normalizeForCompare. Every other artifact must be identical as it stands.
// Any shape this does not recognise (a mount-deferred host, a hoisted keyed setup, …) fails the
// compare, so the site is left as written with the reason (fail closed).

const BEFORE_GROUP_RE = /^const ([A-Za-z_$][\w$]*) = _scrml_g\.document\.querySelector\('\[data-scrml-logic="([\w$-]+)"\]'\);\n_scrml_effect\(function\(\) \{\n/gm;
const AFTER_GROUP_RE = /^_scrml_lift_if_group\(_scrml_g\.document\.querySelector\('\[data-scrml-logic="([\w$-]+)"\]'\), function [A-Za-z_$][\w$]*\(\) \{ return \((.*)\) \? 0 : -1; \}, function\([^)\n]*\) \{\n/gm;
const AFTER_GROUP_END = "\n}, _scrml_effect, _scrml_effect_static);";
const PRESENCE_TERM = String.raw`([A-Za-z_$][\w$]*(?:\("[^"\\\n]*"\))?)!==null&&\1!==undefined`;

/**
 * A presence test read without parentheses or whitespace — `a` / `_scrml_cs_reactive_get("a")`
 * each `!== null && … !== undefined`, joined by `&&` — as the list of names it tests, or null when
 * the condition is anything else. (`&&` is associative, so the parentheses carry no meaning in a
 * condition made only of these terms.)
 */
function presenceNames(cond) {
  // Keep the parentheses of a cell read; drop every other one.
  const flat = cond.replace(/\s+/g, "").replace(/_scrml_cs_reactive_get\("([^"\\\n]*)"\)/g, "\u0000$1\u0001")
    .replace(/[()]/g, "").replace(/\u0000([^\u0001]*)\u0001/g, '_scrml_cs_reactive_get("$1")');
  const names = [];
  const term = new RegExp(`^${PRESENCE_TERM}(?:&&|$)`);
  let rest = flat;
  while (rest.length) {
    const m = term.exec(rest);
    if (!m) return null;
    names.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return names.length ? names : null;
}

/** Cut the plain group anchored at each logic id from `js`; returns { rest, groups: Map<id, cond> } or a reason. */
function cutBeforeGroups(js, ids) {
  const groups = new Map();
  let rest = js;
  for (const id of ids) {
    BEFORE_GROUP_RE.lastIndex = 0;
    let m;
    let found = null;
    while ((m = BEFORE_GROUP_RE.exec(rest))) if (m[2] === id) { found = m; break; }
    if (!found) return { why: `no plain lift group for ${id} before the rewrite` };
    const bodyStart = found.index + found[0].length;
    const end = rest.indexOf("\n});", bodyStart);
    if (end === -1) return { why: `unterminated lift group for ${id} before the rewrite` };
    const ifm = /^\s*if \((.*)\) \{$/m.exec(rest.slice(bodyStart, end));
    if (!ifm) return { why: `the lift group for ${id} has no presence test before the rewrite` };
    groups.set(id, ifm[1]);
    rest = rest.slice(0, found.index) + `/*cut:${id}*/` + rest.slice(end + "\n});".length);
  }
  return { rest, groups };
}

/** Rename every compiler-generated counter name (`_scrml_<kind>_<n>`) by order of first appearance. */
function renumberGenerated(js) {
  const seen = new Map();
  return js.replace(/\b_scrml_([A-Za-z_]*?[A-Za-z])_(\d+)\b/g, (m, kind) => {
    if (!seen.has(m)) seen.set(m, `_scrml_${kind}_#${seen.size}`);
    return seen.get(m);
  });
}

/** Compare one client JS pair for a subset with `markupSites` markup guards. Returns null or a reason. */
export function compareMarkupClientJs(before, after, markupSites) {
  // The selector groups after the rewrite that are new (no selector group at that id before).
  const beforeSelectors = new Set([...before.matchAll(AFTER_GROUP_RE)].map((m) => m[1]));
  const changed = [];
  let afterRest = after;
  for (;;) {
    AFTER_GROUP_RE.lastIndex = 0;
    let m;
    let found = null;
    while ((m = AFTER_GROUP_RE.exec(afterRest))) if (!beforeSelectors.has(m[1])) { found = m; break; }
    if (!found) break;
    const bodyStart = found.index + found[0].length;
    const end = afterRest.indexOf(AFTER_GROUP_END, bodyStart);
    if (end === -1) return `unterminated selector group for ${found[1]} after the rewrite`;
    const body = afterRest.slice(bodyStart, end);
    if (!/^\s*if \(_scrml_arm === 0\) \{$/m.test(body) || /_scrml_arm === [1-9]/.test(body)) {
      return `the selector group for ${found[1]} after the rewrite is not a single presence arm`;
    }
    changed.push({ id: found[1], cond: found[2] });
    afterRest = afterRest.slice(0, found.index) + `/*cut:${found[1]}*/` + afterRest.slice(end + AFTER_GROUP_END.length);
  }
  // At most one group per rewritten guard. Fewer is fine: guards that share a `${ }` with other
  // statements keep the plain group (it is not exactly one `if`), and are compared as text below.
  if (changed.length > markupSites) return `${changed.length} lift group(s) changed shape for ${markupSites} markup guard(s) rewritten`;
  const cut = cutBeforeGroups(before, changed.map((c) => c.id));
  if (cut.why) return cut.why;
  for (const c of changed) {
    const was = presenceNames(cut.groups.get(c.id));
    const now = presenceNames(c.cond);
    if (!was || !now || was.join(",") !== now.join(",")) return `the group for ${c.id} tests a different condition after the rewrite`;
  }
  // The arm-run appendix: emitted once per file that has a selector group.
  const appendix = `\n\n${LIFT_BRANCH_RUN_BANNER}\n${LIFT_BRANCH_RUN_HELPER.join("\n")}`;
  if (!before.includes(LIFT_BRANCH_RUN_BANNER)) {
    if (!afterRest.includes(appendix)) return "the arm-run appendix after the rewrite is not the one impl#1 emits";
    afterRest = afterRest.replace(appendix, "");
  }
  const a = normalizeForCompare(renumberGenerated(cut.rest));
  const b = normalizeForCompare(renumberGenerated(afterRest));
  return a === b ? null : "the code around the rewritten markup guard changed";
}

/** Compare raw artifacts for a subset that holds markup guards. Returns null or a reason. */
function compareWithMarkupGroups(rawA, rawB, markupSites) {
  if (rawA.length !== rawB.length) return "a different set of artifacts";
  for (let i = 0; i < rawA.length; i++) {
    const [pa, fa] = rawA[i];
    const [pb, fb] = rawB[i];
    if (pa !== pb) return "a different set of artifacts";
    const keys = Object.keys(fa);
    if (keys.join(",") !== Object.keys(fb).join(",")) return `different artifact fields for ${pa}`;
    let clientSeen = false;
    for (const k of keys) {
      if (k === "clientJs" && fa[k] !== fb[k]) {
        if (clientSeen) return "two client artifacts changed";
        clientSeen = true;
        const why = compareMarkupClientJs(fa[k], fb[k], markupSites);
        if (why) return why;
      } else if (normalizeForCompare(fa[k]) !== normalizeForCompare(fb[k])) {
        return `${k} changed`;
      }
    }
  }
  return null;
}

/** Is this site a guard (not an arm) whose body renders markup? */
function isMarkupGuard(site) {
  if (site.match) return false;
  return (site.node.body ?? []).some((b) => b && typeof b === "object" && /markup|lift|html-fragment/.test(String(b.kind ?? "")));
}

export const MARKUP_BODY_STATEMENTS =
  "guard body has statements whose re-run frequency differs between the plain group and the arm selector";

/** Unary operators that only read. (`++` / `--` write; `delete` writes; `await` suspends.) */
const PURE_UNARY = new Set(["!", "-", "+", "~", "typeof", "void"]);

/**
 * Is this expression a PURE READ — cell / field / index reads, literals and operators, with NO call
 * of any kind (a call may have a side effect the scan cannot see: `${track(@n)}`, S462 delta review
 * repro t1)? Fail closed: any node kind not listed is not a pure read, and so is a template literal
 * with interpolations (impl#1 keeps it as raw text, so its parts are not visible here).
 */
export function isPureReadExpr(expr) {
  if (!expr || typeof expr !== "object") return false;
  const seen = new WeakSet();
  const stack = [expr];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) stack.push(x); continue; }
    switch (n.kind) {
      case "ident":
      case "member":
      case "index":
      case "binary":
      case "ternary":
      case "array":
      case "object":
      case "prop":
        break;
      case "lit":
        if (n.litType === "template" && n.hasInterpolation !== false) return false;
        break;
      case "unary":
        if (!PURE_UNARY.has(n.op)) return false;
        break;
      default:
        return false;
    }
    for (const k of Object.keys(n)) if (k !== "span" && n[k] && typeof n[k] === "object") stack.push(n[k]);
  }
  return true;
}

/** Parse an interpolation's text with impl#1's expression parser and test it; unparseable → false. */
function isPureReadText(raw, filePath) {
  try {
    const node = parseExprToNode(raw.trim(), filePath, 0);
    return isPureReadExpr(node);
  } catch {
    return false;
  }
}

/** The index just past the `}` that closes the `{` at `open` (string / template aware), or -1. */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\"" || c === "'" || c === "`") {
      const q = c;
      for (i++; i < text.length && text[i] !== q; i++) if (text[i] === "\\") i++;
      if (i >= text.length) return -1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

// The COMPILER's own reading of "an event-handler attribute" (attr-injection-sink.ts) — one reader,
// not a local regex (S462 delta review #3, repros h1/h3: `one=` / `online=` are NOT handlers; they
// are plain attributes rendered at render time, NON_EVENT_ON_WORDS).
const isHandlerAttr = (name) => isExecutableEventHandlerAttrName(name);

/**
 * Check the raw text of an html-fragment (impl#1 keeps the tags of a guard body as text). Returns
 * true only when every interpolation in it is a pure read, every non-handler attribute value is a
 * plain value or a pure read, and no tag is a component use. The text is PARSED here — never
 * accepted wholesale (S462 delta review repro t6: `title="${track(@n)}"`).
 */
function fragmentIsPure(text, filePath, holes = []) {
  // An interpolation's text, or a HOLE: `${\u0000N}` stands for the body's Nth `logic` node (impl#1
  // splits `${…}` out of a fragment into its own node, even mid-tag: `onclick=${f()}`).
  const interp = (raw, handler) => {
    const hole = /^\u0000(\d+)$/.exec(raw);
    if (hole) {
      const node = holes[Number(hole[1])];
      if (!node) return false;
      return handler || ((node.body ?? []).length > 0 && (node.body ?? []).every((x) => x?.kind === "bare-expr" && isPureReadExpr(x.exprNode)));
    }
    return handler || isPureReadText(raw, filePath);
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const dollar = text.indexOf("${", i);
    // An interpolation in text content (outside a tag).
    if (dollar !== -1 && (lt === -1 || dollar < lt)) {
      const end = matchBrace(text, dollar + 1);
      if (end === -1 || !interp(text.slice(dollar + 2, end - 1), false)) return false;
      i = end;
      continue;
    }
    if (lt === -1) return true;
    let j = lt + 1;
    while (j < n && /\s/.test(text[j])) j++;
    if (text[j] === "/") { // a closing tag
      const gt = text.indexOf(">", j);
      if (gt === -1) return false;
      i = gt + 1;
      continue;
    }
    if (text[j] === "!") { // a comment / doctype
      const gt = text.indexOf(">", j);
      if (gt === -1) return false;
      i = gt + 1;
      continue;
    }
    const tm = /^[A-Za-z][\w:.-]*/.exec(text.slice(j));
    if (!tm) { i = lt + 1; continue; } // a bare `<` in text
    if (/^[A-Z]/.test(tm[0])) return false; // a component use (S462 delta review repro t2)
    j += tm[0].length;
    // Attributes, up to `>` / `/>`.
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (j >= n) return false;
      if (text[j] === ">") { j++; break; }
      // A self-closing end — `/>`, or `/ >` as impl#1 re-spaces fragment text (`<input value=@m/>`).
      if (text[j] === "/") {
        let k = j + 1;
        while (k < n && /\s/.test(text[k])) k++;
        if (text[k] === ">") { j = k + 1; break; }
        return false;
      }
      const am = /^[^\s=>\/]+/.exec(text.slice(j));
      if (!am) return false;
      const name = am[0];
      j += name.length;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== "=") continue; // a boolean attribute
      j++;
      while (j < n && /\s/.test(text[j])) j++;
      const handler = isHandlerAttr(name);
      const c = text[j];
      if (c === "\"" || c === "'") {
        // A quoted value: each `${…}` in it must be a pure read (a handler's value never runs at render).
        let k = j + 1;
        for (;;) {
          if (k >= n) return false;
          if (text[k] === c) { k++; break; }
          if (text[k] === "$" && text[k + 1] === "{") {
            const end = matchBrace(text, k + 1);
            if (end === -1) return false;
            if (!interp(text.slice(k + 2, end - 1), handler)) return false;
            k = end;
            continue;
          }
          k++;
        }
        j = k;
      } else if (c === "$" && text[j + 1] === "{") {
        const end = matchBrace(text, j + 1);
        if (end === -1) return false;
        if (!interp(text.slice(j + 2, end - 1), handler)) return false;
        j = end;
      } else if (c === "{") {
        const end = matchBrace(text, j);
        if (end === -1 || !handler) return false; // a `{ … }` block value outside a handler — refuse
        j = end;
      } else {
        // An unquoted value: read to whitespace / `>` / `/>`, parentheses balanced.
        let k = j;
        let depth = 0;
        while (k < n) {
          const d = text[k];
          if (d === "(") depth++;
          else if (d === ")") depth--;
          else if (depth === 0 && (/\s/.test(d) || d === ">" || (d === "/" && /^\/\s*>/.test(text.slice(k, k + 8))))) break;
          k++;
        }
        if (depth !== 0) return false;
        const value = text.slice(j, k);
        if (!handler && !isPureReadText(value, filePath)) return false;
        j = k;
      }
    }
    i = j;
  }
  return true;
}

/** A top-level bare-expr that is literal TEXT between interpolations (`+`, `-`, `·`): impl#1 could not
 * parse it as code (an escape-hatch ParseError) and it holds no identifier, call or bracket. */
function isPunctuationText(node) {
  const e = node?.exprNode;
  if (!e || e.kind !== "escape-hatch" || e.nativeKind !== "ParseError") return false;
  const raw = String(e.raw ?? node.expr ?? "");
  return raw.trim().length > 0 && !/[\p{L}\p{N}_$@(){}\[\]`'"]/u.test(raw);
}

/** A markup element (from a `lift`): no component use; attributes and children pure. */
function markupNodeIsPure(m, filePath) {
  if (!m || typeof m !== "object") return false;
  if (isUserComponentMarkup(m) || /^[A-Z]/.test(String(m.tag ?? ""))) return false;
  for (const a of m.attrs ?? []) {
    if (isHandlerAttr(a?.name)) continue;
    const v = a?.value;
    if (!v) continue; // a boolean attribute
    if (v.kind === "string-literal") {
      const s = String(v.value ?? "");
      if (s.includes("${") && !fragmentIsPure(s, filePath)) return false;
      continue;
    }
    if (v.kind === "variable-ref" && v.exprNode && isPureReadExpr(v.exprNode)) continue;
    if (v.exprNode && isPureReadExpr(v.exprNode)) continue;
    return false; // a call-ref, or anything not shown to be a pure read
  }
  return (m.children ?? []).every((c) => bodyNodeIsPure(c, filePath));
}

/** One node of a markup guard's body (or a markup element's child). */
function bodyNodeIsPure(n, filePath) {
  if (!n || typeof n !== "object") return true;
  switch (n.kind) {
    case "text":
    case "comment":
      return true;
    case "string-literal":
      return !String(n.value ?? "").includes("${");
    case "html-fragment":
      return fragmentIsPure(String(n.content ?? ""), filePath);
    case "markup":
      return markupNodeIsPure(n.node ?? n, filePath);
    case "lift-expr":
      return n.expr?.kind === "markup" && markupNodeIsPure(n.expr.node ?? n.expr, filePath);
    case "logic":
      return (n.body ?? []).length > 0 && (n.body ?? []).every((s) => s?.kind === "bare-expr" && isPureReadExpr(s.exprNode));
    case "bare-expr":
      // Literal text between interpolations (`${a}+${b}`) reaches the tree as a top-level bare-expr.
      return isPunctuationText(n);
    default:
      return false;
  }
}

/**
 * The body of a markup guard is markup only, and everything it evaluates at render time is a pure
 * read. Anything else is refused, deciding from the tree (fail closed: an unknown node kind, an
 * unparsed fragment, a call — anywhere — are all refusals):
 *   - a statement (a declaration, an assignment, an `if`, a nested guard);
 *   - an interpolation, in text or in a non-handler attribute, that is not cell / field reads,
 *     literals and operators — no calls at all (`${track(@n)}`, `title="${track(@n)}"`);
 *   - a component use (its definition may interpolate a call: `<Cnt v=@n/>`).
 * Handler attributes (`onclick=…`) are not checked: a handler does not run at render time.
 *
 * Why it matters (S462 reviews of s462-fix-rule-followups, repros a1b, t1, t2, t3b, t6): the
 * guard's plain lift group re-runs its WHOLE body on every change of any read in it; the rewrite's
 * arm selector re-runs a markup binding only when that binding's own reads change (§7.4.2, #1397
 * LIVE bindings). For pure reads that is the same DOM; for anything with an effect it is a different
 * number of runs — `#hits` diverged 7 → 3 in each repro. The client-JS compare cuts both group bodies,
 * so it cannot see that; the body is checked here instead.
 */
function markupBodyIsPure(body, filePath) {
  // The top-level fragments are ONE markup text (impl#1 splits it at each `${…}` — even inside a
  // tag), so they are scanned together, each `logic` node standing in as a hole.
  let text = "";
  const holes = [];
  for (const n of body ?? []) {
    if (!n || typeof n !== "object") continue;
    switch (n.kind) {
      case "html-fragment":
        text += String(n.content ?? "");
        break;
      case "logic":
        holes.push(n);
        text += "${\u0000" + (holes.length - 1) + "}";
        break;
      case "bare-expr":
        if (!isPunctuationText(n)) return false;
        text += " ";
        break;
      case "text":
      case "comment":
        break;
      default:
        if (!bodyNodeIsPure(n, filePath)) return false;
        text += " ";
    }
  }
  return fragmentIsPure(text, filePath, holes);
}

export const MARKUP_BODY_CALLS =
  "guard body evaluates a call or a component at render time, whose re-run frequency differs between the plain group and the arm selector";

/** Has the body a STATEMENT at its top level (or inside an interpolation block)? */
function hasStatement(body) {
  return (body ?? []).some((n) => {
    if (!n || typeof n !== "object") return false;
    if (["text", "comment", "string-literal", "html-fragment", "markup", "lift-expr"].includes(n.kind)) return false;
    if (n.kind === "logic") return (n.body ?? []).some((s) => s?.kind !== "bare-expr" || s.exprNode?.kind === "assign");
    if (n.kind === "bare-expr") return !isPunctuationText(n);
    return true;
  });
}

/** Why a markup guard's body may not be rewritten, or null when it may. */
function markupBodyRefusal(body, filePath) {
  if (markupBodyIsPure(body, filePath)) return null;
  return hasStatement(body) ? MARKUP_BODY_STATEMENTS : MARKUP_BODY_CALLS;
}

/** "file does not compile; cannot verify (…)" when the ORIGINAL file reports an error-severity
 * diagnostic, else null (fix-verify-shared.js). One compile of the original. */
function originalCompileRefusal(filePath, source, auxSources, inPlaceClean) {
  return verifyByCompile(filePath, source, null, auxSources, 0, inPlaceClean);
}

/**
 * Compile `before` and `after` with impl#1 at the SAME scratch path (the project beside it) and
 * compare. Returns null when they agree, else a reason. `markupSites` > 0: the subset rewrites
 * that many markup guards, whose lift groups are compared as described above. `after === null`:
 * compile only `before`, and return only the "does not compile" reason (or null).
 */
function verifyByCompile(filePath, before, after, auxSources, markupSites = 0, inPlaceClean = false) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-given-presence-"));
  const saved = { log: console.log, warn: console.warn, error: console.error, out: process.stdout.write, err: process.stderr.write };
  try {
    // The file, its project and every database they name, in one layout (fix-verify-shared.js).
    const { target } = writeScratchProject(dir, filePath, before, auxSources);
    const run = (text) => {
      writeFileSync(target, text);
      const r = captureTrailingContentWarnings(() => compileScrml({ inputFiles: [target], write: false, outputDir: join(dir, "out"), log: () => {} })).result;
      const codes = [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d?.code).filter((c) => typeof c === "string").sort();
      const outputs = [];
      const raw = [];
      for (const [k, v] of r.outputs ?? new Map()) {
        const fields = {};
        const rawFields = {};
        for (const f of Object.keys(v ?? {}).sort()) {
          if (!/Map$/.test(f) && typeof v[f] === "string") { fields[f] = normalizeForCompare(v[f]); rawFields[f] = v[f]; }
        }
        outputs.push([relative(dir, k), fields]);
        raw.push([relative(dir, k), rawFields]);
      }
      const byPath = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      outputs.sort(byPath);
      raw.sort(byPath);
      return { codes, outputs: JSON.stringify(outputs), raw, errs: errorSeverityCodes(r) };
    };
    let a;
    let b;
    try {
      console.log = console.warn = console.error = () => {};
      process.stdout.write = process.stderr.write = () => true;
      a = run(before);
      // A file that does not compile emits nothing to compare: equal codes would verify any
      // rewrite at all. Refuse it (fix-verify-shared.js).
      if (a.errs.length === 0 && after !== null) b = run(after);
    } finally {
      console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
      process.stdout.write = saved.out; process.stderr.write = saved.err;
    }
    if (a.errs.length > 0) return scratchRefusalReason(a.errs, filePath, before, inPlaceClean);
    if (after === null) return null; // originalCompileRefusal: the original compiles
    // The rewrite must compile too — including the emitted-JS parse gate, which `codes` does not
    // carry on a `write: false` compile (S462 delta review #3).
    if (b.errs.length > 0) return `the rewrite does not compile (impl#1 reports ${b.errs.join(", ")} after the rewrite)`;
    const strip = (cs) => cs.filter((c) => c !== LINT).join(",");
    if (strip(a.codes) !== strip(b.codes)) return `impl#1 reports different codes after the rewrite (${strip(a.codes) || "none"} → ${strip(b.codes) || "none"})`;
    if (a.outputs === b.outputs) return null;
    if (markupSites > 0) {
      const why = compareWithMarkupGroups(a.raw, b.raw, markupSites);
      return why ? `impl#1 emits different code after the rewrite (${why}), so it would change what runs` : null;
    }
    return "impl#1 emits different code after the rewrite, so it would change what runs";
  } catch (e) {
    return `the verify compile threw: ${String(e?.message ?? e).split("\n")[0]}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Why a site that does not verify alone may not: the known impl#1 miscompiles of the old form. */
function knownCause(site) {
  // g-impl1-given-match-arm-body-dropped-s462 is resolved (#1395): the arm body is lowered now,
  // but as `else if (<presence test>)` where `else :>` lowers to `else`, and this compare does not
  // read the two as alike (they are, after a `not :>` arm of the same scrutinee) — a follow-up.
  if (site.match) return " (impl#1 lowers a `given` match arm as `else if (<presence test>)` and `else :>` as `else`; the verify does not yet read them as alike — follow-up to g-impl1-given-match-arm-body-dropped-s462, resolved)";
  return "";
}

function applyEdits(source, edits) {
  let output = "";
  let cur = 0;
  for (const ed of [...edits].sort((x, y) => x.start - y.start)) {
    output += source.slice(cur, ed.start) + ed.text;
    cur = ed.end;
  }
  return output + source.slice(cur);
}

// ---------------------------------------------------------------------------
// fixGivenPresence
// ---------------------------------------------------------------------------

/**
 * Rewrite every soft-deprecated in-place `given` guard and `given` match arm of ONE file.
 * @param {string} source
 * @param {{ filePath?: string, auxSources?: Record<string,string>, verify?: boolean }} [opts]
 * @returns {{ output: string, changed: boolean, applied: Array<{rule:string,line:number,detail:string}>,
 *             blockers: Array<{rule:string,line:number,reason:string,snippet:string}> }}
 */
export function fixGivenPresence(source, opts = {}) {
  const filePath = opts.filePath ?? "input.scrml";
  const blockers = [];
  const none = () => ({ output: source, changed: false, applied: [], blockers });
  const block = (off, reason) => {
    const ls = lineStartOf(source, off);
    const le = source.indexOf("\n", off);
    blockers.push({ rule: GIVEN_PRESENCE_RULE, line: lineOf(source, off), reason, snippet: source.slice(ls, le === -1 ? source.length : le).trim().slice(0, 120) });
  };
  // Cheap pre-check: no `given` word at all → nothing to do.
  if (!/(?<![A-Za-z0-9_$])given(?![A-Za-z0-9_$])/.test(source)) return none();

  const net = netSites(source);
  const fe = frontEnd(filePath, source);
  const ast = fe.ast;
  if (fe.codes.length > 0 && net.length > 0) {
    blockers.push({
      rule: GIVEN_PRESENCE_RULE, line: 1, snippet: "",
      reason: `impl#1's front end reports ${fe.codes.join(", ")} on this file; a \`given\` guard in a region it could not read is not located — check this file by hand`,
    });
  }
  if (!ast) {
    for (const off of net) block(off, "a `given` guard in a file impl#1 cannot read (its front end built no tree) — left for a human");
    return none();
  }

  const sites = givenSites(ast);
  const located = new Set(sites.map((s) => s.node.span.start));
  for (const off of net) {
    if (!located.has(off)) block(off, "a `given` guard impl#1's front end does not read as one (e.g. inside a component body or an attribute value) — left for a human");
  }

  const planned = [];
  const refusedBody = [];
  for (const site of sites) {
    if (site.node.rebind === true) continue; // §66.7.5 — not in the window
    // A guard with no names is a parse artifact, not a site (a `const ok = a is given` line cut
    // at `given` — g-impl1-is-given-and-value-position-codegen-s460); the lint skips it too.
    if (!Array.isArray(site.node.variables) || site.node.variables.length === 0) continue;
    const p = planSite(source, site, filePath);
    if (p.reason && p.needsCompileCheck) refusedBody.push({ site, reason: p.reason });
    else if (p.reason) block(site.node.span.start, p.reason);
    else planned.push({ site, edit: p.edit });
  }
  // A file that does not compile cannot be verified: every candidate site — including one the
  // body check refuses — gets THAT reason, which is the one an author has to act on first.
  if (opts.verify !== false && (planned.length > 0 || refusedBody.length > 0)) {
    const notCompiling = originalCompileRefusal(filePath, source, opts.auxSources, opts.inPlaceClean);
    if (notCompiling) {
      for (const x of [...refusedBody, ...planned]) block(x.site.node.span.start, `${notCompiling} — left as written`);
      return none();
    }
  }
  for (const x of refusedBody) block(x.site.node.span.start, x.reason);
  if (planned.length === 0) return none();

  for (let i = 1; i < planned.length; i++) {
    if (planned[i].edit.start < planned[i - 1].edit.end) {
      block(planned[i].edit.start, "overlapping rewrites — file left untouched");
      return none();
    }
  }

  const beforeStarts = presenceStarts(ast);
  /** Structural self-check: impl#1 reads the output with exactly the rewritten heads gone. */
  const structural = (subset) => {
    const out = applyEdits(source, subset.map((p) => p.edit));
    const after = frontEnd(filePath, out).ast;
    if (!after) return { out, ok: false };
    const want = beforeStarts.size - subset.length;
    return { out, ok: presenceStarts(after).size === want };
  };
  const verifies = (subset) => {
    const s = structural(subset);
    if (!s.ok) return { out: s.out, why: "impl#1 reads the rewritten file differently (a `given` head it still sees, or a tree it cannot build)" };
    if (opts.verify === false) return { out: s.out, why: null };
    const markupSites = subset.filter((p) => isMarkupGuard(p.site)).length;
    return { out: s.out, why: verifyByCompile(filePath, source, s.out, opts.auxSources, markupSites, opts.inPlaceClean) };
  };

  let accepted = planned;
  let result = verifies(planned);
  if (result.why) {
    // Whole file did not verify: verify each site alone, keep the ones that do.
    accepted = [];
    for (const p of planned) {
      const one = verifies([p]);
      if (one.why) block(p.edit.start, `${one.why}${knownCause(p.site)} — left as written`);
      else accepted.push(p);
    }
    if (accepted.length === 0) return none();
    if (accepted.length === planned.length) {
      // Each verifies alone but not together: refuse the file rather than guess.
      block(planned[0].edit.start, `${result.why} — no site in this file rewritten`);
      return none();
    }
    result = verifies(accepted);
    if (result.why) {
      block(accepted[0].edit.start, `${result.why} — the sites that verify alone do not verify together; no site in this file rewritten`);
      return none();
    }
  }
  const output = result.out;
  const applied = accepted.map((p) => ({ rule: GIVEN_PRESENCE_RULE, line: p.edit.line, detail: p.edit.detail }));
  return { output, changed: output !== source, applied, blockers };
}
