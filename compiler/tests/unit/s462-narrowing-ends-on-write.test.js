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

import { describe, test, expect, setDefaultTimeout } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// Each case is a whole compile (~50 ms alone); under a loaded full-suite run one has
// taken > 5 s, so the default per-test timeout is widened (as the executed-DB tests do).
setDefaultTimeout(30_000);

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

// ---------------------------------------------------------------------------
// FIX ROUND 2 (re-review of 5219250944) + bryan rulings S462 Q10 / Q11 / Q12 ("a").
// ---------------------------------------------------------------------------
function prog3(logic) {
  return `<program>
type User:struct = { name: string }
type Item:struct = { title: string }
<user>: User | not = { name: "a" }
<out> = ""
<words>: string[] = []
<items>: Item[] = []
\${
    function clear() { @user = not }
    function noop() { @out = "z" }
${logic}
}
<p>\${@out}</p>
</program>
`;
}
const all3 = (logic) => e046(prog3(logic));
const n3 = (logic) => all3(logic).length;

describe("S462 fix round 2 — N1: destructuring binders shadow file functions", () => {
  test("const { noop } = { noop: clear }; noop()", () => {
    expect(n3(`
    function show() { if (@user is given) { const { noop } = { noop: clear }
            noop()
            @out = @user.name } }`)).toBe(1);
  });
  test("const { a: noop } = { a: clear }; noop()", () => {
    expect(n3(`
    function show() { if (@user is given) { const { a: noop } = { a: clear }
            noop()
            @out = @user.name } }`)).toBe(1);
  });
  test("a destructured parameter ({ noop })", () => {
    expect(n3(`
    function apply({ noop }) { if (@user is given) { noop()
            @out = @user.name } }
    function go() { apply({ noop: clear }) }`)).toBe(1);
  });
});

describe("S462 fix round 2 — N2: ordinary built-in code is not refused", () => {
  test("a known array method's callback parameter has the element's shape", () => {
    expect(n3(`
    function show() { if (@user is given) {
            const ws = @words.map(w => w.trim())
            const xs = @items.filter(i => i.title.includes("a"))
            const ps = @user.name.split(",").map(p => p.trim())
            @out = @user.name } }`)).toBe(0);
  });
  test("console.* with function-free arguments; new Date() is a built-in receiver", () => {
    expect(n3(`
    function show() { if (@user is given) { console.log("x")
            const d = new Date()
            const s = d.toISOString()
            @out = @user.name } }`)).toBe(0);
  });
  test("a local from a call with a declared primitive return type", () => {
    expect(n3(`
    function fmt(s: string) -> string { return s }
    function show() { if (@user is given) { const t = fmt(@user.name)
            const u = t.trim()
            @out = @user.name } }`)).toBe(0);
  });
  test("an UNTYPED parameter is not trusted; the message names the call and the reason", () => {
    const errs = all3(`
    function show(q) { if (@user is given) { const t = q.trim()
            @out = @user.name } }`);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`q.trim()`");
    expect(errs[0].message).toContain("not known to be a built-in value");
  });
});

describe("S462 Q10 — a write of a provably present value re-narrows", () => {
  test("an object literal written after the narrowing ended", () => {
    expect(n3(`
    function show() { if (@user is given) { clear()
            @user = { name: "b" }
            @out = @user.name } }`)).toBe(0);
  });
  test("with no prior test at all", () => {
    expect(n3(`
    function show() { @user = { name: "c" }
        @out = @user.name }`)).toBe(0);
  });
  test("a write of `not` does not", () => {
    expect(n3(`
    function show() { @user = not
        @out = @user.name }`)).toBe(1);
  });
  test("a write of a possibly-absent value does not", () => {
    expect(n3(`
    function show(u: User | not) { @user = u
        @out = @user.name }`)).toBe(1);
  });
});

