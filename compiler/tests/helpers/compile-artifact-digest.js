/**
 * compile-artifact-digest — a byte-exact digest of everything one `compileScrml`
 * call produces for a single input file: every artifact string of every output
 * entry, plus the sorted diagnostic stream (errors + warnings, code|message).
 *
 * Used by compile-order-independence.test.js (s430-emit-state-leak): the
 * compiler's output must be a pure function of its input — compiling file X
 * after files A, B, C in the same process must produce exactly what compiling X
 * alone in a fresh process produces.
 *
 * Two entry points:
 *   - `digestCompile(file)` — in-process (uses the caller's module state).
 *   - CLI: `bun compile-artifact-digest.js <file>...` — prints one JSON line per
 *     file `{file, digest}`; spawned once per file to get a FRESH-process digest.
 */
import { createHash } from "crypto";
import { compileScrml } from "../../src/api.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function digestCompile(file) {
  const r = compileScrml({ inputFiles: [file], write: false, outputDir: "/nonexistent-scrml-digest" });
  const parts = [];
  for (const key of [...r.outputs.keys()].sort()) {
    const out = r.outputs.get(key);
    for (const field of Object.keys(out).sort()) {
      const v = out[field];
      parts.push(`${key}::${field}::${sha(typeof v === "string" ? v : JSON.stringify(v) ?? "")}`);
    }
  }
  const diags = [...(r.errors ?? []), ...(r.warnings ?? [])]
    .map((e) => `${e.code ?? ""}|${e.message ?? ""}`)
    .sort();
  parts.push(`::diagnostics::${sha(diags.join("\n"))}`);
  return { digest: sha(parts.join("\n")), parts };
}

if (import.meta.main) {
  for (const file of process.argv.slice(2)) {
    const { digest, parts } = digestCompile(file);
    console.log(JSON.stringify({ file, digest, parts }));
  }
}
