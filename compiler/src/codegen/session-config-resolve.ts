/**
 * §20.5 / §20.5.1 — THE ONE RESOLUTION for a unit's session configuration, and the
 * record of which units could not be attributed to a `<program>`.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────
 * `session-secure` (the cookie NAME: `__Host-scrml_sid` vs plain `scrml_sid`) and
 * `sessionExpiry` (the cookie Max-Age + durable-store TTL) are resolved per emitted
 * unit in a THREE-STEP order, and `E-MW-008` must refuse exactly the builds where
 * that order runs out of per-unit answers and would have to guess a unit's owner.
 *
 * S436 rounds 1-3 each answered "can this unit resolve for itself?" by RE-DERIVING
 * the order in the driver — count program-bearing files, then count `<program>`
 * nodes recursively, then add a resolves-for-itself limb. Each round got closer and
 * each was wrong somewhere new, because each was a MIRROR of a dispatch the emitter
 * already performs. The measured failures of the last one:
 *   - F-A: the driver ranged its "some unit cannot resolve for itself" test over
 *     EVERY file, but only a `<program>`-bearing file can carry the remedy the
 *     message advertises, so adding ANY plain page / library / component to a set of
 *     otherwise-correctly-declaring programs re-triggered the error and the
 *     advertised escape became unreachable (17 of 1137 corpus sets).
 *   - F-B: an `auth="required"` program gets `sessionExpiry`/`sessionSecure`
 *     defaults registered by route-inference, so `authMiddlewareEntry` answers for
 *     it and it NEVER reaches the stash — yet the driver's mirror called it
 *     unattributable and refused a build that could not have bled.
 * #1066's review already named the general lesson: *mirroring a predicate is not
 * mirroring a dispatch, and getting it wrong INVERTS the defect.*
 *
 * So the order lives HERE, once. `emit-server` resolves through it, and the same
 * call RECORDS a fall-through. The driver does not re-derive anything: it reads the
 * recorded facts. There is no second implementation to drift.
 *
 * ── THE ORDER (unchanged; moved, not rewritten) ─────────────────────────────────
 *   1. `authMiddlewareEntry` — THIS unit's route-inference output. For a
 *      `<program auth="required">` (Step 8a) route-inference fills in the §20.5
 *      defaults when the program declares none — they ARE that program's own
 *      answer — which is why such a unit is always attributable. An entry from
 *      Step 8b (protect= auto-escalation, `<page auth="required">`) carries a
 *      session field ONLY when the unit itself declares it; otherwise the field is
 *      undefined and this step MISSES, so the unit's own `<program>` (step 2) or
 *      the program stash (step 3) answers. S438: 8b used to stamp `"1h"` / secure
 *      too, which outranked the unit's own program's declaration and hid a
 *      contested unit from `E-MW-008`
 *      (g-route-inference-8b-session-defaults-outrank-program-declaration).
 *   2. the unit's OWN raw read — a recursive walk of this unit's nodes accepting
 *      `<program>` (last match wins) or `<page>` (first match wins), program
 *      outranking page.
 *   3. the build-wide stash the driver pre-scanned — reached ONLY when 1 and 2 both
 *      miss. A unit that gets here is UNATTRIBUTABLE: nothing in the unit or its
 *      route-inference output says which `<program>` governs it.
 *
 * ⚑ THE TWO ATTRIBUTES HAVE DIFFERENT PRESENCE RULES AT STEP 1, and the asymmetry is
 * preserved verbatim because it is load-bearing: `session-secure` tests
 * `!== undefined` (so a registered `false` COUNTS as an answer and must not fall
 * through), while `sessionExpiry` uses `??` (so `null`/`undefined` falls through).
 * Collapsing them would silently change which units are attributable.
 */

export type SessionAttrName = "sessionExpiry" | "session-secure";

/** Where a unit's answer came from. `stash` means UNATTRIBUTABLE (step 3). */
export type SessionAttrSource = "middleware" | "unit" | "stash";

export interface SessionAttrResolution {
  value: unknown;
  source: SessionAttrSource;
}

export interface AuthMiddlewareSessionFields {
  sessionExpiry?: unknown;
  sessionSecure?: unknown;
}

/**
 * Step 2 — the unit's OWN raw read. Moved verbatim from `emit-server`'s
 * `_readRawProgramAttr`; `<program>` outranks `<page>`, recursive, string-literal
 * values only.
 */
