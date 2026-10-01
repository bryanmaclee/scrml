/**
 * snippet-drift.test.js — the DRIFT half of scripts/snippet-gate.js.
 *
 * A documented ```scrml block marked `<!-- snippet: path -->` must equal the
 * gated file it names. These tests build a throwaway repo layout and assert the
 * check bites on each failure class and passes the equal case.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkDrift, parseDoc, normalize } from "../../../scripts/snippet-drift.js";

const FILE = ["<program>", "", "  <count> = 0", "", "  <p>${@count}</p>", "", "</program>", ""].join("\n");
const GATED = ["snips"];

let root;
function write(rel, text) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
}
const run = (docs = ["doc.md"], required = []) => checkDrift(root, GATED, docs, required);
const fence = (body, marker) => `${marker ? marker + "\n" : ""}\`\`\`scrml\n${body}\`\`\`\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "snippet-drift-"));
  write("snips/a.scrml", FILE);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("snippet drift", () => {
  test("equal copy passes (trailing whitespace ignored)", () => {
    write("doc.md", "# t\n\n" + fence(FILE.replace("= 0", "= 0   "), "<!-- snippet: snips/a.scrml -->"));
    const r = run();
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(1);
  });

  test("a drifted copy fails with a diff naming both sides", () => {
    write("doc.md", fence(FILE.replace("= 0", "= 1"), "<!-- snippet: snips/a.scrml -->"));
    const r = run();
    expect(r.failures.length).toBe(1);
    expect(r.failures[0].message).toContain("drifted from snips/a.scrml");
    expect(r.failures[0].diff).toContain("-   <count> = 0");
    expect(r.failures[0].diff).toContain("+   <count> = 1");
  });

  test("a line-range excerpt is compared dedented", () => {
    write("doc.md", fence("<count> = 0\n", "<!-- snippet: snips/a.scrml#L3-L3 -->"));
    expect(run().failures).toEqual([]);
  });

  test("an out-of-bounds range fails", () => {
    write("doc.md", fence("x\n", "<!-- snippet: snips/a.scrml#L3-L99 -->"));
    expect(run().failures[0].message).toContain("outside the file");
  });

  test("a missing target fails", () => {
    write("doc.md", fence(FILE, "<!-- snippet: snips/nope.scrml -->"));
    expect(run().failures[0].message).toContain("does not exist");
  });

  test("a target outside the compile-gated corpus fails", () => {
    write("other/a.scrml", FILE);
    write("doc.md", fence(FILE, "<!-- snippet: other/a.scrml -->"));
    expect(run().failures[0].message).toContain("outside the compile-gated corpus");
  });

  test("a dangling marker fails", () => {
    write("doc.md", "<!-- snippet: snips/a.scrml -->\nsome prose\n\n" + fence(FILE));
    const msgs = run().failures.map((f) => f.message).join("\n");
    expect(msgs).toContain("not followed by a ```scrml fence");
  });

  test("an unmarked whole program in an opted-in document fails; an unmarked fragment does not", () => {
    write("doc.md", fence(FILE, "<!-- snippet: snips/a.scrml -->") + "\n" + fence("<p>fragment</p>\n") + "\n" + fence(FILE));
    const r = run();
    expect(r.failures.length).toBe(1);
    expect(r.failures[0].message).toContain("unmarked scrml block contains a `<program` opener");
  });

  test("documents without markers are not checked", () => {
    write("doc.md", fence(FILE.replace("= 0", "= 7")));
    const r = run();
    expect(r.failures).toEqual([]);
    expect(r.docsWithMarkers).toEqual([]);
  });

  test("a required document with no markers fails (no hollow gate)", () => {
    write("doc.md", fence("<p>x</p>\n"));
    const r = run(["doc.md"], ["doc.md"]);
    expect(r.failures[0].message).toContain("required document has no");
  });

  test("markers inside another fence are ignored", () => {
    const d = parseDoc("```\n<!-- snippet: snips/a.scrml -->\n```\n");
    expect(d.dangling).toEqual([]);
    expect(d.blocks).toEqual([]);
  });

  test("normalize strips outer blank lines and CR", () => {
    expect(normalize(["", "a\r", "  b  ", ""])).toEqual(["a", "  b"]);
    expect(normalize(["    a", "      b"], true)).toEqual(["a", "  b"]);
  });
});
