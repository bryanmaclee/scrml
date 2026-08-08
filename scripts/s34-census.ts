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
 *
 * NO HARDCODED LINE NUMBERS. §34's range is derived from the headings every run. A baked line number
 * in a maintained artifact rots silently and nothing fails — the defect class behind the 3,140-line
 * stale SPEC-INDEX (S290) and the ~9x-wrong LOC figure in the PA profile (S280), which is why
 * docs/FACTS.md exists.
 *
 * Usage:  bun scripts/s34-census.ts [--full] [--json]
 *         bun scripts/s34-census.ts --check-new [--base <ref>]   # §34.0 gate, DIFF-SCOPED
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
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
const implHits = new Map<string, number>();
let filesScanned = 0;
for (const rootRel of SCAN) {
  for (const f of walk(join(ROOT, rootRel))) {
    if (!EXT.test(f)) continue;
    const rel = relative(ROOT, f);
    const isImpl = rel.startsWith("compiler/src/") || rel.startsWith("compiler/native-parser/") || rel.startsWith("compiler/runtime/");
    let t: string; try { t = readFileSync(f, "utf8"); } catch { continue; }
    filesScanned++;
    if (!isImpl) continue;
    for (const tok of t.match(TOKEN) ?? []) {
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
  const offenders: { code: string; why: string }[] = [];
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
    if (DECLARED_AHEAD.test(row)) continue;     // (2) honest spec-ahead declaration
    if (EMITTER.test(row)) continue;            // (1) emitter provenance note
    offenders.push({ code, why: "no emitter provenance note, no spec-ahead declaration, not struck" });
  }

  if (!added) { console.log(`§34.0 gate: no new/changed §34 rows vs ${BASE_REF} — PASS`); process.exit(0); }
  if (offenders.length) {
    console.error(`§34.0 gate FAILED — ${offenders.length} of ${added} new/changed §34 row(s) are unverifiable claims:\n`);
    for (const o of offenders) console.error(`  ${o.code} — ${o.why}`);
    console.error(`\nEvery NEW row SHALL carry ONE of (SPEC §34.0):`);
    console.error(`  1. an emitter provenance note — e.g. (… emitted at \`compiler/src/foo.ts:123\`.)`);
    console.error(`  2. an explicit spec-ahead declaration — Reserved / Nominal / spec-ahead / not yet emitted`);
    console.error(`  3. strikethrough ~~CODE~~ + a retirement note`);
    console.error(`\nOutcome 2 is a first-class answer: if the emitter does not exist yet, SAY SO.`);
    process.exit(1);
  }
  console.log(`§34.0 gate: ${added} new/changed §34 row(s), all well-formed — PASS`);
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
