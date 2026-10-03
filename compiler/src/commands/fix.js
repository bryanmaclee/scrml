/**
 * @module commands/fix
 * `scrml fix` — the verb §63.4 names for the verified rewrite that gates a retirement's scheduling.
 * change-id: s449-scrml-fix-s66-twins (S449 corpus-dialect ruling 6).
 *
 * The rule set is the mechanical §66.21 class — compiler/src/commands/fix-s66.js (see its header
 * for every rule, the write analysis, and the blocker list). A construct the rules cannot rewrite
 * mechanically is LEFT UNTOUCHED and REPORTED (`path:line rule: reason`), never guessed.
 *
 * TWO TIERS (S239 review of 1f9de1f08, HIGH 1). impl#1 is the only compiler adopters run, and it
 * does NOT implement the §66 opener dialect. So:
 *   - DEFAULT — only the rules whose output impl#1 compiles: pre-migrate, program-wrap,
 *     program-move, unwrap-logic. Each is verified per file by an impl#1 compile of the file IN ITS
 *     PROJECT (entry + resolved imports) and withdrawn on any diagnostic change.
 *   - `--s66` — adds the §66 declaration rules (rhs-decl, const-cell, engine-simple). Their output
 *     is the §66 dialect, which impl#1 CANNOT compile; `--s66` is dry-run unless `--write` is also
 *     given, and always prints that warning. (The bootstrap conformance counter calls fix-s66.js
 *     directly with every rule — it is not affected by this CLI default.)
 *
 * Usage:
 *   scrml fix <file|dir> [options]
 *
 * Options:
 *   --dry-run            Print a unified-style diff to stdout; write nothing
 *   --check              Write nothing; exit 1 if any file would change, else 2 if a reported
 *                        construct was left untouched, else 0 (CI-friendly)
 *   --s66                Add the §66 declaration rules (impl#1 cannot compile the result); dry-run
 *                        unless --write
 *   --write              With --s66: actually write the §66 rewrite
 *   --entry              Treat every file as an application entry (program-wrap applies)
 *   --no-program-wrap    Never wrap a file in <program>
 *   --rules=<a,b,...>    Restrict to these rules (default: all — see fix-s66.js S66_RULES)
 *   --json               Print a JSON report (per file: applied rules, blockers) to stdout
 *   --help, -h           Show this message
 *
 * Entry files: a file with a top-level `<program>` is an entry. A file without one is wrapped in
 * `<program>` only when it is application-shaped — it declares no `export`, it is not under a
 * `pages/` or `routes/` directory, and it has top-level markup — or when `--entry` is given. The
 * classification is printed for every wrapped file.
 *
 * Exit status: 0 (blockers are reported, not fatal) · with --check: 1 when a file would change,
 * 2 when nothing would change but a reported construct remains untouched · 1 on a usage / read
 * error.
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "fs";
import { resolve, join, relative, sep, dirname } from "path";
import { fixS66, S66_RULES, IMPL1_SAFE_RULES, S66_DECL_RULES, moduleEdges } from "./fix-s66.js";

const HELP = `scrml fix <file|dir> [options]

Apply the mechanical §66.21 rewrites. A construct that is not mechanically rewritable is left
untouched and reported.

DEFAULT rules (${IMPL1_SAFE_RULES.join(", ")}): their output still compiles with
today's compiler, and each rewrite is verified by compiling the file in its project — a rewrite
that changes what the compiler reports is withdrawn and reported.

--s66 adds the §66 declaration rules (${S66_DECL_RULES.join(", ")}). Their output is the §66 opener
dialect, which TODAY'S COMPILER CANNOT COMPILE. --s66 is a preview: dry-run unless --write is given.

Options:
  --dry-run            Print a diff; write nothing
  --check              Write nothing; exit 1 if a file would change, else 2 if a reported construct
                       was left untouched, else 0
  --s66                Add the §66 declaration rules (dry-run unless --write; output not compilable today)
  --write              With --s66: write the §66 rewrite in place
  --entry              Treat every file as an application entry (program-wrap applies)
  --no-program-wrap    Never wrap a file in <program>
  --rules=<a,b,...>    Restrict to these rules (the declaration rules need --s66): ${S66_RULES.join(", ")}
  --json               Print a JSON report to stdout
  --help, -h           Show this message
`;

const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", ".tmp"]);

function collect(root) {
  const st = statSync(root);
  if (st.isFile()) return root.endsWith(".scrml") ? [root] : [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) { if (!EXCLUDE_DIRS.has(e)) stack.push(p); }
      else if (e.endsWith(".scrml")) out.push(p);
    }
  }
  return out.sort();
}

/**
 * Is a file without `<program>` application-shaped (so program-wrap applies)? Deterministic:
 * no `export` declaration, not under pages/ or routes/, and some top-level markup.
 * @returns {{ entry: boolean, why: string }}
 */
