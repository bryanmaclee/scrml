// Probe family `n22` — S469 (g-row-and-arm-effect-scopes-never-disposed-s469): a STALE EFFECT of removed
// content. Every page starts authorised, with content mounted whose reactive expression calls
// `grant(@tick)`; `grant` sets `@status = "LOGGED IN"`. `#wrong` REVOKES — it removes that content (a
// row, an arm, a row-scoped `<match if=…>`) — then resets `@status` and bumps `@tick`; `#right` only resets
// and bumps. An effect that outlived the content it belonged to runs `grant` on the bump and the wrong
// password logs in. Positions: an arm mounted in a removed row, the `<each>` rows of a torn-down arm (arm
// switch at top level, in a row, in a removed row), a row-scoped `<match if=…>` teardown, the rows of an
// `<each>` nested in a removed row (single and multi-root), a row-scoped `<match if=…>` arm in a removed
// row, and an arm in a row of an `<each>` nested in a removed row. All 9 log in on `29b6320ad`.
// Data, not logic: the default export is a list of [name, scrml source]. Side: client (click #wrong /
// #right, read #out). Do not edit a shape to make it pass.

export const SIDE = "client";

const HEAD = `type Role:enum = { Admin, Guest }
<role>: Role = .Admin
<authed> = true
<tick> = 0
<status> = "rejected"
<cells> = [1, 2]
<sessions> = [{ id: 1, cells: [1, 2] }]
\${
    function grant(t) {
        @status = "LOGGED IN"
        return ""
    }
}
`;

const PAGE = (body, revoke) => `${HEAD}<button id="wrong" onclick=\${ ${revoke}; @status = "rejected"; @tick = @tick + 1 }>go</button>
<button id="right" onclick=\${ @status = "rejected"; @tick = @tick + 1 }>go</button>
<div id="out">\${@status}</div>
${body}
`;

const ARMS = (admin) => `<match for=Role on=@role><Admin>${admin}</Admin><Guest><i>guest</i></Guest></match>`;
const GRANT = `<b>\${grant(@tick)}</b>`;
const EACH_GRANT = `<each in=@cells as c>${GRANT}</each>`;

const shapes = [
  ["an arm mounted in a removed row",
    PAGE(`<each in=@sessions key=@.id as s><div>${ARMS(GRANT)}</div></each>`, "@sessions = []")],
  ["the each rows of an arm mounted in a removed row",
    PAGE(`<each in=@sessions key=@.id as s><div>${ARMS(EACH_GRANT)}</div></each>`, "@sessions = []")],
  ["the each rows of a top-level arm, on arm switch",
    PAGE(`<div>${ARMS(EACH_GRANT)}</div>`, "@role = .Guest")],
  ["the each rows of a row's arm, on arm switch",
    PAGE(`<each in=@sessions key=@.id as s><div>${ARMS(EACH_GRANT)}</div></each>`, "@role = .Guest")],
  ["the each rows of a row-scoped match if= arm, on teardown",
    PAGE(`<each in=@sessions key=@.id as s><match for=Role on=@role if=@authed><Admin>${EACH_GRANT}</Admin><Guest><i>guest</i></Guest></match></each>`, "@authed = false")],
  ["the rows of an each nested in a removed row",
    PAGE(`<each in=@sessions key=@.id as s><div><each in=s.cells as c>${GRANT}</each></div></each>`, "@sessions = []")],
  ["the rows of an each nested in a removed multi-root row",
    PAGE(`<each in=@sessions key=@.id as s><i>row</i><div><each in=s.cells as c>${GRANT}</each></div></each>`, "@sessions = []")],
  ["a row-scoped match if= arm in a removed row",
    PAGE(`<each in=@sessions key=@.id as s><match for=Role on=@role if=@authed><Admin>${GRANT}</Admin><Guest><i>guest</i></Guest></match></each>`, "@sessions = []")],
  ["the each rows of an arm in a row of an each nested in a removed row",
    PAGE(`<each in=@sessions key=@.id as s><each in=s.cells as c><div>${ARMS(EACH_GRANT)}</div></each></each>`, "@sessions = []")],
];

export default shapes;
