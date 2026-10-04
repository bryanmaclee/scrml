/**
 * @module commands/fix-arm-pipe
 * The `scrml fix` rule `arm-pipe` — §19.4.5 / §51.0.S.2.3 (S452): the retiring `|`-led pattern
 * arm → the §18.2 match arm. Ruling: user-voice-scrml.md S452 "c looks right" + "a. one spelling".
 * Lint it clears: W-ARM-PIPE-LEGACY (reserved E-ARM-PIPE-LEGACY). change-id:
 * s452-arm-pipe-deprecation.
 *
 * ═══ THE REWRITE (§19.4.5's table row, verbatim in effect) ═══
 *
 *   - Delete the leading `|` and the space after it: `| <pattern> :>` → `<pattern> :>`.
 *   - A parenthesis-free binder gains its parentheses: `.V m` → `.V(m)` (`::V m` → `::V(m)`,
 *     `T.V m` → `T.V(m)`).
 *   - Where two or more arms share a line, each arm after the first goes on its own line (§18.2:
 *     one arm per line), aligned under the first.
 *   - The separator (`:>` / `=>` / `->`), the pattern's prefix (`.` / `::`) and the arm body are
 *     left as written.
 *   - One case the table does not name: a `|`-led bare binder with no pattern, `| e :>`. impl#1
 *     has always read it as the whole-error arm, and §18.2 / §18.6.1 spell that arm `_ e` (a
 *     pipe-less `e :>` is E-MATCH-BARE-BINDER). It is rewritten `_ e :>` — the same arm.
 *
 * ═══ HOW IT LOCATES ARMS (structurally, never by regex over source text) ═══
 *
 * impl#1's own front end (splitBlocks + buildAST) parses the file. A `!{}` arm the `!{}` arm
 * parser (ast-builder.js `parseErrorTokens`) read through its `|` path carries `legacyPipe` — the
 * offsets of its pattern and (for a paren-free binder) its pattern head and binder, relative to
 * the arm's `span.start` (the `|`; relative so a re-based span — a handler inside an attribute
 * value — still places them). An engine message arm read through `parseMessageArms`' `|` path carries `legacyPipe`
 * with a `bodyRaw` offset; the state-child's `bodyRawOffset` and the engine's `rulesRaw` (a
 * verbatim substring of its block) place it in the file. A `|` that is alternation inside an arm,
 * `||`, or a `|` in a string / comment / SQL block is never an arm record, so it is never touched.
 * Every located offset is confirmed against the source (`|` there, whitespace only between the
 * `|` and the pattern, the binder's text) — an offset the source does not confirm is a blocker.
 *
 * ═══ HOW IT VERIFIES (per file; a failed check withdraws every edit to the file) ═══
 *
 *   1. Structural: impl#1 re-reads the rewritten file; every handler and every state-child has
 *      the same arms (pattern, binding, body, separator) as before, and no `|`-led arm remains
 *      at a rewritten site.
 *   2. (opts.verify, default on) impl#1 compiles the file before and after, at the same path with
 *      its project beside it: every emitted artifact (source maps aside — they encode positions)
 *      must be byte-identical, and the diagnostic codes identical aside from the
 *      W-ARM-PIPE-LEGACY instances the rewrite clears.
 *
 * Idempotent: the output has no `|`-led arm at a rewritten site, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { captureTrailingContentWarnings } from "../expression-parser.ts";
import { parseEngineStateChildren } from "../engine-statechild-parser.ts";
import { parseComponentBody } from "../component-expander.ts";
import { tokenizeBlock, tokenizeError, tokenizeLogic } from "../tokenizer.ts";
import { compileScrml } from "../api.js";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";

export const ARM_PIPE_RULE = "arm-pipe";
const LINT = "W-ARM-PIPE-LEGACY";

// ---------------------------------------------------------------------------
// impl#1's reading of a file
// ---------------------------------------------------------------------------

function parseFile(filePath, source) {
  return frontEnd(filePath, source).ast;
}

/**
 * impl#1's front-end reading: the AST (or null) and the E- codes its BLOCK SPLITTER raised — the
 * errors after which a region of the file may have been read as text or dropped (a builder error
 * on a well-split file does not hide a handler from the tree).
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

/** The `!{}` handlers: each an ordered arm list (deduplicated by the first arm's offset). */
function handlerArmLists(ast) {
  const out = new Map();
  const add = (arms) => {
    if (!Array.isArray(arms) || arms.length === 0) return;
    const key = arms[0]?.span?.start;
    if (typeof key !== "number" || out.has(key)) return;
    out.set(key, arms);
  };
  walk(ast, (n) => {
    if (n.kind === "guarded-expr" || n.kind === "error-effect") add(n.arms);
    // A handler nested in an arm body (ast-builder.js `_nestedHandlersIn`).
    if (Array.isArray(n.nestedHandlers)) for (const h of n.nestedHandlers) add(h?.arms);
  });
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, arms]) => arms);
}

