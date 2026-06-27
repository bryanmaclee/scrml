# ss41 — auto-await error-arm dead-handler fix (fork g)

**Currency:** built S223 (PA) @ HEAD `a0559651` / 2026-06-26. **FIREABLE.** Single bounded codegen fix; the design is settled (no survey needed — the fix direction is in the gap).

**Authority (READ FIRST, Rule 4):** `docs/known-gaps.md` → `g-auto-await-error-arm-dead-promise-check` (MED — the full symptom + root + fix direction + fire site) + `docs/changes/g-auto-await-read-before-resolve-race/SURVEY.md` fork(g) section. **Do NOT bundle with `g-auto-await-read-before-resolve-race`** — that sibling turned out NOT-A-BUG (the `const <derived>` idiom is already race-free, PA-probe-verified S223); this is a DISTINCT error-routing fix.

**Parallel-safety:** touches `emit-client.ts` (the auto-await IIFE wrap — the SAME `post-server-fn-iife-wrap` region ss32 item-1 `a0559651` landed). ⚠️ **ss33 also touches emit-client** — at landing, intersect the file-set against any ss33 emit-client landing (S211). Build on current main (post-ss32) so item-1's `.catch` is present.

**coreFiles:** `compiler/src/codegen/emit-client.ts` (the auto-await IIFE wrap + the `!{}` arm-dispatch emission) · the reactive-server `!{}` error-arm codegen path · SPEC §19 (error-handling / `!{}` arm) + §12 (server-fn wire envelope `__scrml_error`).

## Item

1. **g-auto-await-error-arm-dead-promise-check** (MED) `[status=landed-on-branch SHA=619e9589 branch=spa/ss41 base=a0559651]`
   - **LANDED ss41** (`619e9589`): seam (A) wrap-stage relocation in `emit-client.ts` — moved the reactive-server `!{}` guard+arm INSIDE the auto-await IIFE (checks the RESOLVED envelope `r`, not the Promise). R26 before/after: handler was dead → now fires on a server-error envelope; happy-else sets cell; ss32 `.catch` retained for non-envelope rejections; no-error-arm form byte-identical. S215 adversarial (multi-arm/typed-vs-generic/CPS-vs-fetch/expr-position/payload-binding) all clean. Full `compiler/tests/` 25489/0; no allowlist rebaseline. ⚠ ss33 also touches emit-client (disjoint region) — PA intersect at re-integration (S211).
   - **Symptom:** `@cell = serverFn() !{ ::NetworkError :> … }` emits `let result = (async () => …)(); if (result.__scrml_error) { <!{} dispatch> }` — `result` is the IIFE **Promise**, so `result.__scrml_error` is always falsy → the user's `!{}` handler **never fires** (dead). ss32 item-1's `.catch` safety-nets the rejection (surfaces via `_scrml_error_boundary_log`) but does NOT restore the handler.
   - **Fix (structural):** move the `!{}` envelope dispatch INSIDE the IIFE, after the `await`, checking the RESOLVED envelope:
     ```js
     (async () => {
       const r = await stub(args);
       if (r.__scrml_error) { /* <!{} arm dispatch> */ }
       else { _scrml_reactive_set(name, r); }
     })().catch(e => _scrml_error_boundary_log(name, e));   // keep ss32's safety-net for non-envelope rejections
     ```
     Structural — earlier than the string-rewrite stage. Preserve the ss32 `.catch` (it still catches a genuine rejection that isn't an `__scrml_error` envelope). Preserve the S84 stmt-vs-expr `;)` handling.
   - **Adversarial (S215) + R26:** multiple error arms · `::NetworkError` vs generic `!{}` · the **no-error-arm** form (MUST stay byte-identical to ss32's current emit — don't regress the plain reactive-server assignment) · CPS-stub vs fetch-stub forms · the `!{}` arm body reading the error payload. R26 before/after on real compiled source: BEFORE → `!{}` handler dead (never fires); AFTER → handler fires on a server-error envelope. Full `bun run test`. No `.scrml` fixture expected → no allowlist rebaseline (confirm).
   - **Acceptance:** a server-error envelope routes into the user's `!{}` arm (handler fires, error payload available); a happy result still sets the cell; a genuine rejection (non-envelope) still surfaces via the `.catch`; the no-error-arm form unchanged.
