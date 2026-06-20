// ===========================================================================
// Engine state-child grammar — shared single source of truth (SSOT)
// ===========================================================================
//
// ss2 item 3 (2026-06-19) — these two literal sets were duplicated across the
// type-system (`compiler/src/type-system.ts`) and codegen
// (`compiler/src/codegen/emit-variant-guard.ts`) because `type-system.ts` is
// UPSTREAM of codegen and therefore cannot import from `./codegen/*` (see the
// long-standing comment block this header replaces, formerly at
// type-system.ts:82-99, S81 Phase A10 follow-on).
//
// This module is deliberately placed at `compiler/src/` (NOT under `./codegen/`)
// so BOTH layers can import it: the type-system imports `./engine-statechild-
// grammar.ts`, codegen imports `../engine-statechild-grammar.ts`. That placement
// is the entire point — it lets us retire the duplication without introducing
// an upstream→downstream import cycle.
//
// Both sets describe the SPEC §51.0 engine state-child grammar:
//   - the reserved attribute names that the engine surface owns (rule /
//     history / internal:rule / effect) vs. payload-binding barewords, and
//   - the structural-element tags that may appear inside a state-child body
//     but are NOT renderable markup.
//
// ZERO behavior change: these sets are member-identical to the literals they
// replace. Any future edit to membership MUST update the regression guard at
// `compiler/tests/unit/engine-statechild-grammar.test.js`.
//
// RESIDUAL (noted, NOT migrated by ss2 item 3 — tightly-scoped LOW experiment):
// three further member-identical copies of the RESERVED set remain at:
//   - compiler/src/engine-statechild-parser.ts          (RESERVED_STATE_CHILD_ATTRS)
//   - compiler/src/native-walker/engine-statechild-walker.ts (RESERVED_PAYLOAD_ATTRS)
//   - compiler/src/symbol-table.ts                      (inline RESERVED_STATE_CHILD_ATTRS)
// All three sit at `compiler/src/` (NOT under `./codegen/`) and so CAN import
// this module; folding them in is a clean follow-on dedup once ss2 item 3 lands.

// ---------------------------------------------------------------------------
// §51.0.B / §51.0.B.1 — reserved engine state-child attribute names.
// ---------------------------------------------------------------------------
//
// Per §51.0.B.1 reserved-name precedence, these attribute names take precedence
// over payload-binding interpretation in the bare-attribute form:
//
//   "The reserved state-child attribute names — `rule`, `effect`, `history`,
//    `internal:rule` — take precedence over payload-binding interpretation in
//    the bare-attribute form."  (SPEC §51.0.B.1)
//
//   - `rule`          — §51.0.B   declarative transition target
//   - `history`       — §51.0     history-marker attr
//   - `internal:rule` — §51.0     internal (non-rendering) transition rule
//   - `effect`        — §51.0     side-effect binding
//
// Used by the payload-binding extractor to identify which bareword attrs ARE
// payload bindings (everything bareword that is NOT in this set).
export const ENGINE_STATE_CHILD_RESERVED_ATTRS: ReadonlySet<string> = new Set<string>([
  "rule",
  "history",
  "internal:rule",
  "effect",
]);

// ---------------------------------------------------------------------------
// §51.0 — structural-element tags inside an engine state-child body.
// ---------------------------------------------------------------------------
//
// These tags appear inside a state-child body but are NOT renderable markup
// (per PHASE-0-SURVEY §8 R2): they are engine-grammar-specific structural
// elements that must be filtered before markup resolution (type-system) and
// before HTML emission (codegen).
//
//   - `onTimeout`     — §51.0.M  timer-driven transition element
//   - `onTransition`  — §51.0     transition-effect element
//   - `onIdle`        — §51.0     idle-timeout element
//   - `engine`        — §51.0     nested engine sibling
//   - `machine`       — §51.0     nested machine sibling
export const STATE_CHILD_STRUCTURAL_TAGS: ReadonlySet<string> = new Set<string>([
  "onTimeout",
  "onTransition",
  "onIdle",
  "engine",
  "machine",
]);
