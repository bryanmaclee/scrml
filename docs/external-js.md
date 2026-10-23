# Using external JavaScript libraries in scrml

<!-- dialect: ruled -->

Before you reach for an external JS library, check whether scrml already handles the problem. Adopters coming from the TypeScript/React/Vue ecosystem tend to reach for packages reflexively — the muscle memory is `npm install lodash` before checking if the language already has what lodash provides. This doc is the translation table and the escape hatches, in that order.

> This page teaches **today's ruled scrml**, the language `compiler/SPEC.md` defines, and it is checked by the scrml-native **bootstrap** compiler (`compiler/self-host-v2/`, run as `bun run boot:compile`). CI compiles every complete program on it with that compiler. A program that needs a feature the bootstrap does not build yet (an `import` binding, `^{}`, a sidecar) is still written in the ruled dialect, and is marked spec-ahead in this file's source, naming what is missing (`docs/DIALECT.md`). Blocks marked *fragment* are excerpts, not whole programs. The repository's first compiler (`scrml compile`, impl#1) speaks an older dialect; where this page names an impl#1-only tool, it says so.

**The most important thing to know up front:** scrml's type system, reactive runtime, and stdlib cover a surprising amount of what adopters typically pull from npm. A large fraction of "I need X" objections resolve at the first section below without touching any escape hatch.

---

## 1. The translation table — does scrml already cover this?

### "I need zod for runtime schema validation"

Usually you don't. scrml's type system checks at compile time and at the boundary where untrusted values enter. Struct types (`type User:struct = { ... }`), enums (`type Color:enum = { Red, Green, Blue }`), and inline type predicates (`int(>0 && <10000)`, `string(email)`, SPEC §53) cover most of what zod is used for, with compile-time errors instead of runtime exceptions where the value is known statically.

<!-- gate: spec-ahead [E-PARSE-EXPECTED, E-PARSE-TYPE, E-TYPE-UNKNOWN] — the bootstrap has no inline type predicates (§53) yet -->
```scrml
<program>
  type User:struct = {
    name:  string,
    email: string(email),            // a predicate-typed field (a named shape)
    age:   int(>= 0 && <= 150),      // a range predicate
  }

  <u:User=({ name: "Ada", email: "ada@example.com", age: 36 })/>
  <p>${@u.name}</p>
</program>
```

The predicate sits on the field's type. (A named alias for a predicate, `type Email = string(email)`, is an open SPEC issue, §53.13.3, so spell the predicate where it is used.) `<u:User=(…)/>` is a locked declaration: there is no `let`, so nothing writes `@u` after it is built.

`scrml:data` exports runtime validation for when you want validated records without declaring a struct type: `validate(data, schema, check?)` over rules as data — the `Rule` enum (`Rule.Req`, `Rule.Email`, `Rule.MinLength(n)`, `Rule.Pattern(re)`, `Rule.Custom(tag)`, etc.).

### "I need lodash"

`scrml:data` covers most of it. Available today: `pick`, `omit`, `mapKeys`, `mapValues`, `groupBy`, `indexBy`, `sortBy`, `unique`, `flatten`, `flattenDeep`, `chunk`, `clamp`, `paginate`, `deepMerge`, `toSnakeCase`, `toCamelCase`, `camelizeKeys`, `snakifyKeys`.

<!-- gate: skip — fragment: one import line inside <program> -->
```scrml
import { groupBy, sortBy, pick } from 'scrml:data';
```

For the lodash functions that aren't in the stdlib, write them inline (lodash functions are typically 5–15 lines) or import a small local `.js` helper (§3).

### "I need date-fns / dayjs / moment"

`scrml:time`. `formatDate`, `formatTime`, `formatDateTime`, `formatRelative`, `startOf`, `addTime`, `diffTime`, `debounce`, `throttle`, all pure, usable client-side and server-side.

<!-- gate: skip — fragment: one import line inside <program> -->
```scrml
import { formatDate, formatRelative } from 'scrml:time';
```

### "I need axios / ky for HTTP"

`scrml:http`. Typed fetch wrapper with timeout, retry, and normalized response (`{ ok, status, data, headers, raw }`). HTTP 4xx/5xx does not throw — check `ok`.

### "I need bcrypt / argon2 / jsonwebtoken"

`scrml:crypto` (hashing, tokens, UUIDs) and `scrml:auth` (JWT + password + rate limiter + TOTP). Server-side only by design.

### "I need uuid / nanoid"

`scrml:crypto` → `generateToken`, `generateUUID`.

### "I need numeral.js / Intl helpers"

