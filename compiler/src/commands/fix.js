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
 *   - DEFAULT — only the rules whose output impl#1 compiles: pre-migrate, arm-pipe (§19.4.5, the
 *     `|`-led `!{}` / message arm — commands/fix-arm-pipe.js), is-some (§42.2.2a / §55.1, S462:
 *     `x is some` and the validator `<x is some>` → `is given` — commands/fix-is-some.js), client-server-call (§19.9.10, an
 *     unhandled client call of a server function → `!{ .Transport(_) :> return }` —
 *     commands/fix-client-server-call.js), sql-failable (§19.8.3, an unhandled `?{}` READ outside a
 *     `!` function → `!{ _ :> not }` / `!{ _ :> [] }`; every write is listed, never rewritten — S455
 *     "b your rec on R11" — commands/fix-sql-failable.js), program-wrap, program-move, unwrap-logic. Each is verified per file by an impl#1 compile of the file IN ITS PROJECT
 *     (entry + resolved imports) and withdrawn on any diagnostic change.
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
 * A file that does not compile is REFUSED (S464 ruling "your recs"; §63.4): no rule runs on it and
 * nothing is written; its compile errors are printed (code + line) and the file is listed in the
 * summary. The rest of a directory proceeds. A file that compiles with warnings is not refused.
 *
 * Exit status: 0 (blockers are reported, not fatal) · with --check: 1 when a file would change,
 * 2 when nothing would change but a reported construct remains untouched · 1 on a usage / read
 * error · 3 when any file was refused (does not compile) — in every mode, ahead of 1 / 2.
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "fs";
import { resolve, join, relative, sep, dirname } from "path";
import { fixS66, S66_RULES, IMPL1_SAFE_RULES, S66_DECL_RULES, moduleEdges } from "./fix-s66.js";
import { compileErrorsTogether, COMPILE_THREW } from "./fix-verify-shared.js";

