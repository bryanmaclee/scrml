import { isUserComponentMarkup } from "./component-expander.ts";

/**
 * The `<main>` LANDMARK TAG TEST — one rule, shared by both walkers.
 *
 * The one-landmark invariant (SPEC §20.8.1.1) is decided by two walks that must
 * never disagree about which elements are `<main>`:
 *
 *   - `symbol-table.ts` `collectOutlets` (SYM PASS 15.5) — fires the diagnostic;
 *   - `codegen/emit-html.ts` `treeHasAuthorMain` — picks the emitted slot tag.
 *
 * They previously answered the question with two open-coded `=== "main"` tests.
 * That is the drift this module exists to prevent: the predicate is subtle
 * enough (see the capitalization rule below) that two copies WILL diverge.
 *
 * ---------------------------------------------------------------------------
 * THE CAPITALIZATION RULE — why this is not just `toLowerCase() === "main"`
 * ---------------------------------------------------------------------------
 *
 * HTML element names are ASCII case-insensitive (`html-elements.js` normalizes
 * every registry lookup with `.toLowerCase()`), and the compiler passes an
 * unrecognized capitalized tag through to the output verbatim — so `<MAIN>`
 * really does reach the document and really does become a second landmark to a
 * browser. A `=== "main"` test cannot see it.
 *
 * But in scrml a CAPITALIZED tag is a COMPONENT reference, and `ast-builder.js`
 * classifies component-vs-element by capitalization ALONE — `<MAIN>` and a
 * user's `<Main/>` leave the parser flagged identically as component-ish. So a
 * bare `toLowerCase()` test would swallow a legal, working program:
 *
 *     const Main = <div class="cmp">c</>
 *     <outlet/>
 *     <Main/>
 *
 * — which compiles clean and emits exactly one landmark today. Lowercasing
 * without a guard fires `E-OUTLET-AND-MAIN` on it and, on the emit side,
 * demotes the slot to a `<div>` so the document renders ZERO landmarks.
 *
 * The discriminator is NAME RESOLUTION, not spelling. `isUserComponentMarkup`
 * reads NR's `resolvedKind`, which is authoritative and cross-file aware (an
 * imported component carries `category: "user-component"` on its export
 * record). NR runs at api.js:1585, BEFORE SYM at :1626, so `resolvedKind` is
 * populated by the time PASS 15.5 asks. The rule is therefore:
 *
 *   a capitalized spelling of `main` is the HTML landmark unless NR resolved
 *   that tag to a user component.
 *
 * A component named `Main` wins over the HTML element, exactly as scrml's
 * capitalized-tag convention says it should; its own `<main>`, if it has one,
 * arrives through component expansion and is content-owned per §20.8.1.1 (no
 * diagnostic).
 *
 * UPSTREAM NOTE: `<MAIN>` escaping `E-COMPONENT-035` (which `<Widget/>` does
 * fire) is the deeper inconsistency — an unrecognized capitalized tag is
 * neither normalized to the HTML element nor rejected. This module makes the
 * landmark walkers agree with the browser; it does not fix that classifier.
 */

/**
 * Is this AST node an author `<main>` landmark element?
 *
 * Non-markup nodes, and markup whose tag is not some spelling of `main`,
 * answer false.
 */
export function isAuthorMainTag(node: any): boolean {
  if (!node || node.kind !== "markup") return false;
  const tag = String(node.tag ?? node.tagName ?? "");
  if (tag.toLowerCase() !== "main") return false;
  // The canonical spelling. A lowercase tag can never be a component reference
  // (scrml components are capitalized), so it needs no guard.
  if (tag === "main") return true;
  // A capitalized spelling: the HTML landmark unless NR resolved it to a
  // user component.
  return !isUserComponentMarkup(node);
}
