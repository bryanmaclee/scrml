# Using external JavaScript libraries in scrml

Before you reach for an external JS library, check whether scrml already handles the problem. Adopters coming from the TypeScript/React/Vue ecosystem tend to reach for packages reflexively — the muscle memory is `npm install lodash` before checking if the language already has what lodash provides. This doc is the translation table and the escape hatches, in that order.

> Accurate as of scrml v0.8.0 (2026-09-29). Every complete program on this page compiles with that compiler; blocks marked *fragment* are excerpts, not whole programs.

**The most important thing to know up front:** scrml's type system, reactive runtime, and stdlib cover a surprising amount of what adopters typically pull from npm. A large fraction of "I need X" objections resolve at the first section below without touching any escape hatch.

---

## 1. The translation table — does scrml already cover this?

### "I need zod for runtime schema validation"

Usually you don't. scrml's type system checks at compile time and at the boundary where untrusted values enter. Struct types (`type User:struct = { ... }`), enums (`type Color:enum = { Red, Green, Blue }`), and inline type predicates (`number(>0 && <10000)`, `string(email)`, SPEC §53) cover most of what zod is used for, with compile-time errors instead of runtime exceptions where the value is known statically.

```scrml
<program>
type Email = string(email)
type Age = number(>= 0 && <= 150)

type User:struct = {
    name:  string,
    email: Email,        // a predicate-typed field
    age:   Age
}

<u>: User = { name: "Ada", email: "ada@example.com", age: 36 }
<p>${@u.name}</p>
</program>
```

`scrml:data` exports runtime validation for when you want validated records without declaring a struct type: `validate(data, schema, check?)` over rules as data — the `Rule` enum (`Rule.Req`, `Rule.Email`, `Rule.MinLength(n)`, `Rule.Pattern(re)`, `Rule.Custom(tag)`, etc.).

### "I need lodash"

`scrml:data` covers most of it. Available today: `pick`, `omit`, `mapKeys`, `mapValues`, `groupBy`, `indexBy`, `sortBy`, `unique`, `flatten`, `flattenDeep`, `chunk`, `clamp`, `paginate`, `deepMerge`, `toSnakeCase`, `toCamelCase`, `camelizeKeys`, `snakifyKeys`.

```scrml
import { groupBy, sortBy, pick } from 'scrml:data'     // fragment — one line inside <program>
```

For the lodash functions that aren't in the stdlib, write them inline (lodash functions are typically 5–15 lines) or import a small local `.js` helper (§3).

### "I need date-fns / dayjs / moment"

`scrml:time`. `formatDate`, `formatTime`, `formatDateTime`, `formatRelative`, `startOf`, `addTime`, `diffTime`, `debounce`, `throttle`, all pure, usable client-side and server-side.

```scrml
import { formatDate, formatRelative } from 'scrml:time'   // fragment — one line inside <program>
```

### "I need axios / ky for HTTP"

`scrml:http`. Typed fetch wrapper with timeout, retry, and normalized response (`{ ok, status, data, headers, raw }`). HTTP 4xx/5xx does not throw — check `ok`.

### "I need bcrypt / argon2 / jsonwebtoken"

`scrml:crypto` (hashing, tokens, UUIDs) and `scrml:auth` (JWT + password + rate limiter + TOTP). Server-side only by design.

### "I need uuid / nanoid"

`scrml:crypto` → `generateToken`, `generateUUID`.

### "I need numeral.js / Intl helpers"

`scrml:format`. `formatCurrency`, `pluralize`, `slug`, `truncate`, etc. Uses `Intl.NumberFormat` / `Intl.DateTimeFormat` — respects locale.

### "I need react-hook-form / formik"

You don't. scrml has first-class form handling: `bind:value` on `<input>` wires to reactive state, inline type predicates validate per-field, submit handlers are just functions that fire on submit. The form IS the reactive state graph.

### "I need redux / zustand / recoil / jotai"

You don't. Reactive state cells are the state primitive: `<count> = 0` declares one, `@count` reads and writes it. `const <doubled> = @count * 2` is a derived cell and replaces selectors. `<engine>` replaces state-machine libraries (XState). (The older `<machine>` element has been removed.)

```scrml
<program>
<count> = 0
const <doubled> = @count * 2
<button onclick=@count++>+</button>
<p>${@doubled}</p>
</program>
```

### "I need tailwindcss"

