#!/usr/bin/env bun
/**
 * arm-commas-codemod.ts — insert the S469 arm-separator `,` between arms (dpa-073 F2 "Comma
 * list", F5 steps 2–3), VERIFIED file by file against impl#1's own emit.
 * change-id: s469-impl1-arm-commas.
 *
 * WHAT IT DOES
 *   For every `.scrml` file under the given roots it finds the arm lists impl#1 reads —
 *     - a `match … { … }` body (statement, value, `return`, `const`, markup `${…}`, call argument,
 *       derived cell, engine `derived=`),
 *     - a `!{ … }` handler body,
 *     - an engine state-child's message-arm list (located with impl#1's own
 *       `parseEngineStateChildren` / `parseMessageArms`, so the boundaries are the ones impl#1 parsed) —
 *   and inserts a `,` at the end of every arm that another arm follows (between arms only; the
 *   trailing `,` is optional, §18.2, and is not added). An arm that already ends in `,` is left alone,
 *   so the script is idempotent and safe to re-run (e.g. after the s469-boot-semicolons lane lands).
 *
 * HOW IT IS VERIFIED (--write)
 *   impl#1 accepts the comma list and keeps reading the newline list (S469), so a correct
 *   insertion changes nothing impl#1 emits. Each changed file is compiled BEFORE and AFTER at the
 *   SAME path (the emit carries a path-derived hash) with `compileScrml({ write: false })`; the
 *   change is kept only when the emitted artifacts are byte-identical AND the diagnostics agree on
 *   (code, severity, file, line). A case directory's `case.scrml` is compiled too when an auxiliary
 *   file in it changed. Anything else is REVERTED and listed — never kept on a guess.
 *
 * USAGE
 *   bun docs/changes/s469-impl1-arm-commas/arm-commas-codemod.ts [--write] [--verbose] <root>...
 *     (no --write: dry run — reports the files and insertion counts it would change; --show prints
 *      each rewritten file)
 *   e.g.  bun docs/changes/s469-impl1-arm-commas/arm-commas-codemod.ts --write conformance/cases
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { compileScrml } from "../../../compiler/src/api.js";
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { parseEngineStateChildren } from "../../../compiler/src/engine-statechild-parser.ts";

// ---------------------------------------------------------------------------------------------
// lexical scan of a logic region
// ---------------------------------------------------------------------------------------------

/** One forward pass over `text[from, to)` in a LOGIC context: strings, templates (with `${}`
 *  nesting), line / block comments, and bracket depth relative to `from`. Calls `visit(i, depth,
 *  lastCodeEnd)` at every code position (outside strings / comments), BEFORE consuming text[i].
 *  `lastCodeEnd` is the index just past the last code char seen (strings count as code).
 *  Returns the index of the first unmatched closer (depth would go below 0), or `to`. */
function scan(
  text: string,
  from: number,
  to: number,
  visit: ((i: number, depth: number, lastCodeEnd: number) => void) | null,
): number {
  let depth = 0;
  let lastCodeEnd = from;
  const tmpl: number[] = []; // depth at which each open template `${` resumes
  let i = from;
  while (i < to) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") { while (i < to && text[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? to : e + 2;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (visit) visit(i, depth, lastCodeEnd);
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < to && text[j] !== c && text[j] !== "\n") { if (text[j] === "\\") j++; j++; }
      i = j + 1; lastCodeEnd = Math.min(i, to); continue;
    }
    if (c === "`" || (c === "}" && tmpl.length && tmpl[tmpl.length - 1] === depth)) {
      // template body (fresh, or resumed after a `${ … }`)
      if (c === "}") tmpl.pop();
      let j = i + 1;
      for (;;) {
        if (j >= to) break;
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "`") { j++; break; }
        if (text[j] === "$" && text[j + 1] === "{") { tmpl.push(depth); j += 2; break; }
        j++;
      }
      i = j; lastCodeEnd = i; continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    }
    i++;
    lastCodeEnd = i;
  }
  return to;
}

/** Index of the `}` that closes the `{` at `open`, or -1. */
function closeOf(text: string, open: number): number {
  const r = scan(text, open + 1, text.length, null);
  return r < text.length && text[r] === "}" ? r : -1;
}

// An arm head (§18.2): alternates joined by `|`, then the arm arrow. Bare names are not heads.
const BINDER = String.raw`(?:\s*\((?:[^()]|\([^()]*\))*\))?`;
const ALT = String.raw`(?:\.\s*[A-Z]\w*${BINDER}|::\s*\w+${BINDER}|[A-Z]\w*\s*(?:\.|::)\s*[A-Z]\w*${BINDER}|else(?!\w)|_(?!\w)|not(?!\w)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|-?\d[\w.]*|true(?!\w)|false(?!\w))`;
const HEAD = new RegExp(
  String.raw`(?:\|\s*)?(?:given\s+@?\w+(?:\s*,\s*@?\w+)*|\((?:[^()]|\([^()]*\))*\)|${ALT}(?:\s*\|\s*${ALT})*(?:\s+[a-z_]\w*)?)\s*(?::>|=>|->)`,
  "y",
);
/** The offset just past the arm arrow of the head at `i`, or -1. */
function headAt(text: string, i: number): number {
  HEAD.lastIndex = i;
  return HEAD.test(text) ? HEAD.lastIndex : -1;
}
const VALUE_END = /[\w)\]}"'`$]/;

