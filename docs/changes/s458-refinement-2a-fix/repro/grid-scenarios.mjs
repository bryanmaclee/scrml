// S458 2a-fix F2 — write-originating features × a refined cell. `expect` is the
// cell's value after the steps (a refused write leaves the prior value).
const cells = `
    <n>: number(>0) = 1
    <m>: number = -5
    <p>: number = 7
    type L:struct = { u: string, n: number(>0) }
    <l>: L = { u: "a", n: 1 }
    <ls>: number(>0)[] = [1, 2]
    <items> = [{ id: 1, v: -5 }]
    <o>: number(>0) | not = 1`;
const page = (logic, markup) => `\${${cells}\n${logic}\n}\n<program>\n${markup}\n<p id="sink">\${@n} \${@m} \${@p} \${@l.n} \${@ls.length} \${@o} \${@items.length}</p>\n</program>\n`;
const click = (sel = "#b") => [{ click: sel }];

export const SCENARIOS = [
  { name: "handler-inline", cell: "n", expect: 1, src: page("", `<button id="b" onclick=\${@n = @m}>b</button>`), steps: click() },
  { name: "handler-inline-legit", cell: "n", expect: 7, src: page("", `<button id="b" onclick=\${@n = @p}>b</button>`), steps: click() },
  { name: "handler-fn-call", cell: "n", expect: 1, src: page(`    function setN(v) { @n = v }`, `<button id="b" onclick=\${setN(@m)}>b</button>`), steps: click() },
  { name: "handler-bare-call", cell: "n", expect: 1, src: page(`    function bad() { @n = @m }`, `<button id="b" onclick=bad()>b</button>`), steps: click() },
  { name: "arrow-in-fn", cell: "n", expect: 1, src: page(`    function g() { const f = () => { @n = @m }\n        f() }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "field-write", cell: "l", expect: { u: "a", n: 1 }, src: page(`    function g() { @l.n = @m }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "field-write-legit", cell: "l", expect: { u: "a", n: 7 }, src: page(`    function g() { @l.n = @p }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "element-write", cell: "ls", expect: [1, 2], src: page(`    function g() { @ls[0] = @m }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "push", cell: "ls", expect: [1, 2], src: page(`    function g() { @ls.push(@m) }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "push-legit", cell: "ls", expect: [1, 2, 7], src: page(`    function g() { @ls.push(@p) }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "decrement", cell: "n", expect: 1, src: page(`    function g() { @n-- }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "increment-legit", cell: "n", expect: 2, src: page(`    function g() { @n++ }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "object-assign", cell: "l", expect: { u: "a", n: 1 }, src: page(`    function g() { Object.assign(@l, { n: @m }) }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "alias-field-write", cell: "l", expect: { u: "a", n: 1 }, src: page(`    function g() {\n        const x = @l\n        x.n = @m\n    }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "each-row", cell: "n", expect: 1, src: page("", `<ul><each in=@items key=@.id as it><li><button class="r" onclick=\${@n = it.v}>r</button></li></each></ul>`), steps: click(".r") },
  { name: "lift-row", cell: "n", expect: 1, src: page("", `<ul>\${ for (const it of @items) { lift <li><button class="r" onclick=\${@n = it.v}>r</button></li> } }</ul>`), steps: click(".r") },
  { name: "cps-server-result", cell: "n", expect: 1, server: { getNeg: -5 }, src: page(`    server function getNeg() { return -5 }\n    function load() { @n = getNeg() }`, `<button id="b" onclick=load()>b</button>`), steps: [...click(), { settle: true }] },
  { name: "request-result", cell: "n", expect: 1, server: { getNeg: -5 }, src: page(`    server function getNeg() { return -5 }`, `<request id="r" deps=[]>\n    \${ @n = getNeg() }\n</>`), steps: [{ settle: true }] },
  { name: "reset", cell: "n", expect: 3, src: `\${\n    <q>: number = 3\n    <n>: number(>0) = @q\n    function g() {\n        @q = -5\n        reset(@n)\n    }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@n} \${@q}</p>\n</program>\n`, steps: click() },
  { name: "bind-value", cell: "n", expect: 1, src: page("", `<input id="i" bind:value=@n/>`), steps: [{ input: "#i", value: "-5" }] },
  { name: "bind-value-legit", cell: "n", expect: 4, src: page("", `<input id="i" bind:value=@n/>`), steps: [{ input: "#i", value: "4" }] },
  { name: "nullable-write-not-legit", cell: "o", expect: null, src: page(`    function g() { @o = not }`, `<button id="b" onclick=g()>b</button>`), steps: click() },
  { name: "channel-sync", cell: "n", expect: 1, src: `<program>\n<channel name="c">\n    <n>: number(>0) = 1\n</channel>\n<p id="o">\${@n}</p>\n</program>\n`, steps: [{ socket: { __type: "__sync", __key: "n", __val: -5 } }] },
  { name: "channel-sync-legit", cell: "n", expect: 9, src: `<program>\n<channel name="c">\n    <n>: number(>0) = 1\n</channel>\n<p id="o">\${@n}</p>\n</program>\n`, steps: [{ socket: { __type: "__sync", __key: "n", __val: 9 } }] },
];

// LOCAL bindings (no setter): the AST obligation judges the write; a refused write
// throws before `@s = "wrote"`, so @s stays "none".
const local = (body, v = "@m") => ({
  cell: "s",
  src: `\${\n    type L:struct = { u: string, n: number(>0) }\n    <m>: number = -5\n    <p>: number = 7\n    <s>: string = "none"\n    function g() {\n${body.replaceAll("$V", v).split("\n").map((l) => "        " + l).join("\n")}\n        @s = "wrote"\n    }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@s}</p>\n</program>\n`,
  steps: [{ click: "#b" }],
});
const LOCALS = [
  ["local-reassign", "let k: number(>0) = 1\nk = $V"],
  ["local-element-write", "let a: number(>0)[] = [1, 2]\na[0] = $V"],
  ["local-push", "let a: number(>0)[] = [1, 2]\na.push($V)"],
  ["local-field-write", `let l: L = { u: "a", n: 1 }\nl.n = $V`],
  ["local-object-assign", `let l: L = { u: "a", n: 1 }\nObject.assign(l, { n: $V })`],
  ["local-decrement", "let k: number(>0) = 1\nk--", "@m"],
  ["local-expr-arrow", "let k: number(>0) = 1\nconst f = (d) => (k = d)\nf($V)"],
  ["local-annotated-destructure", "let { n }: L = { u: \"a\", n: $V }"],
];
for (const [name, body] of LOCALS) {
  SCENARIOS.push({ name, expect: "none", ...local(body) });
  if (name !== "local-decrement") SCENARIOS.push({ name: name + "-legit", expect: "wrote", ...local(body, "@p") });
}
SCENARIOS.push({ name: "local-increment-legit", expect: "wrote", ...local("let k: number(>0) = 1\nk++") });
// A block-bodied arrow is opaque to the type stage (raw text): a write into an
// outer refined LOCAL inside one is refused at compile time (never unchecked).
SCENARIOS.push({ name: "local-block-arrow-body", expect: "COMPILE ERROR E-CONTRACT-002", ...local("let k: number(>0) = 1\nconst f = () => { k = $V }\nf()") });
SCENARIOS.push({ name: "local-block-arrow-shadowed-legit", expect: "wrote", ...local("let k: number(>0) = 1\nconst f = (k) => { k = $V }\nf(1)") });
SCENARIOS.push({ name: "cell-block-arrow-body", cell: "n", expect: 1, src: page(`    function g() {\n        const f = () => { @n = @m }\n        f()\n    }`, `<button id="b" onclick=g()>b</button>`), steps: [{ click: "#b" }] });

const drag = `\${\n    type Drag:enum = { Idle, Dragging(id: number(>0)) }\n    <m>: number = -5\n    <p>: number = 7\n`;
const engine = `<engine for=Drag initial=.Idle>\n    <Idle rule=.Dragging></>\n    <Dragging id rule=.Idle : "Dragging \${id}"></>\n</>\n`;
SCENARIOS.push(
  { name: "request-result-legit", cell: "n", expect: 5, server: { getPos: 5 }, src: page(`    server function getPos() { return 5 }`, `<request id="r" deps=[]>\n    \${ @n = getPos() }\n</>`), steps: [{ settle: true }] },
  { name: "enum-payload-cell", cell: "d", expect: "Idle", src: `${drag}    <d>: Drag = .Idle\n    function g() { @d = .Dragging(@m) }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@d}</p>\n</program>\n`, steps: [{ click: "#b" }] },
  { name: "enum-payload-cell-legit", cell: "d", expect: { variant: "Dragging", data: { id: 7 } }, src: `${drag}    <d>: Drag = .Idle\n    function g() { @d = .Dragging(@p) }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@d}</p>\n</program>\n`, steps: [{ click: "#b" }] },
  { name: "engine-payload-transition", cell: "drag", expect: "Idle", src: `${drag}}\n${engine}<program>\n<button id="b" onclick=\${@drag = .Dragging(@m)}>b</button>\n<p id="s">\${@drag}</p>\n</program>\n`, steps: [{ click: "#b" }] },
  { name: "engine-payload-transition-legit", cell: "drag", expect: { variant: "Dragging", data: { id: 7 } }, src: `${drag}}\n${engine}<program>\n<button id="b" onclick=\${@drag = .Dragging(@p)}>b</button>\n<p id="s">\${@drag}</p>\n</program>\n`, steps: [{ click: "#b" }] },
);
