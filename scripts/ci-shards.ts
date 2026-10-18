#!/usr/bin/env bun
// ci-shards — the bookkeeping behind the SHARDED test jobs in .github/workflows/ci.yml (S468, change-id
// s468-ci-speedup).
//
// WHY THIS EXISTS. The required `gate` used to run `bun test compiler/tests/unit compiler/tests/conformance`
// as ONE process (~7.7 min). It is now split across matrix legs with bun's own `--shard=i/N`, and the
// integration + lsp + commands tiers joined the required gate the same way. Splitting a suite opens a
// failure mode the single run could not have: a shard that silently runs NOTHING (or a leg the matrix
// never scheduled, or a bun that ignores `--shard` and runs everything N times) still exits 0. A
// partition is only trustworthy if something checks that it IS a partition. That is `reconcile`.
//
// SUBCOMMANDS
//   bun scripts/ci-shards.ts reconcile <reports-dir> <suite>=<dir>[,<dir>…] [<suite>=… …]
//       Reads every `junit-<suite>-<i>-of-<n>.xml` under <reports-dir> (bun's `--reporter=junit`
//       output, one per shard leg). For each suite it asserts, and exits 1 on any violation:
//         - every leg 1..n reported (a missing leg = a shard that never ran or never uploaded);
//         - the test files the legs ran are DISJOINT (no file ran in two shards);
//         - their union EQUALS the test files under the suite's directories, enumerated here with
//           bun's own discovery rule (`*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*`;
//           js/jsx/ts/tsx/mjs/cjs/mts/cts; node_modules skipped). A file in neither list is named.
//       It prints per-leg and per-suite totals (files / tests / failures / skipped), so the summed
//       count is visible next to the old single-run count.
//       Exit 0 = every suite is an exact partition · 1 = a violation (listed) · 2 = bad invocation.
//
//   bun scripts/ci-shards.ts merge-timings <out.json> <in.json>…
//       Merges bun `--update-timings` outputs (one per shard leg, uploaded as CI artifacts) into the
//       committed balance table `scripts/ci-test-timings.json`. The table only BALANCES the shards —
//       a stale or missing entry changes which leg runs a file, never whether it runs. Refresh it
//       when the legs drift apart: download a run's `test-report-*` artifacts and run this.
//
// The XML is read with a tag scanner, not a parser: bun's junit output is machine-written, and only
// the DEPTH-1 `<testsuite file=…>` elements (one per test file) and their counters are needed.

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "fs";
import { join, relative, resolve } from "path";

const REPO = resolve(import.meta.dir, "..");

/** bun test's discovery rule (https://bun.com/docs/cli/test — "test files"). */
const TEST_FILE = /(\.test|_test|\.spec|_spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

function enumerate(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (TEST_FILE.test(e)) out.push(relative(REPO, p).split("\\").join("/"));
    }
  };
  walk(join(REPO, dir));
  return out;
}

interface FileRow { file: string; tests: number; failures: number; skipped: number }

/** The depth-1 <testsuite> elements of one bun junit report — one per test file. */
function fileRows(xml: string): FileRow[] {
  const rows: FileRow[] = [];
  const attr = (s: string, n: string) => { const m = new RegExp(`\\b${n}="([^"]*)"`).exec(s); return m ? m[1] : ""; };
  let depth = 0;
  for (const m of xml.matchAll(/<(\/?)testsuite\b([^>]*?)(\/?)>/g)) {
    const [, close, attrs, selfClose] = m;
    if (close) { depth--; continue; }
    if (depth === 0) {
      rows.push({
        file: (attr(attrs, "file") || attr(attrs, "name")).split("\\").join("/"),
        tests: Number(attr(attrs, "tests")) || 0,
        failures: Number(attr(attrs, "failures")) || 0,
        skipped: Number(attr(attrs, "skipped")) || 0,
      });
    }
    if (!selfClose) depth++;
  }
  return rows;
}

