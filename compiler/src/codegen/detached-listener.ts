/**
 * S462 fix round 6 (F6-2) — a listener attached directly to an element runs only while
 * that element is in the document.
 *
 * SPEC §42.3.5 (ruling:user-voice-scrml.md S462 "a", Q18) lets an event handler inside an
 * `if=` gate keep the gate's narrowing because "render-gating removes the subtree and its
 * listener synchronously on the write that ends the condition". Delegated events (click,
 * submit — emit-event-wiring.ts `DELEGABLE_EVENTS`) satisfy that by construction: a
 * detached node's propagation path never reaches `document`. A DIRECT listener does not:
 * an event dispatched inside a removed subtree (its propagation path is fixed at dispatch)
 * still reaches every ancestor inside that subtree. So every direct user-handler
 * registration is wrapped here: when the element the listener sits on
 * (`event.currentTarget`) is no longer connected, the handler does not run.
 *
 * This makes the guarantee true for every event that can be dispatched AFTER the removal.
 * It cannot cover an event the browser fires DURING the removal while the node is still
 * connected — Chromium fires `blur` / `focusout` on a focused element synchronously inside
 * `remove()`, with `isConnected === true` (verified with Playwright's Chromium, S462 round
 * 6) — which is why §42.3.5 does not exempt the focus family.
 *
 * `this` and the return value (a promise, for an async handler) pass through unchanged.
 */
export function guardDetachedListener(handlerText: string): string {
  // A handler the compiler wrote as a function literal of the event takes the check as its
  // first statement; anything else (a named handler, a factory's result) is wrapped.
  const lit = /^(\s*(?:async\s+)?function\s*\(\s*_scrml_event\s*\)\s*\{)/.exec(handlerText);
  if (lit) return `${lit[1]} ${DETACHED_CHECK}${handlerText.slice(lit[1].length)}`;
  return `function(_scrml_event) { ${DETACHED_CHECK} return (${handlerText}).call(this, _scrml_event); }`;
}

/** The first statement of a guarded listener. */
export const DETACHED_CHECK = "if (_scrml_event?.currentTarget?.isConnected === false) return;";
