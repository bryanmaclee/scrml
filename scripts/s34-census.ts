#!/usr/bin/env bun
/**
 * §34 catalog census + FALSE-CLAIM triage — is every catalogued diagnostic actually FIREABLE?
 *
 * WHY THIS EXISTS. Per §62.2 the conformance corpus IS the versioned contract, so a catalogued code
 * that cannot fire is a false claim in the contract we are about to freeze — and it inflates the
 * freeze denominator. S305 and S307 found nine such codes BY HAND, one at a time, each by trying to
 * make it fire and failing. This makes the population computable instead of anecdotal.
 *
 * IT IS A TRIAGE, NOT A VERDICT. A code landing in FALSE-CLAIM is a HYPOTHESIS that still owes an
 * execution check (pa-base §8: the empirical gate is the truth, a census never is). What the census
 * IS authoritative about is the negative: zero emitter mentions anywhere means it cannot fire today.
 *
 * -- Probe traps this defeats by construction ----------------------------------------------------
 *  T1 (S305) a retired row is `| ~~CODE~~ |`, so a `^| CODE |` probe returns NO-ROW — the identical
 *            answer it gives for a genuinely UNCATALOGUED code. That conflation inflated the freeze
 *            denominator by 5. STRUCK is its own bucket here.
 *  T2 (S305) `grep '"CODE"'` misses single-quoted pushes; it reported ZERO sites for three LIVE
 *            codes. The emitter scan is quote-agnostic (raw token match).
 *  T3 (S310) scanning too few trees. A first cut over compiler/src + native-parser alone reported 121
 *            dead; widening to every source tree gave 104 and split out 17 that live only in
 *            tests/tooling — i.e. 17 false dead-code claims averted.
 *  T4 (S310) attributing Nominal status to whichever section a STRAY MENTION fell in rather than to
 *            the row's DECLARED refs. That marked E-PROTECT-001 (§11.3.2) "nominal §14.8" and would
 *            have exempted a real false claim; and a too-narrow banner window missed §58's Nominal
 *            marker, wrongly promoting two honest spec-ahead codes into the build arc.
 *  T5 (S261) a code named in an expected.json `description`/`rationale` is NOT pinned. Only
 *            `expect.codes` is a positive pin; `expect.notCodes` asserts ABSENCE and does not prove
 *            the code can fire.
 *  T6 (S310) RUNTIME-SURFACED codes — implemented as a runtime VALUE (an enum variant) rather than a
 *            diagnostic PUSH, so the E-code string appears in NO emitter even though the feature is
 *            fully built. Caught the hard way: all three E-PARSEVARIANT-* were classified FALSE-CLAIM
 *            and written up as the pre-freeze arc's sharpest case before the runtime was checked and
 *            found to implement them. See the RUNTIME_SURFACED note below.
 *  T7 (S364) A COMMENT IS NOT AN EMITTER. The scan matched a bare code token anywhere in a source
 *            file, prose included, so writing the code in two comments was enough to move an honest
 *            spec-ahead row into IMPL-SITES. Measured on this tree: 32 catalogued codes had a "hit"
 *            whose every occurrence is a comment. Comment spans are now stripped first — which can
 *            only remove claims, never real emitters, since a comment cannot fire a diagnostic.
 *  T8 (S364) A PROVENANCE NOTE THAT POINTS AT NOTHING. The §34.0 gate regex tested the SHAPE of a
 *            provenance note and never whether it RESOLVED, so a row naming a deleted file or a
 *            renamed function passed. Found by execution: `I-MATCH-PROMOTABLE` cites
 *            `compiler/src/lint-promotable.ts`, which does not exist (the emitter is
 *            `compiler/src/lint-i-match-promotable.js`). Paths and symbols are now resolved.
 *
 * NO HARDCODED LINE NUMBERS. §34's range is derived from the headings every run. A baked line number
 * in a maintained artifact rots silently and nothing fails — the defect class behind the 3,140-line
 * stale SPEC-INDEX (S290) and the ~9x-wrong LOC figure in the PA profile (S280), which is why
 * docs/FACTS.md exists.
 *
 * Usage:  bun scripts/s34-census.ts [--full] [--json]
 *         bun scripts/s34-census.ts --check-new [--base <ref>]   # §34.0 gate, DIFF-SCOPED
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `new URL(import.meta.url).pathname` yields a `/C:/…` form on Windows that does not
// open (the leading slash makes an invalid `\C:\…` after dirname/join); `fileURLToPath`
// resolves correctly on every platform. Mirrors scripts/facts.ts.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "compiler/SPEC.md");
const rawArgv = process.argv.slice(2);
const argv = new Set(rawArgv);
const FULL = argv.has("--full");
const JSON_OUT = argv.has("--json");
const CHECK_NEW = argv.has("--check-new");
const BASE_REF = (() => {
  const i = rawArgv.indexOf("--base");
  return i >= 0 && rawArgv[i + 1] ? rawArgv[i + 1] : "origin/main";
})();

const specLines = readFileSync(SPEC, "utf8").split("\n");

// -- §34 range, derived (never hardcoded) --------------------------------------------------------
function findHeading(re: RegExp): number {
  for (let i = 0; i < specLines.length; i++) if (re.test(specLines[i])) return i + 1;
  return -1;
}
const SEC34_START = findHeading(/^##\s+34\.\s/);
const SEC35_START = findHeading(/^##\s+35\.\s/);
const SEC34_END = SEC35_START > 0 ? SEC35_START - 1 : specLines.length;
const NATIVE_START = findHeading(/^###\s+34\.1\s/);
if (SEC34_START < 0 || SEC35_START < 0) {
  console.error("FATAL: could not locate the §34/§35 headings in SPEC.md — the census cannot be trusted.");
  process.exit(2);
}

// -- section map + Nominal banners ---------------------------------------------------------------
type Sec = { num: string; start: number; nominal: boolean };
const secs: Sec[] = [];
for (let i = 0; i < specLines.length; i++) {
  const m = specLines[i].match(/^#{1,3} (?:§)?(\d+(?:\.\d+)*)\.?\s+/);
  if (m) secs.push({ num: m[1], start: i + 1, nominal: false });
}
for (let s = 0; s < secs.length; s++) {
  const end = s + 1 < secs.length ? secs[s + 1].start : specLines.length;
  // 120-line window: §58's Nominal banner sits well below its heading (T4).
  const win = specLines.slice(secs[s].start - 1, Math.min(end - 1, secs[s].start + 120)).join("\n");
  secs[s].nominal = /\bNominal\b|spec-ahead/i.test(win);
}
/** Nominality of the row's DECLARED refs (and their ancestors), never of a stray mention (T4). */
function nominalByRefs(refs: string): string[] {
  const out = new Set<string>();
  for (const m of refs.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    const num = m[1];
    for (const s of secs) if ((s.num === num || num.startsWith(s.num + ".")) && s.nominal) out.add(`§${s.num}`);
  }
  return [...out];
}

