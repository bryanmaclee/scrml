#!/usr/bin/env bun
/**
 * sync-bootstrap-url-guard.ts — keep the bootstrap runtime's copy of the §5.2 URL guard verbatim.
 * change-id: s462-bootstrap-sink-guards.
 *
 * SPEC §5.2 rule 3: "The safe sets and the scheme test SHALL be the ones rule 2 uses — one
 * definition, not a second list." impl#1's compiler/src/runtime-url-guard.js is that definition.
 * The bootstrap runtime (compiler/self-host-v2/slice-m1/runtime/runtime.js) ships as ONE file
 * (programs import it as `scrml-runtime.js`), so it cannot import impl#1's module; it carries the
 * file's text between two marker lines instead — `export ` stripped, exactly as impl#1's own
 * runtime inlines it (runtime-template.js `URL_GUARD_RUNTIME_SOURCE`).
 *
 *   bun scripts/sync-bootstrap-url-guard.ts --write   rewrite the block from runtime-url-guard.js
 *   bun scripts/sync-bootstrap-url-guard.ts --check   exit 1 when the block has drifted
 *
 * The unit test compiler/tests/unit/bootstrap-url-guard-verbatim.test.js runs the same check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GUARD_SOURCE_PATH = join(ROOT, "compiler", "src", "runtime-url-guard.js");
export const BOOT_RUNTIME_PATH = join(ROOT, "compiler", "self-host-v2", "slice-m1", "runtime", "runtime.js");
export const BEGIN_MARKER = "// >>> BEGIN verbatim compiler/src/runtime-url-guard.js\n";
export const END_MARKER = "// <<< END verbatim compiler/src/runtime-url-guard.js\n";

/**
 * A file's text with CRLF read as LF. A Windows clone (`core.autocrlf=true`, the windows CI job)
 * checks both files out with CRLF; the comparison is of the TEXT, not the checkout's line endings
 * (and the marker lines end in `\n`).
 */
export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/** The block the bootstrap runtime must carry: the guard source, `export ` stripped. */
export function expectedBlock(): string {
  const src = readText(GUARD_SOURCE_PATH).replace(/^export /gm, "");
  return src.endsWith("\n") ? src : src + "\n";
}

/** The block the bootstrap runtime carries now (between the markers). Throws when a marker is missing. */
export function currentBlock(runtime: string): { before: string; block: string; after: string } {
  const b = runtime.indexOf(BEGIN_MARKER);
  const e = runtime.indexOf(END_MARKER);
  if (b < 0 || e < 0 || e < b) throw new Error(`${BOOT_RUNTIME_PATH}: the verbatim URL-guard markers are missing or out of order`);
  if (runtime.indexOf(BEGIN_MARKER, b + 1) >= 0 || runtime.indexOf(END_MARKER, e + 1) >= 0) {
    throw new Error(`${BOOT_RUNTIME_PATH}: a verbatim URL-guard marker appears twice`);
  }
  return { before: runtime.slice(0, b + BEGIN_MARKER.length), block: runtime.slice(b + BEGIN_MARKER.length, e), after: runtime.slice(e) };
}

export function isInSync(): boolean {
  return currentBlock(readText(BOOT_RUNTIME_PATH)).block === expectedBlock();
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) {
    console.error("usage: bun scripts/sync-bootstrap-url-guard.ts --write | --check");
    process.exit(2);
  }
  const runtime = readText(BOOT_RUNTIME_PATH);
  const cur = currentBlock(runtime);
  const want = expectedBlock();
  if (check) {
    if (cur.block === want) {
      console.log("bootstrap URL guard: in sync with compiler/src/runtime-url-guard.js");
      process.exit(0);
    }
    console.error("bootstrap URL guard: STALE — run `bun scripts/sync-bootstrap-url-guard.ts --write`");
    process.exit(1);
  }
  if (cur.block !== want) writeFileSync(BOOT_RUNTIME_PATH, cur.before + want + cur.after);
  console.log(cur.block === want ? "bootstrap URL guard: already in sync" : "bootstrap URL guard: rewritten from compiler/src/runtime-url-guard.js");
}
