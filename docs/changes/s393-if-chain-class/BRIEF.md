# BRIEF — S393 if-chain descent class closure (verbatim dispatch prompt)

- **Dispatched:** 2026-09-01, S393-bryan
- **Agent:** `scrml-js-codegen-engineer`, model `opus`, `isolation: "worktree"`
- **Base:** `origin/main` @ `8a677477`
- **Governing-sentence gate (base Rule 4) — DISCHARGED before dispatch.** `compiler/SPEC.md:2071`
  (§6.1.1) + the §6.1.2 Read bullet: *"**Read:** `@varname` evaluates to the cell's current value.
  A structural `<varname>` declaration (§6.1.1) — or an equivalently-resolved cell … — SHALL be in
  scope; otherwise the read is `E-STATE-UNDECLARED`."* The declaration IS in scope (the lone-`if=`
  variant compiles clean), so SPEC makes the program legal and the implementation wrongly rejects
  it. Base §8 toward-the-contract limb: conformance restoration, quote-and-ship — NOT a ruling.
- **Direction:** site 1 is newly-ACCEPTING **toward the contract**; sites 2-4 are diagnostic
  completeness. A measured migration is required per site and is part of the brief.

---

(The full verbatim prompt as dispatched follows; it is reproduced in the session transcript and in
`handOffs/delta-log.md` [2011]. Sites, reproducers, the traced root, the two corpus-differential
traps, and the stop-condition are all stated in it.)

**Sites:**
1. **HIGH / conformance restoration** — `compiler/src/symbol-table.ts` PASS-1 `walk` (container list
   ~:1658-1676) has ZERO `if-chain` awareness; it knows `consequent`/`alternate` (the UN-collapsed
   `if-stmt` shape) but not `branches[].element` / `elseBranch`. A state decl inside an if-chain
   branch is never registered → false `E-STATE-UNDECLARED`. One-variable reproducer: adding a
   `<div else>` sibling flips exit 0 → exit 1. Also check `symbol-table.ts:10642`, reported to carry
   its own hand-rolled descent.
2. `compiler/src/lint-w-each-promotable.js` `walkForStmts` — `W-EACH-PROMOTABLE` 1/1/0.
3. `compiler/src/lint-w-map-iteration-order.js:48` `walkEachBlocks` — `W-MAP-ITERATION-ORDER` 1/1/0.
4. `compiler/src/commands/promote.js:828` `findIterationSites` — **adopter-facing**: `scrml promote`
   returns `{"status":"no-sites"}` on source that plainly carries a promotable `${for…lift}`.
5-6. `promote.js:1572` and `lint-w-map-iteration-order.js:78` — INSPECTION-ONLY, must be
   demonstrated broken before being fixed.

**Substrate:** `compiler/src/ast-if-chain.js` (`ifChainChildNodes`), landed by #805. Do not write a
new descent — a seventh hand-rolled copy is the bug generator.

**Owed:** a bite-proven regression test per fixed site; a MEASURED migration per site (assumed-zero
is not measured-zero); emit-inertness proven with a positive-controlled differential, extracting both
trees to the IDENTICAL filesystem path (the chunk namespace id is path-hashed) and running from the
repo root (a stdlib carve-out is repo-root-relative); STOP-and-report if closing site 1 turns any
conformance case RED, since a case may be pinning the false error and flipping it is a ruling.
