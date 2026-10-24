// Probe family `n25` — S469 (g-engine-inside-each-row-renders-nothing): an `<engine>` used as a GATE inside
// an `<each>` row. The engine's body is the guarded content ("LOGGED IN"); it is gated by an `if=` on the
// engine, on an enclosing element, on a `<match>` arm, or the engine's own arm is chosen by a guard that
// reads the password. `#wrong` sets the wrong password, `#right` the right one; both start from `""`.
// Positions: the row root, a multi-root row, a nested element, an `if=` element, a `<match>` arm in the
// row (TAB-parsed and codegen-only parse), the row of an `<each>` in a `<match>` arm, the row of a nested
// `<each>`, and the `<empty>` fallback of a list in a row / at top level.
//
// On `c9f8cd25b` every shape is PASS-DENY: the row renderer dropped the engine (renders nothing for
// either password, no diagnostic) — fail closed, so never a wrong-password login, but silent. The §51.0.K
// rule (S439 ruling #10) refuses an engine in a row: E-COMPONENT-ENGINE-SCOPE (PASS-REFUSED); the
// top-level `<empty>` shape is E-CG-003 (impl#1 cannot lower it). The floor: none may ever show LOGGED IN
// on the wrong password — e.g. a future per-row engine lowering that evaluates its gate once at row
// creation, or ungated.
// Data, not logic: the default export is a list of [name, scrml source]. Side: client (click #wrong /
// #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const HEAD = `type Phase:enum = { Idle, Active }
type Mode:enum = { A, B }
<mode>: Mode = .A
<pw> = ""
<xs> = [{ id: 1, ys: [1] }]
<none> = []
`;

const PAGE = (out) => `${HEAD}<button id="wrong" onclick=\${ @pw = "wrong" }>go</button>
<button id="right" onclick=\${ @pw = "secret" }>go</button>
<div id="out">${out}</div>
`;

// The gated engine: its only visible text is LOGGED IN, behind `if=(@pw == "secret")`.
const GATED = `<engine for=Phase initial=.Idle if=(@pw == "secret")><Idle rule=.Active>"LOGGED IN"</><Active rule=.Idle>"LOGGED IN"</></>`;
// An ungated engine whose arm text is decided by the password (the gate is inside the arm).
const ARMGATE = `<engine for=Phase initial=.Idle><Idle rule=.Active>\${@pw == "secret" ? "LOGGED IN" : ""}</><Active rule=.Idle>""</></>`;

const shapes = [
  ["a gated engine as the row root",
    PAGE(`<each in=@xs key=@.id as r>${GATED}</each>`)],
  ["a gated engine as the row root, index-keyed",
    PAGE(`<each in=@xs as r>${GATED}</each>`)],
  ["a gated engine between two empty roots of a multi-root row",
    PAGE(`<each in=@xs key=@.id as r><i></i>${GATED}<b></b></each>`)],
  ["a gated engine in a nested element of the row",
    PAGE(`<each in=@xs key=@.id as r><span><em>${GATED}</em></span></each>`)],
  ["an engine under an if= element in the row",
    PAGE(`<each in=@xs key=@.id as r><span if=(@pw == "secret")>${ARMGATE.replace('${@pw == "secret" ? "LOGGED IN" : ""}', '"LOGGED IN"')}</span></each>`)],
  ["an engine whose arm reads the password, in the row",
    PAGE(`<each in=@xs key=@.id as r>${ARMGATE}</each>`)],
  ["a gated engine in a <match> arm in the row",
    PAGE(`<each in=@xs key=@.id as r><span><match for=Mode on=@mode><A>${GATED}</><B>""</></></span></each>`)],
  ["a gated engine in a <match> arm in the row that also holds an <each>",
    PAGE(`<each in=@xs key=@.id as r><span><match for=Mode on=@mode><A>${GATED}<each in=r.ys as y><i></i></each></><B>""</></></span></each>`)],
  ["a gated engine in the row of an <each> inside a top-level <match> arm",
    PAGE(`<match for=Mode on=@mode><A><each in=@xs key=@.id as r>${GATED}</each></><B>""</></>`)],
  ["a gated engine in the row of a nested <each>",
    PAGE(`<each in=@xs key=@.id as r><span><each in=r.ys as y>${GATED}</each></span></each>`)],
  ["a gated engine in the <empty> fallback of a list in a row",
    PAGE(`<each in=@xs key=@.id as r><span><each in=@none as n><i></i><empty>${GATED}</empty></each></span></each>`)],
  ["a gated engine in the <empty> fallback of a top-level list",
    PAGE(`<each in=@none as n><i></i><empty>${GATED}</empty></each>`)],
];

export default shapes;
