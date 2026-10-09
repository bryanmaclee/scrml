/**
 * @module commands/fix-is-some
 * The `scrml fix` rule `is-some` — §42.2.2a / §55.1 / §63 (S462): the soft-deprecated presence
 * spelling `x is some` → `x is given`, and the §55.1 validator `<x is some>` → `<x is given>`.
 * Ruling: user-voice-scrml.md S462 "a, validator too, go". Lint it clears: W-IS-SOME-DEPRECATED
 * (reserved E-IS-SOME-DEPRECATED). change-id: s462-is-some-deprecate.
 *
 * ═══ THE REWRITE ═══
 *
 *   The word `some` after `is` becomes `given`. Nothing else in the file is touched: the operand,
 *   the spacing between `is` and `some`, the surrounding expression, a validator's other
 *   predicates and its inline message all stay as written.
 *
 * ═══ HOW IT LOCATES SITES (structurally, never by regex over source text) ═══
 *
 * impl#1's own front end (splitBlocks + buildAST) reads the file. buildAST records every `is`
 * KEYWORD token immediately followed by the IDENT `some` in the token streams it tokenizes at
 * real source offsets — logic bodies, error / test bodies, attribute expression values, the
 * `${…}` interpolations of a quoted attribute, a validator in a declaration opener
 * (`legacyIsSomeSites`). `confirmIsSomeSites` (is-some-deprecation.ts) keeps only the candidates
 * the source confirms — `some` at the offset, whole-word, only whitespace back to a whole-word
 * `is`. A `some` in a comment, a string, a regex or markup prose is never a token pair, so it is
 * never a site. These are exactly the sites W-IS-SOME-DEPRECATED fires on (the lint reads the
 * same confirmed list), so the rule clears every lint it can see and touches nothing else.
 *
 * ═══ HOW IT VERIFIES (per file; a failed check withdraws every edit to the file) ═══
 *
 *   1. Structural: impl#1 re-reads the rewritten file and finds no `is some` site left.
 *   2. (opts.verify, default on) impl#1 compiles the file before and after, at the same path with
 *      its project beside it: every emitted artifact (source maps aside — they encode positions)
 *      must be byte-identical once the one spelling is folded on both sides (a codegen comment
 *      that echoes an attribute's source text — `// class:on=(@x is some)` — carries the word),
 *      and the diagnostic codes identical aside from the W-IS-SOME-DEPRECATED instances the
 *      rewrite clears.
 *
 * Idempotent: the output has no `is some` site, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { captureTrailingContentWarnings } from "../expression-parser.ts";
import { confirmIsSomeSites, IS_SOME_LINT } from "../is-some-deprecation.ts";
import { compileScrml } from "../api.js";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";

export const IS_SOME_RULE = "is-some";

/** impl#1's front-end reading of a file: the confirmed `is some` sites, or null when it built no tree. */
function frontEndSites(filePath, source) {
  try {
    return captureTrailingContentWarnings(() => {
      const bs = splitBlocks(filePath, source);
      const built = buildAST(bs);
      if (!built || !built.ast) return null;
      return confirmIsSomeSites(source, built.legacyIsSomeSites ?? []);
    }).result;
  } catch {
    return null;
  }
}

