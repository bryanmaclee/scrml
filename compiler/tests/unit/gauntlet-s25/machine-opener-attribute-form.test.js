/**
 * S25 gauntlet — §51.3.2 machine opener attribute form.
 *
 * The pre-S25 sentence form `< machine Name for Type>` was ratified for
 * migration in S24 (radical-doubt debate 2026-04-17) and deferred to the
 * next §51 amendment. S25 executes the migration:
 *
 *   OLD: `< machine Name for Type>`
 *   NEW: `< machine name=Name for=Type>`
 *
 *   OLD: `< machine Name for Type derived from @Source>`
 *   NEW: `< machine name=Name for=Type derived=@Source>`
 *
 * Attribute values SHALL be bareword identifiers (not quoted strings).
 * The sentence form now fires E-ENGINE-020.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-opener-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      m020: (result.errors ?? []).filter(e => e.code === "E-ENGINE-020"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §51.3.2 — machine opener attribute form", () => {
  test("attribute-form opener compiles clean", () => {
    const src = `<program>
\${
  type Color:enum = { Red, Green, Blue }
  @light: Traffic = Color.Red
  function advance() { @light = Color.Green }
}
< machine name=Traffic for=Color>
  .Red => .Green
  .Green => .Blue
  .Blue => .Red
</>
<p>x</>
</program>
`;
    const { errors } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
  });

  test("attribute order is flexible (for=X first, name=Y second)", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @state: M = S.A
  function go() { @state = S.B }
}
< machine for=S name=M>
  .A => .B
</>
<p>x</>
</program>
`;
    const { errors } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
  });

  test("derived machine uses derived=@X attribute form", () => {
    const src = `<program>
\${
  type Order:enum = { Pending, Shipped }
  type UIMode:enum = { Busy, Ready }
  @order: OrderFlow = Order.Pending
  function ship() { @order = Order.Shipped }
}
< machine name=OrderFlow for=Order>
  .Pending => .Shipped
</>
< machine name=UI for=UIMode derived=@order>
  .Pending => .Busy
  .Shipped => .Ready
</>
<p>x</>
</program>
`;
    const { errors } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
  });

  test("pre-S25 sentence form → E-ENGINE-020", () => {
    const src = `<program>
\${
  type Color:enum = { Red, Green, Blue }
  @light: Traffic = Color.Red
  function advance() { @light = Color.Green }
}
< machine Traffic for Color>
  .Red => .Green
</>
<p>x</>
</program>
`;
    const { m020 } = compileSrc(src);
    expect(m020.length).toBeGreaterThan(0);
    expect(m020[0].message).toContain("sentence form");
    expect(m020[0].message).toContain("name=Traffic");
    expect(m020[0].message).toContain("for=Color");
  });

  test("pre-S25 sentence form with derived-from clause → E-ENGINE-020 and suggests derived=", () => {
    const src = `<program>
\${
  type Order:enum = { Pending, Shipped }
  type UIMode:enum = { Busy, Ready }
  @order: OrderFlow = Order.Pending
  function ship() { @order = Order.Shipped }
}
< machine OrderFlow for Order>
  .Pending => .Shipped
</>
< machine UI for UIMode derived from @order>
  .Pending => .Busy
  .Shipped => .Ready
</>
<p>x</>
</program>
`;
    const { m020 } = compileSrc(src);
    // Both sentence-form openers should trip E-ENGINE-020.
    expect(m020.length).toBe(2);
    const derivedMsg = m020.find(e => e.message.includes("derived="));
    expect(derivedMsg).toBeTruthy();
    expect(derivedMsg.message).toContain("derived=@order");
  });

  test("whitespace around = is accepted", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @state: M = S.A
  function go() { @state = S.B }
}
< machine name = M   for  =   S>
  .A => .B
</>
<p>x</>
</program>
`;
    const { errors } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
  });
});