// -- catalog -------------------------------------------------------------------------------------
const DECLARED_AHEAD =
  /\bnot yet emitted\b|\breserved\b|\bnominal\b|spec-ahead|lands? with (?:the )?impl|no fire site|excluded from the freeze|deprecation cycle endpoint|activates after|\bplanned\b|not implemented|never implemented/i;

/**
 * T6 (S310) — RUNTIME-SURFACED codes. A code whose implementation is a runtime VALUE (an enum variant
 * a program receives) rather than a compiler diagnostic PUSH will never appear as its own token in any
 * emitter, because the runtime carries the VARIANT NAME, not the E-code string. Scanning for the token
 * therefore reports "no emitter" for a fully-implemented feature.
 *
 * Witnessed immediately: all three `E-PARSEVARIANT-*` codes were classified FALSE-CLAIM and written up
 * as the pre-freeze arc's sharpest case — "a boundary-parse primitive documenting error handling it
 * cannot perform." It performs it. `compiler/runtime/stdlib/data.js:588-590` produces
 * MissingDiscriminator / UnknownVariant / InvalidPayload and `stdlib/data/parse.scrml:46` declares the
 * ParseError enum. The claim was false and an arc was nearly built on it.
 *
 * The rows self-describe ("Runtime: …", "Surfaced via `::ParseError::…`"), so the class is detectable —
 * but detection here only means "do not call this a dead diagnostic". Whether the runtime actually
 * produces the variant is a SEPARATE check this census cannot make.
 */
