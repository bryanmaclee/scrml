// Probe family `n21` — S469 (g-each-nested-peritem-if-not-reactive, g-each-peritem-if-multiroot-deferred):
// a markup `if=` authorization guard inside an `<each>` row that is NOT the row's sole root — a nested
// element, or one root of a multi-root item. Both were a create-time append gate, so a guard REVOKED after
// the row was built kept the content: every page here starts granted, and `#wrong` revokes. (For an
// outer-state guard W-IF-IN-EACH did not even fire.) Every guard form × every position the row element can
// take, plus guards that read the row / an outer row with the row reused by key or index.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const PAGE = (guard, wrap) => `<pw> = "secret"
<xs> = [1]
<none> = []
\${
    function allowed(p) { return p == "secret" }
    const Pill = <span><b if=${guard}>LOGGED IN</b></span>
}
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
${wrap(`<b if=${guard}>LOGGED IN</b>`)}
`;

const GUARDS = [
  ["plain", `(@pw == "secret")`],
  ["call", `allowed(@pw)`],
];
const WRAPS = [
  ["nested in a row element", (b) => `<div id="out"><each in=@xs as y><span>${b}</span></each></div>`],
  ["nested 2 deep", (b) => `<div id="out"><each in=@xs as y><span><em>${b}</em></span></each></div>`],
  ["nested, each in each", (b) => `<div id="out"><each in=@xs as z><each in=@xs as y><span>${b}</span></each></each></div>`],
  ["nested, each in each in each", (b) => `<div id="out"><each in=@xs as w><each in=@xs as z><each in=@xs as y><span>${b}</span></each></each></each></div>`],
  ["nested, a component in a row", () => `<div id="out"><each in=@xs as y><Pill/></each></div>`],
  ["nested, errorBoundary in a row", (b) => `<div id="out"><each in=@xs as y><span>${b.replace(/^<b /, "<errorBoundary ").replace(/<\/b>$/, "</errorBoundary>")}</span></each></div>`],
  ["multi-root, gated head", (b) => `<div id="out"><each in=@xs as y>${b}<i></i></each></div>`],
  ["multi-root, gated tail", (b) => `<div id="out"><each in=@xs as y><i></i>${b}</each></div>`],
];

const shapes = [];
for (const [g, guard] of GUARDS) {
  for (const [w, wrap] of WRAPS) shapes.push([`${g} (${w})`, PAGE(guard, wrap)]);
}

// A guard that reads the ROW: the row starts granted, the button writes the same-key row with `ok`
// computed from the password. Id keys and index keys; the immediate row and an outer row; nested and
// multi-root positions.
const ROW = (keyed, guard, nest) => {
  const row = (ok) => `[{ ${keyed ? "id: 1, " : ""}ok: ${ok}, cells: [1] }]`;
  return `<rows> = ${row("true")}
\${
    function grant(p) { return p == "secret" }
}
<button id="wrong" onclick=\${ @rows = ${row('grant("wrong")')} }>go</button>
<button id="right" onclick=\${ @rows = ${row('grant("secret")')} }>go</button>
<div id="out"><each in=@rows${keyed ? " key=@.id" : ""} as r>${nest(`<b if=${guard}>LOGGED IN</b>`)}</each></div>
`;
};
const NESTS = [
  ["nested", (b) => `<span>${b}</span>`],
  ["outer row", (b) => `<each in=r.cells as c><span>${b}</span></each>`],
  ["multi-root", (b) => `${b}<i></i>`],
];
for (const keyed of [true, false]) {
  for (const guard of ["r.ok", "(r.ok)"]) {
    for (const [n, nest] of NESTS) {
      shapes.push([`row guard (${n}), ${keyed ? "id" : "index"} keys, if=${guard}`, ROW(keyed, guard, nest)]);
    }
  }
}
export default shapes;
