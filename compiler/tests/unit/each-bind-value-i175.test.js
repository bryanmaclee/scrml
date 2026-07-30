/**
 * each-bind-value-i175.test.js — per-item `bind:value` value-side wiring inside
 * `<each>` (GH adopter issue #175, SPEC §5.4).
 *
 * Before i175, every per-item `bind:`/`ref`/`transition:` directive silently
 * no-op'd to a `// deferred (Landing 2 scope...)` comment — the `<input>`
 * rendered but had NO value binding and NO write-back handler (SPEC §5.4
 * violation; no `<each>` carve-out exists). This suite pins the restoration:
 *
 *   §1 — OUTER/shared reactive-cell target (`bind:value=@msg`) is WIRED via the
 *        shared `emitBindDirectiveBody` helper: initial value binding, write-back
 *        addEventListener, and a live-keyed read-back effect (disposes with the
 *        item across reconcile). The old deferred comment is GONE.
 *   §2 — ITEM-FIELD target (`bind:value=@.field` / `@<iterVar>.field`) is
 *        DEFERRED LOUDLY: a W-EACH-BIND-ITEM-FIELD-DEFERRED warning + a comment,
 *        NOT silent wiring.
 *   §3 — top-level (non-each) `bind:value` emission stays BYTE-IDENTICAL: the
 *        each-only live-keying (`_scrml_resolve_item`) must NOT leak into the
 *        default file-scope path (proves the shared helper's default-opts output
 *        is untouched — only a new caller was added).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToOutputs(source, suffix = "each-bind-i175") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
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

// ---------------------------------------------------------------------------
// §1 — OUTER cell bind:value inside <each> is wired (value + write-back + effect)
// ---------------------------------------------------------------------------

const OUTER_SRC = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = []
<msg>: string = ""
<ul>
    <each in=@items key=@.id>
        <li>
            <input bind:value=@msg />
        </li>
    </each>
</ul>
</program>
`;

describe("each bind:value i175 §1 — outer cell wired", () => {
  test("compiles with no errors", () => {
    const { errors } = compileToOutputs(OUTER_SRC);
    expect(errors).toEqual([]);
  });

  test("value side + write-back + live-keyed read-back effect are emitted", () => {
    const { clientJs } = compileToOutputs(OUTER_SRC);
    // initial value binding + reactive read
    expect(clientJs).toContain('.value = _scrml_cs_reactive_get("msg");');
    // write-back handler
    expect(clientJs).toMatch(/\.addEventListener\("input", \(event\) => _scrml_cs_reactive_set\("msg", event\.target\.value\)\);/);
    // read-back effect is LIVE-KEYED to the reconcile lifecycle (disposes with item)
    expect(clientJs).toMatch(/_scrml_effect\(\(\) => \{ let \w+ = _scrml_resolve_item\(_mount, _scrml_each_key_\d+\); if \(\w+ === null\) return; .*\.value = _scrml_cs_reactive_get\("msg"\); \}\)/);
  });

  test("the old deferred comment is GONE for a wired bind:value", () => {
    const { clientJs } = compileToOutputs(OUTER_SRC);
    const stillDeferred = clientJs
      .split("\n")
      .filter((l) => /"bind:value" deferred \(Landing 2 scope/.test(l));
    expect(stillDeferred).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — item-field bind:value is deferred LOUDLY (W-EACH-BIND-ITEM-FIELD-DEFERRED)
// ---------------------------------------------------------------------------

const ITEM_FIELD_SRC = `<program>
type Item:struct = { id: string, text: string }
<items>: Item[] = []
<ul>
    <each in=@items as todo key=@.id>
        <li>
            <input bind:value=@.text />
        </li>
    </each>
</ul>
</program>
`;

describe("each bind:value i175 §2 — item-field deferred loudly", () => {
  test("emits the W-EACH-BIND-ITEM-FIELD-DEFERRED warning (not silent)", () => {
    const { warnings } = compileToOutputs(ITEM_FIELD_SRC);
    const codes = warnings.map((w) => w.code || w);
    expect(codes).toContain("W-EACH-BIND-ITEM-FIELD-DEFERRED");
  });

  test("emits a DEFERRED comment and does NOT wire a write-back for the item field", () => {
    const { clientJs } = compileToOutputs(ITEM_FIELD_SRC);
    expect(clientJs).toContain("item-field binding DEFERRED (W-EACH-BIND-ITEM-FIELD-DEFERRED)");
    // No write-back reactive_set for the item field (it is NOT wired).
    expect(clientJs).not.toContain('_scrml_cs_reactive_set("text"');
  });

  test("the same-root iter-var form (@todo.text) is also treated as item-field", () => {
    const src = ITEM_FIELD_SRC.replace("bind:value=@.text", "bind:value=@todo.text");
    const { warnings } = compileToOutputs(src);
    const codes = warnings.map((w) => w.code || w);
    expect(codes).toContain("W-EACH-BIND-ITEM-FIELD-DEFERRED");
  });
});

// ---------------------------------------------------------------------------
// §3 — top-level (non-each) bind:value stays byte-identical (no each leakage)
// ---------------------------------------------------------------------------

const TOPLEVEL_SRC = `<program>
<name>: string = ""
<input bind:value=@name />
</program>
`;

describe("each bind:value i175 §3 — top-level path unchanged", () => {
  test("top-level bind:value read-back effect is NOT live-keyed (no _scrml_resolve_item)", () => {
    const { clientJs, errors } = compileToOutputs(TOPLEVEL_SRC);
    expect(errors).toEqual([]);
    // Standard file-scope shape: document.querySelector acquire + bare effect.
    expect(clientJs).toContain('.value = _scrml_cs_reactive_get("name");');
    // §17.1 Phase 2 (S301): emitBindings' output is wrapped in a root-scoped
    // `_scrml_bind_rewire(root)` so an `if=` mount can re-bind it, hence
    // `(root || document).querySelector` rather than a bare `document.`.
    expect(clientJs).toMatch(/\(root \|\| document\)\.querySelector\('\[data-scrml-bind-value[^']*'\)/);
    // The each-only live-keying must not leak into the default path.
    expect(clientJs).not.toContain("_scrml_resolve_item");
    // No each-bind deferred/warning noise for a plain top-level bind.
    expect(clientJs).not.toContain("W-EACH-BIND-ITEM-FIELD-DEFERRED");
  });
});
