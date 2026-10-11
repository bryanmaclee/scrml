#!/usr/bin/env bun
/**
 * gen-md-shim.ts — GENERATE compiler/runtime/stdlib/md.js from stdlib/md/index.scrml.
 * change-id: s462-md-phase1.
 *
 * WHY GENERATED. Every other stdlib module ships a HAND-WRITTEN JS shim that mirrors its `.scrml`
 * export list (compiler/src/api.js, "Stdlib runtime directory"). For `scrml:md` a hand-written shim
 * would be a second markdown reader, and SPEC §67.8 (ruling S462 F4: "one md reader, written in
 * scrml (`scrml:md`), used by BOTH compilers") allows exactly one. So the shim is impl#1's own
 * library-mode compile of the scrml reader (§21.5, `--mode library`), with one edit: the compile
 * imports the host-global alias from `./_scrml/_global.js`, and a shim is copied ALONE into a
 * program's `_scrml/` directory, so that import becomes `const _scrml_g = globalThis;` (the
 * alias module's whole content). The header stamps the sha-256 of the scrml source.
 *
 *   bun scripts/gen-md-shim.ts           write compiler/runtime/stdlib/md.js
 *   bun scripts/gen-md-shim.ts --check   exit 1 when md.js is not what the source compiles to now
 *
 * The unit test compiler/tests/unit/stdlib-md-shim.test.js pins the stamped hash against the
 * source and runs the reader's corpus through BOTH a fresh compile and the committed shim.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScrml } from "../compiler/src/api.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MD_SOURCE = join(ROOT, "stdlib", "md", "index.scrml");
export const MD_SHIM = join(ROOT, "compiler", "runtime", "stdlib", "md.js");

const ALIAS_IMPORT = /^import _scrml_g from "\.\/_scrml\/_global\.js";[^\n]*\n/m;

/** The sha-256 of the scrml source, as text with CRLF read as LF. */
export function sourceHash(): string {
  const text = readFileSync(MD_SOURCE, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text).digest("hex");
}

/** Compile the scrml reader in library mode and return the ES module text (alias import intact). */
export function compileReader(): string {
  const outDir = mkdtempSync(join(tmpdir(), "scrml-md-shim-"));
  try {
    const result = compileScrml({ inputFiles: [MD_SOURCE], outputDir: outDir, write: true, mode: "library", log: () => {} });
    const errs = (result.errors ?? []).filter((e: { code?: string; severity?: string }) => e && e.code !== undefined && e.severity !== "warning" && e.severity !== "info");
    if (errs.length > 0) {
      throw new Error("stdlib/md/index.scrml failed to compile:\n" + errs.map((e: { code: string; message?: string }) => `${e.code} ${e.message ?? ""}`).join("\n"));
    }
    return readFileSync(join(outDir, "index.js"), "utf8");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** The shim text: the compiled module, the alias import replaced, the header stamped. */
export function buildShim(compiled: string = compileReader()): string {
  if (!ALIAS_IMPORT.test(compiled)) throw new Error("gen-md-shim: the library compile no longer imports ./_scrml/_global.js — update ALIAS_IMPORT");
  const body = compiled.replace(ALIAS_IMPORT, "const _scrml_g = globalThis; // the host-global alias (SPEC §47.1.1); a shim is copied alone into _scrml/\n");
  const header =
    "// scrml:md — runtime shim. GENERATED — do not edit.\n" +
    "//\n" +
    "// This file is impl#1's library-mode compile of stdlib/md/index.scrml (the one md reader,\n" +
    "// SPEC §67.8), written by scripts/gen-md-shim.ts. Edit the scrml source and regenerate:\n" +
    "//   bun scripts/gen-md-shim.ts\n" +
    `// source-sha256: ${sourceHash()}\n`;
  return header + body;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const want = buildShim();
  if (check) {
    let have = "";
    try { have = readFileSync(MD_SHIM, "utf8").replace(/\r\n/g, "\n"); } catch { have = ""; }
    if (have !== want) {
      console.error("gen-md-shim: compiler/runtime/stdlib/md.js is stale — run `bun scripts/gen-md-shim.ts`");
      process.exit(1);
    }
    console.log("gen-md-shim: md.js is current");
  } else {
    writeFileSync(MD_SHIM, want);
    console.log(`gen-md-shim: wrote ${MD_SHIM}`);
  }
}
