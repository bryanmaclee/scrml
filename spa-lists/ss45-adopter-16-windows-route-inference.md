# ss45 — Windows route-inference path-separator (the adopter #16) — VERIFY-FIRST · MED · trivial

**Currency:** scoped S224 (PA) @ HEAD `9ad78593` / 2026-06-27. **FIREABLE.** Source = **GitHub issue #16** (an adopter, v0.7.0, **Windows**). **MED** (Windows-only, but a TOTAL multi-page breakage there — every page collides at `/`). **Near-trivial fix** — the adopter gave the exact root cause + lines + a deterministic OS-independent repro + the fix.

**Authority (READ FIRST, Rule 4):** `gh issue view 16 --json title,body` (root cause + the node repro) + `compiler/src/route-inference.ts`. The bug: `route-inference.ts` detects page files by searching for the literal substrings `"/routes/"` / `"/pages/"` (forward slashes) in the absolute path, and later splits relative paths on `"/"`. On Windows paths use `\` (`...\pages\login.scrml`) → the match returns `null` → every page falls through to the "single-page app, mount at `/`" fallback → no page gets a route, all collide at `/`. Surfaces first as `I-AUTH-REDIRECT-UNRESOLVED` + `W-AUTH-LOGIN-MISSING` (the `loginRedirect` `/login` no longer resolves), but the breakage is general. The SAME source on Linux/macOS does NOT warn — the only variable is the path separator.

**Fix direction (the adopter-provided, confirm in survey):** normalize `\` → `/` before the prefix match AND before every `.split("/")`. Loci (the adopter's lines): `ROUTE_PREFIXES` match `~4164`/`findRoutePrefix` `~4177`; `relativePath.split("/")` `~4240`; `filePathToUrlPattern` `withoutExt.split("/")` `~4278`. Normalize at the boundary (e.g. `filePath.replace(/\\/g, "/")` on ingest) so all downstream matching/splitting is separator-agnostic. Confirm there is no other `"/"`-literal path op in the module the survey misses.

**Parallel-safety:** `route-inference.ts` ONLY — fully disjoint from ss44 (codegen auth), ss46 (type-system), ss47 (codegen). Parallel-safe with all.

**coreFiles:** `compiler/src/route-inference.ts` (the prefix-match + the 2-3 `.split("/")` sites). Survey confirms no other separator-literal path handling elsewhere in the route pipeline.

**Brief reminders:** **VERIFY-FIRST (S138 reverse)** — the adopter's deterministic node repro (`findRoutePrefix("C:\\...\\pages\\login.scrml")` → null) reproduces OS-independently; confirm it + that the fix (`.replace(/\\/g,"/")`) makes it resolve. Cannot run a real Windows env here → use the deterministic node repro + a unit test that feeds backslash paths. R26 + a unit test asserting backslash-path route inference matches the forward-slash result. **ADVERSARIAL (S215)** — mixed separators, UNC paths, a `pages\` nested route (`pages\users\[id].scrml`), `routes\` too, drive letters. FULL `bun run test` before DONE (the Linux suite is unaffected — the fix is separator-normalization; assert zero Linux regression).

## Items
1. **Verify + normalize path separators** `[status=open]` VERIFY-FIRST — confirm the deterministic repro; normalize `\`→`/` at the route-inference ingest boundary so the prefix-match + all `.split("/")` sites are separator-agnostic. Cover `routes\` + `pages\` + nested + drive-letter paths.
2. **Tests** `[status=open]` — unit test with backslash paths asserting identical route inference to forward-slash; the two auth lints (`I-AUTH-REDIRECT-UNRESOLVED` / `W-AUTH-LOGIN-MISSING`) no longer false-fire on backslash paths.

## Acceptance
A multi-page app with `pages\login.scrml` / `pages\batches.scrml` / `pages\users\[id].scrml` infers `/login` / `/batches` / `/users/:id` on backslash paths (matching the forward-slash result); the auth-redirect lints resolve; zero Linux/macOS regression; full suite green.