const RUNTIME_SURFACED = /\bRuntime:|Surfaced via|surfaces? (?:via|as) `?::|\(runtime\)/i;

type Row = { code: string; struck: boolean; severity: string; line: number; native: boolean; refs: string; declared: boolean; runtime: boolean };
const rows: Row[] = [];
const idx = new Map<string, Row>();
for (let i = SEC34_START - 1; i < SEC34_END && i < specLines.length; i++) {
  const raw = specLines[i];
  if (!raw.startsWith("|")) continue;
  const cells = raw.split("|");
  if (cells.length < 3) continue;
  const first = cells[1].trim();
  if (!first || /^-+$/.test(first) || /^code$/i.test(first)) continue;
  const struck = first.includes("~~"); // T1
  const code = first.replace(/~~/g, "").replace(/\*\*/g, "").replace(/`/g, "").trim();
  if (!/^[EWI]-[A-Z0-9-]+$/.test(code)) continue;
  const prior = idx.get(code);
  if (prior) { if (prior.struck && !struck) { prior.struck = false; prior.line = i + 1; } continue; }
  const r: Row = {
    code, struck, severity: cells[cells.length - 2]?.trim() ?? "", line: i + 1,
    native: NATIVE_START > 0 && i + 1 >= NATIVE_START, refs: (cells[2] ?? "").trim(),
    declared: DECLARED_AHEAD.test(raw), runtime: RUNTIME_SURFACED.test(raw),
  };
  idx.set(code, r); rows.push(r);
}
const codeSet = new Set(rows.map((r) => r.code));

// -- fs ------------------------------------------------------------------------------------------
/**
 * Blank out `//` line comments and `/* *\/` block comments, preserving offsets and line count.
 * String and template literals are tracked so a `"http://…"` or a `/* inside a string *\/` is not
 * mistaken for a comment opener.
 *
 * WHY (T7, this round): the emitter scan below counted a code token appearing ANYWHERE in a source
 * file, prose included. Writing `E-FOO-001` in two comments was therefore enough to move an honest
 * spec-ahead row into IMPL-SITES — a comment was reported as an emitter. Measured on this tree:
 * 32 catalogued codes had a "hit" whose every occurrence is a comment. A comment cannot fire a
 * diagnostic, so this exclusion has no false-negative risk: it can only remove claims, never real
 * emitters.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let mode: "code" | "line" | "block" | "s" | "d" | "t" = "code";
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && c2 === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c === "'" ? "s" : c === '"' ? "d" : "t"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } else out += " "; i++; continue; }
    if (mode === "block") {
      if (c === "*" && c2 === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += (c === "\n" ? "\n" : " "); i++; continue;
    }
    // inside a string/template literal — copy verbatim, honoring escapes
    if (c === "\\") { out += c + (c2 ?? ""); i += 2; continue; }
    if ((mode === "s" && c === "'") || (mode === "d" && c === '"') || (mode === "t" && c === "`")) mode = "code";
    out += c; i++; continue;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  let es: string[]; try { es = readdirSync(dir); } catch { return out; }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const p = join(dir, e); let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// -- conformance pins (T5: expect.codes only) ----------------------------------------------------
const pinned = new Set<string>();
let caseCount = 0, badCases = 0;
for (const f of walk(join(ROOT, "conformance/cases"))) {
  if (!f.endsWith("expected.json")) continue;
  caseCount++;
  try { for (const c of (JSON.parse(readFileSync(f, "utf8"))?.expect?.codes ?? [])) pinned.add(c); }
  catch { badCases++; }
}

// -- emitter scan, every tree (T2, T3) -----------------------------------------------------------
const SCAN = ["compiler/src", "compiler/native-parser", "compiler/runtime", "compiler/scripts",
  "compiler/self-host", "compiler/self-host-v2", "lsp", "scripts", "stdlib", "compiler/tests"];
const EXT = /\.(ts|js|mjs|scrml)$/;
const TOKEN = /\b[EWI]-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;
const JSISH = /\.(ts|js|mjs)$/;
const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const implHits = new Map<string, number>();
/** Every identifier appearing in EXECUTABLE source (comments stripped) — backs the §34.0
 *  provenance check below. Populated only for `--check-new`; the default census never needs it. */
