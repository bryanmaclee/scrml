// s458-refinement-every-position Phase 0 — reproducer sources, one per position (plus controls).
// Each entry: { name, mode?, src }. `run.mjs` writes each to <name>.scrml next to this file and compiles it.
// All sources use V5-strict declaration form: top-level `<x>: T = v`, function locals `let`/`const`.

export const PROBES = [
  // ---- controls (positions that ARE checked today) ----
  { name: "c0-decl-boundary", src: `<program>
\${
  function pick(v) {
    let q: string(url) = v
    return q
  }
}
<p>\${pick("https://example.com")}</p>
</program>
` },
  { name: "c1-client-param", src: `<program>
\${
  function take(u: string(url)) {
    return u
  }
  function relay(v) {
    return take(v)
  }
}
<p>\${relay("https://example.com")}</p>
</program>
` },
  { name: "c2-server-param", src: `<program>
\${
  server function save(link: string(url)) {
    return link
  }
}
<button onclick=save("https://example.com")>save</button>
</program>
` },
  { name: "c3-client-return", src: `<program>
\${
  function pick(v) -> string(url) {
    return v
  }
}
<p>\${pick("https://example.com")}</p>
</program>
` },

  // ---- (1) reassignment of a refined cell / binding ----
  { name: "p1a-reactive-reassign", src: `<program>
<u>: string(url) = "https://example.com"
\${
  function setIt(v) {
    @u = v
  }
}
<p id="out">\${@u}</p>
<button onclick=setIt("javascript:alert(1)")>x</button>
</program>
` },
  { name: "p1b-local-reassign", src: `<program>
\${
  function pick(v) {
    let q: string(url) = "https://example.com"
    q = v
    return q
  }
}
<p>\${pick("https://example.com")}</p>
</program>
` },
  { name: "p1c-reactive-reassign-literal", src: `<program>
<u>: string(url) = "https://example.com"
\${
  function setIt() {
    @u = "javascript:alert(1)"
  }
}
<p id="out">\${@u}</p>
<button onclick=setIt()>x</button>
</program>
` },

  // ---- (2) struct fields ----
  { name: "p2a-struct-field-runtime", src: `<program>
\${
  type Link:struct = { u: string(url), n: number(>0) }
  function mk(v, k) {
    const l: Link = { u: v, n: k }
    return l
  }
}
<p>\${mk("https://example.com", 1).u}</p>
</program>
` },
  { name: "p2b-struct-field-static", src: `<program>
\${
  type Link:struct = { u: string(url), n: number(>0) }
  function mk() {
    const l: Link = { u: "javascript:alert(1)", n: -1 }
    return l
  }
}
<p>\${mk().u}</p>
</program>
` },
  { name: "p2c-struct-field-enum-subset-static", src: `<program>
\${
  type Role:enum = { Admin, Editor, Viewer }
  type Post:struct = { title: string, role: Role oneOf([.Admin, .Editor]) }
  function mk() {
    const bad: Post = { title: "x", role: .Viewer }
    return bad
  }
}
<p>\${mk().title}</p>
</program>
` },
  { name: "p2d-struct-field-mutation", src: `<program>
\${
  type Link:struct = { u: string(url) }
  function mk(v) {
    let l: Link = { u: "https://example.com" }
    l.u = v
    return l
  }
}
<p>\${mk("https://example.com").u}</p>
</program>
` },

  // ---- (3) top-level const / const anywhere ----
  { name: "p3a-toplevel-const", src: `<program>
\${
  function pick() {
    return "javascript:alert(1)"
  }
  const X: string(url) = pick()
}
<p id="out">\${X}</p>
</program>
` },
  { name: "p3b-fn-local-const", src: `<program>
\${
  function pick(v) {
    const q: string(url) = v
    return q
  }
}
<p>\${pick("https://example.com")}</p>
</program>
` },

  // ---- (4) <endpoint> payload fields ----
  { name: "p4a-endpoint-payload", src: `<program>

type Req:enum = {
  Save(link: string(url))
  Count(n: number(>0))
}

<endpoint path="/e" method="POST" accepts=Req>
  <Save(link) : { saved: link }>
  <Count(n) : { n: n }>
</endpoint>

</program>
` },
  // ---- (4b) parseVariant call (same decoder) ----
  { name: "p4b-parsevariant-call", src: `<program>
\${
  import { parseVariant } from 'scrml:data'
  type Req:enum = {
    Save(link: string(url))
  }
  function decode(raw) {
    const r = parseVariant(raw, Req) !{
      .MissingDiscriminator :> { return "missing" }
      .UnknownVariant(tag) :> { return "unknown" }
      .InvalidPayload(field, reason) :> { return "invalid" }
      .Malformed(reason) :> { return "malformed" }
    }
    return "ok"
  }
}
<p>\${decode("{}")}</p>
</program>
` },
  // ---- (4c) <api> response ----
  { name: "p4c-api-response", src: `<program>
\${
  type Q:struct = { id: int }
  type Res:enum = {
    Found(link: string(url))
    NotFound
  }
  <query>: Q = { id: 1 }
}
<api base="https://api.example.com">
  getIt(Q) -> GET "/x/\${id}" : Res
</api>
<request id="r" api="getIt" args=@query></>
</program>
` },

  // ---- (5) schema / table fields ----
  { name: "p5a-schemafor-refined-struct", src: `\${
  import { schemaFor } from 'scrml:data'
  type Link:struct = {
    u: string(url)
    n: number(>0)
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Link) }
  </>
</program>
` },
  { name: "p5b-table-state-type-refined-field", src: `<program db="sqlite:./test.db">
\${
  < Link authority="server" table="links">
    id: number
    url: string(url)
  </>
  <Link> @links
}
<ul><each in=@links key=@.id><li>\${@.url}</li></each></ul>
</program>
` },

  // ---- (6) server function refined return ----
  { name: "p6a-server-return", src: `<program>
\${
  server function make(v) -> string(url) {
    return v
  }
  <out> = ""
  function go() {
    @out = make("javascript:alert(1)")
  }
}
<button onclick=go()>go</button>
<p>\${@out}</p>
</program>
` },

  // ---- (7) library / tool / value-export function parameters ----
  { name: "p7a-library-export-param", mode: "library", src: `<program>
\${
  export function take(u: string(url)) {
    return u
  }
}
</program>
` },
  { name: "p7b-tool-param", src: `<program kind="tool" lang="js">
    function take(u: string(url)): string {
        return u
    }
    function main(args: string[]): number {
        println(take(args[0]))
        return 0
    }
</program>
` },
  { name: "p7c-value-export-param", src: `<program>
\${
  export function take(u: string(url)) {
    return u
  }
}
<p>\${take("https://example.com")}</p>
</program>
` },

  // ---- (8) literal call argument (static zone) ----
  { name: "p8a-literal-call-arg", src: `<program>
\${
  function take(u: string(url)) {
    return u
  }
}
<p>\${take("javascript:alert(1)")}</p>
</program>
` },
  { name: "p8b-literal-call-arg-number", src: `<program>
\${
  function take(n: number(>0)) {
    return n
  }
}
<p>\${take(-5)}</p>
</program>
` },

  // ---- (9) nested worker <program> function parameter ----
  { name: "p9a-worker-fn-param", src: `<program>
<out> = ""
<program name="wk">
  \${
    function check(u: string(url)) {
      return u
    }
    when message(data) {
      send(check(data))
    }
  }
</program>
<p>\${@out}</p>
</program>
` },

  // ---- predicate-FORM axis (not a position — the reader) ----
  { name: "f1-sharedcore-param", src: `<program>
\${
  function take(n: number.min(0).max(100)) {
    return n
  }
  function relay(v) {
    return take(v)
  }
}
<p>\${relay(5)}</p>
</program>
` },
  { name: "f2-enum-subset-param", src: `<program>
\${
  type Role:enum = { Admin, Editor, Viewer }
  function promote(r: Role oneOf([.Admin, .Editor])) {
    return r
  }
  function relay(v) {
    return promote(v)
  }
}
<p>\${relay(.Admin)}</p>
</program>
` },
  { name: "f3-pattern-decl", src: `<program>
\${
  function pick(v) {
    let e: string(pattern(/^[^@]+@[^@]+$/)) = v
    return e
  }
}
<p>\${pick("a@b")}</p>
</program>
` },
  { name: "f5-unknown-shape-boundary-decl", src: `<program>
\${
  function pick(v) {
    let e: string(ssn) = v
    return e
  }
}
<p>\${pick("a")}</p>
</program>
` },
  { name: "f6-sharedcore-inparen-decl", src: `<program>
\${
  function pick(v) {
    let n: number(min(0) && max(100)) = v
    return n
  }
}
<p>\${pick(5)}</p>
</program>
` },
  { name: "f7-sharedcore-literal-decl", src: `<program>
\${
  function pick() {
    let n: number(min(0) && max(100)) = 500
    let s: string.req.length(>=2) = ""
    return n
  }
}
<p>\${pick()}</p>
</program>
` },
  { name: "f4-enum-subset-server-param", src:`<program>
\${
  type Role:enum = { Admin, Editor, Viewer }
  server function promote(r: Role oneOf([.Admin, .Editor])) {
    return r
  }
}
<button onclick=promote(.Admin)>go</button>
</program>
` },
];
