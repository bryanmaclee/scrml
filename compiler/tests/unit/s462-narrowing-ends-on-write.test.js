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

  test("a narrowed prop survives a call (every prop write is already E-COMPONENT-PROP-WRITE)", () => {
    expect(codes(comp(`() => { if (onGo is some) { console.log("x"); onGo() } }`))).not.toContain("E-TYPE-031");
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 1 (S239 differential review of 0006c9243). Each case: before = the count on
// 0006c9243, after = this commit.
// ---------------------------------------------------------------------------
function prog2(logic) {
  return `<program>
type User:struct = { name: string }
type K:enum = { A, B }
<user>: User | not = { name: "a" }
<out> = ""
<k>: K = .A
\${
${logic}
}
<p>\${@out}</p>
</program>
`;
}
const n046 = (logic) => e046(prog2(logic)).length;

describe("S462 fix round 1 — fail-open holes closed", () => {
  test("F1: a write in a callee's RETURNING branch is in its write set (may-write)", () => {
    expect(n046(`
    function clear() { if (@out == "") { @user = not
            return } }
    function show() { if (@user is given) { clear()
            @out = @user.name } }`)).toBe(1);
  });

  test("F2: a parameter named like a file function does not borrow its write set", () => {
    expect(n046(`
    function noop() { @out = "x" }
    function clear() { @user = not }
    function apply(noop) { if (@user is given) { noop()
            @out = @user.name } }
    function go() { apply(clear) }`)).toBe(1);
  });

  test("F2: a local alias named like a file function", () => {
    expect(n046(`
    function noop() { @out = "x" }
    function clear() { @user = not }
    function show() { const noop = clear
        if (@user is given) { noop()
            @out = @user.name } }`)).toBe(1);
  });

  test("F2: an arrow parameter named like a file function", () => {
    expect(n046(`
    function noop() -> bool { @out = "x"
        return true }
    function clear() -> bool { @user = not
        return true }
    function show() { const run = (noop) => (@user is given && noop() && @user.name == "a")
        const b = run(clear) }`)).toBe(1);
  });

  test("F2 / F5d: an inner function resolves to ITSELF, not to a same-named outer one", () => {
    // inner writes, outer does not → fires
    expect(n046(`
    function clear() { @out = "x" }
    function show() {
        function clear() { @user = not }
        if (@user is given) { clear()
            @out = @user.name } }`)).toBe(1);
    // outer writes, inner does not → survives (was joined before)
    expect(n046(`
    function clear() { @user = not }
    function show() {
        function clear() { @out = "x" }
        if (@user is given) { clear()
            @out = @user.name } }`)).toBe(0);
  });

  test("F3: a built-in method NAME on a receiver of unknown type is not trusted", () => {
    expect(n046(`
    function clear() { @user = not }
    function show() { const api = { get: clear }
        if (@user is given) { api.get()
            @out = @user.name } }`)).toBe(1);
    expect(n046(`
    function clear() { @user = not }
    function show() { const api = { clear: clear }
        if (@user is given) { api.clear()
            @out = @user.name } }`)).toBe(1);
  });

  test("F3 twin: a built-in method on a receiver KNOWN to be a built-in value is trusted", () => {
    expect(n046(`
    function show(s: string, xs: int[]) { if (@user is given) {
            const t = s.trim().toUpperCase()
            const ys = xs.filter((x) => x > 1).map((x) => x + 1)
            const z = @user.name.trim()
            @out = @user.name + t } }`)).toBe(0);
  });

  test("F4: a function handed to a built-in outside a callback position is assumed called", () => {
    expect(n046(`
    function wipe() -> string { @user = not
        return "" }
    function show() { if (@user is given) { const s = JSON.stringify(1, wipe)
            @out = @user.name } }`)).toBe(1);
    expect(n046(`
    function wipe() -> string { @user = not
        return "" }
    function show() { if (@user is given) { const s = String({ toString: wipe })
            @out = @user.name } }`)).toBe(1);
    expect(n046(`
    function wipe() -> string { @user = not
        return "" }
    function show(xs: int[]) { if (@user is given) { const g = Object.groupBy(xs, (x) => wipe())
            @out = @user.name } }`)).toBe(1);
  });

  test("F4: a value of unknown type handed to a built-in may be a function", () => {
    expect(n046(`
    function show(v) { if (@user is given) { const s = String(v)
            @out = @user.name } }`)).toBe(1);
  });

  test("F4 twin: data of a known function-free type handed to a built-in", () => {
    expect(n046(`
    function show(n: int, s: string) { if (@user is given) { const t = String(n) + JSON.stringify([s, 1])
            @out = @user.name + t } }`)).toBe(0);
  });
});

describe("S462 fix round 1 — spurious rejections removed", () => {
  test("F5a: match arms are alternatives — a write in one arm does not reach a sibling", () => {
    expect(n046(`
    function clear() { @user = not }
    function show() { if (@user is given) {
            match @k {
                .A :> { clear() }
                .B :> { @out = @user.name }
            } } }`)).toBe(0);
  });

  test("F5a twin: after the match, the union of the arms applies", () => {
    expect(n046(`
    function clear() { @user = not }
    function show() { if (@user is given) {
            match @k {
                .A :> { clear() }
                .B :> { @out = "b" }
            }
            @out = @user.name } }`)).toBe(1);
  });

  test("F5b: a defer body runs at the block's exit — it ends nothing inside the block", () => {
    expect(n046(`
    function show() { if (@user is given) {
            defer { @user = not }
            @out = @user.name } }`)).toBe(0);
  });

  test("F5b twin: a defer's write ends the narrowing AFTER its block", () => {
    expect(n046(`
    function show(c: bool) { if (@user is given) {
            if (c) { defer { @user = not }
                @out = "x" }
            @out = @user.name } }`)).toBe(1);
  });

  test("F5b: a defer body is judged after the rest of its block's writes", () => {
    expect(n046(`
    function clear() { @user = not }
    function show() { if (@user is given) {
            defer { @out = @user.name }
            clear() } }`)).toBe(1);
  });

  test("F5c: a test AFTER a write in the same condition narrows (if and ternary)", () => {
    expect(n046(`
    function wipe() -> bool { @user = not
        return true }
    function show() { if (wipe() && @user is given) { @out = @user.name } }`)).toBe(0);
    expect(n046(`
    function wipe() -> bool { @user = not
        return true }
    function show() { @out = (wipe() && @user is given) ? @user.name : "" }`)).toBe(0);
  });

  test("F5c twin: a test BEFORE a write in the same condition does not", () => {
    expect(n046(`
    function wipe() -> bool { @user = not
        return true }
    function show() { if (@user is given && wipe()) { @out = @user.name } }`)).toBe(1);
  });

  test("early return: the else branch's write ends the early-return narrowing", () => {
    expect(n046(`
    function clear() { @user = not }
    function show(c: bool) {
        if (@user is not) { return } else { clear() }
        @out = @user.name }`)).toBe(1);
  });
});
