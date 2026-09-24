# compiler/tests/self-host — retired (s430-stage-swap)

The four per-module "self-host parity" test files that lived here were retired by
`s430-stage-swap` (bryan S430 ruling P5). They are not coming back in this shape.

| file | what it did | why it is gone |
|---|---|---|
| `ast.test.js` | text-substituted `fn`→`function` in `compiler/self-host/ast.scrml`, wrapped the result in a Blob and `import()`ed scrml source **as JavaScript** | never invoked the compiler; `describe.skip`-ed; not in the gate (known-gaps `g-self-host-parity-harness-evaluates-scrml-source-as-javascript`) |
| `bs.test.js` | compiled `compiler/self-host/bs.scrml` in library mode, compared exported functions against `block-splitter.js` | `bs.scrml` does not compile, so every case was permanently skipped |
| `tab.test.js` | compiled `compiler/self-host/tab.scrml`, compared tokenizer functions against `tokenizer.js` | per-function parity of a module that is not a pipeline stage; red (4 fail + 1 error at the change base) and outside every gate |
| `bpp.test.js` | tested the **JS** `parser-workarounds.js` helpers only | not a self-host test at all — moved to `compiler/tests/unit/parser-workarounds.test.js` (now gated) |

## What replaced them

P5: a bootstrap module is DONE when a **hybrid compiler** — the TS pipeline with that one stage
swapped for the bootstrap build — passes the **full conformance suite**. The corpus differential
against pure TS is triage, not a gate.

```sh
bun scripts/hybrid.ts --list                                     # every substitutable stage + its entry export
bun scripts/hybrid.ts --swap TAB=<module> --conformance          # THE GATE
bun scripts/hybrid.ts --swap TAB=<module> --differential         # triage: N of M identical + first diff hunks
```

`<module>` may be a `.js`/`.ts` path or a `.scrml` path (compiled by the TS compiler in library
mode first) — the runner does not care where the bootstrap lives. The seam and its stage-contract
validation are `compiler/src/pipeline-seam.ts`; the gated tests are
`compiler/tests/integration/hybrid-stage-swap.test.js`.
