# Using external JavaScript libraries in scrml

Before you reach for an external JS library, check whether scrml already handles the problem. Adopters coming from the TypeScript/React/Vue ecosystem tend to reach for packages reflexively — the muscle memory is `npm install lodash` before checking if the language already has what lodash provides. This doc is the translation table and the escape hatches, in that order.

**The most important thing to know up front:** scrml's type system, shape system, reactive runtime, and stdlib cover a surprising amount of what adopters typically pull from npm. A large fraction of "I need X" objections resolve at the first section below without touching any escape hatch.

---

## 1. The translation table — does scrml already cover this?

### "I need zod for runtime schema validation"

You don't. scrml's type system runs at compile time AND enforces at runtime. The combination of `<struct>`, `<shape>`, enums (`type Color:enum = { Red, Green, Blue }`), and inline type predicates (`number(>0 && <10000)`, `string(email)`, §53) covers the entire zod surface, with compile-time errors instead of runtime exceptions.

```scrml
${
    type Email = string(email)
    type Age = number(>= 0 && <= 150)

    struct User {
        name: string
        email: Email        // validated at every construction site
        age: Age
    }
}
```

`scrml:data` exports validation primitives (`required`, `email`, `minLength`, `pattern`, `validate`, etc.) for when you want runtime-validated records without a full struct shape.

### "I need lodash"

`scrml:data` covers most of it. Available today: `pick`, `omit`, `mapKeys`, `mapValues`, `groupBy`, `indexBy`, `sortBy`, `unique`, `flatten`, `flattenDeep`, `chunk`, `clamp`, `paginate`, `deepMerge`, `toSnakeCase`, `toCamelCase`, `camelizeKeys`, `snakifyKeys`.

```scrml
${ import { groupBy, sortBy, pick } from 'scrml:data' }
```

For the ~10% of lodash that isn't in stdlib, write it inline (lodash functions are typically 5–15 lines) or use `^{}` meta to shell out to Bun.

### "I need date-fns / dayjs / moment"

`scrml:time`. `formatDate`, `formatTime`, `formatDateTime`, `formatRelative`, `startOf`, `addTime`, `diffTime`, `debounce`, `throttle`, all pure, usable client-side and server-side.

```scrml
${ import { formatDate, formatRelative } from 'scrml:time' }
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

You don't. scrml's `@variable` reactive system is the state primitive. `const @derived = ...` replaces selectors. `<engine>` replaces state-machine libraries (XState). (`<machine>` was the old keyword; REMOVED at S307.)

### "I need tailwindcss"

scrml compiles `#{...}` blocks inline with the markup — class-less styling by default. If you want Tailwind specifically, it's a build-step concern, not a scrml concern; scrml does not ship a preprocessor for it today.

### "I need an ORM (Prisma, Drizzle, TypeORM)"

You don't. scrml's `?{ SELECT ... FROM users }` is compile-time-typed SQL with schema introspection from `<db src="…">`. Type-safe queries without a query builder.

### "I need a test runner (jest, vitest)"

`scrml:test` (early). For the compiler itself, scrmlTS uses `bun test` directly — works on any `.test.js` file. Auto-property tests emit from `<engine>` declarations (§51.13) — ported off the removed `<machine>` keyword at S307.

### "I need JSON Schema / OpenAPI"

Shapes (§14, §16) + inline type predicates are the source of truth. Generate OpenAPI downstream from shapes if you need the ecosystem interop; don't author OpenAPI by hand.

### "I need graphql / trpc"

You don't. Server functions are typed RPCs. The compiler-inferred call graph IS the schema — no separate client/server contract.

---

## 2. JS built-ins you can use directly

Appendix D of SPEC.md lists globals available inside `${ }` logic with no import and no `^{}` ceremony: `Array`, `Object`, `Boolean`, `Date`, `JSON`, `Math`, `console`, `Intl`, `Reflect`, `Proxy`, `parseInt`, `parseFloat`, `Number.isFinite`, `isNaN`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `structuredClone`, `encodeURIComponent`, `decodeURIComponent`, `btoa`, `atob`. Provided by the Bun runtime, part of ECMAScript.

```scrml
${
    const today = new Date()
    const formatted = today.toISOString().split("T")[0]
    const random = Math.floor(Math.random() * 100)
}
```

---

## 3. Local `.js` helper files

If you have a small JS file in your project, import it with a relative path inside `${ }`. This has been ratified in SPEC §21 since the first import-system design.

```scrml
${
    import { helper } from './helper.js'
    import { computeThing } from './utils/math.js'
}
```

Use this for small, project-local utilities. No ceremony, no tooling, no manifest.

---

## 4. `^{}` meta escape hatch — the designed answer

When you genuinely need a runtime capability that scrml doesn't expose directly, `^{}` is the escape hatch. The rule is memoryable: **scrml is always at least as powerful as raw Bun/JS.** Anything Bun can do, `^{}` can do.

The `^{}` block runs at compile time; it can inline computed values into your source, run code generation, or emit JS that will execute at runtime.

```scrml
${
    // Compile-time computation inlined into the module
    ^{ emit(`const BUILD_ID = "${Date.now()}"`) }

    @buildId: string = BUILD_ID
}
```

