#!/usr/bin/env bun
/**
 * scripts/source-text-regex-census.ts — the probe for the post-AST source-text rule.
 *
 * WHY THIS EXISTS (S338). Five adversarial reviews across two unrelated branches in one
 * session found the same substitution every time: **a text-level shortcut standing in for a
 * structural one** — a regex asked a question that the parsed tree, already in hand, could
 * have answered. Five instances, different files, different authors, no coordination:
 *
 *   - a `wired` classification table validated by COUNTING TEXT OCCURRENCES (and circularly:
 *     the delta it measured included the declaration that existed only because the table had
 *     already said "wired")
 *   - `bareAttrValueIsWired` restating codegen's `name.startsWith("on")` as `/^on[a-z]/`,
 *     which then drifted on `on=`, `on-tap=`, `on_tap=`
 *   - an `import.meta` fence regexing source text TWO LINES BEFORE the `parseExprToNode` call
 *     that would have answered it structurally
 *   - `bareBindingReferenceOf` anchored on the trimmed RHS source text, so `(@v)` defeated a
 *     guard that `@v` tripped
 *   - a lifecycle variant branch matching `.Published` inside a STRING LITERAL
 *
 * None was caught by a 22,385-test suite or a 7,375-artifact differential. The class is
 * invisible to differentials by construction: a regex over source text is indistinguishable
 * from a correct check until someone writes a string literal.
 *
 * THE RULE THIS PROBE READS (ruled by bryan, S338 — "b, and c for the 7-site cluster"):
 *   A regex applied to SOURCE TEXT in a POST-AST stage requires a one-line justification, or
 *   the structural route. Binds NEW-OR-TOUCHED code only. Detection is a RATIO, not an
 *   inspection. It is deliberately NOT a CI gate.
 *
 * WHAT IS AND IS NOT A DEFECT. A regex over source text in the tokenizer, block-splitter,
 * ast-builder, expression-parser or native-parser is CORRECT — turning text into structure is
 * their job. The defect class is a stage that ALREADY HOLDS THE PARSED TREE asking the text
 * instead. That partition is the whole point; the raw count of regexes (11,196 literals at the
 * time of writing) is worthless and must never be quoted.
 *
 * ⚠ THIS PROBE REPORTS A FLOOR, NOT A COUNT — state that wherever you quote it.
 * It keys on identifier NAMES, so it cannot see `postRe.test(t)` — which is exactly where the
 * confirmed pre-existing defect at `type-system.ts:26048` lives. The opaque-argument population
 * is reported separately and is UNCLASSIFIABLE by this instrument. The author of this script
 * built a name-pattern-matching probe to detect the practice of pattern-matching instead of
 * resolving structure, and it inherited the same blind spot; that is recorded rather than
 * smoothed over, per the S338 delta-log.
 *
 * A STRUCTURAL SUCCESSOR would walk the TypeScript AST and resolve each regex argument to its
 * declared type + origin, rather than guessing from its name. That is the by-construction form
 * and it is the honest upgrade path.
 *
 * MODES:
 *   bun scripts/source-text-regex-census.ts            summary + the full post-AST population
 *   bun scripts/source-text-regex-census.ts --summary  totals only
 *   bun scripts/source-text-regex-census.ts --json     machine-readable
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "compiler", "src");

/** Stages whose JOB is turning text into structure. A regex on text here is CORRECT. */
const PRE_AST_MARKERS = [
  "tokenizer", "block-splitter", "block-preprocessor", "ast-builder", "expression-parser",
  "native-parser/", "engine-statechild-parser", "match-statechild-parser", "preprocess",
  "lint-ghost-patterns", "tailwind-classes", "sql-lex", "commands/migrate", "commands/promote",
  "runtime-template", "meta-eval", "attr",
];
const isPreAst = (rel: string) => PRE_AST_MARKERS.some((p) => rel.includes(p));

const SRC_ARG_STRONG =
  /\b\w*(raw|rawtext|sourcetext|srctext|bodyraw|rulesraw|inittrim|exprtext|opener|argstr|stmttext|codetext)\w*\b/i;
