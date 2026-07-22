// scripts/facts.ts — U2 of the marketing claim-gate. change-id: marketing-claim-gate
//
// THREE MODES (mirrors scripts/state.ts exactly — same anchor contract, same exit semantics):
//   `bun scripts/facts.ts`         PRINT  — read-only report of every derived fact.
//   `bun scripts/facts.ts --write` WRITE  — in-place-regenerate the `@generated:*` sections of
//                                           docs/FACTS.md from the derive functions. Idempotent.
//   `bun scripts/facts.ts --check` CHECK  — regenerate in memory + compare to on-disk; exit 1 on
//                                           any stale section. Wired into CI `gate`.
//
// WHY (S280): public content makes CLAIMS, and a number that was true when written rots silently.
// The C2 (derived-number) half of the claim taxonomy: "745 conformance cases", "21-module standard
// library", "~36,000 lines of specification" are all mechanically derivable from the repo — so a
// marketing doc SHALL cite this file rather than hardcode a figure that decays.
//
// DETERMINISM IS THE HARD CONSTRAINT. Every fact below is derived from repo content at a given
// commit and nothing else. Deliberately EXCLUDED, because they change without a commit and would
// make `--check` flap red for reasons no PR caused:
//   - GitHub stars / forks / clone traffic
//   - open/closed adopter issue counts (`gh issue list`)
//   - test pass counts (require a run; the suite is the gate's job, not a published figure)
// Also excluded: the §34 diagnostic-code total. It is genuinely load-bearing but not reliably
// extractable — a naive scan from the §34 heading to EOF over-counts by catching later tables, and
// a wrong number in a file whose entire purpose is accuracy is worse than an absent one.
//
// House style mirrors scripts/state.ts (plain bun-run TS, readFileSync, anchor find/replace).

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, dirname, relative, extname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p: string) => relative(ROOT, p) || p;
const read = (p: string) => readFileSync(p, "utf8");

// ---------------------------------------------------------------- derive fns

function compilerVersion(): string {
  return JSON.parse(read(join(ROOT, "package.json"))).version;
}

function specLines(): number {
  return read(join(ROOT, "compiler/SPEC.md")).split("\n").length - 1;
}

/** Conformance cases = every `expected.json` under conformance/cases (the case IS the assertion). */
function conformanceCases(): number {
  let n = 0;
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
      return;
    }
    if (p.endsWith("expected.json")) n++;
  };
  walk(join(ROOT, "conformance/cases"));
  return n;
}

/** Directories under stdlib/ — each is an importable `scrml:<name>` module. */
function stdlibModules(): string[] {
  const d = join(ROOT, "stdlib");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((e) => statSync(join(d, e)).isDirectory())
    .sort();
}

/** CLI verbs = compiler/src/commands/*.js, minus non-verb helper modules. */
function cliVerbs(): string[] {
  const d = join(ROOT, "compiler/src/commands");
  if (!existsSync(d)) return [];
  const NOT_A_VERB = new Set(["module-format-notice"]);
  return readdirSync(d)
    .filter((e) => extname(e) === ".js")
    .map((e) => e.replace(/\.js$/, ""))
    .filter((v) => !NOT_A_VERB.has(v))
    .sort();
}

/** LSP capabilities actually registered in the server. */
function lspProviders(): string[] {
  const p = join(ROOT, "lsp/server.js");
  if (!existsSync(p)) return [];
  const hits = read(p).match(/([a-zA-Z]+)Provider\s*:/g) ?? [];
  // `resolveProvider: true` is a sub-option of completionProvider, not a capability.
  const NOT_A_CAPABILITY = new Set(["resolve"]);
  return [...new Set(hits.map((h) => h.replace(/Provider\s*:/, "")))]
    .filter((c) => !NOT_A_CAPABILITY.has(c))
    .sort();
}

/** Editor integrations = directories under editors/. */
function editorIntegrations(): string[] {
  const d = join(ROOT, "editors");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((e) => statSync(join(d, e)).isDirectory())
    .sort();
}

/** `scrml build --target` values recognised by the build command. */
function deployTargets(): string[] {
  const p = join(ROOT, "compiler/src/commands/build.js");
  if (!existsSync(p)) return [];
  const src = read(p);
  const known = ["docker", "fly", "railway", "render"];
  return known.filter((t) => new RegExp(`["'\`]${t}["'\`]`).test(src)).sort();
}

/** Public code samples under the snippet gate (scripts/snippet-gate.js corpus). */
function gatedSnippets(): number {
  let n = 0;
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
      return;
    }
    if (extname(p) === ".scrml") n++;
  };
  for (const r of ["docs/tutorial-snippets", "docs/readme-snippets"]) walk(join(ROOT, r));
  return n;
}

// ------------------------------------------------------------ generated docs

type GenSection = { name: string; file: string; produce: () => string };

const FACTS_MD = join(ROOT, "docs/FACTS.md");