Runtime capability escape (using `bun.eval` through `^{}`) is the path for "use an npm package I absolutely must have" — a partially-implemented feature as of 2026-04. This is the path that deprecates the "add npm support to scrml" ask.

**When `^{}` is the right tool:** one-off runtime capability, codegen, compile-time constants, environment-dependent values, external capability that doesn't map to the stdlib.

**When `^{}` is the wrong tool:** every function call in the codebase. If you find yourself writing 50 `^{}` blocks, the real ask is "add this to stdlib" — open an issue.

---

## 5. `vendor/` pattern — for whole libraries you've reviewed

For third-party source you want to ship with your project, copy it into `vendor/<name>/` and import via the `vendor:` prefix:

```scrml
${ import { specialThing } from 'vendor:some-library' }
```

The import resolver (§41) treats `vendor:` as a first-class prefix, resolved to `vendor/<name>/` in project root. No registry, no lockfile, no auto-fetch. You read the source, you commit it, you know what you're shipping. This is the Odin-model escape hatch.

For the library to be importable, its source must either be `.scrml` or `.js`/`.mjs` that scrml's module resolver can read. ESM syntax only.

**Future tooling:** `scrml vendor add <url>` (planned, not yet shipped) will automate the fetch + hash-verify + write. Today it's a manual copy.

---

## 6. Sidecars — `use foreign:` for server-only external code

If your external code is not JavaScript at all — Go, Rust, Python, etc. — the pattern is a sidecar: nest a `<program lang="...">` block with the foreign source, and import its exported functions with `use foreign:`:

```scrml
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

Server-side only (E-FOREIGN-012). The compiler generates HTTP/socket client code; types are declared in scrml and checked at the boundary.

---

## 7. What scrml does NOT support (and why)

### npm registry — by design

Bare specifiers (`import X from "lodash"`) are a compile error (E-IMPORT-005). scrml has no npm integration, no lockfile, no auto-fetch. This is a philosophical commitment documented in spec §41.4 and §41.6: the toolchain SHALL NOT download anything automatically. The approved path for any npm package's functionality is `^{}` + `bun.eval` (scrml ≥ Bun capability guarantee) or source-copy into `vendor/`.

If you're looking for "how do I use lodash in scrml" — section 1 above probably already answered it.

### CDN imports — not yet specced

No `cdn:` or `https:` prefix today. If you need to load an external browser module at runtime (e.g., CodeMirror, Monaco, D3), today's pattern is a script-injection bridge inside `^{}` at compile time. An explicit answer is an open design question tied to Phase 0/1 in the npm-bridge insight.

### Bundler integration — deferred

scrml's compiler emits plain JS; if you need a separate bundler (Vite, esbuild) in the pipeline, wire it downstream of `scrml compile`. There is no first-class plugin/adapter interface today.

---

## 8. FAQ

### "Why not just add npm support?"

The short answer: every language that shipped a "temporary" npm bridge kept it. The `^{}` escape hatch and `vendor/` pattern are the designed answers — they preserve the philosophy that dependencies are a liability, not a feature. If you find an actual gap, the productive ask is "add this to stdlib" or "close the `^{}` runtime-capability gap," not "add a package manager."

### "The stdlib is missing X. What do I do?"

Three options, in order: (1) open an issue describing the gap; (2) write it inline in your project (most missing-stdlib cases are 10–30 lines); (3) if it's genuinely external and significant, vendor the source after reviewing it.

### "Can I mix scrml with React / Vue / Svelte?"

Not directly; scrml compiles to standalone HTML/JS/CSS, not to framework-embeddable components. For incremental adoption, the unit of migration is the page — move one page at a time from your framework to a scrml file.

### "How do I type an external JS library?"

If you're calling through `^{}` or a local `.js` file, write a shape or struct that represents the surface you consume. The type constraint attaches at the import site:

```scrml
${
    import { parseDate } from './date-helper.js'

    shape DateResult {
        year: int
        month: int
        day: int
    }

    const result: DateResult = parseDate("2026-04-22")
}
```

### "I'm writing a CodeMirror / Monaco / D3 integration. What's the current-best-practice pattern?"

Today: the `^{}` + `<script type="module">` injection + `window.__mod` + `CustomEvent` bridge pattern (see 6nz's CM6 probe in `6NZ` repo's `playground-three`). The 9/9 smoke-test outcome confirms it works end-to-end, but it's known-clunky. Cleaner patterns are under design discussion.

### "Is there a path to CDN imports someday?"

Possibly. The question is tracked as Phase 1 in the npm-bridge insight. The prerequisite ("Phase 0") is finishing the `^{}` + `bun.eval` wiring, shipping this doc (the one you're reading), and shipping `scrml vendor add`. Phase 1 is only re-opened if adopter evidence continues to demand it after Phase 0 ships.

---

## Reference

- SPEC §21 — Module and Import System
- SPEC §23.4 — `use foreign:` sidecars
- SPEC §41 — Import System (`use` + `import` hybrid)
- SPEC §53 — Inline Type Predicates
- SPEC Appendix D — JS standard library access
- `stdlib/` — current module set (`scrml:auth`, `scrml:crypto`, `scrml:data`, `scrml:format`, `scrml:fs`, `scrml:http`, `scrml:path`, `scrml:process`, `scrml:router`, `scrml:store`, `scrml:test`, `scrml:time`)
- `examples/` — working sample apps