/**
 * The engine state-children with message arms, placed in the file: `{ base, arms }` per state
 * child, `base` = the file offset of its `bodyRaw`. `unplaced` lists engines whose `rulesRaw`
 * is not a unique substring of their own block.
 */
function messageArmLists(ast, source) {
  const lists = [];
  const unplaced = [];
  const seen = new Set();
  walk(ast, (n) => {
    if (n.kind !== "engine-decl" || typeof n.rulesRaw !== "string" || !n.rulesRaw || !n.span) return;
    let children;
    try { children = parseEngineStateChildren(n.rulesRaw); } catch { return; }
    if (!children.some((sc) => (sc.messageArms ?? []).length > 0)) return;
    // `rulesRaw` is the engine body verbatim (trimmed) — it must occur exactly once inside the
    // engine's own block.
    const at = source.indexOf(n.rulesRaw, n.span.start);
    const inBlock = at >= 0 && at + n.rulesRaw.length <= n.span.end;
    const again = inBlock ? source.indexOf(n.rulesRaw, at + 1) : -1;
    if (!inBlock || (again >= 0 && again + n.rulesRaw.length <= n.span.end)) { unplaced.push(n.span.start); return; }
    if (seen.has(at)) return;
    seen.add(at);
    for (const sc of children) {
      const arms = sc.messageArms ?? [];
      if (arms.length === 0 || typeof sc.bodyRawOffset !== "number") continue;
      lists.push({ base: at + sc.bodyRawOffset, arms, tag: sc.tag });
    }
  });
  return { lists, unplaced };
}

/**
 * The markup body of a component definition as impl#1's component expander reads it (the same
 * reading as fix-s66.js `componentBodyOf`): a `component-def`'s `raw`, or an
 * `export const Name = <markup>` export-decl's `raw` past its prefix.
 */
function componentBodyOf(n) {
  if (typeof n.raw !== "string") return null;
  let body = null;
  if (n.kind === "component-def" && typeof n.name === "string") body = n.raw;
  else if (n.kind === "export-decl" && n.exportKind === "const" && typeof n.exportedName === "string") {
    const prefix = `export const ${n.exportedName} =`;
    const idx = n.raw.indexOf(prefix);
    if (idx !== -1) body = n.raw.slice(idx + prefix.length).trimStart();
  }
  return body !== null && body.trimStart().startsWith("<") ? body : null;
}

/**
 * Component definitions whose body holds a `|`-led `!{}` arm. impl#1 keeps a component body as
 * TOKEN-JOINED text (`</>` reads `< / >`) and parses it only at expansion, so an arm there has no
 * source position this rule can confirm: it is reported, never rewritten. Returns the span
 * offsets of those definitions.
 */
