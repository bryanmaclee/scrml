// Probe family `n23` — S469 (g-lift-row-if-is-display-toggle-not-a-render-gate-s462 and its cluster): a
// markup `if=` authorization guard inside LIFTED markup — a `for … lift` row (nested element, multi-root
// root, value-indexed sole root), a non-loop `if … lift` / bare `lift`, a
// markup value (a function returning markup, a ternary, a markup-typed `const`), and an `<each>` that IS
// the lifted root. Lifted markup lowered most of these to a `style.display` toggle: the element stayed in
// the DOM while the guard was false, so `#out`'s text still held LOGGED IN (and its handlers stayed
// reachable). Every page starts GRANTED and `#wrong` revokes, so a create-time-only gate fails too.
// (The unparenthesized inline `${ for x of @xs lift … }` form is refused today — E-FOR-UNPARENTHESIZED-HEAD —
// so it is not a probe of the gate and is not here.)
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const PAGE = (guard, wrap) => `<pw> = "secret"
<xs> = [1]
<sel> = "secret"
\${
    function allowed(p) { return p == "secret" }
    function granted() { return @pw == "secret" }
}
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
${wrap(`<b if=${guard}>LOGGED IN</b>`, guard)}
`;

const GUARDS = [
  ["plain", `(@pw == "secret")`],
  ["call", `allowed(@pw)`],
  // A QUOTED condition is an expression (§17.1), not a string: read as a string it is truthy.
  ["quoted", `"allowed(@pw)"`],
  // S469 round 2 (F1): the cell is read INSIDE the called function — no `@pw` in the attribute text.
  ["indirect", `granted()`],
  ["indirect and", `(granted() && true)`],
];
const WRAPS = [
  ["for-lift sole root", (b) => `<div id="out">\${ for (x of @xs) { lift ${b} } }</div>`],
  ["for-lift nested", (b) => `<div id="out">\${ for (x of @xs) { lift <span>${b}</span> } }</div>`],
  ["for-lift nested 2 deep", (b) => `<div id="out">\${ for (x of @xs) { lift <span><em>${b}</em></span> } }</div>`],
  ["for-lift multi-root, gated head", (b) => `<div id="out">\${ for (x of @xs) { lift ${b}\n lift <i></i> } }</div>`],
  ["for-lift multi-root, gated tail", (b) => `<div id="out">\${ for (x of @xs) { lift <i></i>\n lift ${b} } }</div>`],
  ["for-lift in for-lift, nested", (b) => `<div id="out">\${ for (y of @xs) { lift <div>\${ for (x of @xs) { lift <span>${b}</span> } }</div> } }</div>`],
  ["for over a literal, nested", (b) => `<div id="out">\${ for (x of [1]) { lift <span>${b}</span> } }</div>`],
  ["if-lift root", (b) => `<div id="out">\${ if (true) { lift ${b} } }</div>`],
  ["if-lift nested", (b) => `<div id="out">\${ if (true) { lift <span>${b}</span> } }</div>`],
  ["bare lift root", (b) => `<div id="out">\${ lift ${b} }</div>`],
  ["bare lift nested", (b) => `<div id="out">\${ lift <span>${b}</span> }</div>`],
  ["function returning markup", (b) => `\${ function pill() { return <span>${b}</span> } }\n<div id="out">\${ pill() }</div>`],
  ["ternary markup value", (b) => `<div id="out">\${ true ? <span>${b}</span> : "" }</div>`],
  ["lift in each in match arm", (b) => `type Phase:enum = { Idle, Active }\n<ph>: Phase = .Idle\n<div id="out"><match for=Phase on=@ph><Idle><each in=@xs as y><span>\${ for (x of @xs) { lift <span>${b}</span> } }</span></each></Idle><Active>x</Active></match></div>`],
  // (The component's text is an interpolation: a literal text body gains a trailing space on expansion,
  // the S465-era whitespace gap, which would read as PASS-DENY.)
  ["component in for-lift, gated", (b, g) => `\${ const Pill = <span>\${"LOGGED IN"}</span> }\n<div id="out">\${ for (x of @xs) { lift <div><Pill if=${g}/></div> } }</div>`],
  ["component in for-lift, gate in its body", (b) => `\${ const Pill = <span>${b}</span> }\n<div id="out">\${ for (x of @xs) { lift <div><Pill/></div> } }</div>`],
  ["lifted each root", (b, g) => `<div id="out">\${ if (true) { lift <each in=@xs as y if=${g}>LOGGED IN</each> } }</div>`],
];

const shapes = [];
for (const [g, guard] of GUARDS) {
  for (const [w, wrap] of WRAPS) shapes.push([`${g} (${w})`, PAGE(guard, wrap)]);
}

// The value-indexed select-row predicate `@cell == item.field` (S103 O(2) dispatch): the sole root and a
// nested element. The row's field holds the password the guard expects.
const VI = (nest) => `<pw> = "secret"
<keys> = [{ id: 1, k: "secret" }]
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
<div id="out">\${ for (r of @keys) { lift ${nest(`<b if=(@pw == r.k)>LOGGED IN</b>`)} } }</div>
`;
shapes.push(["value-indexed (for-lift sole root)", VI((b) => b)]);
shapes.push(["value-indexed (for-lift nested)", VI((b) => `<span>${b}</span>`)]);

