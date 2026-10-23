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
export default shapes;