/** Boundaries skipped because the arm ends in `;` (offsets in the file being scanned). */
let SEMI_SKIPS: number[] = [];

/** Insertion offsets (a `,` goes AT the offset) for one arm-list body `text[from, to)`. */
function armListInsertions(text: string, from: number, to: number): number[] {
  const heads: Array<{ at: number; lastCodeEnd: number }> = [];
  let firstCode = -1;
  let headArrowEnd = -1; // a head never starts inside the previous head (`.A | .B :>`)
  scan(text, from, to, (i, depth, lastCodeEnd) => {
    // a line start = only whitespace / comments between the previous code and here, with a newline
    const lineStart = firstCode < 0 || text.slice(lastCodeEnd, i).includes("\n");
    if (firstCode < 0) firstCode = i;
    if (depth === 0) {
      const prevCh = lastCodeEnd > from ? text[lastCodeEnd - 1] : "";
      const midLineOk = !lineStart && /\s/.test(text[i - 1] ?? "") && VALUE_END.test(prevCh);
      if ((lineStart || midLineOk) && i >= headArrowEnd) {
        const end = headAt(text, i);
        if (end >= 0) { heads.push({ at: i, lastCodeEnd }); headArrowEnd = end; }
      }
    }
  });
  // An arm list starts with an arm.
  if (heads.length < 2 || heads[0].at !== firstCode) return [];
  const out: number[] = [];
  for (let k = 1; k < heads.length; k++) {
    const e = heads[k].lastCodeEnd;
    const before = text[e - 1];
    if (before === "," || before === "{" || before === "|") continue;
    // An arm that ends in `;` (e.g. after a `;`-inserting migration) is not rewritten to `x;,`:
    // it is reported, for a human (SEMI_SKIPS).
    if (before === ";") { SEMI_SKIPS.push(e); continue; }
    out.push(e);
  }
  return out;
}

/** `match` / `!{` bodies, found textually (verification guards every guess). */
function textualArmLists(text: string): number[] {
  const out: number[] = [];
  const re = /\bmatch\b|!\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const at = m.index;
    const lineHead = text.slice(text.lastIndexOf("\n", at) + 1, at);
    if (lineHead.includes("//")) continue; // in a line comment (crude; verification covers)
    let open = -1;
    if (m[0] === "!{") {
      open = at + 1;
    } else {
      if (at > 0 && /[.\w$@]/.test(text[at - 1])) continue; // `.match` / `x.match` / `@match`
      // the subject runs to the first `{` at depth 0 (a multi-scrutinee head is `( … )`)
      let depth = 0;
      for (let j = at + 5; j < Math.min(text.length, at + 400); j++) {
        const c = text[j];
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") { if (--depth < 0) break; }
        else if (c === ";" || c === "}") break;
        else if (c === "{" && /[?$!^~]/.test(text[j - 1] ?? "")) {
          // a `?{ … }` (SQL) / `${ … }` / `!{ … }` block inside the subject — skip it whole
          const k = closeOf(text, j);
          if (k < 0) break;
          j = k;
        }
        else if (c === "{" && depth === 0) { open = j; break; }
      }
      if (open < 0) continue;
    }
    const close = closeOf(text, open);
    if (close < 0) continue;
    out.push(...armListInsertions(text, open + 1, close));
  }
  return out;
}

/** Engine message-arm lists, located by impl#1's own parser. */
function engineArmLists(text: string, filePath: string): number[] {
  const out: number[] = [];
  let tab: any;
  try { tab = buildAST(splitBlocks(filePath, text)); } catch { return out; }
  const engines: any[] = [];
  (function walk(list: any[]) {
    for (const n of list || []) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "engine-decl" && typeof n.rulesRaw === "string" && n.rulesRawPos) engines.push(n);
      walk(n.children); walk(n.body); walk(n.bodyChildren);
    }
  })(tab?.ast?.nodes ?? []);
  for (const e of engines) {
    const base = e.rulesRawPos.start;
    if (text.slice(base, base + e.rulesRaw.length) !== e.rulesRaw) continue; // not placed verbatim
    let children: any[] = [];
    try { children = parseEngineStateChildren(e.rulesRaw); } catch { continue; }
    for (const sc of children) {
      const arms = sc.messageArms ?? [];
      if (arms.length < 2 || typeof sc.bodyRawOffset !== "number") continue;
      for (let k = 0; k + 1 < arms.length; k++) {
        const a = arms[k];
        const s = base + sc.bodyRawOffset + a.spanStart;
        const t = base + sc.bodyRawOffset + a.spanEnd;
        // last code char of the arm (a trailing `// …` read into a bare body is skipped)
        let lastCodeEnd = s;
        scan(text, s, t, (i) => { lastCodeEnd = i + 1; });
        // `scan` reports the START of a string / template; walk to its end
        while (lastCodeEnd < t && !/\s/.test(text[lastCodeEnd]) && text.slice(lastCodeEnd, lastCodeEnd + 2) !== "//") lastCodeEnd++;
        if (text[lastCodeEnd - 1] === ",") continue;
        if (text[lastCodeEnd - 1] === ";") { SEMI_SKIPS.push(lastCodeEnd); continue; }
        // never past a `,` already written after the arm
        const after = text.slice(lastCodeEnd).match(/^[ \t]*,/);
        if (after) continue;
        out.push(lastCodeEnd);
      }
    }
  }
  return out;
}