function reconcile(dir: string, specs: string[]): number {
  if (!existsSync(dir)) { console.error(`ci-shards: no reports directory ${dir}`); return 1; }
  const reports = readdirSync(dir, { recursive: true } as any).map(String).filter((f) => /junit-.+\.xml$/.test(f));
  let bad = 0;
  for (const spec of specs) {
    const [suite, dirs] = spec.split("=");
    if (!suite || !dirs) { console.error(`ci-shards: bad suite spec "${spec}" (want name=dir,dir)`); return 2; }
    const legs = new Map<number, { n: number; rows: FileRow[] }>();
    for (const f of reports) {
      const m = new RegExp(`(?:^|[\\\\/])junit-${suite}-(\\d+)-of-(\\d+)\\.xml$`).exec(f);
      if (!m) continue;
      legs.set(Number(m[1]), { n: Number(m[2]), rows: fileRows(readFileSync(join(dir, f), "utf8")) });
    }
    console.log(`\n== ${suite} (${dirs})`);
    if (legs.size === 0) { console.log(`  ✗ no junit report for this suite at all`); bad++; continue; }
    const ns = new Set([...legs.values()].map((l) => l.n));
    if (ns.size !== 1) { console.log(`  ✗ legs disagree on the shard count: ${[...ns].join(", ")}`); bad++; continue; }
    const n = [...ns][0];
    const owner = new Map<string, number>();
    const totals = { files: 0, tests: 0, failures: 0, skipped: 0 };
    for (let i = 1; i <= n; i++) {
      const leg = legs.get(i);
      if (!leg) { console.log(`  ✗ leg ${i}/${n} reported nothing (never ran, or never uploaded its report)`); bad++; continue; }
      const t = leg.rows.reduce((a, r) => ({ tests: a.tests + r.tests, failures: a.failures + r.failures, skipped: a.skipped + r.skipped }), { tests: 0, failures: 0, skipped: 0 });
      console.log(`  leg ${i}/${n}: ${leg.rows.length} files, ${t.tests} tests, ${t.failures} failures, ${t.skipped} skipped`);
      if (leg.rows.length === 0) { console.log(`  ✗ leg ${i}/${n} ran zero files`); bad++; }
      totals.files += leg.rows.length; totals.tests += t.tests; totals.failures += t.failures; totals.skipped += t.skipped;
      for (const r of leg.rows) {
        const prev = owner.get(r.file);
        if (prev !== undefined) { console.log(`  ✗ ${r.file} ran in BOTH leg ${prev} and leg ${i}`); bad++; }
        owner.set(r.file, i);
      }
    }
    const expected = new Set(dirs.split(",").flatMap(enumerate));
    const missing = [...expected].filter((f) => !owner.has(f)).sort();
    const extra = [...owner.keys()].filter((f) => !expected.has(f)).sort();
    for (const f of missing) console.log(`  ✗ not run by any leg: ${f}`);
    for (const f of extra) console.log(`  ✗ ran, but is not a test file under ${dirs}: ${f}`);
    bad += missing.length + extra.length;
    console.log(`  total: ${totals.files} files (expected ${expected.size}), ${totals.tests} tests, ${totals.failures} failures, ${totals.skipped} skipped`);
  }
  if (bad > 0) { console.error(`\nci-shards: ${bad} partition violation(s) — the sharded run is NOT the whole suite`); return 1; }
  console.log(`\nci-shards: every suite is an exact partition of its test files`);
  return 0;
}

function mergeTimings(out: string, inputs: string[]): number {
  const files: Record<string, number> = {};
  for (const f of inputs) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    for (const [k, v] of Object.entries(j.files ?? {})) files[k] = Number(v);
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(out, JSON.stringify({ version: 1, files: sorted }, null, 2) + "\n");
  console.log(`ci-shards: wrote ${Object.keys(sorted).length} file timings to ${out}`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "reconcile" && rest.length >= 2) process.exit(reconcile(rest[0], rest.slice(1)));
if (cmd === "merge-timings" && rest.length >= 2) process.exit(mergeTimings(rest[0], rest.slice(1)));
console.error("usage: bun scripts/ci-shards.ts reconcile <reports-dir> <suite>=<dir>[,<dir>…]…\n       bun scripts/ci-shards.ts merge-timings <out.json> <in.json>…");
process.exit(2);