function componentsWithLegacyArms(ast, filePath) {
  const out = [];
  walk(ast, (n) => {
    const body = componentBodyOf(n);
    if (body === null || !body.includes("|") || !n.span) return;
    let r;
    try { r = captureTrailingContentWarnings(() => parseComponentBody(body, String(n.name ?? n.exportedName ?? "C"), filePath)).result; } catch { return; }
    let found = false;
    walk(r?.nodes ?? [], (m) => {
      if ((m.kind === "guarded-expr" || m.kind === "error-effect") && Array.isArray(m.arms) && m.arms.some((a) => a.legacyPipe)) found = true;
    });
    if (found) out.push(n.span.start);
  });
  return out;
}

/**
 * The completeness net (S452 review r1): every `|` that impl#1's `!{}` arm parser would read as an
 * arm lead, found with impl#1's OWN block splitter + tokenizer — not from the AST. A handler is an
 * `error-effect` block of the block-splitter tree, or an error-effect BLOCK_REF token the tokenizer
 * emits for a `!{…}` inside a `${}` / `^{}` body or inside another handler's body (recursively).
 * In a handler's own token stream an arm lead is a PUNCT `|` at bracket depth 0 (the arm parser
 * ends an arm at any such `|`; `||` is one OPERATOR token; strings and comments are their own
 * tokens). Returns the source offsets of those `|` tokens. A `|`-led arm this net finds that the
 * rule did not rewrite is REPORTED — the rule never leaves one silently. (Handlers inside markup
 * attribute values are not block-split; the AST path covers those, and component bodies are
 * reported by `componentsWithLegacyArms`.)
 */
function tokenizerArmSites(filePath, source) {
  const sites = new Set();
  const seen = new Set();
  const handler = (raw, start, line, col) => {
    if (typeof raw !== "string" || !raw.startsWith("!{") || !raw.endsWith("}") || seen.has(start)) return;
    seen.add(start);
    let toks;
    try { toks = tokenizeError(raw.slice(2, raw.length - 1), start + 2, line ?? 1, (col ?? 1) + 2); } catch { return; }
    let depth = 0;
    for (const t of toks) {
      if (t.kind === "BLOCK_REF" && t.block?.type === "error-effect") { handler(t.block.raw ?? t.text, t.span.start, t.span.line, t.span.col); continue; }
      if (t.kind !== "PUNCT") continue;
      if (t.text === "{" || t.text === "(" || t.text === "[") depth++;
      else if (t.text === "}" || t.text === ")" || t.text === "]") depth = Math.max(0, depth - 1);
      else if (t.text === "|" && depth === 0) sites.add(t.span.start);
    }
  };
  const visit = (b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "error-effect" && b.span) handler(b.raw, b.span.start, b.span.line, b.span.col);
    // `text` too: a program body's bare code run (§40.8) is a text block to the splitter and is
    // read as code by the AST builder. (In genuine prose a `!{…}` holding a `|` is reported too —
    // a report, never a rewrite.)
    if ((b.type === "logic" || b.type === "meta" || b.type === "text") && typeof b.raw === "string" && b.span) {
      let toks = [];
      try {
        toks = b.type === "text"
          ? tokenizeLogic(b.raw, b.span.start, b.span.line ?? 1, b.span.col ?? 1, [])
          : tokenizeBlock(b, filePath);
      } catch { toks = []; }
      for (const t of toks) if (t.kind === "BLOCK_REF" && t.block?.type === "error-effect") handler(t.block.raw ?? t.text, t.span.start, t.span.line, t.span.col);
    }
    for (const c of b.children ?? []) visit(c);
  };
  let bs;
  try { bs = captureTrailingContentWarnings(() => splitBlocks(filePath, source)).result; } catch { return []; }
  for (const b of bs?.blocks ?? []) visit(b);
  return [...sites].sort((a, b) => a - b);
}

