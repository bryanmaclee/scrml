// parser-flag-retired.test.js — S449 (user-voice item 6 = (b)).
//
// The full-pipeline `--parser=scrml-native` routing is retired: compiler/native-parser
// is a frozen component of impl#1, reached only at its fixed internal call sites.
// A caller that still asks for it must be told, not silently compiled with the
// default front end.

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const CLI = resolve(import.meta.dir, "../../src/cli.js");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "parser-flag-retired-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, "<program>\n<p>hi</p>\n</program>\n");
  return { dir, file };
}

describe("the retired `parser` option", () => {
  test("compileScrml throws on parser: \"scrml-native\"", () => {
    const { dir, file } = fixture();
    try {
      expect(() => compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), parser: "scrml-native" }))
        .toThrow(/`parser` option is retired \(S449\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("compileScrml accepts an absent / null parser (the default front end)", () => {
    const { dir, file } = fixture();
    try {
      expect(compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), log: () => {} }).errors).toEqual([]);
      expect(compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), log: () => {}, parser: null }).errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`scrml compile --parser=scrml-native` exits 1 with a retirement message", () => {
    const { dir, file } = fixture();
    try {
      for (const args of [["--parser=scrml-native"], ["--parser", "scrml-native"]]) {
        const r = Bun.spawnSync(["bun", CLI, "compile", file, "-o", join(dir, "out"), ...args], { stdout: "pipe", stderr: "pipe" });
        expect(r.exitCode).toBe(1);
        expect(r.stderr.toString()).toContain("--parser is retired (S449)");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
