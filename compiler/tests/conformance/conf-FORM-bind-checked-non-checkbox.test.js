/**
 * CONF-FORM-bind-checked-non-checkbox | §34 / §5.4.1 (D-FORM-8)
 *
 * Catalog: E-ATTR-011 — `bind:` used on an unsupported render-spec.
 * Normative: SPEC §5.4.1 L1651 — "`bind:checked` is dispatched ONLY when the
 * render-spec is `<input type="checkbox"/>`. Any other type with `bind:checked`
 * on the source-level bind form is `E-ATTR-011`." Without this the compiler
 * silently wires `.checked` + a change listener onto a text-shaped input.
 *
 * A BARE `<input bind:checked=@x>` (no `type` attr) is tolerated — the author
 * intends a checkbox; only an EXPLICIT conflicting type is rejected.
 *
 * Firing site: compiler/src/codegen/emit-html.ts bind: validation pre-pass
 * (the E-ATTR-011 tag/type check, co-located with BIND_VALID_TAGS).
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-FORM-bind-checked-non-checkbox: §5.4.1 bind:checked on non-checkbox → E-ATTR-011", () => {
  test('POS: <input type="text" bind:checked=@flag/> fires E-ATTR-011', () => {
    const src = `<program>
<flag> = false
<input type="text" bind:checked=@flag/>
</>
`;
    const { errors } = compile(src, "checked-text");
    const e011 = errors.filter(e => e.code === "E-ATTR-011");
    expect(e011.length).toBeGreaterThanOrEqual(1);
    expect(e011[0].message).toContain('type="checkbox"');
  });

  test('POS: <input type="number" bind:checked=@flag/> fires E-ATTR-011', () => {
    const src = `<program>
<flag> = false
<input type="number" bind:checked=@flag/>
</>
`;
    const { errors } = compile(src, "checked-number");
    expect(errors.some(e => e.code === "E-ATTR-011")).toBe(true);
  });

  test('NEG: <input type="checkbox" bind:checked=@flag/> does NOT fire E-ATTR-011', () => {
    const src = `<program>
<flag> = false
<input type="checkbox" bind:checked=@flag/>
</>
`;
    const { errors } = compile(src, "checked-checkbox");
    expect(errors.some(e => e.code === "E-ATTR-011")).toBe(false);
  });

  test('NEG: bare <input bind:checked=@flag/> (no type attr) does NOT fire E-ATTR-011', () => {
    const src = `<program>
<flag> = false
<input bind:checked=@flag/>
</>
`;
    const { errors } = compile(src, "checked-bare");
    expect(errors.some(e => e.code === "E-ATTR-011")).toBe(false);
  });
});