function lineOf(src, off) {
  let n = 1;
  for (let i = 0; i < off && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}
const lineStartOf = (src, off) => src.lastIndexOf("\n", off - 1) + 1;
const isBlank = (s) => /^[ \t]*$/.test(s);

/** The file's line ending: CRLF when the file uses it, else LF (a split arm keeps the file's style). */
const eolOf = (src) => (src.includes("\r\n") ? "\r\n" : "\n");

/** `prefix` with every non-tab character turned into a space (an indent that aligns under it). */
const alignIndent = (prefix) => prefix.replace(/[^\t]/g, " ");

// ---------------------------------------------------------------------------
// Edit planning
// ---------------------------------------------------------------------------

/**
 * Plan the edits for one arm list. `arms[k]` → `{ start, legacy }` where `start` is the file
 * offset of the arm's first character (its `|` when legacy) and `legacy` (when `|`-led) is
 * `{ pipeStart, patternStart, canonicalBinder?: {headEnd, binderStart, binderEnd, name},
 * bareBinder?: true, arrowFound }`. Returns the edits, or a blocker reason.
 */
function planArmList(src, arms, edits, block) {
  // anchor[k] — the file offset whose column arm k's pattern will start at after the rewrite.
  const anchor = [];
  for (let k = 0; k < arms.length; k++) {
    const a = arms[k];
    if (!a.legacy) { anchor.push(a.start); continue; }
    const L = a.legacy;
    if (!L.arrowFound) { block(L.pipeStart, "a `|`-led arm with no arm arrow (an alternation the `!{}` parser splits into arms?) — left for a human"); return; }
    if (src[L.pipeStart] !== "|" || !(L.patternStart > L.pipeStart) || !isBlank(src.slice(L.pipeStart + 1, L.patternStart))) {
      block(L.pipeStart, "the arm's recorded `|` / pattern offsets are not confirmed by the source — left untouched"); return;
    }
    const ls = lineStartOf(src, L.pipeStart);
    const before = src.slice(ls, L.pipeStart);
    // Shares its line with earlier content of this arm list → its own line (§18.2).
    const split = k > 0 && !isBlank(before);
    let text = "";
    let from = L.pipeStart;
    if (split) {
      let ws = L.pipeStart;
      while (ws > ls && (src[ws - 1] === " " || src[ws - 1] === "\t")) ws--;
      from = ws;
      const a0 = anchor[k - 1];
      text = eolOf(src) + alignIndent(src.slice(lineStartOf(src, a0), a0));
      anchor.push(a0);
    } else {
      anchor.push(L.pipeStart);
    }
    if (L.bareBinder) text += "_ ";
    edits.push({ start: from, end: L.patternStart, text, line: lineOf(src, L.pipeStart), detail: L.detail, pipe: L.pipeStart });
    if (L.binder) {
      const B = L.binder;
      if (src.slice(B.binderStart, B.binderEnd) !== B.name || !isBlank(src.slice(B.headEnd, B.binderStart)) || !(B.headEnd > L.patternStart)) {
        edits.pop();
        block(L.pipeStart, "the paren-free binder's recorded offsets are not confirmed by the source — left untouched"); return;
      }
      edits.push({ start: B.headEnd, end: B.binderEnd, text: `(${B.name})`, line: lineOf(src, B.binderStart), detail: null });
    }
  }
}

/** The arm lists of a file, as planning input. */
function collectArmLists(ast, src) {
  const lists = [];
  for (const arms of handlerArmLists(ast)) {
    lists.push({
      kind: "handler",
      arms: arms.map((a) => {
        const lp = a.legacyPipe;
        const at = a.span?.start ?? 0;
        if (!lp) return { start: at, legacy: null };
        // legacyPipe offsets are relative to the arm's span.start (its `|`).
        const legacy = {
          pipeStart: at,
          patternStart: at + lp.patternAt,
          arrowFound: lp.arrowFound !== false,
          bareBinder: !!lp.bareBinder,
          detail: `\`| ${lp.pattern}\` → \`${lp.canonical}\``,
        };
        if (lp.parenFreeBinder) {
          legacy.binder = { headEnd: at + lp.headEndAt, binderStart: at + lp.binderAt, binderEnd: at + lp.binderEndAt, name: String(a.binding ?? "") };
        }
        return { start: at, legacy };
      }),
    });
  }
  const msg = messageArmLists(ast, src);
  for (const { base, arms } of msg.lists) {
    lists.push({
      kind: "message",
      arms: arms.map((a) => {
        if (!a.legacyPipe) return { start: base + a.spanStart, legacy: null };
        return {
          start: base + a.spanStart,
          legacy: {
            pipeStart: base + a.spanStart,
            patternStart: base + a.legacyPipe.patternStart,
            arrowFound: true,
            detail: `\`| ${a.legacyPipe.pattern}\` → \`${a.legacyPipe.pattern}\` (message arm)`,
          },
        };
      }),
    });
  }
  return { lists, unplaced: msg.unplaced };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Every arm's meaning-bearing fields, in order — what the rewrite must leave unchanged. */
function armSignature(ast, src) {
  // A nested handler's text is part of its outer arm's body; the nested arms are compared on their
  // own (they are lists here too), so the outer body is compared with each nested `!{…}` elided.
  const bodyOf = (a) => {
    let h = String(a.handler ?? "");
    for (const nh of a.nestedHandlers ?? []) if (typeof nh?.raw === "string") h = h.split(nh.raw).join("!{…}");
    return h;
  };
  const handlers = handlerArmLists(ast).map((arms) => arms.map((a) => ({
    pattern: a.pattern, binding: a.binding, handler: bodyOf(a), armArrow: a.armArrow, typeQualifier: a.typeQualifier ?? "",
  })));
  const messages = messageArmLists(ast, src).lists.map(({ arms, tag }) => ({
    tag,
    arms: arms.map(({ spanStart, spanEnd, legacyPipe, ...rest }) => rest),
  }));
  return JSON.stringify({ handlers, messages });
}

/** Count the `|`-led arms impl#1 reads in a file. */
function legacyArmCount(ast, src) {
  let n = 0;
  for (const arms of handlerArmLists(ast)) for (const a of arms) if (a.legacyPipe) n++;
  for (const { arms } of messageArmLists(ast, src).lists) for (const a of arms) if (a.legacyPipe) n++;
  return n;
}

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
 * Compile `before` and `after` with impl#1 at the SAME scratch path (the project beside it) and
 * compare. Returns null when they agree, else a reason.
 */
function verifyByCompile(filePath, before, after, auxSources) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-arm-pipe-"));
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
        for (const f of Object.keys(v ?? {}).sort()) if (!/Map$/.test(f) && typeof v[f] === "string") fields[f] = v[f];
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
    if (a.outputs !== b.outputs) return "impl#1 emits different artifacts after the rewrite";
    return null;
  } catch (e) {
    return `the verify compile threw: ${String(e?.message ?? e).split("\n")[0]}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// fixArmPipe
// ---------------------------------------------------------------------------

/**
 * Rewrite every `|`-led `!{}` handler arm and engine message arm of ONE file.
 * @param {string} source
 * @param {{ filePath?: string, auxSources?: Record<string,string>, verify?: boolean }} [opts]
 * @returns {{ output: string, changed: boolean, applied: Array<{rule:string,line:number,detail:string}>,
 *             blockers: Array<{rule:string,line:number,reason:string,snippet:string}> }}
 */
export function fixArmPipe(source, opts = {}) {
  const filePath = opts.filePath ?? "input.scrml";
  const blockers = [];
  const none = { output: source, changed: false, applied: [], blockers };
  const block = (off, reason) => {
    const ls = lineStartOf(source, off);
    const le = source.indexOf("\n", off);
    blockers.push({ rule: ARM_PIPE_RULE, line: lineOf(source, off), reason, snippet: source.slice(ls, le === -1 ? source.length : le).trim().slice(0, 120) });
  };
  // Cheap pre-check: no `|` at all → no `|`-led arm.
  if (!source.includes("|")) return none;
  // The completeness net: every arm lead impl#1's tokenizer sees. Whatever the rule does not
  // rewrite is reported (never left silently), on every path that does not withdraw the file.
  const netSites = tokenizerArmSites(filePath, source);
  const reportUnrewritten = (rewritten, why) => {
    const blockedLines = new Set(blockers.map((b) => b.line));
    for (const off of netSites) {
      if (rewritten.has(off) || blockedLines.has(lineOf(source, off))) continue;
      block(off, why);
    }
  };
  const NOT_PLACED = "a `|`-led arm in a `!{…}` that impl#1 does not parse as a handler (it reads it as text, or copies it into the output unparsed — e.g. inside an object-literal method body, g-impl1-object-literal-method-handler-raw-s452) — left for a human";
  const fe = frontEnd(filePath, source);
  const ast = fe.ast;
  // A file impl#1's front end rejects may hold handlers in a region it read as text or dropped:
  // neither the tree nor the tokenizer net can see them. Say so rather than report a clean file.
  // (`!{` here only decides whether the warning is relevant; nothing is located or rewritten by it.)
  const frontEndBlind = fe.codes.length > 0 && source.includes("!{");
  if (frontEndBlind) {
    blockers.push({
      rule: ARM_PIPE_RULE, line: 1, snippet: "",
      reason: `impl#1's front end reports ${fe.codes.join(", ")} on this file; a \`|\`-led arm in a region it could not read is not located — check this file by hand`,
    });
  }
  if (!ast) {
    reportUnrewritten(new Set(), "a `|`-led `!{}` arm in a file impl#1 cannot read (its front end built no tree) — left for a human");
    return none;
  }
  const { lists, unplaced } = collectArmLists(ast, source);
  for (const off of unplaced) block(off, "an engine whose message arms cannot be placed in the file — left untouched");
  for (const off of componentsWithLegacyArms(ast, filePath)) {
    block(off, "a `|`-led `!{}` arm inside a component body — left as written: impl#1 does not yet compile the pipe-less form in a component body (g-impl1-component-body-pipeless-handler-s452), so keep the `|` there for now");
  }

  const edits = [];
  for (const L of lists) {
    if (!L.arms.some((a) => a.legacy)) continue;
    const mark = edits.length;
    const nb = blockers.length;
    planArmList(source, L.arms, edits, block);
    if (blockers.length > nb) {
      edits.length = mark; // a list with an unconfirmed arm is left whole — and every arm of it said
      const said = new Set(blockers.map((b) => b.line));
      for (const a of L.arms) {
        if (!a.legacy || said.has(lineOf(source, a.legacy.pipeStart))) continue;
        block(a.legacy.pipeStart, "a `|`-led arm left as written with the rest of its handler (another arm of the handler is left for a human)");
      }
    }
  }
  if (edits.length === 0) {
    reportUnrewritten(new Set(), NOT_PLACED);
    return none;
  }

  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end) {
      block(edits[i].start, "overlapping arm rewrites — file left untouched");
      return none;
    }
  }
  let output = "";
  let cur = 0;
  for (const ed of edits) {
    output += source.slice(cur, ed.start) + ed.text;
    cur = ed.end;
  }
  output += source.slice(cur);

  // 1. Structural self-check.
  const after = parseFile(filePath, output);
  const fixedCount = edits.filter((e) => e.detail).length;
  if (!after || armSignature(after, output) !== armSignature(ast, source) ||
      legacyArmCount(after, output) !== legacyArmCount(ast, source) - fixedCount) {
    block(edits[0].start, "impl#1 reads the rewritten arms differently — no arm in this file rewritten");
    return none;
  }
  // 2. Compile self-check.
  if (opts.verify !== false) {
    const why = verifyByCompile(filePath, source, output, opts.auxSources);
    if (why) {
      block(edits[0].start, `${why} — no arm in this file rewritten`);
      return none;
    }
  }
  reportUnrewritten(new Set(edits.filter((e) => e.detail).map((e) => e.pipe)), NOT_PLACED);
  const applied = edits.filter((e) => e.detail).map((e) => ({ rule: ARM_PIPE_RULE, line: e.line, detail: e.detail }));
  return { output, changed: output !== source, applied, blockers };
}