export function classifyEntry(source, relPath) {
  if (/<program\b/.test(source)) return { entry: true, why: "has a <program>" };
  const segs = relPath.split(sep).join("/").split("/");
  if (segs.includes("pages") || segs.includes("routes")) return { entry: false, why: "under pages/ or routes/ (route file)" };
  if (/(^|[\s{;])export\s/.test(source)) return { entry: false, why: "declares an export (module file)" };
  if (!/^\s*<(?!\/)[A-Za-z]/m.test(source.replace(/\$\{[\s\S]*?\}/g, ""))) return { entry: false, why: "no top-level markup" };
  return { entry: true, why: "no export, not a route, has top-level markup (application entry)" };
}

/**
 * A file's project, as the compiler resolves it: every `.scrml` file impl#1 reaches through its
 * import graph from the file (transitively, read from disk), plus `extra` if given. Edges come from
 * impl#1 itself — its front end's AST and its module resolver (fix-s66.js `moduleEdges`); no text
 * scanner (S239 re-review r4). Keys are absolute paths. An import that does not resolve is left
 * out — fixS66 sees it as unresolved and treats every cell as written (the safe direction).
 */
const READ_CACHE = new Map();
function readCached(f) {
  if (!READ_CACHE.has(f)) READ_CACHE.set(f, readFileSync(f, "utf8"));
  return READ_CACHE.get(f);
}

export function resolveProject(file, extra = []) {
  const out = {};
  const seen = new Set([resolve(file)]);
  const queue = [resolve(file), ...extra.map((p) => resolve(p))];
  while (queue.length) {
    const f = queue.shift();
    let src;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    if (f !== resolve(file)) out[f] = src;
    for (const target of moduleEdges(f, src).edges) {
      if (!seen.has(target) && target.endsWith(".scrml") && existsSync(target)) { seen.add(target); queue.push(target); }
    }
    for (const p of extra) seen.add(resolve(p));
  }
  return out;
}

/** A minimal line diff (LCS) in unified style. */
export function lineDiff(a, b, label) {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [`--- ${label}`, `+++ ${label} (fixed)`];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; continue; }
    out.push(`@@ line ${i + 1} @@`);
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) break;
      if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) out.push(`-${A[i++]}`);
      else out.push(`+${B[j++]}`);
    }
  }
  return out.join("\n");
}

export function parseFixArgs(args) {
  const o = { targets: [], dryRun: false, check: false, entry: false, noWrap: false, rules: null, json: false, help: false, s66: false, write: false };
  for (const a of args) {
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--check") o.check = true;
    else if (a === "--entry") o.entry = true;
    else if (a === "--no-program-wrap") o.noWrap = true;
    else if (a === "--json") o.json = true;
    else if (a === "--s66") o.s66 = true;
    else if (a === "--write") o.write = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--rules=")) o.rules = a.slice(8).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else o.targets.push(a);
  }
  if (o.rules) for (const r of o.rules) if (!S66_RULES.includes(r)) throw new Error(`unknown rule '${r}' (rules: ${S66_RULES.join(", ")})`);
  if (o.rules && !o.s66) {
    const decl = o.rules.filter((r) => S66_DECL_RULES.includes(r));
    if (decl.length) throw new Error(`rule(s) ${decl.join(", ")} produce the §66 dialect, which impl#1 cannot compile — pass --s66 to preview them`);
  }
  if (o.write && !o.s66) throw new Error("--write is only for --s66 (the default rules write in place already)");
  // --s66 is a preview unless --write: its output does not compile with today's compiler.
  if (o.s66 && !o.write && !o.check) o.dryRun = true;
  return o;
}