`scrml:format` (SPEC §41.22), a typed module: `fixed(x, 2, .HalfEven)` and `pad(n, 3, "0")` (both specified S469; not yet in the module), `formatNumber`, `formatPercent`, `pluralize`, `slug`, `truncate`, and more, each returning a string you interpolate. A `${}` slot gives a value's one plain text and takes no format options, so formatting is always a call. The locale-aware members use `Intl` underneath. Money is the exception: its one display path, `formatCurrency(Money, .Mode)`, lands with `scrml:money`.

### "I need react-hook-form / formik"

You don't. scrml has first-class form handling: `bind:value` on `<input>` wires to reactive state, inline type predicates validate per-field, submit handlers are just functions that fire on submit. The form IS the reactive state graph.

### "I need redux / zustand / recoil / jotai"

You don't. Reactive state cells are the state primitive: `let <count:int=0/>` declares a writable one, and `@count` reads and writes it. `<doubled:int=(@count * 2)/>` is a derived cell (a locked declaration whose initializer reads other cells) and replaces selectors. A `single` declaration whose state children carry `rule=` transitions (`<phase:Phase=.Idle single>`, SPEC §66.13) replaces state-machine libraries (XState). (The older `<engine for=T>` and `<machine>` elements are retired forms.)

```scrml
<program>
  let <count:int=0/>
  <doubled:int=(@count * 2)/>

  <button onclick={ @count = @count + 1; }>+</button>
  <p>${@doubled}</p>
</program>
```

### "I need tailwindcss"

You don't need to install it. The language specifies a built-in Tailwind utility engine (SPEC §26): use utility classes (`p-4`, `max-w-2xl`, `hover:text-rose-900`, `md:grid-cols-2`) directly in markup and the compiler emits CSS for only the classes you use — no Tailwind CLI, PostCSS, or config file. For hand-written CSS, use `#{...}` blocks: inside a component they are scoped with native `@scope`; at `<program>` level they are global (§65). Today the Tailwind engine is in impl#1 only. The bootstrap has none yet, and it builds the native `#{}` styling model first.

### "I need an ORM (Prisma, Drizzle, TypeORM)"

You don't. scrml's `?{ SELECT ... FROM users }` is SQL checked at compile time against the schema (from `<schema>` or the `<db src="…">` database). Type-checked queries without a query builder. Applying `<schema>` changes to a real database is impl#1's `scrml db-migrate` today; schema migration has not moved to the bootstrap yet.

### "I need a test runner (jest, vitest)"

`~{}` inline test blocks run under the compiler and are stripped from production builds; `scrml:test` provides assertion helpers. The scrml compiler's own suite uses `bun test` directly — that works on any `.test.js` file. impl#1's `--emit-machine-tests` emits property tests from a state machine's transition graph (§51.13).

### "I need JSON Schema / OpenAPI"

Struct and enum types + inline type predicates are the source of truth. Generate OpenAPI downstream from those types if you need the ecosystem interop; don't author OpenAPI by hand.

### "I need graphql / trpc"

You don't. Server functions are typed RPCs. The compiler-inferred call graph IS the schema — no separate client/server contract.

---

## 2. JS built-ins you can use directly

Appendix D of SPEC.md says which host globals the language admits with no import (S469):