// The value-indexed predicate's ROW side: the cell holds the expected key, the button writes the
// same-key row with the key the password names. A create-time `r.k` (and a value bucket registered
// under it) keeps the gate open after the row is revoked.
const VIROW = (keyed, nest) => {
  const row = (k) => `[{ ${keyed ? "id: 1, " : ""}k: ${k} }]`;
  return `<pw> = "secret"
<keys> = ${row('"secret"')}
\${
    function keyFor(p) { return p }
}
<button id="wrong" onclick=\${ @keys = ${row('keyFor("wrong")')} }>go</button>
<button id="right" onclick=\${ @keys = ${row('keyFor("secret")')} }>go</button>
<div id="out">\${ for (r of @keys) { lift ${nest(`<b if=(@pw == r.k)>LOGGED IN</b>`)} } }</div>
`;
};
for (const keyed of [true, false]) {
  shapes.push([`value-indexed row side (sole root), ${keyed ? "id" : "index"} keys`, VIROW(keyed, (b) => b)]);
  shapes.push([`value-indexed row side (nested), ${keyed ? "id" : "index"} keys`, VIROW(keyed, (b) => `<span>${b}</span>`)]);
}

// A guard that reads the ROW: the row starts granted, the button writes the same-key row with `ok`
// computed from the password. Id keys and index keys; nested and multi-root positions.
const ROW = (keyed, guard, nest) => {
  const row = (ok) => `[{ ${keyed ? "id: 1, " : ""}ok: ${ok} }]`;
  return `<rows> = ${row("true")}
\${
    function grant(p) { return p == "secret" }
}
<button id="wrong" onclick=\${ @rows = ${row('grant("wrong")')} }>go</button>
<button id="right" onclick=\${ @rows = ${row('grant("secret")')} }>go</button>
<div id="out">\${ for (r of @rows) { ${nest(`<b if=${guard}>LOGGED IN</b>`)} } }</div>
`;
};
const NESTS = [
  ["nested", (b) => `lift <span>${b}</span>`],
  ["multi-root", (b) => `lift ${b}\n lift <i></i>`],
];
for (const keyed of [true, false]) {
  for (const guard of ["r.ok", "(r.ok)"]) {
    for (const [n, nest] of NESTS) {
      shapes.push([`row guard (${n}), ${keyed ? "id" : "index"} keys, if=${guard}`, ROW(keyed, guard, nest)]);
    }
  }
}
// S469 round 3 — a guard that reads a LOCAL of the lift body (a counter, an accumulator, a flag set after
// the lift). Only the FIRST element carries the text; the guard is open for every later value of the
// local. A gate whose effect re-reads the local's FINAL value opens the first element on the wrong password.
// (show= is a visibility toggle, not a gate — its content stays in `#out`'s text — so it is not probed here.)
const LOCALS = [
  ["while counter, i > 0", `let i = 0
 while (i < 2) { lift <b if=(i > 0 || @pw == "secret")>\${i == 0 ? "LOGGED IN" : ""}</b>
 i = i + 1 }`],
  ["while counter, i != 0", `let i = 0
 while (i < 2) { lift <b if=(i != 0 || @pw == "secret")>\${i == 0 ? "LOGGED IN" : ""}</b>
 i = i + 1 }`],
  ["counter over @items", `let c = 0
 for (r of @items) { c = c + 1
 lift <b if=(c > 1 || @pw == "secret")>\${c == 1 ? "LOGGED IN" : ""}</b> }`],
  ["accumulator over a literal", `let acc = 0
 for (x of [1, 2]) { acc = acc + x
 lift <b if=(acc > 1 || @pw == "secret")>\${acc == 1 ? "LOGGED IN" : ""}</b> }`],
  ["flag set after the lift", `let ok = false
 lift <b if=(ok || @pw == "secret")>LOGGED IN</b>
 ok = true`],
  // S469 round 4 (F-A) — a local CLOSURE reads its locals by reference, and a mutated local
  // array / object is the same value at every later read: neither may reach a later re-run.
  ["closure over a flag set after the lift", `let ok = false
 const allowed = () => ok || @pw == "secret"
 lift <b if=(allowed())>LOGGED IN</b>
 ok = true`],
  ["closure over a counter", `let pos = 0
 const later = () => pos > 1 || @pw == "secret"
 for (it of @items) { pos = pos + 1
 lift <b if=(later())>\${pos == 1 ? "LOGGED IN" : ""}</b> }`],
  ["mutated local array", `let seen = []
 for (it of @items) { seen.push(it.id)
 lift <b if=(seen.length > 1 || @pw == "secret")>\${seen.length == 1 ? "LOGGED IN" : ""}</b> }`],
  ["mutated local object", `let o = { c: 0 }
 for (it of @items) { o.c = o.c + 1
 lift <b if=(o.c > 1 || @pw == "secret")>\${o.c == 1 ? "LOGGED IN" : ""}</b> }`],
];
const LOCAL_CTX = [
  ["plain group", (b) => `\${ ${b} }`],
  ["if-lift arm", (b) => `\${ if (true) { ${b} } }`],
  ["row", (b) => `\${ for (row of @rows) { ${b} } }`],
];
for (const [cn, ctx] of LOCAL_CTX) {
  for (const [ln, body] of LOCALS) {
    // A `while` inside a reconciled row lifts outside the row (g-while-lift-in-reconciled-row-escapes-the-row-s469).
    if (cn === "row" && ln.startsWith("while")) continue;
    shapes.push([`body local (${cn}): ${ln}`, `<pw> = "secret"
<rows> = [{ id: 1 }]
<items> = [{ id: 1 }, { id: 2 }]
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
<div id="out">${ctx(body)}</div>
`]);
  }
}
export default shapes;