/** Run `scrml fix` over the given args. Returns the exit code (the CLI calls process.exit). */
export function runFixCommand(args, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  let o;
  try {
    o = parseFixArgs(args);
  } catch (e) {
    io.err(`scrml fix: ${e.message}`);
    return 1;
  }
  if (o.help || o.targets.length === 0) {
    io.out(HELP);
    return o.help ? 0 : 1;
  }
  const cwd = process.cwd();
  const report = [];
  let wouldChange = 0;
  if (o.s66) {
    io.err("scrml fix --s66: WARNING — the §66 declaration rules emit the §66 opener dialect, which today's compiler (impl#1) cannot compile."
      + (o.write ? " Writing in place (--write)." : " Preview only (dry-run); pass --write to write it."));
  }
  for (const t of o.targets) {
    const root = resolve(cwd, t);
    if (!existsSync(root)) { io.err(`scrml fix: no such file or directory: ${t}`); return 1; }
    const files = collect(root);
    for (const file of files) {
      const rel = relative(cwd, file) || file;
      const source = readFileSync(file, "utf8");
      const cls = o.entry ? { entry: true, why: "--entry" } : classifyEntry(source, rel);
      let rules = o.rules ?? (o.s66 ? [...S66_RULES] : [...IMPL1_SAFE_RULES]);
      if (o.noWrap) rules = rules.filter((r) => r !== "program-wrap");
      // The file's project (entry + resolved imports + the other target files): its writes count
      // toward this file's cells, and the verify compile runs with the whole project beside it.
      // auxSources: the import closure (beside the file in the verify compile); scanSources: the
      // other target files, read only for writes (a component file can write an ambient cell).
      const project = resolveProject(file);
      const scan = {};
      if (rules.some((x) => S66_DECL_RULES.includes(x))) for (const f of files) if (f !== file && !(f in project)) scan[f] = readCached(f);
      const r = fixS66(source, { filePath: file, entry: cls.entry, rules, auxSources: project, scanSources: scan });
      report.push({ file: rel, entry: cls.entry, entryWhy: cls.why, changed: r.changed, applied: r.applied, blockers: r.blockers });
      if (!o.json) {
        for (const b of r.blockers) io.err(`${rel}:${b.line} ${b.rule}: ${b.reason}${b.snippet ? `  [${b.snippet}]` : ""}`);
        if (r.applied.some((a) => a.rule === "program-wrap")) {
          io.err(`${rel}: wrapped in <program reset="none"> — ${cls.why}`);
          // impl#1 emits the §65.3.4 reset layer only for a declared <program>; the wrap writes
          // <program reset="none"> so the page renders exactly as before (S451 ruling, fork b = 2).
          io.err(`${rel}: note — reset="none" preserves the old styling (impl#1 added no §65.3.4 CSS reset to this file); delete the attribute to opt into the reset`);
        }
      }
      if (!r.changed) continue;
      wouldChange++;
      if (o.dryRun && !o.json) io.out(lineDiff(source, r.output, rel));
      if (!o.dryRun && !o.check) writeFileSync(file, r.output);
    }
  }
  if (o.json) io.out(JSON.stringify({ files: report }, null, 2));
  else {
    const blocked = report.filter((f) => f.blockers.length > 0).length;
    io.err(`scrml fix: ${report.length} file(s) · ${wouldChange} ${o.dryRun || o.check ? "would change" : "changed"} · ${blocked} with constructs left for a human`);
  }
  if (!o.check) return 0;
  if (wouldChange > 0) return 1;
  return report.some((f) => f.blockers.length > 0) ? 2 : 0;
}

export async function runFix(args) {
  process.exit(runFixCommand(args));
}
