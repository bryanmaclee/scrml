/**
 * delta-lint-partial-parse.test.js — pins the delta-log gate's population accounting (S365).
 *
 * WHY THIS EXISTS. `scripts/delta-lint.ts` is a BLOCKING CI gate whose whole purpose is to stop an
 * entry silently dropping out of the flogence digest. It has now gone blind TWICE:
 *
 *   S365 (a) TOTAL blindness  — a separator drift made every entry unparseable and the gate printed
 *                               "0 entries … — PASS" at exit 0. Fixed by refuseDegenerateScope().
 *   S365 (b) PARTIAL blindness — the convention drifted to `[NNNN] <emoji> <kind> · body` and the
 *                               narrow regex could not parse it, so FOUR live entries were invisible
 *                               to the gate AND to the digest projection while it printed PASS.
 *
 * (b) survived (a)'s fix because the zero-population guard consulted `bracketed` only inside the
 * `total === 0` branch — all-or-nothing, and partial blindness READS HEALTHIER the more entries
 * still parse. The repo's own doctrine (pa-base §8) is that an unproven gate is the one that rots,
 * so the accounting invariant is pinned here rather than left to a hand-run bite proof.
 *
 * THE INVARIANT: every line in the live scope that opens with `[NNNN]` is either PARSED (and thus
 * checked for uniqueness) or REPORTED. There is no third bucket. A PASS may never be printed over a
 * population the parser cannot account for.
 *
 * The script is a top-level CLI with side effects at import (it reads the log and calls
 * process.exit), so it is exercised by SPAWN against sandbox trees rather than by import — the
 * script resolves its own ROOT as `dirname(script)/..`, so a sandbox is `<tmp>/scripts/delta-lint.ts`
 * plus `<tmp>/handOffs/delta-log.md`. (Making it importable the way scripts/state.ts was at S307 is
 * recorded as follow-up, not done here.)
 *
 * EXIT CODES: 0 pass · 1 a NEW duplicate · 2 the parser cannot account for the population.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT_SRC = join(REPO, "scripts", "delta-lint.ts");

let SANDBOX = "";
let SCRIPT = "";
let LOG = "";

beforeAll(() => {
  SANDBOX = mkdtempSync(join(tmpdir(), "delta-lint-s365-"));
  mkdirSync(join(SANDBOX, "scripts"), { recursive: true });
  mkdirSync(join(SANDBOX, "handOffs"), { recursive: true });
  SCRIPT = join(SANDBOX, "scripts", "delta-lint.ts");
  LOG = join(SANDBOX, "handOffs", "delta-log.md");
  copyFileSync(SCRIPT_SRC, SCRIPT);
});

afterAll(() => {
  if (SANDBOX) rmSync(SANDBOX, { recursive: true, force: true });
});

/** Write the fixture log, run the gate, return { code, out }. No baseline file → nothing baselined. */
function runGate(logBody, args = []) {
  writeFileSync(LOG, logBody);
  const r = spawnSync("bun", [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const HEAD = "# delta-log\n## Session 236\n";

describe("delta-lint §1 — a clean population passes and a real duplicate fails", () => {
  test("pristine canonical entries → exit 0", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] find · beta\n[1602] land · gamma\n`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("3 entries in the live scope");
    expect(r.out).toContain("PASS");
  });

  test("a duplicate in the canonical shape → exit 1", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] find · beta\n[1601] land · gamma\n`);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[1601] appears 2×");
  });
});

describe("delta-lint §2 — the marker form is the live convention and is COUNTED", () => {
  // These are the exact shapes of the four live entries that were invisible: [561] [562] [565]
  // carry `⭐`, [727] carries `⚠️` (two code points — U+26A0 plus a variation selector).
  test("`[NNNN] <emoji> <kind> · body` parses; all three entries counted", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] ⭐ find/rule · beta\n[1602] ⚠️ rule-falsified · gamma\n`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("3 entries in the live scope");
  });

  test("a duplicate hiding among marker-form entries is now REPORTED, not passed over", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] find · beta\n[1601] ⭐ land · gamma\n`);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[1601] appears 2×");
  });

  test("an astral-plane emoji marker (surrogate pair) parses too", () => {
    const r = runGate(`${HEAD}[1600] 🚩 rule · alpha\n[1601] find · beta\n`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("2 entries in the live scope");
  });
});

