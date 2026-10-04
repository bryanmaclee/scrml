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
  try {
    return captureTrailingContentWarnings(() => buildAST(splitBlocks(filePath, source)).ast).result ?? null;
  } catch {
    return null;
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
  walk(ast, (n) => {
    if ((n.kind !== "guarded-expr" && n.kind !== "error-effect") || !Array.isArray(n.arms) || n.arms.length === 0) return;
    const key = n.arms[0]?.span?.start;
    if (typeof key !== "number" || out.has(key)) return;
    out.set(key, n.arms);
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

function lineOf(src, off) {
  let n = 1;
  for (let i = 0; i < off && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}
const lineStartOf = (src, off) => src.lastIndexOf("\n", off - 1) + 1;
const isBlank = (s) => /^[ \t]*$/.test(s);

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
      text = "\n" + alignIndent(src.slice(lineStartOf(src, a0), a0));
      anchor.push(a0);
    } else {
      anchor.push(L.pipeStart);
    }
    if (L.bareBinder) text += "_ ";
    edits.push({ start: from, end: L.patternStart, text, line: lineOf(src, L.pipeStart), detail: L.detail });
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
  const handlers = handlerArmLists(ast).map((arms) => arms.map((a) => ({
    pattern: a.pattern, binding: a.binding, handler: a.handler, armArrow: a.armArrow, typeQualifier: a.typeQualifier ?? "",
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
  const ast = parseFile(filePath, source);
  if (!ast) return none; // impl#1 cannot read the file — nothing located, nothing rewritten
  const { lists, unplaced } = collectArmLists(ast, source);
  for (const off of unplaced) block(off, "an engine whose message arms cannot be placed in the file — left untouched");
  for (const off of componentsWithLegacyArms(ast, filePath)) {
    block(off, "a `|`-led `!{}` arm inside a component body — impl#1 keeps the body as token text, so the arm has no confirmable source position; rewrite it by hand (delete the `|`, §19.4.5)");
  }

  const edits = [];
  for (const L of lists) {
    if (!L.arms.some((a) => a.legacy)) continue;
    const mark = edits.length;
    const nb = blockers.length;
    planArmList(source, L.arms, edits, block);
    if (blockers.length > nb) edits.length = mark; // a list with an unconfirmed arm is left whole
  }
  if (edits.length === 0) return none;

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
  const applied = edits.filter((e) => e.detail).map((e) => ({ rule: ARM_PIPE_RULE, line: e.line, detail: e.detail }));
  return { output, changed: output !== source, applied, blockers };
}
