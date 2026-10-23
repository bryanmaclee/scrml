/**
 * claim-gate-runs.test.js — scripts/claim-gate.js must load and run (S469 hygiene).
 *
 * #142 (S280) rewrote the script's header comment and dropped its closing `*\/`, so the `import`
 * lines became comment text and every run crashed with `existsSync is not defined` (claim-gate.js:82).
 * The script is a `--report` survey instrument wired into no gate, so nothing noticed for ~190
 * sessions. This runs it end to end on a three-block fixture: one block compiles, one opts out with
 * `// gate: skip`, one fails to compile — so both exit paths are exercised.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "../../..");
const FENCE = "```";
let dir;
let md;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "claim-gate-runs-"));
  md = join(dir, "surface.md");
  writeFileSync(
    md,
    [
      "# fixture",
      `${FENCE}scrml`, "<program>", "<p>hi</p>", "</program>", FENCE,
      `${FENCE}scrml`, "// gate: skip", "not code", FENCE,
      `${FENCE}scrml`, "<program>", "<p>${@nope}</p>", "</program>", FENCE,
      "",
    ].join("\n"),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) =>
  spawnSync("bun", ["scripts/claim-gate.js", ...args, md], { cwd: ROOT, encoding: "utf8" });

describe("scripts/claim-gate.js runs", () => {
  test("--report: tallies pass / skip / fail and exits 0", () => {
    const r = run("--report");
    expect(r.stderr).not.toContain("is not defined");
    expect(r.stdout).toContain("claim-gate: 1 passed, 1 skipped, 0 snippet-gated, 0 spec-ahead, 1 failed (3 total).");
    expect(r.status).toBe(0);
  });

  test("gate mode: the failing block exits 1 and is named in the detail", () => {
    const r = run();
    expect(r.stdout).toContain("claim-gate: 1 passed, 1 skipped, 0 snippet-gated, 0 spec-ahead, 1 failed (3 total).");
    expect(r.stderr).toContain("block #3 — compile-fail");
    expect(r.status).toBe(1);
  });
});