You don't need to install it. The compiler has a built-in Tailwind utility engine (SPEC §26): use utility classes (`p-4`, `max-w-2xl`, `hover:text-rose-900`, `md:grid-cols-2`) directly in markup and the compiler emits CSS for only the classes you use — no Tailwind CLI, PostCSS, or config file. Variant prefixes and many arbitrary values (`grid-cols-[1fr_2fr]`) are supported; an unrecognized class fires the `W-TAILWIND-UNRECOGNIZED-CLASS` lint. For hand-written CSS, use `#{...}` blocks: inside a component they are scoped with native `@scope`; at `<program>` level they are global.

### "I need an ORM (Prisma, Drizzle, TypeORM)"

You don't. scrml's `?{ SELECT ... FROM users }` is SQL checked at compile time against the schema (from `<schema>` or the `<db src="…">` database). Type-checked queries without a query builder, and `scrml db-migrate` applies `<schema>` changes to a real database.

### "I need a test runner (jest, vitest)"

`~{}` inline test blocks run under the compiler and are stripped from production builds; `scrml:test` provides assertion helpers. The scrml compiler's own suite uses `bun test` directly — that works on any `.test.js` file. `--emit-machine-tests` emits property tests from `<engine>` declarations (§51.13).

### "I need JSON Schema / OpenAPI"

Struct and enum types + inline type predicates are the source of truth. Generate OpenAPI downstream from those types if you need the ecosystem interop; don't author OpenAPI by hand.

### "I need graphql / trpc"

You don't. Server functions are typed RPCs. The compiler-inferred call graph IS the schema — no separate client/server contract.

---

## 2. JS built-ins you can use directly

Appendix D of SPEC.md lists globals available inside `${ }` logic with no import and no `^{}` ceremony: `Array`, `Object`, `Boolean`, `Date`, `JSON`, `Math`, `console`, `Intl`, `Reflect`, `Proxy`, `parseInt`, `parseFloat`, `Number.isFinite`, `isNaN`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `structuredClone`, `encodeURIComponent`, `decodeURIComponent`, `btoa`, `atob`. Provided by the Bun runtime, part of ECMAScript.

```scrml
const today = new Date()                              // fragment — inside <program> or a function body
const formatted = today.toISOString().split("T")[0]
```

For numbers and randomness the stdlib has sanctioned wrappers — `scrml:math` (pure: `round`, `floor`, `clamp`, `parseInt`, …) and `scrml:random` (`random`, `randomInt`) — which keep pure `fn` bodies pure.

---

## 3. Local `.js` helper files

If you have a small JS file in your project, import it with a relative path (SPEC §21):

```scrml
import { helper } from './helper.js'              // fragment — inside <program>
import { computeThing } from './utils/math.js'
```

Use this for small, project-local utilities. No ceremony, no tooling, no manifest.

---

## 4. `^{}` meta blocks — compile-time code generation

`^{}` runs at compile time. It works over a closed set of meta primitives (`emit()`, `reflect(Type)`, and a few others — SPEC §22): it can generate markup from compile-time data or introspect your types. It is **not** a host escape hatch — no DOM, no SQL, no file or network I/O, and no `eval`.

```scrml
<program>
const links = [
    { href: "/docs", label: "Docs" },
    { href: "/blog", label: "Blog" },
]

<nav>
    ^{
        // Runs at compile time: the loop unrolls into static markup.
        for (const l of links) {
            emit(`<a href="${l.href}">${l.label}</a>`)
        }
    }
</nav>
</program>
```

**When `^{}` is the right tool:** code generation, compile-time constants, markup derived from a type (`reflect`).

**When `^{}` is the wrong tool:** reaching a runtime capability. Use the stdlib, a local `.js` file (§3), or a vendored library (§5). A JS-host API that throws can be wrapped with `scrml:host`'s `safeCall` / `safeCallAsync`, which turn the throw into a scrml failable result. Direct host imports (`import:host`) are gated by a `scrml.toml` `[capabilities] host-import` allow-list that is disabled by default (SPEC §22.13).

---

## 5. `vendor/` pattern — for whole libraries you've reviewed

For third-party scrml source you want to ship with your project, copy it into `vendor/` at the project root and import it via the `vendor:` prefix:

```scrml
import { specialThing } from 'vendor:some-library'   // fragment — resolves to vendor/some-library.scrml
```

The import resolver (§41) treats `vendor:` as a first-class prefix: `vendor:<name>` resolves to `vendor/<name>.scrml` under the project root (a missing file is `E-IMPORT-006`). No registry, no lockfile, no auto-fetch. You read the source, you commit it, you know what you're shipping.

A vendored plain-JavaScript library (ESM) is imported with a relative path instead — `import { x } from './vendor/lib/index.js'` — as in §3.

