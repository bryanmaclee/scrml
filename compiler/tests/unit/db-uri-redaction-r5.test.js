/**
 * s430-dev-db-stub F4 round 5 — a secret must not leak through PATH
 * NORMALISATION. `path.resolve` rewrites `//`, `/./` and `/../` inside a
 * password, so a message that resolves the RAW value and redacts afterwards
 * prints the rewritten secret (no longer a match for anything). The
 * protect-analyzer now resolves the DISPLAY form for every message path.
 *
 * Each input is checked END-TO-END through the CLI (E-PA-002 with no DDL, and
 * the Note(PA) path with DDL) and through the LSP. Every fragment a
 * normalisation could produce is asserted absent.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.js");

const CASES = [
  {
    name: "`//` inside a userinfo password",
    value: "sqlite://app:k3J9//Xq8vLm2PzA@./data.db",
    fragments: ["k3J9//Xq8vLm2PzA", "k3J9/Xq8vLm2PzA", "Xq8vLm2PzA", "k3J9"],
  },
  {
    name: "`//` inside a ?password= value",
    value: "sqlite:./data.db?password=k3J9//Xq8vLm2PzA",
    fragments: ["k3J9//Xq8vLm2PzA", "k3J9/Xq8vLm2PzA", "Xq8vLm2PzA", "k3J9"],
  },
  {
    name: "`/./` inside a ?pwd= value",
    value: "sqlite:./b.db?pwd=a/./Qz9",
    fragments: ["a/./Qz9", "a/Qz9", "Qz9"],
  },
  {
    name: "`/../` inside a ?password= value",
    value: "sqlite:./c.db?password=Pp1/../Zz8wQ",
    fragments: ["Pp1/../Zz8wQ", "Zz8wQ", "Pp1"],
  },
];

const body = (v, ddl) =>
  `<program db="${v}">\n  <db src="${v}" tables="items">\n` +
  (ddl ? `    \${\n      function mk() {\n        ?{\`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)\`}.run()\n      }\n    }\n` : "") +
  `    <p>x</p>\n  </db>\n</program>\n`;

describe("round 5: normalised paths never carry a secret", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-norm-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  CASES.forEach((c, i) => {
    for (const ddl of [false, true]) {
      test(`CLI ${ddl ? "Note(PA)" : "E-PA-002"} — ${c.name}`, () => {
        const f = join(dir, `n${i}${ddl ? "d" : ""}.scrml`);
        writeFileSync(f, body(c.value, ddl));
        const r = Bun.spawnSync([process.execPath, CLI, "compile", f, "-o", join(dir, `o${i}${ddl}`)], { stdout: "pipe", stderr: "pipe" });
        const out = r.stdout.toString() + "\n" + r.stderr.toString();
        expect(out).toContain(ddl ? "Note(PA)" : "E-PA-002");
        expect(out).toContain("<redacted>");
        for (const frag of c.fragments) expect(out).not.toContain(frag);
      });
    }

    test(`LSP — ${c.name}`, async () => {
      const { analyzeText } = await import("../../../lsp/handlers.js");
      const orig = process.stderr.write;
      let err = "";
      process.stderr.write = (chunk) => { err += String(chunk); return true; };
      let res;
      try {
        res = analyzeText(join(dir, `lsp${i}.scrml`), body(c.value, false));
      } finally {
        process.stderr.write = orig;
      }
      expect(res.diagnostics.some((d) => d.code === "E-PA-002")).toBe(true);
      const all = res.diagnostics.map((d) => d.message).join("\n") + err;
      for (const frag of c.fragments) expect(all).not.toContain(frag);
    });
  });

  test("the protect-analyzer alone (no chokepoint) already prints only the display path", async () => {
    const { runPA } = await import("../../src/protect-analyzer.js");
    for (const c of CASES) {
      const file = join(dir, "raw.scrml");
      const span = { file, start: 0, end: 10, line: 1, col: 1 };
      const ast = {
        filePath: file,
        nodes: [{ id: 1, kind: "state", stateType: "db", children: [], span, attrs: [
          { name: "src", value: { kind: "string-literal", value: c.value }, span },
          { name: "tables", value: { kind: "string-literal", value: "items" }, span },
        ] }],
      };
      const notes = [];
      const { errors } = runPA({ files: [ast], onNote: (l) => notes.push(l) });
      const text = errors.map((e) => e.message).join("\n") + notes.join("");
      expect(text).toContain("E-PA-002");
      for (const frag of c.fragments) expect(text).not.toContain(frag);
    }
  });
});
