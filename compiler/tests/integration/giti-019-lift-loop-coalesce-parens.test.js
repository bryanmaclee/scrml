/**
 * GITI-019 — lift-loop text interpolation with `||`/`&&` must parenthesize
 * the source expression before the auto `?? ""` coalesce guard.
 *
 * Adopter (giti) bug: a text interpolation inside a `for … lift` loop whose
 * expression has a top-level `||` (or `&&`) emitted illegal JS:
 *
 *     createTextNode(String(e.description || "(no message)" ?? ""))
 *
 * ES2020 forbids mixing `??` with a top-level `||`/`&&` operand without
 * explicit parens, so the client bundle failed `node --check` with
 * "Logical expressions and coalesce expressions cannot be mixed".
 *
 * Fix (compiler/src/codegen/emit-lift.js `emitCreateElementFromMarkup`):
 * parenthesize the inner expr →
 *
 *     createTextNode(String((e.description || "(no message)") ?? ""))
 *
 * Scope is the lift-loop / markup-embedded text-interpolation path ONLY. A
 * DIRECT top-level reactive interpolation takes the `el.textContent = expr`
 * path with NO `?? ""` wrap and is unaffected — §3 asserts it stays clean.
 *
 * Validation: acorn (the compiler's own parser dep, ecmaVersion 2022 / module)
 * rejects the `||`-mixed-with-`??` form with the same diagnostic `node --check`
 * emits, so acorn.parse is a faithful in-process stand-in for `node --check`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "giti019-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(name, source) {
  const filePath = join(TMP, name);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
  return result;
}

// result.outputs is a Map keyed by SOURCE file path; the value carries
// `.clientJs`. Match on the source basename (e.g. "repro.scrml").
function clientJsFor(result, srcName) {
  for (const [filePath, out] of result.outputs) {
    if (filePath.endsWith(srcName) && typeof out.clientJs === "string") return out.clientJs;
  }
  return undefined;
}

function isValidEsm(js) {
  try {
    acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// §1 — repro: `||` interpolation inside a for…lift loop
// ---------------------------------------------------------------------------

const REPRO_SOURCE = `<program>

@entries = [{ description: not }]

<ul>
  ${"$"}{
    for (let e of @entries) {
      lift <li>${"$"}{e.description || "(no message)"}</li>
    }
  }
</ul>

</program>`;

describe("GITI-019 §1: lift-loop interpolation with || emits valid JS", () => {
  test("compiled client.js parses (acorn === node --check) — no coalesce/logical mix", () => {
    const result = compileSource("repro.scrml", REPRO_SOURCE);
    const client = clientJsFor(result, "repro.scrml");
    expect(typeof client).toBe("string");
    const check = isValidEsm(client);
    expect(check.error).toBeNull();
    expect(check.ok).toBe(true);
  });

  test("inner expr is parenthesized before the coalesce guard", () => {
    const result = compileSource("repro.scrml", REPRO_SOURCE);
    const client = clientJsFor(result, "repro.scrml");
    // The fixed form: parens wrap the source expr; the broken form had none.
    expect(client).toContain('createTextNode(String((e.description || "(no message)") ?? ""))');
    // Guard against regression to the illegal form.
    expect(client).not.toContain('String(e.description || "(no message)" ?? "")');
  });
});

// ---------------------------------------------------------------------------
// §2 — `&&` variant takes the same parenthesized path
// ---------------------------------------------------------------------------

const REPRO_AND_SOURCE = `<program>

@entries = [{ description: not }]

<ul>
  ${"$"}{
    for (let e of @entries) {
      lift <li>${"$"}{e.description && "has-value"}</li>
    }
  }
</ul>

</program>`;

describe("GITI-019 §2: lift-loop interpolation with && also parenthesizes", () => {
  test("&& operand produces valid, parenthesized JS", () => {
    const result = compileSource("repro-and.scrml", REPRO_AND_SOURCE);
    const client = clientJsFor(result, "repro-and.scrml");
    expect(typeof client).toBe("string");
    expect(isValidEsm(client).ok).toBe(true);
    expect(client).toContain('createTextNode(String((e.description && "has-value") ?? ""))');
  });
});

// ---------------------------------------------------------------------------
// §3 — UNAFFECTED PATH: direct top-level interpolation stays clean
//       (textContent assignment, NO `?? ""` wrap) — no regression.
// ---------------------------------------------------------------------------

const DIRECT_SOURCE = `<program>

@msg = not

<div>${"$"}{@msg || "fallback"}</div>

</program>`;

describe("GITI-019 §3: direct top-level interpolation unchanged (no regression)", () => {
  test("direct interpolation emits textContent with NO coalesce wrap", () => {
    const result = compileSource("direct.scrml", DIRECT_SOURCE);
    const client = clientJsFor(result, "direct.scrml");
    expect(typeof client).toBe("string");
    // Still valid JS.
    expect(isValidEsm(client).ok).toBe(true);
    // The unaffected path: textContent assignment, no `?? ""` coalesce guard.
    expect(client).toContain('.textContent = _scrml_reactive_get("msg") || "fallback"');
    expect(client).not.toContain('?? ""');
  });
});
