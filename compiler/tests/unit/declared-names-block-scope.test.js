/* SPDX-License-Identifier: MIT
 *
 * Unit — g-declared-names-set-shared-across-blocks-emits-a-bare-assignment (S415).
 *
 * ⚑ A `let` INSIDE A BLOCK PERMANENTLY MARKED THAT NAME "DECLARED" FOR THE ENCLOSING
 * SCOPE, so a later write to the same name — in a scope where that binding is NOT
 * visible — emitted a BARE ASSIGNMENT to a name that does not exist. At exit 0, with
 * zero diagnostics:
 *
 *     for (let i = 0; i < rows.length; i = i + 1) {
 *       let row = rows[i]          // block-local; leaked into declaredNames
 *     }
 *     row = "Q"                    // NOT in scope here
 *
 * emitted `row = "Q";` — a bare assignment — and the module threw
 * `ReferenceError: row is not defined` the moment it ran.
 *
 * ROOT: `emit-logic.ts` decides DECLARATION vs BARE ASSIGNMENT for a `tilde-decl`
 * purely on `opts.declaredNames?.has(node.name)`, and `let-decl`/`const-decl` ADD to
 * that set. Every BLOCK emitter threaded the set BY REFERENCE, so additions made
 * inside a block leaked out to the enclosing scope and to sibling blocks. Only
 * `function-decl` copied it (the S412 fix, `emit-logic.ts` ~:4234). The fix gives each
 * block body its own COPY — inherit the enclosing declarations, discard the block's
 * own additions on exit, which is the block scoping JS `let` actually has.
 *
 * ⚑ NO INNER FUNCTION IS REQUIRED. This is one frame. The S412 sibling needed a
 * nested `function`; this one does not, which is why S412's `function-decl` copy did
 * not close it.
 *
 * ⚑ THE CONTROLS ARE LOad-BEARING. The naive "give each block a FRESH EMPTY Set" fix
 * makes the reproducers pass while silently breaking the ordinary case — a `let`
 * declared in an ENCLOSING scope, written inside a nested block, would stop being
 * recognised as a rebind and emit `const acc = acc + 1`, which shadows the outer
 * binding and reads itself in its own TDZ. `enclosing bindings survive` below pins
 * that. `opts.declaredNames` may also be `undefined`, which means "no tracking at
 * all" — `new Set(undefined)` is an empty Set and would CHANGE behaviour, so the fix
 * preserves undefined as undefined.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
function build(source, name) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "declared-names-block-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode: "library",
    write: true, verbose: false, log: () => {},
  });
  let js = "", artifact = null;
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) { js += readFileSync(join(outDir, f), "utf8"); artifact = join(outDir, f); }
    }
  } catch { /* no artifact */ }
  return { js, artifact, errors: r.errors || [] };
}

/** Compile, assert clean, import, and hand back the module. */
async function load(source, name) {
  const { artifact, errors, js } = build(source, name);
  expect(errors.map((e) => e.code)).toEqual([]);
  expect(artifact).not.toBeNull();
  const mod = await import(pathToFileURL(artifact).href);
  return { mod, js };
}

