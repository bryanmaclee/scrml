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
 *   When the whole file does not verify, each site is verified alone and the sites that verify
 *   alone are re-verified together; a site that does not is left as written with the reason.
 *   That is how a site impl#1 compiles differently today is refused: the rewrite would change
 *   what runs (a `given` arm whose body impl#1 drops, g-impl1-given-match-arm-body-dropped-s462;
 *   a markup guard over a cell, whose `if` rewrite renders stale today,
 *   g-impl1-markup-if-branch-memo-stale-render-s462; a site whose diagnostic codes change).
 *
 * Idempotent: the output has no `given` head at a rewritten site, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { captureTrailingContentWarnings } from "../expression-parser.ts";
import { compileScrml } from "../api.js";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
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

/**
 * Confirm a `given` head against the source. Returns
 * `{ ok: true, names, sepStart, sepEnd, sep, braceAt }` or `{ ok: false, reason }`.
 * Only whitespace may separate the head's parts; a comment, a property path or any other
 * token is a reason to leave the site alone.
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
    if (k > 0) {
      if (source[at] !== ",") return { ok: false, reason: "the guard's head is not a comma-separated identifier list in the source — left for a human" };
      i = skipWs(source, at + 1);
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
  const braceAt = skipWs(source, sepStart + 2);
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
function planSite(source, site) {
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
  if (source[head.braceAt] !== "{") {
    return { reason: "the guard's body is not a `{ … }` block (E-SYNTAX-044: a guard body is a block; braces decide what the guard covers) — left for a human" };
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

function absKey(filePath, key) {
  return isAbsolute(key) ? resolve(key) : resolve(dirname(resolve(filePath)), key);
}
function commonDir(paths) {
  let parts = dirname(paths[0]).split(sep);
  for (const p of paths.slice(1)) {
    const q = dirname(p).split(sep);
    let i = 0;
    while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(sep) || sep;
}

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

/**
 * Compile `before` and `after` with impl#1 at the SAME scratch path (the project beside it) and
 * compare. Returns null when they agree, else a reason.
 */
function verifyByCompile(filePath, before, after, auxSources) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-given-presence-"));
  const saved = { log: console.log, warn: console.warn, error: console.error, out: process.stdout.write, err: process.stderr.write };
  try {
    const self = resolve(filePath);
    const files = new Map([[self, before]]);
    for (const [p, s] of Object.entries(auxSources ?? {})) {
      const ap = absKey(filePath, p);
      if (ap !== self) files.set(ap, s);
    }
    const root = commonDir([...files.keys()]);
    let target = null;
    for (const [ap, s] of files) {
      const out = join(dir, "src", relative(root, ap));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, s);
      if (ap === self) target = out;
    }
    const run = (text) => {
      writeFileSync(target, text);
      const r = captureTrailingContentWarnings(() => compileScrml({ inputFiles: [target], write: false, outputDir: join(dir, "out"), log: () => {} })).result;
      const codes = [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d?.code).filter((c) => typeof c === "string").sort();
      const outputs = [];
      for (const [k, v] of r.outputs ?? new Map()) {
        const fields = {};
        for (const f of Object.keys(v ?? {}).sort()) if (!/Map$/.test(f) && typeof v[f] === "string") fields[f] = normalizeForCompare(v[f]);
        outputs.push([relative(dir, k), fields]);
      }
      outputs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return { codes, outputs: JSON.stringify(outputs) };
    };
    let a;
    let b;
    try {
      console.log = console.warn = console.error = () => {};
      process.stdout.write = process.stderr.write = () => true;
      a = run(before);
      b = run(after);
    } finally {
      console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
      process.stdout.write = saved.out; process.stderr.write = saved.err;
    }
    const strip = (cs) => cs.filter((c) => c !== LINT).join(",");
    if (strip(a.codes) !== strip(b.codes)) return `impl#1 reports different codes after the rewrite (${strip(a.codes) || "none"} → ${strip(b.codes) || "none"})`;
    if (a.outputs !== b.outputs) return "impl#1 emits different code after the rewrite, so it would change what runs";
    return null;
  } catch (e) {
    return `the verify compile threw: ${String(e?.message ?? e).split("\n")[0]}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Why a site that does not verify alone may not: the known impl#1 miscompiles of the old form. */
function knownCause(site) {
  if (site.match) return " (impl#1 drops the body of a `given` match arm — g-impl1-given-match-arm-body-dropped-s462 — and `else :>` runs it)";
  const names = Array.isArray(site.node.spellings) ? site.node.spellings : [];
  const hasMarkup = (site.node.body ?? []).some((b) => b && typeof b === "object" && /markup|lift|html-fragment/.test(String(b.kind ?? "")));
  if (hasMarkup && names.some((n) => typeof n === "string" && n.startsWith("@"))) {
    return " (in markup, impl#1 lowers `${ if (@cell is given) { … } }` with a branch memo (`_scrml_lift_branch_N`) that skips the re-render while presence holds, so `${@cell.field}` inside it goes stale; `given @cell` re-renders — the rewrite would make it worse — g-impl1-markup-if-branch-memo-stale-render-s462)";
  }
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
  for (const site of sites) {
    if (site.node.rebind === true) continue; // §66.7.5 — not in the window
    // A guard with no names is a parse artifact, not a site (a `const ok = a is given` line cut
    // at `given` — g-impl1-is-given-and-value-position-codegen-s460); the lint skips it too.
    if (!Array.isArray(site.node.variables) || site.node.variables.length === 0) continue;
    const p = planSite(source, site);
    if (p.reason) block(site.node.span.start, p.reason);
    else planned.push({ site, edit: p.edit });
  }
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
    return { out: s.out, why: verifyByCompile(filePath, source, s.out, opts.auxSources) };
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
