# s459-ship-strip — progress

Base: `origin/main` @ `6fcde7f7e`, branch `s459-ship-strip`.

## Log

- BRIEF archived (`07761a1ad`).
- `compiler/src/codegen/ship-strip.ts` (`d3e70dd81`): acorn token reprint (exact token slices;
  gap -> `\n` if it held a line terminator, else one space only where two tokens would fuse,
  else nothing; toolchain comments kept). Verified by re-parse in every goal the input parses
  in: token type + exact text + line-break-before must match, else comment-only fallback
  (verified the same way), else unchanged input + reason.
- Prototype over the S459 measurement outputs (s1..s5): every file verified `full`.
  Runtime gz9: s1 16324->5092, s2 26206->7434, s3 47658->13438, s4 73415->18130, s5 20742->6372.
  (esbuild minifyWhitespace measured 7220 on s2; the ~3% gap is the kept line structure.)

## Design decisions (so far)

- Acorn reprint, NOT Bun.Transpiler: a transpiler is a second printer whose output we would
  only be able to check after the fact; the reprint copies token text verbatim, so the
  verification is the whole proof. Line structure kept: one statement per line in the shipped
  file, and every ASI / restricted-production decision is unchanged by construction.
- Strip points = the final-bytes point of each artifact class, BEFORE its content hash:
  runtime (index.ts after assembly + esm transform, before FNV), per-route chunks
  (route-splitter finalizeChunkHash), chunk boot script (before its FNV), client.js + worker
  bundles (api.js, after the relative/stdlib rewrites, before the #82 hash + the emit gate).

## Next

- Wire flag `stripShippedJs` (compileScrml -> runCG -> splitter); CLI build default on +
  `--keep-comments`; compile `--minify`; dev off.