const GEN_SECTIONS: GenSection[] = [
  {
    name: "facts-table",
    file: FACTS_MD,
    produce: () => {
      const stdlib = stdlibModules();
      const verbs = cliVerbs();
      const lsp = lspProviders();
      const editors = editorIntegrations();
      const targets = deployTargets();
      return [
        `| fact | value |`,
        `|---|---|`,
        `| compiler version | \`${compilerVersion()}\` |`,
        `| specification lines (\`compiler/SPEC.md\`) | ${specLines().toLocaleString("en-US")} |`,
        `| conformance cases | ${conformanceCases()} |`,
        `| standard-library modules | ${stdlib.length} |`,
        `| CLI verbs | ${verbs.length} |`,
        `| LSP capabilities | ${lsp.length} |`,
        `| editor integrations | ${editors.length} |`,
        `| deploy targets | ${targets.length} |`,
        `| public code samples under the compile gate | ${gatedSnippets()} |`,
      ].join("\n");
    },
  },
  {
    name: "facts-lists",
    file: FACTS_MD,
    produce: () => {
      const fmt = (xs: string[]) => xs.map((x) => `\`${x}\``).join(" · ");
      return [
        `**Standard-library modules** (${stdlibModules().length}) — ${fmt(stdlibModules())}`,
        ``,
        `**CLI verbs** (${cliVerbs().length}) — ${fmt(cliVerbs())}`,
        ``,
        `**LSP capabilities** (${lspProviders().length}) — ${fmt(lspProviders())}`,
        ``,
        `**Editor integrations** (${editorIntegrations().length}) — ${fmt(editorIntegrations())}`,
        ``,
        `**Deploy targets** (${deployTargets().length}) — ${fmt(deployTargets())}`,
      ].join("\n");
    },
  },
];

// --------------------------------------------------------------- anchor logic

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findSpan(text: string, name: string) {
  const startRe = new RegExp(`<!--\\s*@generated:${escapeRe(name)}\\s+START\\b[^>]*-->`);
  const endRe = new RegExp(`<!--\\s*@generated:${escapeRe(name)}\\s+END\\b[^>]*-->`);
  const s = startRe.exec(text);
  const e = endRe.exec(text);
  if (!s || !e) return null;
  const startMarkerEnd = s.index + s[0].length;
  if (e.index < startMarkerEnd) return null;
  const from = text.indexOf("\n", startMarkerEnd) + 1;
  const to = text.lastIndexOf("\n", e.index);
  // `to === from - 1` is the EMPTY region (markers on adjacent lines) — legal, and the
  // shape a freshly-authored anchor pair has before its first --write.
  if (from <= 0 || to < from - 1) return null;
  return { from, to, current: to < from ? "" : text.slice(from, to) };
}

const eolNorm = (s: string) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");

// ---------------------------------------------------------------------- main

const args = process.argv.slice(2);
const write = args.includes("--write");
const check = args.includes("--check");

if (!write && !check) {
  console.log("scrml — derived public facts (PRINT mode)\n");
  for (const sec of GEN_SECTIONS) console.log(sec.produce() + "\n");
  console.log(`(write them into ${rel(FACTS_MD)} with --write; gate with --check)`);
  process.exit(0);
}

const stale: string[] = [];
const missing: string[] = [];
const ok: string[] = [];
const byFile = new Map<string, string>();

for (const sec of GEN_SECTIONS) {
  const text = byFile.get(sec.file) ?? (existsSync(sec.file) ? read(sec.file) : null);
  if (text === null) {
    missing.push(`${rel(sec.file)} (file absent)`);
    continue;
  }
  const span = findSpan(text, sec.name);
  if (!span) {
    missing.push(`@generated:${sec.name} (in ${rel(sec.file)})`);
    byFile.set(sec.file, text);
    continue;
  }
  const fresh = sec.produce();
  if (eolNorm(span.current) === eolNorm(fresh)) {
    ok.push(`@generated:${sec.name} (${rel(sec.file)})`);
    byFile.set(sec.file, text);
    continue;
  }
  stale.push(`@generated:${sec.name} (${rel(sec.file)})`);
  byFile.set(sec.file, text.slice(0, span.from) + fresh + "\n" + text.slice(span.to + 1));
}

if (write) {
  for (const [file, text] of byFile) writeFileSync(file, text);
  for (const s of ok) console.log(`  already current — ${s}`);
  for (const s of stale) console.log(`  regenerated — ${s}`);
  for (const m of missing) console.log(`  ⚠ MISSING anchor — ${m}`);
  console.log("\n--write: done.");
  process.exit(missing.length > 0 ? 1 : 0);
}

// --check
for (const s of ok) console.log(`  PASS  ${s}`);
for (const s of stale) console.error(`  STALE ${s}`);
for (const m of missing) console.error(`  MISSING ${m}`);
if (stale.length > 0 || missing.length > 0) {
  console.error(
    `\nFAIL — docs/FACTS.md is out of date with the repo. Run \`bun scripts/facts.ts --write\`.\n` +
      `Public documents cite these numbers; a stale figure is a false public claim.`,
  );
  process.exit(1);
}
console.log("\nPASS — all derived facts current.");
process.exit(0);
