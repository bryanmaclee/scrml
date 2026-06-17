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
 */

export const POPULATED_SEEDS = {
  "examples/03-contact-book.scrml": {
    contacts: [
      { id: "1", name: "Ada Lovelace", email: "ada@x.io" },
      { id: "2", name: "Alan Turing", email: "alan@x.io" },
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