const treeIdents = new Set<string>();
let filesScanned = 0;
for (const rootRel of SCAN) {
  for (const f of walk(join(ROOT, rootRel))) {
    if (!EXT.test(f)) continue;
    const rel = relative(ROOT, f);
    const isImpl = rel.startsWith("compiler/src/") || rel.startsWith("compiler/native-parser/") || rel.startsWith("compiler/runtime/");
    let t: string; try { t = readFileSync(f, "utf8"); } catch { continue; }
    filesScanned++;
    // A COMMENT IS NOT AN EMITTER. Strip comment spans before the token match, or a code
    // named in prose counts as an implementation site (see stripComments above).
    const code = JSISH.test(f) ? stripComments(t) : t;
    if (CHECK_NEW && JSISH.test(f)) {
      for (const id of code.match(IDENT) ?? []) treeIdents.add(id);
    }
    if (!isImpl) continue;
    for (const tok of code.match(TOKEN) ?? []) {
      if (codeSet.has(tok)) implHits.set(tok, (implHits.get(tok) ?? 0) + 1);
    }
  }
}

// -- classify ------------------------------------------------------------------------------------
type Bucket = "STRUCK" | "PINNED" | "IMPL-SITES" | "DECLARED-AHEAD" | "RUNTIME-SURFACED" | "FALSE-CLAIM";
const bucketOf = (r: Row): Bucket =>
  r.struck ? "STRUCK"
  : pinned.has(r.code) ? "PINNED"
  : (implHits.get(r.code) ?? 0) > 0 ? "IMPL-SITES"
  : r.declared ? "DECLARED-AHEAD"
  : r.runtime ? "RUNTIME-SURFACED"   // T6 — implemented as a runtime VALUE, not a diagnostic push
  : "FALSE-CLAIM";

const SHALL = /\b(SHALL|MUST)\b/;
type Disp = "NOMINAL-HOME" | "BUILD-ARC" | "HOME-NO-SHALL" | "ORPHAN-INDEX";
type Ev = { row: Row; homes: number; shalls: { line: number; text: string }[]; nominal: string[]; disp: Disp };

function evidence(r: Row): Ev {
  const re = new RegExp(`(?<![A-Z0-9-])${r.code}(?![A-Z0-9-])`);
  let homes = 0;
  const shalls: { line: number; text: string }[] = [];
  for (let i = 0; i < specLines.length; i++) {
    const ln = i + 1;
    if (ln >= SEC34_START && ln <= SEC34_END) continue; // the index is not a home
    if (!re.test(specLines[i])) continue;
    homes++;
    if (SHALL.test(specLines[i])) shalls.push({ line: ln, text: specLines[i].trim().slice(0, 200) });
  }
  const nominal = nominalByRefs(r.refs);
  const disp: Disp = nominal.length ? "NOMINAL-HOME"
    : homes === 0 ? "ORPHAN-INDEX"
    : shalls.length ? "BUILD-ARC"
    : "HOME-NO-SHALL";
  return { row: r, homes, shalls, nominal, disp };
}

