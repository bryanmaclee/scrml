/**
 * seed-fixtures.js — per-app POPULATED-seed fixtures (the DD's "one-line fixture
 * cell-set" for class-2/3a apps).
 *
 * Per the DD §"Driving corpus apps" + §"render-state taxonomy": an app with a
 * `<db>`/`<each>` that renders the `<empty>` fallback from an EMPTY cell is a
 * VALID partial render (looks green) — the board bug class lives ONLY in the
 * POPULATED render where the loop body reaches each item. So the harness records
 * `(app, seed=empty)` and `(app, seed=populated)` as TWO separate cells; D6
 * (S-EMPTY-WITH-DATA) fires only when seed=populated yet the DOM is empty.
 *
 * This map keys the known list-rendering corpus apps to a tiny fixture: the
 * top-level reactive cell(s) the loop reads, set to a 2-item array. Apps NOT in
 * this map get only the `empty` cell (mount + DOMContentLoaded). Adding a new
 * app's seed is a one-line entry — the cheapest "with-data" path (DD option 3a:
 * cell-injection, no real db/server).
 *
 * The cell-set is applied AFTER mount via the reactive set side-channel
 * (_scrml_reactive_set), so the values must match the cell's declared shape.
 *
 * SEED-SHAPE INVARIANT (S203). A populated seed MUST provide EVERY field the app's
 * template renders off the item's struct. A seed missing a field → the template
 * interpolates JS `undefined` → literal "undefined" in the DOM → a FALSE
 * `S-NULLISH-TEXT` smell that looks like a codegen bug but is a seed gap. When a
 * POPULATED cell shows `S-NULLISH-TEXT`, TRIAGE: (1) does the seed provide every
 * rendered field of the struct? If not, fix the seed here (it is NOT a compiler
 * bug). (2) Only if the seed is complete is the `undefined` a real codegen leak.
 * Precedent: the 03-contact-book `phone` gap (g-render-nullish-text, S203) was a
 * seed gap, not codegen.
 */

export const POPULATED_SEEDS = {
  "examples/03-contact-book.scrml": {
    // NOTE (S203): the Contact struct is { id, name, email, phone } and the template renders
    // ${contact.phone}; a seed missing `phone` renders literal "undefined" (a FALSE S-NULLISH-TEXT).
    // See the seed-shape invariant in this file's header.
    contacts: [
      { id: "1", name: "Ada Lovelace", email: "ada@x.io", phone: "555-0001" },
      { id: "2", name: "Alan Turing", email: "alan@x.io", phone: "555-0002" },
    ],
  },
  "examples/06-kanban-board.scrml": {
    todo: [
      { id: "1", title: "Spec the harness", column: "todo" },
      { id: "2", title: "Wire detectors", column: "todo" },
    ],
  },
  "examples/16-remote-data.scrml": {
    contacts: [
      { id: "1", name: "Ada Lovelace" },
      { id: "2", name: "Alan Turing" },
    ],
  },
  "examples/25-triage-board.scrml": {
    tasks: [
      { id: "1", title: "Triage A", column: "todo", order: 0 },
      { id: "2", title: "Triage B", column: "doing", order: 1 },
    ],
  },
};

/** The seed object for an app's populated cell, or null if none registered. */
export function seedFor(relpath) {
  return POPULATED_SEEDS[relpath] ?? null;
}