const HELP = `scrml fix <file|dir> [options]

Apply the mechanical §63 deprecation rewrites (the §66.21 declaration class; arm-pipe: a
\`|\`-led \`!{}\` / engine message arm → the §18.2 match arm, §19.4.5; is-some: \`x is some\`
and the validator \`<x is some>\` → \`is given\`, §42.2.2a / §55.1; given-presence: the in-place
\`given x, y :> { … }\` guard → \`if (x is given && y is given) { … }\` and a \`given x :>\` match arm →
\`else :>\`, §42.2.3; client-server-call: an
unhandled client call of a server function → \`f() !{ .Transport(_) :> return }\`, §19.9.10;
sql-failable: an unhandled \`?{}\` READ in a server function that is not \`!\` →
\`?{…}.get() !{ _ :> not }\` / \`.all() !{ _ :> [] }\`, §19.8.3; every WRITE — any \`.run()\`, a bare
\`?{}\` statement, any query not provably a pure read — is LISTED for a human, never rewritten).
A construct that is not mechanically rewritable is left untouched and reported; an "info" line
marks a rewrite whose meaning differs (a client function's callers no longer abort; a failed read
no longer throws on today's compiler — it yields \`not\` / \`[]\`).

A file that does not compile is REFUSED: no rule runs, nothing is written, and its compile errors
are listed (a rewrite of a file the compiler cannot fully read cannot be verified). Fix the errors
first. Warnings do not refuse. In a directory the other files proceed; the exit status is then 3.

DEFAULT rules (${IMPL1_SAFE_RULES.join(", ")}): their output still compiles with
today's compiler, and each rewrite is verified by compiling the file in its project — a rewrite
that changes what the compiler reports is withdrawn and reported.

--s66 adds the §66 declaration rules (${S66_DECL_RULES.join(", ")}). Their output is the §66 opener
dialect, which TODAY'S COMPILER CANNOT COMPILE. --s66 is a preview: dry-run unless --write is given.

Options:
  --dry-run            Print a diff; write nothing
  --check              Write nothing; exit 1 if a file would change, else 2 if a reported construct
                       was left untouched, else 0 (3 if a file was refused, in every mode)
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

/**
 * The rule run of one file, as the CLI does it AFTER its does-it-compile gate (the gate is the
 * caller's: `runFixCommand` refuses a file that does not compile and never calls this for it).
 * Exported so the §66 write analysis can be tested on project shapes impl#1 does not compile
 * (a missing import, a `vendor:` component) — those are refused by the CLI, but the analysis keeps
 * its fail-closed behaviour for the other callers of fixS66 (the bootstrap twin generator).
 * @param {string} file     absolute path
 * @param {string} source   its text
 * @param {string} rel      the path as printed (entry classification reads it)
 * @param {object} o        parsed options (parseFixArgs)
 * @param {string[]} files  every target file of the run (scanned for writes by the §66 rules)
 */
export function applyFixRules(file, source, rel, o, files = [file], extra = {}) {
  const cls = o.entry ? { entry: true, why: "--entry" } : classifyEntry(source, rel);
  const rules = effectiveRules(o);
  // The file's project (entry + resolved imports + the other target files): its writes count
  // toward this file's cells, and the verify compile runs with the whole project beside it.
  // auxSources: the import closure (beside the file in the verify compile); scanSources: the
  // other target files, read only for writes (a component file can write an ambient cell).
  const project = resolveProject(file);
  const scan = {};
  if (rules.some((x) => S66_DECL_RULES.includes(x))) for (const f of files) if (f !== file && !(f in project)) scan[f] = readCached(f);
  const r = fixS66(source, { filePath: file, entry: cls.entry, rules, auxSources: project, scanSources: scan, inPlaceClean: extra.inPlaceClean === true });
  return { cls, r };
}

/**
 * The does-it-compile gate of one target (S464 ruling; S466 review): which of `files` are refused,
 * with the error-severity diagnostics that refuse each, judged the way `scrml compile` judges the
 * target.
 *   - A file target: `scrml compile <file>` — any error refuses it.
 *   - A directory: the target files compiled TOGETHER (`scrml compile <dir>`); a file is refused on
 *     the errors of itself and of the modules it imports (`resolveProject`). One file's error can stop the compile before a later check runs for the others
 *     (the emitted-JS parse check is skipped once any error is reported), so the refused files are
 *     dropped and the rest compiled again, until a compile refuses no further file. When only
 *     errors that name no file remain — or the joint compile CRASHES — each remaining file is
 *     judged by its own compile (`jointNote` says why).
 * pre-migrate exists to clear E-DEPRECATED-001 (impl#1's hard error on `<machine>`): while it runs,
 * that code alone does not refuse; pre-migrate then requires the migrated file to compile (fix-s66.js).
 * @returns {{ refused: Map<string, object[]>, clean: boolean }} `clean`: the last compile of the
 *   files that were not refused reported no error at all (so a rule's scratch compile that errors
 *   is a divergence of the scratch copy, not a file that does not compile).
 */
export function judgeTargets(files, isDir, rules) {
  const tolerated = (d) => rules.includes("pre-migrate") && d.code === "E-DEPRECATED-001";
  const refused = new Map();
  if (!isDir) {
    const diags = compileErrorsTogether(files);
    const errs = diags.filter((d) => !tolerated(d));
    for (const f of files) if (errs.length > 0) refused.set(f, errs);
    return { refused, clean: diags.length === 0 };
  }
  const own = new Map();
  const ownOf = (f) => {
    if (!own.has(f)) own.set(f, new Set([f, ...Object.keys(resolveProject(f))]));
    return own.get(f);
  };
  // Each file by its own compile (`scrml compile <file>`): the fallback when the joint compile
  // reports only errors that name no file, or crashes.
  const judgeEach = (fs) => {
    let allClean = true;
    for (const f of fs) {
      const mine = compileErrorsTogether([f]);
      if (mine.length > 0) allClean = false;
      const errs = mine.filter((d) => !tolerated(d));
      if (errs.length > 0) refused.set(f, errs);
    }
    return allClean;
  };
  let remaining = [...files];
  let clean = true;
  while (remaining.length > 0) {
    const diags = compileErrorsTogether(remaining);
    clean = diags.length === 0;
    const errs = diags.filter((d) => !tolerated(d));
    if (errs.length === 0) break;
    if (remaining.length === 1) { refused.set(remaining[0], errs); break; }
    // Errors that name a file refuse that file and every file importing it; the rest is compiled again.
    let newly = 0;
    for (const f of remaining) {
      const mine = errs.filter((d) => d.file !== null && ownOf(f).has(d.file));
      if (mine.length > 0) { refused.set(f, mine); newly++; }
    }
    if (newly > 0) { remaining = remaining.filter((f) => !refused.has(f)); continue; }
    // Only errors that name no file are left (measured S466: E-IMPORT-002 / E-CG-003 / E-TYPE-031 /
    // E-META-EVAL-002 / E-VALIDATOR-INLINE-DYNAMIC carry no file in a joint compile of
    // conformance/cases), or the compiler CRASHED on the set (`scrml compile samples`, 881 unrelated
    // files, overflows the stack). Such an error says nothing about which file it belongs to, so it
    // refuses none by itself: each remaining file is judged by its own compile.
    const threw = errs.find((d) => d.code === COMPILE_THREW);
    const allClean = judgeEach(remaining);
    return {
      refused, clean: allClean,
      jointNote: threw ? `crashes on these files together (${threw.message})` : `reports ${errs.length} error(s) that name no file (${[...new Set(errs.map((d) => d.code))].join(", ")})`,
    };
  }
  return { refused, clean };
}

/** The rules a run applies (parsed options → rule names). */
export function effectiveRules(o) {
  let rules = o.rules ?? (o.s66 ? [...S66_RULES] : [...IMPL1_SAFE_RULES]);
  if (o.noWrap) rules = rules.filter((r) => r !== "program-wrap");
  return rules;
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
  let refused = 0;
  const notes = [];
  if (o.s66) {
    io.err("scrml fix --s66: WARNING — the §66 declaration rules emit the §66 opener dialect, which today's compiler (impl#1) cannot compile."
      + (o.write ? " Writing in place (--write)." : " Preview only (dry-run); pass --write to write it."));
  }
  for (const t of o.targets) {
    const root = resolve(cwd, t);
    if (!existsSync(root)) { io.err(`scrml fix: no such file or directory: ${t}`); return 1; }
    const files = collect(root);
    // S464 ruling ("your recs"): a file that does not compile BEFORE the rewrite is refused — no
    // rule runs, nothing is written, and its compile errors are named. A rewrite of a file the
    // compiler cannot fully read cannot be verified: every rule's verify compares the compiler's
    // reading before and after, and a broken file's "same errors, no artifacts" passes any rewrite
    // at all (measured S464: unwrap-logic + sql-failable rewrote a file whose other function emits
    // invalid JS). Warnings and info do not refuse. Every rule, every mode (incl. --s66).
    //
    // "Does not compile" is judged the way `scrml compile` judges it (S466 review): the target is
    // compiled AS THE USER WOULD COMPILE IT — `scrml compile <file>` for a file, `scrml compile
    // <dir>` (every target file together) for a directory — once, in place, before anything is
    // written. A single file is refused on any error of that compile. In a directory, a file is
    // refused on the errors of ITSELF and of the modules it imports (its project), not on another
    // file's: a component module that compiles as part of its project is not refused because it
    // does not compile alone. Errors that name no file, or a crash, fall back to judging each file by its own compile (judgeTargets).
    const rules = effectiveRules(o);
    const gate = judgeTargets(files, statSync(root).isDirectory(), rules);
    if (gate.jointNote) notes.push(`scrml compile ${relative(cwd, root) || "."} ${gate.jointNote}; the remaining files were each judged by their own compile`);
    if (gate.jointNote && !o.json) {
      io.err(`scrml fix: note — \`scrml compile ${relative(cwd, root) || "."}\` ${gate.jointNote}; the remaining files were each judged by their own compile`);
    }
    const isDir = statSync(root).isDirectory();
    for (const file of files) {
      const rel = relative(cwd, file) || file;
      const source = readFileSync(file, "utf8");
      const compileErrors = gate.refused.get(file) ?? [];
      if (compileErrors.length > 0) {
        refused++;
        report.push({ file: rel, refused: true, compileErrors: compileErrors.map((d) => ({ ...d, file: d.file ? relative(cwd, d.file) || d.file : null })), changed: false, applied: [], blockers: [], infos: [] });
        if (!o.json) {
          io.err(`${rel}: refused — the file does not compile, so no rewrite can be verified; nothing was changed. Fix these first (\`scrml compile ${isDir ? relative(cwd, root) || "." : rel}\` shows them in full):`);
          for (const d of compileErrors) {
            const where = d.file ? `${relative(cwd, d.file) || d.file}${d.line != null ? `:${d.line}` : ""}` : "(no file)";
            io.err(`  ${where} ${d.code}${d.message ? `: ${d.message}` : ""}`);
          }
        }
        continue;
      }
      const { cls, r } = applyFixRules(file, source, rel, o, files, { inPlaceClean: gate.clean });
      report.push({ file: rel, entry: cls.entry, entryWhy: cls.why, changed: r.changed, applied: r.applied, blockers: r.blockers, infos: r.infos ?? [] });
      if (!o.json) {
        for (const b of r.blockers) io.err(`${rel}:${b.line} ${b.rule}: ${b.reason}${b.snippet ? `  [${b.snippet}]` : ""}`);
        // Only for a file that changes (or would): an info describes a rewrite.
        if (r.changed) for (const i of r.infos ?? []) io.err(`${rel}:${i.line} ${i.rule}: info — ${i.message}`);
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
  if (o.json) io.out(JSON.stringify(notes.length ? { files: report, notes } : { files: report }, null, 2));
  else {
    const blocked = report.filter((f) => f.blockers.length > 0).length;
    io.err(`scrml fix: ${report.length} file(s) · ${wouldChange} ${o.dryRun || o.check ? "would change" : "changed"} · ${blocked} with constructs left for a human`
      + (refused > 0 ? ` · ${refused} refused (does not compile)` : ""));
    if (refused > 0) {
      io.err("scrml fix: refused (fix the compile errors, then run scrml fix again):");
      for (const f of report) if (f.refused) io.err(`  ${f.file}`);
    }
  }
  // A refused file is the most severe outcome — the tool could not assess it at all — in every mode.
  if (refused > 0) return 3;
  if (!o.check) return 0;
  if (wouldChange > 0) return 1;
  return report.some((f) => f.blockers.length > 0) ? 2 : 0;
}

export async function runFix(args) {
  process.exit(runFixCommand(args));
}
