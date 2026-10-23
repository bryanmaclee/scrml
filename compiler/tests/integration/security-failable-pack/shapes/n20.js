// Probe family `n20` — S469 (g-structural-if-inside-each-row-template-fails-open, the `<match>` half): an
// `if=` authorization guard on a `<match>` that sits INSIDE an `<each>` row (or an `<each>`'s `<empty>`
// body). The per-row match dispatch never read the match's `if=`, so the dispatched arm rendered whatever
// the guard said — LOGGED IN before any password and still after a wrong one — while the same `<match if=>`
// at top level was gated. Every guard form × every container the row match can sit in, plus a guard that
// reads the ROW item (a stale create-time read logs in after the row is revoked).
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const PAGE = (guard, wrap) => `type Phase:enum = { Idle, Active }
<pw> = ""
<xs> = [1]
<none> = []
<ph>: Phase = .Idle
\${
    function allowed(p) { return p == "secret" }
}
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
${wrap(`<match for=Phase on=@ph if=${guard}><Idle>LOGGED IN</Idle><Active>LOGGED IN</Active></match>`)}
`;

const GUARDS = [
  ["plain", `(@pw == "secret")`],
  ["call", `allowed(@pw)`],
];
const WRAPS = [
  ["match in each", (m) => `<div id="out"><each in=@xs as y>${m}</each></div>`],
  ["match in each, under a row element", (m) => `<div id="out"><each in=@xs as y><span>${m}</span></each></div>`],
  ["match in each in each", (m) => `<div id="out"><each in=@xs as z><each in=@xs as y>${m}</each></each></div>`],
  ["match in each in each in each", (m) => `<div id="out"><each in=@xs as w><each in=@xs as z><each in=@xs as y>${m}</each></each></each></div>`],
  ["match in each, component", (m) => `\${ const Box = <div><p id="out"><each in=@xs as y>${m}</each></p></div> }\n<Box/>`],
  ["match in each, engine arm", (m) => `<div id="out"><engine for=Phase initial=.Idle><Idle rule=.Active><each in=@xs as y>${m}</each></><Active rule=.Idle>x</></></div>`],
  ["match in an each's <empty>", (m) => `<div id="out"><each in=@none as y><p>row</p><empty>${m}</empty></each></div>`],
];

const shapes = [];
for (const [g, guard] of GUARDS) {
  for (const [w, wrap] of WRAPS) shapes.push([`${g} (${w})`, PAGE(guard, wrap)]);
}

// A guard that reads the ROW: the row starts granted, the button writes the same-key row with `ok`
// computed from the password. A gate evaluated once at row creation (or reading the create-time item)
// keeps LOGGED IN on a wrong password. Id keys and index keys; the immediate row and an outer row.
const ROW = (keyed, guard, nest) => {
  const row = (ok) => `[{ ${keyed ? "id: 1, " : ""}ok: ${ok}, cells: [1] }]`;
  return `type Phase:enum = { Idle, Active }
<ph>: Phase = .Idle
<rows> = ${row("true")}
\${
    function grant(p) { return p == "secret" }
}
<button id="wrong" onclick=\${ @rows = ${row('grant("wrong")')} }>go</button>
<button id="right" onclick=\${ @rows = ${row('grant("secret")')} }>go</button>
<div id="out"><each in=@rows${keyed ? " key=@.id" : ""} as r>${nest(`<match for=Phase on=@ph if=${guard}><Idle>LOGGED IN</Idle><Active>LOGGED IN</Active></match>`)}</each></div>
`;
};
for (const keyed of [true, false]) {
  for (const guard of ["r.ok", "(r.ok)"]) {
    shapes.push([`row guard, ${keyed ? "id" : "index"} keys, if=${guard}`, ROW(keyed, guard, (m) => m)]);
    shapes.push([`outer-row guard, ${keyed ? "id" : "index"} keys, if=${guard}`, ROW(keyed, guard, (m) => `<each in=r.cells as c>${m}</each>`)]);
  }
}
export default shapes;