describe("delta-lint §3 — the widen is NARROW: an unknown shape is refused, not swallowed", () => {
  test("a bracketed line the parser cannot read → exit 2, and the line is NAMED", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] two words · beta\n[1602] land · gamma\n`);
    expect(r.code).toBe(2);
    expect(r.out).toContain("PARTIAL PARSE");
    expect(r.out).toContain("[1601] two words · beta");
    expect(r.out).not.toContain("PASS");
  });

  test("a DUPLICATE hidden inside the unreadable region → exit 2, never a PASS", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] two words · beta\n[1601] three word thing · gamma\n`);
    expect(r.code).toBe(2);
    expect(r.out).toContain("PARTIAL PARSE");
    expect(r.out).toContain("2 bracketed line(s) are NOT being counted");
  });

  test("the accounting is stated in the diagnostic (bracketed vs parsed)", () => {
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] two words · beta\n`);
    expect(r.code).toBe(2);
    expect(r.out).toContain("2 line(s) in the live scope");
    expect(r.out).toContain("1 matched the ENTRY shape");
  });
});

describe("delta-lint §4 — the TOTAL-blindness refusals still hold (no regression on S365(a))", () => {
  test("full separator drift → exit 2", () => {
    const r = runGate(`${HEAD}[1600] rule - alpha\n[1601] find - beta\n[1601] land - gamma\n`);
    expect(r.code).toBe(2);
    expect(r.out).toContain("MEASURED ZERO");
  });

  test("empty file → exit 2", () => {
    const r = runGate("");
    expect(r.code).toBe(2);
    expect(r.out).toContain("MEASURED ZERO");
  });

  test("comments-only (non-empty, nothing bracketed) → exit 2", () => {
    const r = runGate(`${HEAD}<!-- nothing here yet -->\njust prose\n`);
    expect(r.code).toBe(2);
    expect(r.out).toContain("MEASURED ZERO");
  });
});

describe("delta-lint §5 — --fix refuses to renumber against a partial population", () => {
  test("--fix under a partial parse → exit 2 and the log is BYTE-IDENTICAL", () => {
    const body = `${HEAD}[1600] rule · alpha\n[1601] two words · beta\n[1601] three word thing · gamma\n`;
    const r = runGate(body, ["--fix"]);
    expect(r.code).toBe(2);
    expect(readFileSync(LOG, "utf8")).toBe(body);
  });

  test("--fix on a clean parse renumbers to a number no ENTRY holds (the corruption case)", () => {
    // The recorded corruption: a VISIBLE duplicate [1601] beside an INVISIBLE [1602]. With the old
    // narrow regex, maxSeq came from visible entries only (1601), so --fix renumbered onto [1602] —
    // manufacturing a collision — and the confirm re-run then printed PASS over it. Counting the
    // marker-form entry lifts maxSeq to 1602, so the renumber lands on 1603.
    const r = runGate(
      `${HEAD}[1600] rule · alpha\n[1601] find · beta\n[1601] land · gamma\n[1602] ⭐ rule · delta\n`,
      ["--fix"],
    );
    expect(r.code).toBe(0);
    const after = readFileSync(LOG, "utf8");
    expect(after).toContain("[1603] land · gamma");
    expect(after).toContain("[1602] ⭐ rule · delta");

    // …and the confirm re-run must now be an HONEST pass over all four entries.
    const confirm = spawnSync("bun", [SCRIPT], { encoding: "utf8" });
    expect(confirm.status).toBe(0);
    expect(`${confirm.stdout}${confirm.stderr}`).toContain("4 entries in the live scope");
  });

  test("--fix still warns about the UNFIXED merge-orientation hazard", () => {
    // The clean-parse gate does not make --fix safe on a union-merge result; that defect is open.
    // The warning must not disappear, or the guard starts reading as though it solved both.
    const r = runGate(`${HEAD}[1600] rule · alpha\n[1601] find · beta\n[1601] land · gamma\n`, ["--fix"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("MERGE HAZARD");
  });
});