// -- §34.0 gate: NEW/TOUCHED rows only, never the legacy corpus ---------------------------------
// A gate that is instantly red for reasons no change caused gets bypassed, then deleted (pa-base §8),
// so this reads a DIFF and is silent on every pre-existing row.
if (CHECK_NEW) {
  // Diff against the MERGE BASE with a two-dot diff, so the WORKING TREE is included.
  // `git diff base...HEAD` (three-dot) compares COMMITTED HEAD only and silently ignores uncommitted
  // edits — which made the first cut of this gate hollow: it reported PASS on a deliberately bad row.
  // Caught by the bite proof, which is the entire reason §8 requires one.
  let mergeBase = BASE_REF;
  try {
    mergeBase = execFileSync("git", ["merge-base", BASE_REF, "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch { /* detached / shallow clone — fall back to the ref itself */ }

  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "-U0", mergeBase, "--", "compiler/SPEC.md"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`§34.0 gate: cannot diff against '${BASE_REF}' (merge-base ${mergeBase}) — ${(e as Error).message}`);
    process.exit(2);
  }

  const EMITTER = /emitted at|emitter:|`(?:compiler|scripts|lsp|stdlib)\/[A-Za-z0-9_./-]+`|\((?:compiler|scripts)\/[A-Za-z0-9_./-]+:\d+\)/i;

  // -- provenance RESOLUTION (this round) --------------------------------------------------------
  // The check above is a regex for the SHAPE of a provenance note. It never asked whether the note
  // points at anything: a row naming a deleted file or a renamed function passed, because a
  // backticked path is a backticked path. Measured on this tree — `I-MATCH-PROMOTABLE` claims
  // "Emitted at `compiler/src/lint-promotable.ts`"; that file does not exist (the emitter is
  // `compiler/src/lint-i-match-promotable.js`). A rename staled the note and nothing checked.
  //
  // So a note that HAS the shape must also RESOLVE:
  //   - every backticked repo path in the row must exist on disk
  //   - every symbol the row names must appear in executable source (comments stripped, so a
  //     function deleted but still eulogised in a comment does not launder the claim)
  const PATH_REF = /`((?:compiler|scripts|lsp|stdlib)\/[A-Za-z0-9_./-]+?)(?::\d+)?`/g;
  // The two provenance conventions §34 actually uses, and only those: a backticked symbol
  // IMMEDIATELY after a backticked path (`compiler/src/type-system.ts` `checkPrintArgs`), or one
  // introduced by "via"/"in". Anything looser reads ordinary prose as a symbol claim.
  const SYMBOL_REFS = [
    /`(?:compiler|scripts|lsp|stdlib)\/[A-Za-z0-9_./-]+(?::\d+)?`\s+`([A-Za-z_$][A-Za-z0-9_$]*)`/g,
    /\bvia\s+`([A-Za-z_$][A-Za-z0-9_$]*)`/gi,
    /\bin\s+(?:the\s+)?`([A-Za-z_$][A-Za-z0-9_$]*)`/gi,
  ];
  // Backticked prose that is NOT a JS symbol: pure lowercase_snake_case with no leading underscore
  // — e.g. E-SCHEMA-011's row names the Postgres catalog `pg_constraint`. This codebase has no
  // lowercase_snake function names, and `_scrml_*` keeps its leading underscore, so the filter costs
  // nothing real. It was the ONLY false positive across all 811 catalogued rows.
  const NOT_A_SYMBOL = /^[a-z]+(?:_[a-z0-9]+)+$/;

  const offenders: { code: string; why: string }[] = [];
  const stale: { code: string; why: string }[] = [];
  let added = 0;

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const row = line.slice(1);
    if (!row.startsWith("|")) continue;
    const cells = row.split("|");
    if (cells.length < 3) continue;
    const first = cells[1].trim();
    if (!first || /^-+$/.test(first) || /^code$/i.test(first)) continue;
    const struck = first.includes("~~");
    const code = first.replace(/~~/g, "").replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!/^[EWI]-[A-Z0-9-]+$/.test(code)) continue;
    added++;
    if (struck) continue;                       // (3) retirement row

    // A row may name an emitter AND declare itself spec-ahead. Whatever provenance it does name
    // still has to resolve — a Nominal row citing a deleted file is a stale claim either way.
    for (const m of row.matchAll(PATH_REF)) {
      if (!existsSync(join(ROOT, m[1]))) {
        stale.push({ code, why: `names \`${m[1]}\`, which does not exist` });
      }
    }
    for (const re of SYMBOL_REFS) {
      re.lastIndex = 0;
      for (const m of row.matchAll(re)) {
        const sym = m[1];
        if (NOT_A_SYMBOL.test(sym)) continue;
        if (!treeIdents.has(sym)) {
          stale.push({ code, why: `names symbol \`${sym}\`, which appears in no executable source` });
        }
      }
    }

    if (DECLARED_AHEAD.test(row)) continue;     // (2) honest spec-ahead declaration
    if (EMITTER.test(row)) continue;            // (1) emitter provenance note
    offenders.push({ code, why: "no emitter provenance note, no spec-ahead declaration, not struck" });
  }

  if (!added) { console.log(`§34.0 gate: no new/changed §34 rows vs ${BASE_REF} — PASS`); process.exit(0); }
  if (offenders.length || stale.length) {
    const n = offenders.length + stale.length;
    console.error(`§34.0 gate FAILED — ${n} problem(s) across ${added} new/changed §34 row(s):\n`);
    for (const o of offenders) console.error(`  ${o.code} — ${o.why}`);
    for (const s of stale) console.error(`  ${s.code} — STALE PROVENANCE: ${s.why}`);
    if (offenders.length) {
      console.error(`\nEvery NEW row SHALL carry ONE of (SPEC §34.0):`);
      console.error(`  1. an emitter provenance note — e.g. (… emitted at \`compiler/src/foo.ts:123\`.)`);
      console.error(`  2. an explicit spec-ahead declaration — Reserved / Nominal / spec-ahead / not yet emitted`);
      console.error(`  3. strikethrough ~~CODE~~ + a retirement note`);
      console.error(`\nOutcome 2 is a first-class answer: if the emitter does not exist yet, SAY SO.`);
    }
    if (stale.length) {
      console.error(`\nA provenance note SHALL RESOLVE: every backticked repo path must exist, and every`);
      console.error(`symbol named via \`path\` \`sym\` / "via \`sym\`" / "in \`sym\`" must appear in executable`);
      console.error(`source. A note pointing at a renamed function is a false claim in the §62.2 contract.`);
    }
    process.exit(1);
  }
  console.log(`§34.0 gate: ${added} new/changed §34 row(s), all well-formed (provenance resolves) — PASS`);
  process.exit(0);
}