describe("S462 Q11 — a suspension point ends every cell narrowing", () => {
  test("a server call (the compiler awaits it); the message names the suspension", () => {
    const errs = all3(`
    server function save() -> int { return 1 }
    function show() { if (@user is given) { const r = save()
            @out = @user.name } }`);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`save()` is a server call");
    expect(errs[0].message).toContain("suspension point");
  });
  test("a function placed on the server by its own `?{}` (no `server` keyword)", () => {
    const errs = compile(prog3(`
    function count() -> int { const r = ?{\`SELECT 1 AS n\`}.get()
        return 1 }
    function show() { if (@user is given) { const r = count()
            @out = @user.name } }`)).filter((e) => e.code === "E-TYPE-046");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`count()` is a server call");
  });
  test("a call of a client function that awaits a server call", () => {
    expect(n3(`
    server function save() -> int { return 1 }
    function persist() { const r = save() }
    function show() { if (@user is given) { persist()
            @out = @user.name } }`)).toBe(1);
  });
  test("a re-test after the suspension narrows again", () => {
    expect(n3(`
    server function save() -> int { return 1 }
    function show() { if (@user is given) { const r = save()
            if (@user is given) { @out = @user.name } } }`)).toBe(0);
  });
});

describe("S462 Q12 — a function body created in a narrowed scope re-tests reactive cells", () => {
  test("a lambda", () => {
    const errs = all3(`
    function show() { if (@user is given) { const f = () => @user.name
            @out = f() } }`);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("does not reach into the function");
  });
  test("a scheduled callback", () => {
    expect(n3(`
    function put(s: string) { @out = s }
    function show() { if (@user is given) { setTimeout(() => put(@user.name), 10) } }`)).toBe(1);
  });
  test("a nested function declaration", () => {
    expect(n3(`
    function show() { if (@user is given) {
            function inner() -> string { return @user.name }
            @out = inner() } }`)).toBe(1);
  });
  test("an event-handler body OUTSIDE an `if=@user` gate", () => {
    // (S462 Q18 superseded the earlier reading in which a handler INSIDE the gate also
    // re-tested; see the Q18 block below.)
    expect(e046(`<program>
type User:struct = { name: string }
<user>: User | not = { name: "a" }
<out> = ""
<div if=@user></div><button onclick={ @out = @user.name }>go</button>
<p>\${@out}</p>
</program>
`).length).toBe(1);
  });
  test("a lambda a built-in calls synchronously keeps the narrowing", () => {
    expect(n3(`
    function show() { if (@user is given) { const xs = @words.map(w => w + @user.name)
            @out = xs.join(",") } }`)).toBe(0);
  });
  test("a re-test inside the function narrows", () => {
    expect(n3(`
    function show() { if (@user is given) { const f = () => (@user is given ? @user.name : "")
            @out = f() } }`)).toBe(0);
  });
});

