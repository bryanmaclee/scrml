// Probe family `n19` — S469 (g-nested-each-if-guard-dropped-s469): an `if=` authorization guard on an
// `<each>` that sits INSIDE another `<each>`'s row (or inside lifted markup). The nested-each branch of
// emit-each never read the inner each's `if=`, so the gated rows rendered whatever the guard said — the
// page showed LOGGED IN before any password was entered, and still after a wrong one. Every guard form
// × every container the nested list can sit in.
// Data, not logic: the default export is a list of [name, scrml source, extraFiles?]. Side: client
// (click #wrong / #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const PAGE = (guard, wrap) => `type AuthErr:enum = { Denied }
type Phase:enum = { Idle, Active }
<pw> = ""
<xs> = [1]
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
${wrap(`<each in=@xs as x if=${guard}>LOGGED IN</each>`)}
`;

const GUARDS = [
  ["plain", `(@pw == "secret")`],
  ["handled failable", `\${ @pw != "" && (check(@pw) !{ _ :> false }) }`],
];
const WRAPS = [
  ["each in each", (e) => `<div id="out"><each in=@xs as y>${e}</each></div>`],
  ["each in each in each", (e) => `<div id="out"><each in=@xs as z><each in=@xs as y>${e}</each></each></div>`],
  ["each in each, component", (e) => `\${ const Box = <div><p id="out"><each in=@xs as y>${e}</each></p></div> }\n<Box/>`],
  ["each in each, engine", (e) => `<div id="out"><engine for=Phase initial=.Idle>\n  <Idle rule=.Active><each in=@xs as y>${e}</each></>\n  <Active rule=.Idle>x</>\n</></div>`],
  ["each in lifted markup", (e) => `<div id="out">\${ for (r of @xs) { lift <span>${e}</span> } }</div>`],
];

const shapes = [];
for (const [g, guard] of GUARDS) {
  for (const [w, wrap] of WRAPS) shapes.push([`${g} (${w})`, PAGE(guard, wrap)]);
}

// S469 review F1 — a LIFTED `<each if=r.ok>` read the create-time loop item: the row starts
// granted, the button writes the same-key row with `ok` computed from the password, and the
// stale gate kept LOGGED IN on a wrong one. Id keys and index keys; `if=r.ok` and `if=(r.ok)`.
const LIFT = (keyed, guard, grant) => {
  const row = (ok) => `[{ ${keyed ? "id: 1, " : ""}ok: ${ok}, cells: [1] }]`;
  return `type AuthErr:enum = { Denied }
<rows> = ${row("true")}
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function grant(p) { return p == "secret" }
}
<button id="wrong" onclick=\${ @rows = ${row(grant('"wrong"'))} }>go</button>
<button id="right" onclick=\${ @rows = ${row(grant('"secret"'))} }>go</button>
<div id="out">\${ for (r of @rows) { lift <span><each in=r.cells as c if=${guard}>LOGGED IN</each></span> } }</div>
`;
};
// (A handled-failable grant in the handler's row literal, `ok: (check("wrong") !{ _ :> false })`,
// is E-CODEGEN-INVALID-LOGIC today — refused for a reason unrelated to the gate, so not a probe of it.)
const GRANTS = [
  ["plain", (p) => `grant(${p})`],
];
for (const keyed of [true, false]) {
  for (const guard of ["r.ok", "(r.ok)"]) {
    for (const [gn, grant] of GRANTS) {
      shapes.push([`lifted stale item, ${keyed ? "id" : "index"} keys, if=${guard}, ${gn}`, LIFT(keyed, guard, grant)]);
    }
  }
}

// S469 review F4 — an `else` sibling where no if= chain is built (an `<each>` row, lifted
// markup) rendered UNCONDITIONALLY. `#out` is the else branch: it must not show on a wrong
// password (it is refused — E-CTRL-001 — and fails closed).
const ELSE = (body) => `<pw> = ""
<xs> = [1]
<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
${body}
`;
shapes.push(["else after a nested each if=", ELSE(`<each in=@xs as y><each in=@xs as x if=(@pw != "secret")>rejected</each><p id="out" else>LOGGED IN</p></each>`)]);
shapes.push(["else after a markup if= in a row", ELSE(`<each in=@xs as y><p if=(@pw != "secret")>rejected</p><p id="out" else>LOGGED IN</p></each>`)]);
shapes.push(["else after a lifted each if=", ELSE(`\${ for (r of @xs) { lift <div><each in=@xs as c if=(@pw != "secret")>rejected</each><p id="out" else>LOGGED IN</p></div> } }`)]);
shapes.push(["else after a markup if= in lifted markup", ELSE(`\${ for (r of @xs) { lift <div><p if=(@pw != "secret")>rejected</p><p id="out" else>LOGGED IN</p></div> } }`)]);
export default shapes;
