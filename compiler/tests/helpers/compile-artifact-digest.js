/**
 * compile-artifact-digest — a byte-exact digest of everything one `compileScrml`
 * call produces for a single input file: every artifact string of every output
 * entry, plus the sorted diagnostic stream — errors + warnings + lintDiagnostics
 * (code|message), all three result fields.
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
  parts.push(`::diagnostics::${sha(diagStream(r))}`);
  return { digest: sha(parts.join("\n")), parts };
}

/**
 * The diagnostic stream, ALL THREE result fields.
 *
 * `compileScrml` returns diagnostics in three places, not two: `errors` (fatal),
 * `warnings` (W-*), and `lintDiagnostics` (I-*). A digest that hashes only the
 * first two is blind to an order-dependent lint, and reads GREEN while the
 * property it exists to prove is violated — the §8 hollow gate, and the exact
 * three-field trap this repo has been bitten by before (a probe reading only
 * `.errors` concluded "no warning fires" when the warning was in `.warnings`).
 */
function diagStream(r) {
  return [...(r.errors ?? []), ...(r.warnings ?? []), ...(r.lintDiagnostics ?? [])]
    .map((e) => `${e.code ?? ""}|${e.message ?? ""}`)
    .sort()
    .join("\n");
}

/**
 * Digest every output of ONE `compileScrml` call over a SET of input files,
 * keyed by output key so the result can be compared across input ORDERINGS
 * without attributing outputs back to source files.
 *
 * This is the axis `digestCompile` cannot reach. That one compiles a single file
 * per call, so it proves PROCESS-HISTORY independence — what this process
 * compiled EARLIER does not change the result. It says nothing about
 * WITHIN-UNIT order: whether the same file SET handed to one call in a different
 * sequence produces the same artifacts. That is the shape the original leak had
 * (`_structuralDeclNamesForFile` carrying one file's structural-decl set into the
 * next file's function-body emission), and it is the open
 * `compilescrml-input-order-canonical` thread.
 */
export function digestCompileSet(files) {
  const r = compileScrml({ inputFiles: files, write: false, outputDir: "/nonexistent-scrml-digest" });
  const byKey = new Map();
  for (const key of [...r.outputs.keys()].sort()) {
    const out = r.outputs.get(key);
    const fields = [];
    for (const field of Object.keys(out).sort()) {
      const v = out[field];
      fields.push(`${field}::${sha(typeof v === "string" ? v : JSON.stringify(v) ?? "")}`);
    }
    byKey.set(key, sha(fields.join("\n")));
  }
  return { byKey, diagnostics: sha(diagStream(r)) };
}

if (import.meta.main) {
  for (const file of process.argv.slice(2)) {
    const { digest, parts } = digestCompile(file);
    console.log(JSON.stringify({ file, digest, parts }));
  }
}