describe("g-etype046-blind-in-block-bodied-arrows-s462 — a block-bodied arrow is checked", () => {
  test("an unguarded read inside a block-bodied arrow fires (at the enclosing statement)", () => {
    const errs = all3(`
    function show() { const r = () => { @out = @user.name }
        r() }`);
    expect(errs.length).toBe(1);
    expect(errs[0].span?.line).toBe(12);
  });
  test("a guarded read inside one does not", () => {
    expect(n3(`
    function show() { const r = () => { if (@user is given) { @out = @user.name } }
        r() }`)).toBe(0);
  });
  test("F2 in its block-bodied form: an arrow parameter named like a file function", () => {
    expect(n3(`
    function show() { const run = (noop) => { if (@user is given) { noop()
                @out = @user.name } }
        run(clear) }`)).toBe(1);
  });
  test("a block-bodied lambda a built-in calls synchronously keeps the narrowing", () => {
    expect(n3(`
    function show() { if (@user is given) { @words.forEach((w) => { @out = @user.name + w }) } }`)).toBe(0);
  });
  test("a block-bodied lambda handed to a built-in: its body's writes count", () => {
    expect(n3(`
    function show() { if (@user is given) { @words.forEach((w) => { clear() })
            @out = @user.name } }`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 3 (re-review #3 of 5ebd277eb).
// ---------------------------------------------------------------------------
function prog4(logic) {
  return `<program>
type User:struct = { name: string, tags: string[] }
<user>: User | not = { name: "a", tags: [] }
<users>: User[] = []
<words>: string[] = ["a", "b"]
<out> = ""
\${
    function clear() { @user = not }
${logic}
}
<p>\${@out}</p>
</program>
`;
}
const all4 = (logic) => e046(prog4(logic));

describe("S462 fix round 3 — NEW-1: a sync callback body is a loop body", () => {
  test("forEach: a write later in the callback ends the narrowing for the next call", () => {
    expect(all4(`
    function show() { if (@user is given) { @words.forEach((w) => { @out = @user.name
                clear() }) } }`).length).toBe(1);
  });
  test("map with an expression body whose call writes the cell", () => {
    expect(all4(`
    function pick2(a: string, b: bool) -> string { return a }
    function wipe() -> bool { @user = not
        return true }
    function show() { if (@user is given) { const xs = @words.map((w) => pick2(@user.name, wipe()))
            @out = xs.join(",") } }`).length).toBe(1);
  });
  test("twin: a callback that writes nothing keeps the narrowing", () => {
    expect(all4(`
    function show() { if (@user is given) { @words.forEach((w) => { @out = @user.name + w }) } }`).length).toBe(0);
  });
});

describe("S462 fix round 3 — NEW-2: an element access is not provably present (Q10)", () => {
  test("`@user = @users.at(0)` does not re-narrow", () => {
    expect(all4(`
    function show() { clear()
        @user = @users.at(0)
        @out = @user.name }`).length).toBe(1);
  });
  test("`@user = @users[0]` does not re-narrow", () => {
    expect(all4(`
    function show() { clear()
        @user = @users[0]
        @out = @user.name }`).length).toBe(1);
  });
});

describe("S462 fix round 3 — the note names the untrusted call inside a callback", () => {
  test("reduce: the accumulator's method call is named", () => {
    const errs = all4(`
    function show() { if (@user is given) { const all = @words.reduce((acc, w) => acc.concat([w]), [])
            @out = @user.name } }`);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`acc.concat(…)`");
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 4 (re-review #4 of 88a33c700).
// ---------------------------------------------------------------------------
describe("S462 fix round 4 — R4-1: block arrows with several / default / rest parameters are checked", () => {
  test("reduce((a, w) => { … clear() … }) is a loop body", () => {
    expect(all4(`
    function show() { if (@user is given) { const r = @words.reduce((a, w) => { const s = a + @user.name
                clear()
                return s }, "") } }`).length).toBe(1);
  });
  test("toSorted((a, b) => { … clear() … })", () => {
    expect(all4(`
    function show() { if (@user is given) { const r = @words.toSorted((a, b) => { @out = @user.name
                clear()
                return 0 }) } }`).length).toBe(1);
  });
  test("forEach((w, i) => { … clear() })", () => {
    expect(all4(`
    function show() { if (@user is given) { @words.forEach((w, i) => { @out = @user.name
                clear() }) } }`).length).toBe(1);
  });
  test("unguarded reads in (a, b) => { … } and (a = 1) => { … }", () => {
    expect(all4(`
    function show() { const f = (a, b) => { @out = @user.name }
        const g = (a = 1) => { @out = @user.name }
        f(1, 2)
        g() }`).length).toBe(2);
  });
  test("twin: a guarded read in a two-parameter block arrow", () => {
    expect(all4(`
    function show() { const f = (a, b) => { if (@user is given) { @out = @user.name } }
        f(1, 2) }`).length).toBe(0);
  });
});

describe("S462 fix round 4 — R4-2: an optional-chained field is not provably present (Q10)", () => {
  test("`@user = @box?.owner` does not re-narrow", () => {
    expect(e046(`<program>
type User:struct = { name: string }
type Box:struct = { owner: User }
<user>: User | not = { name: "a" }
<box>: Box | not = not
<out> = ""
\${
    function clear() { @user = not }
    function show() { clear()
        @user = @box?.owner
        @out = @user.name }
}
<p>\${@out}</p>
</program>
`).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 5 (re-review #5 of df6fddc4b) — the escape-hatch arrow carries its
// STRUCTURED parameters and its acorn-delimited body; no text scanner reads either.
// ---------------------------------------------------------------------------
function prog5(logic) {
  return `<program>
type User:struct = { name: string }
<user>: User | not = { name: "a" }
<out> = ""
<words>: string[] = ["a", "b"]
\${
    function clear() { @user = not }
    function noop() { @out = "z" }
${logic}
}
<p>\${@out}</p>
</program>
`;
}
const n5 = (logic) => e046(prog5(logic)).length;

describe("S462 fix round 5 — P1-a: parameters are read structurally (no param scanner)", () => {
  test("a nested-arrow default does not hide a parameter that shadows a file function", () => {
    expect(n5(`
    function show(q) { const run = (f = () => 1, noop) => { if (@user is given) { noop()
                @out = @user.name } }
        run(1, clear) }`)).toBe(1);
  });
  test("a string default holding `)=>`", () => {
    expect(n5(`
    function show(q) { const run = (f = ")=>", noop) => { if (@user is given) { noop()
                @out = @user.name } }
        run(1, clear) }`)).toBe(1);
  });
  test("a defaulted parameter that shadows a file function", () => {
    expect(n5(`
    function show() { const run = (noop = 1) => { if (@user is given) { noop()
                @out = @user.name } }
        run(clear) }`)).toBe(1);
  });
  test("a destructured parameter with a nested default", () => {
    expect(n5(`
    function show() { const run = ({ b = { c: 1 }, noop } = {}) => { if (@user is given) { noop()
                @out = @user.name } }
        run({ noop: clear }) }`)).toBe(1);
  });
  test("a rest parameter", () => {
    expect(n5(`
    function show() { const run = (a, ...noop) => { @out = @user.name }
        run(1) }`)).toBe(1);
  });
  test("a comment between `)` and `=>`", () => {
    expect(n5(`
    function show() { const run = (a, noop) /* c */ => { if (@user is given) { noop()
                @out = @user.name } }
        run(1, clear) }`)).toBe(1);
  });
  test("a named function expression", () => {
    expect(n5(`
    function show() { const run = function named(a, noop) { if (@user is given) { noop()
                @out = @user.name } }
        run(1, clear) }`)).toBe(1);
  });
  test("twin: a non-shadowing default keeps the file function's write set", () => {
    expect(n5(`
    function show() { const run = (a, b = "}") => { if (@user is given) { noop()
                @out = @user.name } }
        run(1) }`)).toBe(0);
  });
});

describe("S462 fix round 5 — P1-b: the body is acorn-delimited (no body scanner)", () => {
  test("a regex default holding `)`", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.forEach((w, i = /\\)/) => { @out = @user.name
                clear() }) } }`)).toBe(1);
  });
  test("a regex default holding `) => { 1 }`", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.forEach((w, i = /\\) => { 1 }/) => { @out = @user.name
                clear() }) } }`)).toBe(1);
  });
  for (const d of [`"}"`, `")"`, `"=> { }"`]) {
    test(`a string default ${d}: the unguarded read in the body is checked`, () => {
      expect(n5(`
    function show() { const run = (a, b = ${d}) => { @out = @user.name }
        run(1) }`)).toBe(1);
    });
  }
  test("body strings holding braces", () => {
    expect(n5(`
    function show() { const run = (a, b) => { if (@user is given) { const s = "}{"
                clear()
                @out = @user.name + s } }
        run(1, 2) }`)).toBe(1);
  });
  test("function (w, i) { … } as a sync callback is a loop body", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.forEach(function (w, i) { @out = @user.name
                clear() }) } }`)).toBe(1);
  });
  test("twin: a callback that writes nothing keeps the narrowing", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.forEach((w, i = /\\)/) => { @out = @user.name + w }) } }`)).toBe(0);
  });
});

describe("S462 fix round 5 — parameter defaults run on each call, before the body", () => {
  test("a default that writes, on a block-bodied sync callback", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.forEach((w, i, a, x = clear()) => { @out = @user.name }) } }`)).toBe(1);
  });
  test("a default that writes, on an expression-bodied sync callback", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.forEach((w, i, a, x = clear()) => @out = @user.name) } }`)).toBe(1);
  });
  test("an unguarded read in a block arrow's default", () => {
    expect(n5(`
    function show() { const f = (a, x = @user.name) => { @out = x }
        f(1) }`)).toBe(1);
  });
  test("a destructured array parameter shadows a file function", () => {
    expect(n5(`
    function show() { const run = ([noop]) => { if (@user is given) { noop()
                @out = @user.name } }
        run([clear]) }`)).toBe(1);
  });
});

describe("S462 fix round 5 — no text scan decides what an escape hatch writes", () => {
  test("a tagged template call (no `(`, no `=`) ends the narrowing", () => {
    expect(n5(`
    function tag(s) { @user = not
        return "" }
    function show() { if (@user is given) { const t = tag\`x\`
            @out = @user.name } }`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// S462 Q18 ("a") — a handler inside an `if=` gate keeps the gate's narrowing.
// ---------------------------------------------------------------------------
function progM(markup) {
  return `<program>
type User:struct = { name: string }
<user>: User | not = { name: "a" }
<other>: User | not = { name: "b" }
<out> = ""
\${
    function clear() { @user = not }
}
${markup}
<p>\${@out}</p>
</program>
`;
}
const nM = (markup) => e046(progM(markup)).length;

describe("S462 Q18 — an event handler inside an `if=` gate keeps that cell's narrowing", () => {
  test("a handler on a child of `if=@user` reads @user bare", () => {
    expect(nM(`<div if=@user><button onclick={ @out = @user.name }>go</button></div>`)).toBe(0);
  });
  test("a handler on the gated element itself", () => {
    expect(nM(`<button if=@user onclick={ @out = @user.name }>go</button>`)).toBe(0);
  });
  test("an `else-if=` gate", () => {
    expect(nM(`<p if=@other>o</p><div else-if=@user><button onclick={ @out = @user.name }>go</button></div>`)).toBe(0);
  });
  test("a deeper descendant", () => {
    expect(nM(`<div if=@user><section><ul><li><button onclick={ @out = @user.name }>go</button></li></ul></section></div>`)).toBe(0);
  });
  test("nested gates contribute their narrowings", () => {
    expect(nM(`<div if=@user><section if=@other><button onclick={ @out = @user.name + @other.name }>go</button></section></div>`)).toBe(0);
  });
  test("`show=` does not gate (hides, does not remove)", () => {
    expect(nM(`<div show=@user><button onclick={ @out = @user.name }>go</button></div>`)).toBe(1);
  });
  test("another cell stays un-narrowed", () => {
    expect(nM(`<div if=@user><button onclick={ @out = @other.name }>go</button></div>`)).toBe(1);
  });
  test("a handler outside the gate", () => {
    expect(nM(`<div if=@user></div><button onclick={ @out = @user.name }>go</button>`)).toBe(1);
  });
  test("a write inside the handler still ends the narrowing", () => {
    expect(nM(`<div if=@user><button onclick={ @user = not
        @out = @user.name }>go</button></div>`)).toBe(1);
  });
  test("a call inside the handler that writes the cell ends it", () => {
    expect(nM(`<div if=@user><button onclick={ clear()
        @out = @user.name }>go</button></div>`)).toBe(1);
  });
  test("a timer callback inside the handler re-tests", () => {
    expect(nM(`<div if=@user><button onclick={ setTimeout(() => { @out = @user.name }, 10) }>go</button></div>`)).toBe(1);
  });
  test("a closure created inside the handler re-tests", () => {
    expect(nM(`<div if=@user><button onclick={ const f = () => @user.name
        @out = f() }>go</button></div>`)).toBe(1);
  });
  test("a gate ended by an earlier write does not keep anything", () => {
    expect(nM(`<div if=@user>\${ clear() }<button onclick={ @out = @user.name }>go</button></div>`)).toBe(1);
  });
});

describe("S462 Q18 — a realistic site (trucking load-detail shape), its cell annotated `T | not`", () => {
  const site = (gate) => `<program>
type Load:struct = { ref: string }
<currentLoad>: Load | not = not
<loaded> = false
<out> = ""
<div ${gate} class="space-y-6"><h2>\${@currentLoad.ref}</h2><button onclick={ @out = @currentLoad.ref }>accept</button></div>
<p>\${@out}</p>
</program>
`;
  test("a bare `if=@currentLoad` gate: children and handler both legal", () => {
    expect(e046(site("if=@currentLoad")).length).toBe(0);
  });
  test("the corpus's parenthesized compound gate narrows neither on impl#1 (carried g-impl1-condition-rule-s460)", () => {
    // Pinned so a fix of that gap shows up here: the child read AND the handler read fire today.
    expect(e046(site("if=(@loaded && @currentLoad is some)")).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 6 (F6-2) — focus-family handlers keep no gate narrowing: Chromium fires
// `blur` / `focusout` on a focused element DURING its removal, while still connected.
// ---------------------------------------------------------------------------
describe("S462 round 6 — F6-2: a focus-family handler is not exempt", () => {
  for (const ev of ["onblur", "onfocusout", "onfocus", "onfocusin"]) {
    test(`${ev} under \`if=@user\` re-tests`, () => {
      expect(nM(`<div if=@user><input ${ev}={ @out = @user.name }/></div>`)).toBe(1);
    });
  }
  test("oninput / onkeydown under `if=@user` keep it (direct listeners check the element is connected)", () => {
    expect(nM(`<div if=@user><input oninput={ @out = @user.name } onkeydown={ @out = @user.name }/></div>`)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 6 — F6-4: an arrow written AS the handler value is the handler itself.
// ---------------------------------------------------------------------------
describe("S462 round 6 — F6-4: a function handler value is the handler, not a closure in it", () => {
  test("`onclick=${() => { … }}` under `if=@user` keeps the gate (like the `{ … }` form)", () => {
    expect(nM(`<div if=@user><button onclick=\${() => { @out = @user.name }}>go</button></div>`)).toBe(0);
  });
  test("several parameters, an expression body, a function expression", () => {
    expect(nM(`<div if=@user><button onclick=\${(e, x) => { @out = @user.name }}>go</button></div>`)).toBe(0);
    expect(nM(`<div if=@user><button onclick=\${() => @out = @user.name}>go</button></div>`)).toBe(0);
    // A function-EXPRESSION handler value lowers to the statement `function (e) { … }`
    // inside the listener — JS that never parsed. The §2.2.1 parse floor now refuses it
    // in every compile (S464 Q24 fix round 3; g-emitted-js-invalid-shapes-surfaced-by-
    // floor-s464); the narrowing itself (the point here) raises no E-TYPE-046.
    const fx = compile(progM(`<div if=@user><button onclick=\${function (e) { @out = @user.name }}>go</button></div>`));
    expect(fx.map((e) => e.code)).toEqual(["E-CODEGEN-INVALID-LOGIC"]);
  });
  test("outside a gate it re-tests (Q12)", () => {
    expect(nM(`<button onclick=\${() => { @out = @user.name }}>go</button>`)).toBe(1);
  });
  test("a closure created INSIDE the arrow handler still re-tests", () => {
    expect(nM(`<div if=@user><button onclick=\${() => { setTimeout(() => { @out = @user.name }, 1) }}>go</button></div>`)).toBe(1);
  });
  test("a write inside it still ends the narrowing", () => {
    expect(nM(`<div if=@user><button onclick=\${() => { clear()
        @out = @user.name }}>go</button></div>`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 6 — F6-5: the branches of a markup `if=` / `else-if=` / `else` chain are walked.
// ---------------------------------------------------------------------------
describe("S462 round 6 — F6-5: an if-chain's branches are checked", () => {
  test("a bare read in the `else` element fires (render and handler)", () => {
    expect(nM(`<div if=@other>o</div><div else><p>\${@user.name}</p><button onclick={ @out = @user.name }>go</button></div>`)).toBe(2);
  });
  test("a bare read in an `else-if=` on a different condition fires", () => {
    expect(nM(`<div if=@other>o</div><div else-if=(@out == "")><p>\${@user.name}</p></div>`)).toBe(1);
  });
  test("the `if=` branch of a chain narrows its own cell", () => {
    expect(nM(`<div if=@user><p>\${@user.name}</p></div><div else><p>none</p></div>`)).toBe(0);
  });
  test("an `else-if=@user` branch narrows @user (render and handler)", () => {
    expect(nM(`<p if=@other>o</p><div else-if=@user><p>\${@user.name}</p><button onclick={ @out = @user.name }>go</button></div><p else>none</p>`)).toBe(0);
  });
  test("the `else` of `if=@user` does not narrow @user", () => {
    expect(nM(`<div if=@user>u</div><div else><p>\${@user.name}</p></div>`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 6 — F6-3: component E-TYPE-031 reads block arrows structurally.
// ---------------------------------------------------------------------------
const e031 = (body) => compile(`<program>
const C = <div class="c" props={ onGo?: () => void }>
${body}
</>
<C/>
</program>
`).filter((e) => e.code === "E-TYPE-031").length;

describe("S462 round 6 — F6-3: E-TYPE-031 sees several / default / rest-parameter block arrows", () => {
  test("a two-parameter arrow handler value", () => {
    expect(e031(`    <button class="g" onclick=\${(e, x) => { onGo() }}>g</button>`)).toBe(1);
  });
  test("a defaulted-parameter arrow handler value", () => {
    expect(e031(`    <button class="g" onclick=\${(e = 1) => { onGo() }}>g</button>`)).toBe(1);
  });
  test("a rest-parameter arrow handler value", () => {
    expect(e031(`    <button class="g" onclick=\${(...a) => { onGo() }}>g</button>`)).toBe(1);
  });
  test("a two-parameter block arrow passed to forEach", () => {
    expect(e031(`    <button class="g" onclick=\${() => { [1, 2].forEach((a, b) => { onGo() }) }}>g</button>`)).toBe(1);
  });
  test("twins: guarded forms stay clean", () => {
    expect(e031(`    <button class="g" onclick=\${(e, x) => { onGo?.() }}>g</button>`)).toBe(0);
    expect(e031(`    <button class="g" onclick=\${(e = 1) => { if (onGo is given) { onGo() } }}>g</button>`)).toBe(0);
  });
});

describe("S462 round 6 (merge of s461 argExprs) — a reactive array mutation's function argument is read", () => {
  test("`@words.sort(cmp)` where cmp writes the cell ends the narrowing", () => {
    expect(n5(`
    function cmp(a: string, b: string) -> int { @user = not
        return 0 }
    function show() { if (@user is given) { @words.sort(cmp)
            @out = @user.name } }`)).toBe(1);
  });
  test("twin: a comparator that writes nothing keeps it", () => {
    expect(n5(`
    function cmp(a: string, b: string) -> int { return 0 }
    function show() { if (@user is given) { @words.sort(cmp)
            @out = @user.name } }`)).toBe(0);
  });
});

describe("S462 round 6 — F6-3/F6-4: an arrow handler value's E-TYPE-031 lands on the call", () => {
  test("the reported column is the `onGo` call, not the attribute", () => {
    const line = `    <button class="g" onclick=\${(e, x) => { if (onGo is not) { onGo() } }}>g</button>`;
    const errs = compile(`<program>
const C = <div class="c" props={ onGo?: () => void }>
${line}
</>
<C/>
</program>
`).filter((e) => e.code === "E-TYPE-031");
    expect(errs.length).toBe(1);
    expect(errs[0].span.line).toBe(3);
    expect(errs[0].span.col).toBe(line.lastIndexOf("onGo()") + 1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 6 (review #6 ruling) — the gate exemption is an ALLOW-list of user-input events,
// matched by exact (ASCII-lowercased) name; everything else re-tests.
// ---------------------------------------------------------------------------
describe("S462 round 6 — only user-input events keep a gate's narrowing", () => {
  for (const ev of ["onclick", "ondblclick", "oncontextmenu", "oninput", "onbeforeinput", "onsubmit", "onreset",
    "onkeydown", "onkeyup", "onkeypress", "onmousedown", "onmouseup", "onmousemove", "onpointerdown",
    "onpointerup", "onpointermove", "onwheel", "ontouchstart", "ontouchmove", "ontouchend", "ondragstart",
    "ondrag", "ondragend", "ondragenter", "ondragover", "ondrop", "onauxclick", "onClick", "on:click"]) {
    test(`${ev} keeps it`, () => {
      expect(nM(`<div if=@user><input ${ev}={ @out = @user.name }/></div>`)).toBe(0);
    });
  }
  for (const ev of ["onchange", "onmouseleave", "onmouseout", "onpointerleave", "onpointercancel",
    "ontouchcancel", "onanimationend", "ontransitionend", "onscroll", "onselect", "ondragleave",
    "onfocus", "onblur", "on:custom", "onfoo"]) {
    test(`${ev} re-tests`, () => {
      expect(nM(`<div if=@user><input ${ev}={ @out = @user.name }/></div>`)).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// FIX ROUND 7 — R7-2: an `if=` inside a component body narrows like a top-level one.
// ---------------------------------------------------------------------------
const compProg = (body) => `<program>
type User:struct = { name: string }
<user>: User | not = { name: "a" }
<out> = ""
const C = ${body}
<C/>
<p>\${@out}</p>
</program>
`;
describe("S462 round 7 — R7-2: a component-body `if=` narrows its children and handlers", () => {
  test("an if-chain in a component body", () => {
    expect(e046(compProg(`<section><div if=@user><p>\${@user.name}</p><button onclick={ @out = @user.name }>b</button></div><div else>none</div></section>`)).length).toBe(0);
  });
  test("a lone `if=` in a component body", () => {
    expect(e046(compProg(`<section><div if=@user><p>\${@user.name}</p><button onclick={ @out = @user.name }>b</button></div></section>`)).length).toBe(0);
  });
  test("twins: the `else` branch and an ungated read still fire", () => {
    expect(e046(compProg(`<section><div if=@user>u</div><div else><p>\${@user.name}</p></div></section>`)).length).toBe(1);
    expect(e046(compProg(`<section><p>\${@user.name}</p></section>`)).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 7 — R7-3: a reactive-array-mutation comparator is read like any callback.
// ---------------------------------------------------------------------------
describe("S462 round 7 — R7-3: `@xs.sort(arrow)` reads the comparator", () => {
  test("an expression-bodied comparator calling a string method keeps the narrowing", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.sort((a, b) => a.localeCompare(b))
            @out = @user.name } }`)).toBe(0);
  });
  test("a block-bodied comparator keeps it too", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.sort((a, b) => { return a.localeCompare(b) })
            @out = @user.name } }`)).toBe(0);
  });
  test("a comparator that writes the cell ends it", () => {
    expect(n5(`
    function show() { if (@user is given) { @words.sort((a, b) => { clear()
                return 0 })
            @out = @user.name } }`)).toBe(1);
  });
  test("a named comparator that writes the cell ends it", () => {
    expect(n5(`
    function cmp(a: string, b: string) -> int { @user = not
        return 0 }
    function show() { if (@user is given) { @words.sort(cmp)
            @out = @user.name } }`)).toBe(1);
  });
  test("a function-valued parameter as comparator is unresolvable", () => {
    expect(n5(`
    function show(f) { if (@user is given) { @words.sort(f)
            @out = @user.name } }`)).toBe(1);
  });
});

describe("S462 round 7 — event-name prefixes normalise (onclient:)", () => {
  test("onclient:click under `if=@user` keeps it; outside a gate it re-tests", () => {
    expect(nM(`<div if=@user><button onclient:click={ @out = @user.name }>go</button></div>`)).toBe(0);
    expect(nM(`<div if=@user></div><button onclient:click={ @out = @user.name }>go</button>`)).toBe(1);
  });
});