describe("a block's `let` does not leak into the enclosing scope's declaredNames (S415)", () => {
  // -------------------------------------------------------------------------
  // ⚑ THE REPRODUCER — runtime, not emit. The emitted text alone is not enough:
  // `row = "Q";` is perfectly well-formed JS. What is wrong is that nothing
  // declares `row`, and only running it shows that.
  // -------------------------------------------------------------------------
  test("⚑ RUNTIME — a `for` block-local does not make a later same-name write bare", async () => {
    const { mod } = await load(
      `\${
  export function render(rows) {
    let out = ""
    for (let i = 0; i < rows.length; i = i + 1) {
      let row = rows[i]
      out = out + row
    }
    row = "Q"
    return out + row
  }
}`,
      "repro-for",
    );
    // Before the fix: ReferenceError: row is not defined.
    expect(mod.render(["a", "b"])).toBe("abQ");
  });

  test("⚑ RUNTIME — the same shape with an intervening inner `function`", async () => {
    const { mod } = await load(
      `\${
  export function render(rows) {
    let out = ""
    for (let i = 0; i < rows.length; i = i + 1) {
      let row = rows[i]
      out = out + row
    }
    function tag() {
      row = "Q"
      return row
    }
    return out + tag()
  }
}`,
      "repro-inner-fn",
    );
    expect(mod.render(["a", "b"])).toBe("abQ");
  });

  // -------------------------------------------------------------------------
  // CONTROL — the trigger is the NAME COLLISION, not the shape. Rename only the
  // block-local and the identical program has always worked.
  // -------------------------------------------------------------------------
  test("CONTROL — renaming only the block-local still works", async () => {
    const { mod, js } = await load(
      `\${
  export function render(rows) {
    let out = ""
    for (let i = 0; i < rows.length; i = i + 1) {
      let item = rows[i]
      out = out + item
    }
    row = "Q"
    return out + row
  }
}`,
      "control-renamed",
    );
    expect(mod.render(["a", "b"])).toBe("abQ");
    // `row` is undeclared in this frame, so it must be emitted as a DECLARATION.
    expect(/\b(const|let|var)\s+row\s*=/.test(js)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ⚑ CONTROL — the regression a "fresh empty Set" fix would cause. Enclosing
  // bindings MUST stay visible inside nested blocks, at every depth: `acc` from
  // the function frame and `bump` from the enclosing `if` block are both WRITTEN
  // two levels in, and both must emit as bare assignments, never redeclarations.
  // -------------------------------------------------------------------------
  test("⚑ CONTROL — enclosing bindings survive into nested blocks (no redeclaration)", async () => {
    const { mod, js } = await load(
      `\${
  export function f() {
    let acc = 0
    if (true) {
      let bump = 5
      for (let i = 0; i < 2; i = i + 1) {
        bump = bump + 1
        acc = acc + bump
      }
    }
    return acc
  }
}`,
      "control-enclosing",
    );
    // bump: 5->6 (acc 6), 6->7 (acc 13). A redeclaration would TDZ-throw or shadow.
    expect(mod.f()).toBe(13);
    expect(/\b(const|let|var)\s+bump\s*=\s*bump\b/.test(js)).toBe(false);
    expect(/\b(const|let|var)\s+acc\s*=\s*acc\b/.test(js)).toBe(false);
  });

  test("CONTROL — a genuine same-scope `let x` then `x = v` still emits a bare assignment", async () => {
    const { mod, js } = await load(
      `\${
  export function g() {
    let x = 1
    x = 2
    return x
  }
}`,
      "control-same-scope",
    );
    expect(mod.g()).toBe(2);
    // Exactly one declaration of `x`; the reassignment must not add a second.
    expect((js.match(/\b(const|let|var)\s+x\s*=/g) || []).length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // All four block emitters thread the Set — if, for, while, do…while.
  // -------------------------------------------------------------------------
  test("⚑ RUNTIME — `if` body", async () => {
    const { mod } = await load(
      `\${
  export function f(flag) {
    let out = ""
    if (flag) {
      let row = "a"
      out = out + row
    }
    row = "Q"
    return out + row
  }
}`,
      "block-if",
    );
    expect(mod.f(true)).toBe("aQ");
    expect(mod.f(false)).toBe("Q");
  });

  test("⚑ RUNTIME — an `if` body's `let` does not leak into its sibling `else` body", async () => {
    // The if/else limbs shared ONE bodyOpts object, so the then-branch's `let row`
    // marked `row` declared for the else-branch, which has no such binding.
    const { mod } = await load(
      `\${
  export function f(flag) {
    let out = ""
    if (flag) {
      let row = "a"
      out = out + row
    } else {
      row = "b"
      out = out + row
    }
    return out
  }
}`,
      "block-if-else-sibling",
    );
    expect(mod.f(false)).toBe("b");
    expect(mod.f(true)).toBe("a");
  });

  test("⚑ RUNTIME — `while` body", async () => {
    const { mod } = await load(
      `\${
  export function f() {
    let out = ""
    let i = 0
    while (i < 2) {
      let row = "x"
      out = out + row
      i = i + 1
    }
    row = "Q"
    return out + row
  }
}`,
      "block-while",
    );
    expect(mod.f()).toBe("xxQ");
  });

  test("⚑ RUNTIME — `do…while` body", async () => {
    const { mod } = await load(
      `\${
  export function f() {
    let out = ""
    let i = 0
    do {
      let row = "y"
      out = out + row
      i = i + 1
    } while (i < 2)
    row = "Q"
    return out + row
  }
}`,
      "block-do-while",
    );
    expect(mod.f()).toBe("yyQ");
  });

  test("⚑ RUNTIME — for-of body", async () => {
    const { mod } = await load(
      `\${
  export function f(rows) {
    let out = ""
    for r in rows {
      let row = r
      out = out + row
    }
    row = "Q"
    return out + row
  }
}`,
      "block-for-of",
    );
    expect(mod.f(["a", "b"])).toBe("abQ");
  });
});