function insertCommas(text: string, filePath: string): { text: string; count: number } {
  const at = [...new Set([...textualArmLists(text), ...engineArmLists(text, filePath)])].sort((a, b) => b - a);
  let s = text;
  for (const p of at) s = s.slice(0, p) + "," + s.slice(p);
  return { text: s, count: at.length };
}

// ---------------------------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------------------------

function fingerprint(filePath: string): string {
  let r: any;
  try {
    r = compileScrml({ inputFiles: [filePath], outputDir: join(dirname(filePath), ".arm-commas-dist"), write: false, log: () => {} });
  } catch (e) {
    return "THREW:" + String((e as Error)?.message ?? e).split("\n")[0];
  }
  const outs: Record<string, unknown> = {};
  if (r.outputs instanceof Map) for (const [k, v] of r.outputs) outs[k] = v;
  const diag = [...(r.errors ?? []), ...(r.warnings ?? [])]
    .map((d: any) => `${d.code}|${d.severity ?? ""}|${d.span?.file ?? ""}|${d.span?.line ?? ""}`)
    .sort();
  return JSON.stringify({ outs, diag });
}

function walk(dir: string, acc: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    // A `*-newline-list` case keeps its NEWLINE-separated arm list on purpose (impl#1's carried
    // newline reading, S469 r4) — never migrated.
    else if (name.endsWith(".scrml") && !/-newline-list$/.test(dir)) acc.push(p);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const verbose = args.includes("--verbose");
  const roots = args.filter((a) => !a.startsWith("--"));
  if (roots.length === 0) {
    console.error("usage: arm-commas-codemod.ts [--write] [--verbose] <root>...");
    process.exit(2);
  }
  const files: string[] = [];
  for (const r of roots) walk(resolve(r), files);

  const planned = new Map<string, { before: string; after: string; count: number }>();
  const semiSkipped: string[] = [];
  for (const f of files) {
    const before = readFileSync(f, "utf8");
    SEMI_SKIPS = [];
    const { text: after, count } = insertCommas(before, f);
    if (count > 0) planned.set(f, { before, after, count });
    for (const at of new Set(SEMI_SKIPS)) semiSkipped.push(`${f}:${before.slice(0, at).split("\n").length}`);
  }
  if (semiSkipped.length > 0) {
    console.log(`arm-commas: ${semiSkipped.length} boundary(ies) NOT rewritten — the arm ends in \`;\` (fix by hand):`);
    for (const s of semiSkipped) console.log(`  ${s}`);
  }
  const total = [...planned.values()].reduce((n, p) => n + p.count, 0);
  console.log(`arm-commas: ${files.length} file(s) scanned; ${planned.size} would change; ${total} comma(s).`);
  if (!write) {
    if (verbose) for (const [f, p] of planned) console.log(`  ${p.count}\t${f}`);
    if (args.includes("--show")) for (const [f, p] of planned) console.log(`\n=== ${f}\n${p.after}`);
    return;
  }

  // Verify per directory (a case's entry compiles its auxiliary files too).
  const byDir = new Map<string, string[]>();
  for (const f of planned.keys()) {
    const d = dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(f);
  }
  let kept = 0, keptCommas = 0;
  const reverted: string[] = [];
  for (const [d, changed] of byDir) {
    const probes = new Set(changed);
    const entry = join(d, "case.scrml");
    if (existsSync(entry)) probes.add(entry);
    const fpBefore = new Map<string, string>();
    for (const p of probes) fpBefore.set(p, fingerprint(p));
    for (const f of changed) writeFileSync(f, planned.get(f)!.after);
    const bad = [...probes].filter((p) => fingerprint(p) !== fpBefore.get(p));
    if (bad.length > 0) {
      for (const f of changed) writeFileSync(f, planned.get(f)!.before);
      reverted.push(...changed.map((f) => `${f}  (emit/diagnostics changed: ${bad.map((b) => basename(b)).join(", ")})`));
    } else {
      kept += changed.length;
      for (const f of changed) keptCommas += planned.get(f)!.count;
    }
  }
  console.log(`arm-commas: KEPT ${kept} file(s), ${keptCommas} comma(s) — impl#1 emit + diagnostics identical.`);
  console.log(`arm-commas: REVERTED ${reverted.length} file(s):`);
  for (const r of reverted) console.log(`  ${r}`);
}

main();
