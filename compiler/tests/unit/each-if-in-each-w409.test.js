/**
 * each-if-in-each-w409.test.js — W-IF-IN-EACH is RETIRED (S469); a nested per-row `if=`
 * is reactive.
 *
 * History: GH adopter issue #409 (assetManagement) found that a per-row `if=` on a
 * NESTED (non-item-root) element inside `<each>` was a CREATE-TIME append gate —
 * evaluated once when the row was built — and W-IF-IN-EACH was minted to warn about it,
 * scoped to conditions that read the row item on the premise that an outer-state-only
 * condition "re-evaluates through the each render fn's collection effect". That premise
 * was false (the collection effect does not re-run on an outer cell, and a re-run reuses
 * the keyed row), so an outer-state guard stayed rendered after it was revoked with no
 * signal at all — a fail-open guard (g-each-nested-peritem-if-not-reactive, S469).
 *
 * S469: every per-row `if=` lowers to the element⇄comment structural swap
 * (`_scrml_ifrow_apply`) in a per-row render-gate effect, so the warning has no trigger
 * and is retired (SPEC §34, struck row). This suite pins, over the sources the warning
 * suite used, that:
 *   - no W-IF-IN-EACH is emitted, for any of them;
 *   - every nested `if=` lowers to the reactive swap (never the bare create-time append);
 *   - the old create-time-gate comment is gone.
 * Behaviour (both directions, reorders, nesting) is pinned by
 * compiler/tests/browser/each-row-if-reactive-s469.browser.test.js.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileToOutputs(source, suffix = "each-if-w409") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codesOf = (list) => list.map((w) => w.code || w);

// The sources the W-IF-IN-EACH suite pinned — positives (item-reading) and negatives
// (outer state, string-literal look-alikes, the sole root, top level) alike.
const SOURCES = {
  "nested, item-reading `it.note`": [`<program>
    <items> = [{ id: 1, note: "" }]
    <each in=@items as it key=@.id>
        <div class="row">
            <div class="via-if" if=(it.note != "")>VIA-IF: \${it.note}</div>
        </div>
    </each>
</program>
`, /_scrml_ifrow_apply\(_scrml_cur_\d+, _scrml_el_\d+, _scrml_ph_\d+, \(\(!_scrml_structural_eq\(it\.note, ""\)\)\)\)/],
  "nested, contextual sigil `@.note`": [`<program>
    <items> = [{ id: 1, note: "" }]
    <each in=@items as it key=@.id>
        <div class="row">
            <div class="via-if" if=(@.note != "")>VIA-IF: \${it.note}</div>
        </div>
    </each>
</program>
`, /_scrml_ifrow_apply\([^;]*it\.note/],
  "sole item root": [`<program>
    <items> = [{ id: 1, note: "" }]
    <each in=@items as it key=@.id>
        <div class="soleroot" if=(it.note != "")>SOLE: \${it.note}</div>
    </each>
</program>
`, /_scrml_ifrow_apply\(/],
  "nested, outer state only (was unwarned AND frozen)": [`<program>
    <items> = [{ id: 1, note: "" }]
    <show> = true
    <each in=@items as it key=@.id>
        <div class="row">
            <span if=@show>OUTER-STATE</span>
        </div>
    </each>
</program>
`, /_scrml_ifrow_apply\([^;]*_scrml_cs_reactive_get\("show"\)/],
  "nested, the iter-var word inside a string literal": [`<program>
    <items> = [{ id: 1, note: "" }]
    <label> = "hit"
    <each in=@items as it key=@.id>
        <div class="row">
            <span if=(@label == "it works")>OUTER-ONLY</span>
        </div>
    </each>
</program>
`, /_scrml_ifrow_apply\([^;]*"it works"/],
  "nested, an `@.` substring inside a string literal": [`<program>
    <items> = [{ id: 1, note: "" }]
    <email> = "z"
    <each in=@items as row key=@.id>
        <div class="row">
            <span if=(@email == "user@.example.com")>OUTER-ONLY</span>
        </div>
    </each>
</program>
`, /_scrml_ifrow_apply\([^;]*_scrml_cs_reactive_get\("email"\)/],
  // (The `@.` inside the string literal is still rewritten to the row alias by the
  // string-blind `@.` lowering — g-scrml-sigil-rewrites-reach-inside-every-string-literal,
  // pre-existing and not this suite's subject; the swap is what is pinned here.)
  "nested, an `as (k, v)` destructure binding": [`type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 4500 }, { key: "HOU", value: 3200 }]
<ul>
    <each in=@pairs as (k, v)>
        <li class="row">
            <span if=(v > 4000)>HIGH: \${k}</span>
        </li>
    </each>
</ul>
`, /_scrml_ifrow_apply\([^;]*\(v > 4000\)/],
};

describe("W-IF-IN-EACH is retired (S469) — every per-row if= is the reactive swap", () => {
  for (const [name, [src, swap]] of Object.entries(SOURCES)) {
    test(name, () => {
      const { warnings, errors, clientJs } = compileToOutputs(src);
      expect(codesOf(errors).filter((c) => !/^[WI]-/.test(c))).toEqual([]);
      expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
      expect(codesOf(errors)).not.toContain("W-IF-IN-EACH");
      expect(clientJs).toMatch(swap);
      expect(clientJs).not.toContain("create-time gate, NOT reactive");
      // No bare create-time append gate is left for a per-row if=.
      expect(clientJs).not.toMatch(/\n\s*if \([^\n]*\) _scrml_el_frag_\d+\.appendChild\(_scrml_el_\d+\);|\n\s*if \([^\n]*\) _scrml_item_frag\.appendChild\(_scrml_el_\d+\);/);
    });
  }

  test("a top-level if= (outside any <each>) is unaffected and not warned", () => {
    const { warnings, errors } = compileToOutputs(`<program>
    <show> = true
    <div if=@show>TOP-LEVEL</div>
</program>
`);
    expect(codesOf(errors).filter((c) => !/^[WI]-/.test(c))).toEqual([]);
    expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
  });
});
