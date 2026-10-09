/**
 * S462 — a write to a narrowed place ends the narrowing (SPEC §42.3.5).
 *
 * Ruling (user-voice-scrml.md S462 "b"), verbatim in §42.3.5:
 *   "A write to the narrowed place — direct, in a nested block, or by a call that writes
 *    it or whose write set cannot be determined — ends the narrowing from that point; a
 *    later member access through it is E-TYPE-046."
 *
 * Structure (when a write happens): compiler/src/presence-narrowing.ts `endsWithin`.
 * What a node writes (a function's write set, the unresolvable-call limb):
 * compiler/src/narrowing-write-set.ts. E-TYPE-046 consumer: type-system.ts
 * `checkOptionalMemberAccess`; E-TYPE-031 (optional fn props) shares the walker.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let n = 0;

function compile(source) {
  const name = `s462-narrow-${process.pid}-${++n}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return result.errors ?? [];
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * The E-TYPE-046 errors of a compile. Every case here is otherwise clean: any OTHER
 * error would mean the case does not test what it says, so it fails the test.
 */
const e046 = (src) => {
  const all = compile(src);
  expect(all.filter((e) => e.code !== "E-TYPE-046").map((e) => e.code)).toEqual([]);
  return all.filter((e) => e.code === "E-TYPE-046");
};

/** A program with a plain-optional `@user`, a second one `@other`, and the given logic. */
function prog(logic) {
  return `<program>
type User:struct = { name: string }
<user>: User | not = { name: "a" }
<other>: User | not = { name: "b" }
<out> = ""
<n>: int = 0
\${
${logic}
}
<p>\${@out}</p>
</program>
`;
}

describe("S462 — a write ends the narrowing (E-TYPE-046 fires after it)", () => {
  test("the reproducer: a call to a function that writes the cell", () => {
    const errs = e046(prog(`
    function clear() { @user = not }
    function show() {
        if (@user is given) {
            clear()
            @out = @user.name
        }
    }`));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("narrowing of `@user` ended");
  });

  test("a direct write in the narrowed block", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            @user = not
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("a write in a nested block (an `if` branch) ends it after the block", () => {
    expect(e046(prog(`
    function show(c: bool) {
        if (@user is given) {
            if (c) { @user = not }
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("a write later in a loop body ends it for the whole body (next iteration)", () => {
    expect(e046(prog(`
    function show(xs: int[]) {
        if (@user is given) {
            for (const x of xs) {
                @out = @user.name
                @user = not
            }
        }
    }`)).length).toBe(1);
  });

  test("a write after the loop does not reach back into it", () => {
    expect(e046(prog(`
    function show(xs: int[]) {
        if (@user is given) {
            for (const x of xs) {
                @out = @user.name
            }
            @user = not
        }
    }`)).length).toBe(0);
  });

  test("a call to a function that writes the cell transitively", () => {
    expect(e046(prog(`
    function inner() { @user = not }
    function outer() { inner() }
    function show() {
        if (@user is given) {
            outer()
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("reset(@cell) is a write", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            reset(@user)
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("an unresolvable call (a callback parameter) ends every narrowing", () => {
    const errs = e046(prog(`
    function show(cb: () -> void) {
        if (@user is given) {
            cb()
            @out = @user.name
        }
    }`));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("cannot be determined");
  });

  test("an unresolvable call through a local holding a function", () => {
    expect(e046(prog(`
    function show() {
        const f = () => { @user = not }
        if (@user is given) {
            f()
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("a function that calls an unresolvable callee has an undetermined write set", () => {
    expect(e046(prog(`
    function run(cb: () -> void) { cb() }
    function show() {
        if (@user is given) {
            run(() => { })
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("a lambda handed to a built-in callback method that writes the cell", () => {
    expect(e046(prog(`
    function clear() { @user = not }
    function show(xs: int[]) {
        if (@user is given) {
            xs.forEach(x => clear())
            @out = @user.name
        }
    }`)).length).toBe(1);
  });

  test("within one expression: an operand evaluated after the write", () => {
    expect(e046(prog(`
    function clear() -> string { @user = not
        return "" }
    function show() {
        if (@user is given) {
            @out = clear() + @user.name
        }
    }`)).length).toBe(1);
  });

  test("an early-return narrowing ends at a later write", () => {
    expect(e046(prog(`
    function clear() { @user = not }
    function show() {
        if (@user is not) return
        clear()
        @out = @user.name
    }`)).length).toBe(1);
  });

  test("given @cell :> body — a write in the body ends it", () => {
    expect(e046(prog(`
    function clear() { @user = not }
    function show() {
        given @user :> {
            clear()
            @out = @user.name
        }
    }`)).length).toBe(1);
  });
});

describe("S462 — the narrowing SURVIVES what does not write the place", () => {
  test("a call to a function proven NOT to write the cell", () => {
    expect(e046(prog(`
    function bump() { @n = @n + 1 }
    function show() {
        if (@user is given) {
            bump()
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("a write to a DIFFERENT cell", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            @other = not
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("a function that writes a different optional cell", () => {
    expect(e046(prog(`
    function clearOther() { @other = not }
    function show() {
        if (@user is given) {
            clearOther()
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("a read BEFORE the write", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            @out = @user.name
            @user = not
        }
    }`)).length).toBe(0);
  });

  test("the write's own right-hand side reads before the write", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            @user = { name: @user.name }
        }
    }`)).length).toBe(0);
  });

  test("a write UNDER the place (a field) does not end it", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            @user.name = "z"
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("a write in a branch that always returns does not reach the rest", () => {
    expect(e046(prog(`
    function show(c: bool) {
        if (@user is given) {
            if (c) {
                @user = not
                return
            }
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("built-in calls (`Math.`, `.trim()`, `String(...)`) do not end it", () => {
    expect(e046(prog(`
    function show(s: string) {
        if (@user is given) {
            const k = Math.max(1, 2)
            const t = s.trim()
            const u = String(k)
            @out = @user.name + t + u
        }
    }`)).length).toBe(0);
  });

  test("a scheduled callback (setTimeout) runs later, not here", () => {
    expect(e046(prog(`
    function clear() { @user = not }
    function show() {
        if (@user is given) {
            setTimeout(() => clear(), 10)
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("a function DEFINED (not called) in the block writes nothing here", () => {
    expect(e046(prog(`
    function show() {
        if (@user is given) {
            const f = () => { @user = not }
            @out = @user.name
        }
    }`)).length).toBe(0);
  });

  test("a fresh test after the write narrows again", () => {
    expect(e046(prog(`
    function clear() { @user = not }
    function show() {
        if (@user is given) {
            clear()
            if (@user is given) {
                @out = @user.name
            }
        }
    }`)).length).toBe(0);
  });
});

describe("S462 — E-TYPE-031 (optional function prop) shares the reader", () => {
  const comp = (handler) => `<program>
const C = <div class="c" props={ onGo?: () => void }>
    <button class="g" onclick=\${${handler}}>g</button>
</>
<C/>
</program>
`;
  const codes = (src) => compile(src).map((e) => e.code);

  test("a narrowed prop, then assigned, then called — E-TYPE-031", () => {
    // The assignment is also E-COMPONENT-PROP-WRITE (a by-value prop); the narrowing
    // ends at it either way.
    expect(codes(comp(`() => { if (onGo is some) { onGo = not; onGo() } }`))).toContain("E-TYPE-031");
  });

  test("a narrowed prop survives a call (a call cannot rebind a local)", () => {
    expect(codes(comp(`() => { if (onGo is some) { console.log("x"); onGo() } }`))).not.toContain("E-TYPE-031");
  });
});
