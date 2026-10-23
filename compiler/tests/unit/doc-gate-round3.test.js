/**
 * doc-gate-round3.test.js — S469 docs-gate review round 3.
 *
 *   F1  a fence on a list-item line (`- ```scrml`, `1. ```scrml`, nested) is gated, and does
 *       not desync the parser.
 *   F2  at most 3 spaces of indent on an opener / closer, relative to its container.
 *   F3  malformed pins are errors, never "unpinned".
 *   4   the claim-gate surface floor: a fenced public doc must be gated or excused.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDocMarkers, parseGateMarker } from "../../../scripts/doc-gate-markers.js";
import { uncoveredDocs, PUBLIC_SURFACE, SURFACE_UNGATED } from "../../../scripts/claim-gate-surface.js";

const ROOT = join(import.meta.dir, "../../..");
const B = "```";

describe("F1 — list-item containers", () => {
  test("`- ```scrml` is gated, its body is dedented, and the next real fence is still found", () => {
    const d = parseDocMarkers([
      `- ${B}scrml`, "  <p>a</p>", `  ${B}`,
      "",
      "text",
      `${B}scrml`, "<p>b</p>", B,
    ].join("\n"));
    expect(d.errors).toEqual([]);
    expect(d.blocks.map((b) => b.body)).toEqual(["<p>a</p>", "<p>b</p>"]);
  });
  test("`1. ```scrml` and `1) ```scrml` are gated", () => {
    for (const m of ["1.", "1)"]) {
      const d = parseDocMarkers([`${m} ${B}scrml`, "   x", `   ${B}`].join("\n"));
      expect(d.blocks.length).toBe(1);
      expect(d.blocks[0].body).toBe("x");
    }
  });
  test("nested list markers on one line are gated", () => {
    const d = parseDocMarkers([`- 1. ${B}scrml`, "     x", `     ${B}`].join("\n"));
    expect(d.blocks.length).toBe(1);
    expect(d.blocks[0].body).toBe("x");
  });
  test("a fence in a list item's continuation (indented to the content column) is gated", () => {
    const d = parseDocMarkers(["1. Step one:", "", `   ${B}scrml`, "   x", `   ${B}`].join("\n"));
    expect(d.blocks.length).toBe(1);
    expect(d.blocks[0].body).toBe("x");
  });
  test("a line indented less than the list content column ends the item and its fence", () => {
    const d = parseDocMarkers([`- ${B}scrml`, "  x", "after", `${B}scrml`, "y", B].join("\n"));
    expect(d.blocks.map((b) => b.body)).toEqual(["x", "y"]);
  });
  test("a non-scrml list-item fence cannot hide a later scrml block", () => {
    const d = parseDocMarkers([`- ${B}js`, `  ${B}scrml`, `  ${B}`, "", `${B}scrml`, "z", B].join("\n"));
    expect(d.blocks.map((b) => b.body)).toEqual(["z"]);
  });
});

describe("F2 — 0–3 spaces of indent, relative to the container", () => {
  test("a ```scrml indented 4 spaces at top level is an error, not a gated fence", () => {
    const d = parseDocMarkers([`    ${B}scrml`, "    x", `    ${B}`].join("\n"));
    expect(d.blocks.length).toBe(0);
    expect(d.errors[0].message).toContain("indented 4+ spaces");
  });
  test("a closer indented 4 spaces does not close a top-level fence", () => {
    const d = parseDocMarkers([`${B}scrml`, "x", `    ${B}`, "y", B].join("\n"));
    expect(d.blocks.length).toBe(1);
    expect(d.blocks[0].bodyLines).toEqual(["x", `    ${B}`, "y"]);
  });
  test("an opener indented 1–3 spaces is a fence", () => {
    expect(parseDocMarkers([`   ${B}scrml`, "x", `   ${B}`].join("\n")).blocks.length).toBe(1);
  });
});

describe("F3 — malformed pins are rejected", () => {
  const bad = [
    ["unclosed", "spec-ahead [E-X — reason", "unclosed"],
    ["no brackets", "spec-ahead E-PARSE-TAG — reason", "outside brackets"],
    ["after the separator", "spec-ahead — [E-PARSE-TAG] reason", "after the separator"],
    ["bare codes after the separator", "spec-ahead — E-PARSE-TAG, E-SCOPE-001 reason", "after the separator"],
    ["a second group", "spec-ahead [E-PARSE-TAG] [E-SCOPE-001] — reason", "second"],
    ["BOOTSTRAP-CRASH is not a pinnable code", "spec-ahead [BOOTSTRAP-CRASH] — reason", "bad pinned code list"],
  ];
  for (const [name, inner, msg] of bad) {
    test(name, () => {
      expect(parseGateMarker(inner).error).toContain(msg);
      const d = parseDocMarkers(["<!-- dialect: ruled -->", `<!-- gate: ${inner} -->`, `${B}scrml`, "x", B].join("\n"));
      expect(d.blocks[0].gate).toBeNull();
      expect(d.errors[0].message).toContain("malformed gate marker");
    });
  }
  test("well-formed markers still parse", () => {
    expect(parseGateMarker("spec-ahead [E-A, E-B] — why").marker).toEqual({ kind: "spec-ahead", codes: ["E-A", "E-B"], reason: "why" });
    expect(parseGateMarker("skip — E-free prose is fine when it is not a code").marker.reason).toContain("E-free prose");
    expect(parseGateMarker("skip — a fragment").marker).toEqual({ kind: "skip", codes: null, reason: "a fragment" });
  });
});

describe("4 — the claim-gate surface floor", () => {
  let root;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "surface-floor-"));
    mkdirSync(join(root, "docs/changes/x"), { recursive: true });
    mkdirSync(join(root, "docs/guide"), { recursive: true });
    const fenced = [`${B}scrml`, "<program></program>", B].join("\n");
    writeFileSync(join(root, "README.md"), fenced);
    writeFileSync(join(root, "docs/new-guide.md"), fenced);
    writeFileSync(join(root, "docs/guide/list.md"), [`- ${B}scrml`, "  x", `  ${B}`].join("\n"));
    writeFileSync(join(root, "docs/changes/x/BRIEF.md"), fenced);
    writeFileSync(join(root, "docs/prose.md"), "no code here\n```js\nlet x = 1\n```\n");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("a fenced doc that is neither gated nor excused is reported; gated, excused and fence-less docs are not", () => {
    const miss = uncoveredDocs(root, new Set(["README.md"]));
    expect(miss).toEqual(["docs/guide/list.md", "docs/new-guide.md"]);
  });
  test("every excuse carries a reason", () => {
    for (const [p, why] of Object.entries(SURFACE_UNGATED)) expect(why.length, p).toBeGreaterThan(10);
  });
  test("the round-3 additions are in the surface", () => {
    for (const p of ["docs/lin.md", "docs/external-js.md", "docs/website"]) expect(PUBLIC_SURFACE).toContain(p);
  });
  test("the real repo has no uncovered fenced doc (claim-gate --list exits 0)", () => {
    const r = spawnSync("bun", ["scripts/claim-gate.js", "--list"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stdout).not.toContain("UNGATED (surface floor)");
    expect(r.stdout).toContain("docs/lin.md");
    expect(r.status).toBe(0);
  }, 60_000);
});
