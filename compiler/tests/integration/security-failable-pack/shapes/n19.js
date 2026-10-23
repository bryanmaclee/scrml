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
export default shapes;