function lineOf(src, off) {
  let n = 1;
  for (let i = 0; i < off && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}
const lineStartOf = (src, off) => src.lastIndexOf("\n", off - 1) + 1;

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

/** Fold the one spelling the rewrite changes, so an artifact that echoes source text compares equal. */
const fold = (s) => s.split("is given").join("is some");

/**
 * Compile `before` and `after` with impl#1 at the SAME scratch path (the project beside it) and
 * compare. Returns null when they agree, else a reason.
 */
function verifyByCompile(filePath, before, after, auxSources) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-is-some-"));
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
      const diags = [...(r.errors ?? []), ...(r.warnings ?? [])];
      const codes = diags.map((d) => d?.code).filter((c) => typeof c === "string").sort();
      // The lint on THIS file (an imported file's own sites are its own business).
      const fileOf = (d) => d?.filePath ?? d?.span?.file ?? null;
      const ownLints = diags.filter((d) => d?.code === IS_SOME_LINT && fileOf(d) !== null && resolve(fileOf(d)) === resolve(target)).length;
      const outputs = [];
      for (const [k, v] of r.outputs ?? new Map()) {
        const fields = {};
        for (const f of Object.keys(v ?? {}).sort()) if (!/Map$/.test(f) && typeof v[f] === "string") fields[f] = fold(v[f]);
        outputs.push([relative(dir, k), fields]);
      }
      outputs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return { codes, ownLints, outputs: JSON.stringify(outputs) };
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
    const strip = (cs) => cs.filter((c) => c !== IS_SOME_LINT).join(",");
    if (strip(a.codes) !== strip(b.codes)) return `impl#1 reports different codes after the rewrite (${strip(a.codes) || "none"} → ${strip(b.codes) || "none"})`;
    if (b.ownLints !== 0) return "impl#1 still reports W-IS-SOME-DEPRECATED in this file after the rewrite";
    if (a.outputs !== b.outputs) return "impl#1 emits different artifacts after the rewrite";
    return null;
  } catch (e) {
    return `the verify compile threw: ${String(e?.message ?? e).split("\n")[0]}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Rewrite every `is some` site of ONE file to `is given`.
 * @param {string} source
 * @param {{ filePath?: string, auxSources?: Record<string,string>, verify?: boolean }} [opts]
 * @returns {{ output: string, changed: boolean, applied: Array<{rule:string,line:number,detail:string}>,
 *             blockers: Array<{rule:string,line:number,reason:string,snippet:string}> }}
 */
export function fixIsSome(source, opts = {}) {
  const filePath = opts.filePath ?? "input.scrml";
  const blockers = [];
  const none = { output: source, changed: false, applied: [], blockers };
  // Cheap pre-check (it only decides whether to read the file; nothing is located by it).
  if (!source.includes("some")) return none;
  const sites = frontEndSites(filePath, source);
  if (sites === null) {
    if (/(?<![A-Za-z0-9_$])is\s+some(?![A-Za-z0-9_$])/.test(source)) {
      blockers.push({ rule: IS_SOME_RULE, line: 1, snippet: "", reason: "impl#1's front end builds no tree for this file — an `is some` in it is not located; check it by hand" });
    }
    return none;
  }
  if (sites.length === 0) return none;

  let output = "";
  let cur = 0;
  for (const s of sites) {
    output += source.slice(cur, s.start) + "given";
    cur = s.end;
  }
  output += source.slice(cur);

  const block = (off, reason) => {
    const ls = lineStartOf(source, off);
    const le = source.indexOf("\n", off);
    blockers.push({ rule: IS_SOME_RULE, line: lineOf(source, off), reason, snippet: source.slice(ls, le === -1 ? source.length : le).trim().slice(0, 120) });
  };

  // 1. Structural self-check.
  const after = frontEndSites(filePath, output);
  if (after === null || after.length !== 0) {
    block(sites[0].isStart, "impl#1 does not read the rewritten file as `is given` at every site — no site in this file rewritten");
    return none;
  }
  // 2. Compile self-check.
  if (opts.verify !== false) {
    const why = verifyByCompile(filePath, source, output, opts.auxSources);
    if (why) {
      block(sites[0].isStart, `${why} — no site in this file rewritten`);
      return none;
    }
  }
  const applied = sites.map((s) => ({
    rule: IS_SOME_RULE,
    line: s.line,
    detail: s.kind === "validator" ? "`<… is some>` → `<… is given>` (validator)" : "`is some` → `is given`",
  }));
  return { output, changed: output !== source, applied, blockers };
}
