# BRIEF — s430-import-host (ruling P4.1: build `import:host` as specified)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## State (PA-verified S430 on 15e60e4b)
`import:host { tokenize } from "./tok.js"` compiles at exit 0, zero diagnostics, and the declaration appears VERBATIM as
text in the emitted `<body>`. Zero references to `import:host` / `E-IMPORT-008` in `compiler/src`. Gap:
`g-import-host-is-unimplemented-and-renders-as-page-text`.

## Governing text — implement it AS WRITTEN
SPEC §21.3.1 (read IN FULL), §22.13 (the `[capabilities] host-import` manifest entry, read IN FULL), §34 `E-IMPORT-008` /
`E-IMPORT-009`, §41.17 (the `scrml:compiler` thunk family under `stdlib/compiler/`). Key SHALLs: file-top only (inside `${}`
→ E-IMPORT-003); manifest read before parse, absent manifest ⇒ `"disabled"` ⇒ every use fires E-IMPORT-008;
`"self-host-only"` permits only the canonical `stdlib/compiler/**` pattern; host-tag other than `host` → E-IMPORT-009; named
bindings (with optional `as`) enter the file's logic scope exactly like a plain `import`; the host module is NOT evaluated
during parse; cycles → E-IMPORT-002. **Do not extend the allow-list or invent manifest keys** — if the spec is ambiguous,
record it and pick the narrowest reading.

## Do
1. Parse in both front-ends (default `ast-builder.js`/block-splitter + native parser), manifest gate (find or build the
   `scrml.toml` reader; report which), scope binding, codegen as a STATIC ES import in the emitted module (no dynamic import,
   no Promise), E-IMPORT-002/003/008/009.
2. Tests incl. the negative ones, and one end-to-end: a file under a `stdlib/compiler/` fixture with a `self-host-only`
   manifest imports a named export from a `.js` module, calls it, and the emitted module runs under `bun`.
3. Corpus: compile the tracked corpus on base vs build — expected impact zero (nothing uses it); report.
4. Add conformance cases under `conformance/cases/` for the diagnostic codes (codes-half) per the suite's README.
