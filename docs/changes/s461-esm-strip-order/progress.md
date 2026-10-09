# progress — s461-esm-strip-order

- 2026-10-09T17:43:58Z WIP(s461-esm-strip-order): start at /home/user/scrml/.claude/worktrees/agent-aa777eab0a49c68c2 (base origin/main 5a895f3)

## Governing sentence (SPEC.md §47.9.9 "One reader", re-read in full at :32550-32568)
> "The strip is the last transform of each artifact's bytes and runs BEFORE everything that reads or names them: the §2.2.1 emit gate judges the stripped bytes, and every content hash — the runtime's filename hash, the per-route chunk hash (§47.5, §40.9.8), the chunk-activation script's hash, and the §47.9.8 page-bundle hash — is computed over the stripped bytes, so a content address always names the bytes that ship."

- 2026-10-09T17:46Z Phase 1 (trace). Locus HELD: `codegen/index.ts` runCG calls `emitPerRouteChunks` (route-splitter.ts) whose `finalizeChunkHash` strips (shipPayload) then hashes each chunk; AFTER it returns, the esm loop at index.ts ~:4242-4255 rewrites `chunk.payloadJs = toEsmClientChunk(...)` (emit-client-esm.ts:297) — adding a `// --- runtime + cross-file imports (esm-chunks) ---` comment + an unstripped `import { … } from "…";` header — with no re-strip and no re-hash. Refinement: the fix lives in route-splitter `finalizeChunkHash` (an ESM hook applied BEFORE the strip), not at index.ts.
- 2026-10-09T17:46Z Phase 1 baseline symptom (origin/main, examples/23-trucking-dispatch, compile --emit-per-route --minify --module-format=esm, in-process): 63 chunks, 21 written, 21 carry a strippable comment, 21 filename hashes != computeChunkHash(shipped bytes). Classic same app: 0 / 0.