- **In:** the typed arrays (`Float64Array`, `Float32Array`, `Float16Array`, `Int8Array` … `Uint32Array`), `ArrayBuffer` and `DataView`.
- **Out:** `Math` (use `scrml:math`); `String`, `Number`, `parseInt`, `parseFloat` (text goes through a template, and parsing through `T.parse(s)`, which gives `T | not`); `isNaN`, `isFinite`, `BigInt`, `Proxy`, `Reflect`; and `Array` (scrml's one sequence kind is the tape, not a JS array).
- **Open, not decided yet:** the rest of the old list, among them `Date`, `JSON`, `console`, `Intl`, `Map`, `Set`, `setTimeout`, `structuredClone` and `encodeURIComponent`.

A value's methods are its type's, not the host's. A string has the typed table in Appendix D.1, counted in code points, and a tape has the grant-named methods of §66.12.6 (`.append`, never `push`). The bootstrap admits `Date.now()`:

```scrml
<program>
  let <stamp:number=0/>

  function mark() { @stamp = Date.now(); }

  <button onclick=mark()>Stamp</button>
  <p>Last stamp: ${@stamp}</p>
</program>
```

For numbers and randomness the stdlib has sanctioned wrappers — `scrml:math` (pure: `round(x, .Mode)` and `trunc` (specified S469; not yet in the module), `floor`, `clamp`, `parseInt(s, radix)`, …) and `scrml:random` (`random`, `randomInt`) — which keep pure `fn` bodies pure. impl#1 still lets the old host globals through. That is an impl#1 divergence, not the language.

---

## 3. Local `.js` helper files

If you have a small JS file in your project, import it with a relative path (SPEC §21):

<!-- gate: skip — fragment: import lines inside <program> -->
```scrml
import { helper } from './helper.js';
import { computeThing } from './utils/math.js';
```

Use this for small, project-local utilities. No ceremony, no tooling, no manifest.

---

## 4. `^{}` meta blocks — compile-time code generation

`^{}` runs at compile time. It works over a closed set of meta primitives (`emit()`, `reflect(Type)`, and a few others — SPEC §22): it can generate markup from compile-time data or introspect your types. It is **not** a host escape hatch — no DOM, no SQL, no file or network I/O, and no `eval`.

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED] — the bootstrap has no ^{} meta context yet -->
```scrml
<program>
  type Link:struct = { href: string, label: string }

  <nav>
    ^{
      // Runs at compile time: the loop unrolls into static markup.
      const links: Link[] = [
        { href: "/docs", label: "Docs" },
        { href: "/blog", label: "Blog" },
      ];
      for (l of links) {
        emit(`<a href="${l.href}">${l.label}</a>`);
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

<!-- gate: skip — fragment: one import line inside <program>; it resolves to vendor/some-library.scrml -->
```scrml
import { specialThing } from 'vendor:some-library';
```

The import resolver (§41) treats `vendor:` as a first-class prefix: `vendor:<name>` resolves to `vendor/<name>.scrml` under the project root (a missing file is `E-IMPORT-006`). No registry, no lockfile, no auto-fetch. You read the source, you commit it, you know what you're shipping.

A vendored plain-JavaScript library (ESM) is imported with a relative path instead — `import { x } from './vendor/lib/index.js'` — as in §3.

**Future tooling:** `scrml vendor add <url>` (planned, not yet shipped) will automate the fetch + hash-verify + write. Today it's a manual copy.

---

## 6. Sidecars — `use foreign:` for non-JS code (specified, not shipped)

> **Not in either compiler.** Sidecars are specified in SPEC §23.4 / §43, but neither compiler builds them. impl#1 recognizes a `use foreign:` declaration and fails closed with `E-FOREIGN-SIDECAR-NOMINAL`; the bootstrap has no nested `<program>` yet. The block below shows the specified design.

If your external code is not JavaScript at all — Go, Rust, Python, etc. — the specified pattern is a sidecar: nest a `<program name="…" lang="…">` that declares, in scrml types, the functions the sidecar exports, and import them with `use foreign:` at the top level of the outer program:

<!-- gate: spec-ahead [E-BOOTSTRAP-REDECLARE, E-BOOTSTRAP-UNSUPPORTED, E-PARSE-EXPECTED, E-PARSE-EXPR, E-PARSE-UNCLOSED, E-SCOPE-001, E-TYPE-STRUCT-CONTEXT] — the bootstrap has no nested <program> (sidecar; it reads the inner Features as a redeclaration) and no use foreign: declaration yet -->
```scrml
<program>
  type Features:struct = { values: number[], modelId: string }   // declared on both sides: a type does not cross a <program> boundary (§40.4)

  <program name="ml" lang="python" port=9001 health="/health">
    type Features:struct = { values: number[], modelId: string }
    export function predict(f: Features) -> number;
  </>

  use foreign:ml { predict }

  function score(f: Features) -> number {
    return predict(f);
  }
</program>
```

As specified: server-side only (calling `predict` from client code is `E-FOREIGN-012`), the compiler generates the HTTP/socket client code, and the types declared in the nested `<program>` are checked at the boundary.

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

scrml's compiler emits plain JS; if you need a separate bundler (Vite, esbuild) in the pipeline, wire it downstream of the compiler (`bun run boot:compile`). There is no first-class plugin/adapter interface today.

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

<!-- gate: spec-ahead [E-SCOPE-001] — the bootstrap parses import but does not bind imported names yet -->
```scrml
<program>
  import { parseDate } from './date-helper.js';

  type DateResult:struct = {
    year:  int,
    month: int,
    day:   int,
  }

  <result:DateResult=(parseDate("2026-04-22"))/>
  <p>${@result.year}</p>
</program>
```

The type is the contract at the boundary: from there on, what the host handed back is a `DateResult`. Tapes work the same way. A tape that arrives from host JS carries no grants until you give it a tape type (`Item[free, append]`), and a scrml tape you hand to host JS crosses as a frozen view or a copy, so host code can't write it behind its grants (SPEC §66.12.6).

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
- SPEC Appendix D — which JS host globals the language admits (S469: in / out / open)
- SPEC §41.22 — `scrml:format`
- SPEC §66.12 — tapes and their grants (host-JS crossings)
- SPEC §26 — Tailwind utility classes
- `stdlib/` — the standard-library modules, each importable as `scrml:<name>`; the current list and count are in [`docs/FACTS.md`](FACTS.md)
- `examples/` — working sample apps
