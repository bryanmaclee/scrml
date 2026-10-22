/**
 * scripts/doc-boot-check.js
 *
 * Compile one scrml source with the BOOTSTRAP for the public-docs gates
 * (`scripts/claim-gate.js`, `scripts/snippet-gate.js`), in memory — nothing is written.
 * It is `scripts/scrml-boot.ts`'s `compileSource` (the same path `bun run boot:compile`
 * takes), so a doc block passes exactly when `boot:compile` would exit 0: no
 * Error-severity diagnostic and no printer refusal. Warnings do not fail.
 *
 * The bootstrap bundle loads once per process (built by impl#1 on a cold cache, ~10 s;
 * cached on disk afterwards — see scrml-boot.ts SPEED).
 */

import { compileSource, formatDiagnostic } from "./scrml-boot.ts";

/**
 * @param {string} absPath  the path the source is compiled AS (need not exist on disk when `text` is given)
 * @param {string} [text]   the source; omitted → read from `absPath`
 * @returns {Promise<{ ok: boolean, crash: boolean, codes: string[], lines: string[] }>}
 *   `codes`: the Error-severity diagnostic codes, in order; `lines`: one line per diagnostic.
 */
export async function bootCheck(absPath, text) {
  try {
    const overlay = text === undefined ? undefined : new Map([[absPath, text]]);
    const r = await compileSource(absPath, { overlay });
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    return {
      ok: r.ok,
      crash: false,
      codes: errors.map((d) => d.code),
      lines: r.diagnostics.map((d) => formatDiagnostic(d, "line")),
    };
  } catch (e) {
    return { ok: false, crash: true, codes: ["BOOTSTRAP-CRASH"], lines: [`bootstrap crash: ${String(e?.message ?? e)}`] };
  }
}

/** A short "what the bootstrap said" summary: the distinct error codes, most frequent first. */
export function codeSummary(codes, max = 4) {
  const n = new Map();
  for (const c of codes) n.set(c, (n.get(c) ?? 0) + 1);
  const sorted = [...n.entries()].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, max).map(([c, k]) => (k > 1 ? `${c}×${k}` : c));
  if (sorted.length > max) shown.push(`+${sorted.length - max} more`);
  return shown.join(", ");
}