export function readRawUnitSessionAttr(nodes: unknown, attrName: SessionAttrName): string | undefined {
  let progVal: string | undefined;
  let pageVal: string | undefined;
  const visit = (ns: any[]): void => {
    if (!Array.isArray(ns)) return;
    for (const n of ns) {
      if (!n || n.kind !== "markup") continue;
      if (n.tag === "program" || n.tag === "page") {
        const a = ((n.attrs ?? []) as any[]).find((x: any) => x && x.name === attrName);
        if (a && a.value && a.value.kind === "string-literal") {
          if (n.tag === "program") progVal = a.value.value;
          else if (pageVal === undefined) pageVal = a.value.value;
        }
      }
      if (Array.isArray(n.children)) visit(n.children);
    }
  };
  visit(nodes as any[]);
  return progVal ?? pageVal; // program-level wins over page-level
}

/** Steps 1 + 2 only — the per-unit answer, before any build-wide fallback. */
function resolveWithoutStash(
  attr: SessionAttrName,
  authMiddlewareEntry: AuthMiddlewareSessionFields | null | undefined,
  nodes: unknown,
): SessionAttrResolution | null {
  if (attr === "session-secure") {
    // `!== undefined`, NOT `??` — a registered `false` is an answer.
    if (authMiddlewareEntry && authMiddlewareEntry.sessionSecure !== undefined) {
      return { value: authMiddlewareEntry.sessionSecure, source: "middleware" };
    }
  } else {
    const v = authMiddlewareEntry?.sessionExpiry;
    if (v !== undefined && v !== null) return { value: v, source: "middleware" };
  }
  const own = readRawUnitSessionAttr(nodes, attr);
  if (own !== undefined) return { value: own, source: "unit" };
  return null;
}

/**
 * TRUE iff this unit answers `attr` out of its own route-inference entry or its own
 * nodes — i.e. it is ATTRIBUTABLE and never consults the build-wide stash. This is
 * the predicate `E-MW-008` needs, and it is the SAME two steps `resolveUnitSessionAttr`
 * runs, not a copy of them.
 */
export function unitResolvesSessionAttrItself(
  attr: SessionAttrName,
  authMiddlewareEntry: AuthMiddlewareSessionFields | null | undefined,
  nodes: unknown,
): boolean {
  return resolveWithoutStash(attr, authMiddlewareEntry, nodes) !== null;
}

/**
 * The full three-step resolution the emitter performs. `source === "stash"` means the
 * unit was unattributable and the build-wide value (or the language default, when the
 * stash is empty) governs it.
 */
export function resolveUnitSessionAttr(
  attr: SessionAttrName,
  authMiddlewareEntry: AuthMiddlewareSessionFields | null | undefined,
  nodes: unknown,
  programStashValue: unknown,
): SessionAttrResolution {
  const own = resolveWithoutStash(attr, authMiddlewareEntry, nodes);
  if (own) return own;
  return { value: programStashValue, source: "stash" };
}

// ---------------------------------------------------------------------------
// The unattributable-unit sink.
//
// Recorded by `emit-server` at the moment a resolution ACTUALLY falls through to
// step 3 while emitting session infrastructure, and drained by the driver after the
// emission loop. Gating on real emission is the half the driver cannot compute:
// `_needsSessionInfra` depends on route-inference output, server-load gates,
// `@currentUser` queries, session builtins and channel auth, all derived deep inside
// `emit-server`. Recording from there is what makes "a second program that emits no
// session infrastructure" correctly NOT a conflict (review finding F-B) without
// mirroring that predicate anywhere.
//
// Same reset/drain idiom as `resetSessionValueUseErrors` / `drainSessionValueUseErrors`
// in emit-expr.ts.
// ---------------------------------------------------------------------------

export interface UnattributableUnit {
  filePath: string;
  attr: SessionAttrName;
}

let _unattributable: UnattributableUnit[] = [];

export function resetUnattributableSessionUnits(): void {
  _unattributable = [];
}

export function recordUnattributableSessionUnit(filePath: string, attr: SessionAttrName): void {
  if (_unattributable.some((u) => u.filePath === filePath && u.attr === attr)) return;
  _unattributable.push({ filePath, attr });
}

export function drainUnattributableSessionUnits(): UnattributableUnit[] {
  const out = _unattributable;
  _unattributable = [];
  return out;
}
