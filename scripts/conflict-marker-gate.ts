#!/usr/bin/env bun
// conflict-marker-gate — fail if any TRACKED file carries an unresolved VCS conflict marker.
//
// WHY THIS EXISTS (S409). `compiler/SPEC-INDEX.md` shipped to `main` at e74f5423 (#900) with three
// raw conflict markers enclosing 117 duplicated Sections rows, and the cloud `gate` was GREEN. The
// file is a mandatory full-read at every Profile-A PA boot, so the next session read a doubled
// navigation table as though it were the map.
//
// The gate that existed did not fail, and it was not broken: ci.yml ran a step named
// "SPEC-INDEX totals gate" (`regen-spec-index.ts --check`), which verifies the two numbers in the
// `@generated` totals block. Those numbers were correct. PA-verified by execution on the broken
// file: it printed `SPEC-INDEX totals OK` and exited 0. The gate measured what it was built to
// measure and its answer was true — it simply was not an answer to "is this file well-formed."
// (pa-base §8, the coverage blind-spot family; the S405 durable one level up — an enumeration's
// METHOD being sound says nothing about its AXIS being complete.)
//
// SCOPE + FALSE-POSITIVE POSTURE. Only the two DISTINCTIVE markers are matched, anchored at line
// start: the 7-char run plus a space. The bare `=======` middle marker is deliberately NOT matched
// — it collides with setext-style Markdown headings (`Title` underlined with `=`), which is exactly
// the cry-wolf shape pa-base §8 warns retires a gate. Either distinctive marker alone is already a
// defect, so nothing real is missed.
//
// BACKLOG AT INTRODUCTION: zero. Swept at S409 across all tracked files — `SPEC-INDEX.md` was the
// only hit and is fixed in the same arc. This gate is green from its first run, which is the
// condition pa-base §8 requires before adding one (a gate instantly red over an existing backlog
// gets bypassed, then deleted).
//
// A doc that legitimately needs to DISPLAY a conflict marker should indent it inside its fenced
// block; the anchor is at column 0 on purpose.

import { execFileSync } from "node:child_process";

// Built at runtime so this file's own source does not contain a matchable literal.
const OPEN = "<".repeat(7) + " ";
const CLOSE = ">".repeat(7) + " ";
const PATTERN = `^(${OPEN}|${CLOSE})`;

let hits: string[] = [];
try {
  const out = execFileSync("git", ["grep", "-n", "-E", PATTERN, "--", "."], {
    encoding: "utf8",
  });
  hits = out.split(/\r?\n/).filter(Boolean);
} catch (err: any) {
  // `git grep` exits 1 on NO MATCH — the success case here. Any other status is a real failure and
  // MUST NOT be read as "clean" (pa-base §8: a probe's error must not render as its negative answer).
  if (err?.status !== 1) {
    console.error(
      `conflict-marker-gate — the probe itself FAILED (exit ${err?.status}); this is NOT a pass.\n` +
        `${err?.stderr ?? err?.message ?? err}`,
    );
    process.exit(2);
  }
}

// State the scope actually used, so a mis-scoped run is visible in the output rather than inferable.
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean).length;

if (hits.length > 0) {
  console.error(`\nUNRESOLVED CONFLICT MARKERS — ${hits.length} line(s) across the tracked tree:\n`);
  for (const h of hits) console.error(`  ${h.slice(0, 160)}`);
  console.error(
    `\nA conflict marker on the trunk is a broken artifact, not a style issue: the file it sits in\n` +
      `is being read as truth by something. Resolve the merge and re-run.\n`,
  );
  process.exit(1);
}

console.log(`conflict-marker-gate — ${tracked} tracked files scanned, 0 markers — PASS`);