const SRC_ARG_LOOSE =
  /^(raw|text|body|src|source|code|init|initTrim|expr|exprText|stmt|opener|content|slice|line|decl|rules|snippet)([A-Z]\w*)?$/;
const NOT_SRC = /(path|file|dir|url|msg|message|label|classname|version|hash|selector|tagname)/i;
/** Args this instrument CANNOT classify — the honest blind spot. */
const OPAQUE = /^(t|s|v|x|y|n|a|b|c|txt|str|val|tmp)$/;

const CALL =
  /(?:\.(test|exec)\s*\(\s*([A-Za-z_$][\w$.]*)|([A-Za-z_$][\w$.]*)\s*\.\s*(match|search)\s*\(\s*(?:\/|new RegExp))/g;

const isGate = (ln: string) =>
  /\bif\s*\(/.test(ln) || /\breturn\b/.test(ln) || /[?]\s*[^:]*:/.test(ln) ||
  /&&|\|\|/.test(ln) || /\bwhile\s*\(/.test(ln) || /\.(some|every|filter|find)\s*\(/.test(ln);

type Hit = { file: string; line: number; arg: string; kind: string; text: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules") walk(p, out); }
    else if (/\.(ts|js)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const preAst: Hit[] = [], postAst: Hit[] = [], opaque: Hit[] = [];
let lines = 0, calls = 0;

for (const f of files) {
  const rel = f.replace(ROOT + "/", "");
  const src = readFileSync(f, "utf8").split("\n");
  lines += src.length;
  src.forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    let m: RegExpExecArray | null; CALL.lastIndex = 0;
    while ((m = CALL.exec(ln))) {
      calls++;
      const arg = (m[2] || m[3] || "").trim();
      const kind = m[1] || m[4];
      if (!arg || NOT_SRC.test(arg) || !isGate(ln)) continue;
      const hit: Hit = { file: rel, line: i + 1, arg, kind, text: ln.trim().slice(0, 160) };
      const last = arg.split(".").pop() || arg;
      if (OPAQUE.test(last)) { if (!isPreAst(rel)) opaque.push(hit); continue; }
      if (!(SRC_ARG_STRONG.test(arg) || SRC_ARG_LOOSE.test(last))) continue;
      (isPreAst(rel) ? preAst : postAst).push(hit);
    }
  });
}

const byFile = new Map<string, Hit[]>();
for (const h of postAst) { if (!byFile.has(h.file)) byFile.set(h.file, []); byFile.get(h.file)!.push(h); }

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ files: files.length, lines, calls, preAst: preAst.length,
    postAst: postAst.length, opaqueUnclassifiable: opaque.length, postAstFiles: byFile.size,
    isFloor: true, hits: postAst }, null, 2));
} else {
  console.log(`source-text-regex census — compiler/src   (DETECTION, not a gate)`);
  console.log(`  files / lines                        : ${files.length} / ${lines.toLocaleString()}`);
  console.log(`  regex-applied-to-a-value call sites  : ${calls}`);
  console.log();
  console.log(`  PRE-AST  (legitimate — text→structure IS the job) : ${preAst.length}`);
  console.log(`  POST-AST (the rule's population)                  : ${postAst.length}  across ${byFile.size} files`);
  console.log(`  OPAQUE-ARG, post-AST (UNCLASSIFIABLE by this probe): ${opaque.length}`);
  console.log();
  console.log(`  ⚠ ${postAst.length} IS A FLOOR, NOT A COUNT. This probe keys on identifier NAMES; it cannot`);
  console.log(`    see \`postRe.test(t)\` — the site of the confirmed defect at type-system.ts:26048.`);
  console.log(`    Quote it as a floor or do not quote it.`);
  if (!process.argv.includes("--summary")) {
    console.log(`\nPOST-AST POPULATION, BY FILE — complete, no truncation:`);
    for (const [f, hs] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${f}  (${hs.length})`);
      for (const h of hs) console.log(`    :${h.line}  [${h.kind} on ${h.arg}]  ${h.text}`);
    }
  }
}