**Future tooling:** `scrml vendor add <url>` (planned, not yet shipped) will automate the fetch + hash-verify + write. Today it's a manual copy.

---

## 6. Sidecars — `use foreign:` for non-JS code (specified, not shipped)

> **Not in the shipping compiler.** Sidecars are specified in SPEC §23.4 / §43, but the out-of-process sidecar codegen is not implemented in v0.8.0. A `use foreign:` declaration fails closed with `E-FOREIGN-SIDECAR-NOMINAL`. The block below shows the specified design; it does not compile today.

If your external code is not JavaScript at all — Go, Rust, Python, etc. — the specified pattern is a sidecar: nest a `<program lang="...">` block with the foreign source, and import its exported functions with `use foreign:`:

```scrml
// specified in SPEC §23.4 — not in the shipping compiler yet
<program>
    <program lang="python" name="ml">
        def predict(features): ...
    </program>

    ${ use foreign:ml { predict } }

    server fn score(input) {
        return predict(input)
    }
</program>
```

As specified: server-side only, the compiler generates the HTTP/socket client code, and types are declared in scrml and checked at the boundary.

---

## 7. What scrml does NOT support (and why)

### npm registry — by design

Bare specifiers (`import X from "lodash"`) are a compile error (E-IMPORT-005). scrml has no npm integration, no lockfile, no auto-fetch. This is a deliberate commitment (SPEC §41.4, §41.6): the toolchain does not download anything automatically. The paths for an npm package's functionality are: the stdlib, a local `.js` file (§3), or a reviewed source copy (§5).

### `eval` / `new Function` — not supported

There is no runtime code evaluation in scrml: `eval(...)` and `new Function(...)` do not resolve (they are rejected as undeclared identifiers, `E-SCOPE-001`). Dynamic `import(...)` is also rejected (`E-DYNAMIC-IMPORT-NOT-IN-SCRML`).

If you're looking for "how do I use lodash in scrml" — section 1 above probably already answered it.

### CDN imports — not yet specced

No `cdn:` or `https:` prefix today. Loading an external browser module at runtime (e.g., CodeMirror, Monaco, D3) has no first-class answer yet; it is an open design question.

### Bundler integration — deferred

scrml's compiler emits plain JS; if you need a separate bundler (Vite, esbuild) in the pipeline, wire it downstream of `scrml compile`. There is no first-class plugin/adapter interface today.

---

## 8. FAQ

### "Why not just add npm support?"

The short answer: every language that shipped a "temporary" npm bridge kept it. The stdlib, local `.js` imports, and the `vendor/` pattern are the designed answers — they preserve the philosophy that dependencies are a liability, not a feature. If you find an actual gap, the productive ask is "add this to stdlib," not "add a package manager."

### "The stdlib is missing X. What do I do?"

Three options, in order: (1) open an issue describing the gap; (2) write it inline in your project (most missing-stdlib cases are 10–30 lines); (3) if it's genuinely external and significant, vendor the source after reviewing it.

### "Can I mix scrml with React / Vue / Svelte?"

Not directly; scrml compiles to standalone HTML/JS/CSS, not to framework-embeddable components. For incremental adoption, the unit of migration is the page — move one page at a time from your framework to a scrml file.

### "How do I type an external JS library?"

If you're calling a local `.js` file, write a struct type that represents the surface you consume and annotate the binding:

```scrml
<program>
import { parseDate } from './date-helper.js'

type DateResult:struct = {
    year:  int,
    month: int,
    day:   int
}

const result: DateResult = parseDate("2026-04-22")
<p>${result.year}</p>
</program>
```

### "I'm writing a CodeMirror / Monaco / D3 integration. What's the current-best-practice pattern?"

There is no first-class pattern yet. Integrations built so far inject a `<script type="module">`, expose the module on `window`, and talk to scrml state through `CustomEvent`s. It works but is clunky; a cleaner pattern is an open design question.

### "Is there a path to CDN imports someday?"

Possibly. It is an open question, to be revisited if real adopters need it after `scrml vendor add` ships.

---

## Reference

- SPEC §21 — Module and Import System
- SPEC §23.4 — `use foreign:` sidecars (specified; not in the shipping compiler)
- SPEC §41 — Import System (`use` + `import` hybrid)
- SPEC §53 — Inline Type Predicates
- SPEC Appendix D — JS standard library access
- SPEC §26 — Tailwind utility classes
- `stdlib/` — the standard-library modules, each importable as `scrml:<name>`; the current list and count are in [`docs/FACTS.md`](FACTS.md)
- `examples/` — working sample apps