const buckets = new Map<Bucket, Row[]>();
for (const r of rows) { const b = bucketOf(r); buckets.set(b, [...(buckets.get(b) ?? []), r]); }
const falseClaims = (buckets.get("FALSE-CLAIM") ?? []).map(evidence);
const byDisp = (d: Disp) => falseClaims.filter((e) => e.disp === d);
const n = (b: Bucket) => (buckets.get(b) ?? []).length;

if (JSON_OUT) {
  console.log(JSON.stringify({
    generated: { specLines: specLines.length, sec34: [SEC34_START, SEC34_END], filesScanned, caseCount },
    buckets: Object.fromEntries([...buckets].map(([k, v]) => [k, v.length])),
    dispositions: Object.fromEntries((["NOMINAL-HOME", "BUILD-ARC", "HOME-NO-SHALL", "ORPHAN-INDEX"] as Disp[])
      .map((d) => [d, byDisp(d).map((e) => e.row.code)])),
  }, null, 2));
  process.exit(0);
}

console.log(`# §34 catalog census — ${rows.length} rows (§34 ${SEC34_START}..${SEC34_END}, derived)`);
console.log(`${filesScanned} source files · ${caseCount} conformance cases${badCases ? ` (${badCases} unparseable)` : ""}\n`);
console.log(`| bucket | count | meaning |`);
console.log(`|---|---|---|`);
console.log(`| STRUCK | ${n("STRUCK")} | already retired — must NOT enter any denominator |`);
console.log(`| PINNED | ${n("PINNED")} | a conformance case positively asserts it fires |`);
console.log(`| IMPL-SITES | ${n("IMPL-SITES")} | live + unpinned + has an emitter — fire-attempt work |`);
console.log(`| DECLARED-AHEAD | ${n("DECLARED-AHEAD")} | no emitter, row declares reserved/Nominal — honest |`);
console.log(`| RUNTIME-SURFACED | ${n("RUNTIME-SURFACED")} | row says it surfaces at RUNTIME as a value — verify the runtime separately, NOT a dead diagnostic |`);
console.log(`| FALSE-CLAIM | ${n("FALSE-CLAIM")} | no emitter AND the row promises a live diagnostic |`);
console.log(`\n## FALSE-CLAIM dispositions\n`);
console.log(`| disposition | count |`);
console.log(`|---|---|`);
for (const d of ["BUILD-ARC", "HOME-NO-SHALL", "ORPHAN-INDEX", "NOMINAL-HOME"] as Disp[]) {
  console.log(`| ${d} | ${byDisp(d).length} |`);
}

if (FULL) {
  for (const d of ["BUILD-ARC", "ORPHAN-INDEX", "NOMINAL-HOME", "HOME-NO-SHALL"] as Disp[]) {
    console.log(`\n## ${d} — ${byDisp(d).length}\n`);
    for (const e of byDisp(d)) {
      const refs = e.row.refs.replace(/\s+/g, " ").slice(0, 40) || "—";
      console.log(`- \`${e.row.code}\` (§34:${e.row.line}, refs ${refs}) — homes ${e.homes}` +
        `${e.nominal.length ? ` · nominal ${e.nominal.join(",")}` : ""}${e.shalls.length ? ` · ${e.shalls.length} SHALL` : ""}`);
      if (d === "BUILD-ARC" && e.shalls[0]) console.log(`    SPEC:${e.shalls[0].line} — ${e.shalls[0].text}`);
    }
  }
  const fam = new Map<string, string[]>();
  for (const e of byDisp("BUILD-ARC")) {
    const f = e.row.code.replace(/-[0-9]+$/, "").replace(/^([EWI]-[A-Z]+).*/, "$1");
    fam.set(f, [...(fam.get(f) ?? []), e.row.code]);
  }
  console.log(`\n## BUILD-ARC family rollup\n`);
  for (const [f, cs] of [...fam.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`- **${f}** x${cs.length} — ${cs.join(", ")}`);
  }
}
