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
 * top-level reactive SOURCE cell(s) the loop reads, set to a small array (or, for
 * an app whose list lives in an enum payload, to that variant value). Apps NOT in
 * this map get only the `empty` cell (mount + DOMContentLoaded). Adding a new
 * app's seed is a one-line entry — the cheapest "with-data" path (DD option 3a:
 * cell-injection, no real db/server).
 *
 * The cell-set is applied AFTER mount via the reactive set side-channel
 * (_scrml_reactive_set), so the values must match the cell's declared shape —
 * in its EMITTED RUNTIME form, not its source form. The seed bridge
 * (render-harness.js applySeed) resolves each name against the cells the chunk
 * really emits and writes nothing for a name that is not one:
 *   - name a SOURCE cell. A derived cell (`const <x> = @y.filter(...)`) is
 *     recomputed from its source; the bridge refuses the write (`derived-cell`).
 *   - name a cell that EXISTS. A match binding / each alias is not a cell
 *     (`no-such-cell`).
 *   - write enum values the way the emit represents them (read the app's emitted
 *     client JS — `bun compiler/bin/scrml.js compile <app> --output-dir <tmp>`):
 *       unit variant     `.Todo`          -> the bare string "Todo"
 *       payload variant  `.Loaded(rows)`  -> { variant: "Loaded", data: { rows } }
 *     (from the emitted `const Status = Object.freeze({ Todo: "Todo", ... })` and
 *     `Loaded: function(rows) { return { variant: "Loaded", data: { rows } }; }`.)
 *   - use the values the app actually compares against (§45 strict equality:
 *     `"doing" != "Doing"`), or every filter matches nothing.
 * The pinned SEED_OBSERVABILITY table in e2e-render-map.test.js records, per app,
 * how the seed resolved AND which seeded rows rendered in which container, so a
 * fixture that stops driving its app reds there rather than scoring green.
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
    // (S427: `id` is `number` in the struct; the old fixture seeded strings.)
    contacts: [
      { id: 1, name: "Ada Lovelace", email: "ada@x.io", phone: "555-0001" },
      { id: 2, name: "Alan Turing", email: "alan@x.io", phone: "555-0002" },
    ],
  },
  "examples/06-kanban-board.scrml": {
    // Card = { id: number, title: string, status: Status }; Status is a UNIT enum, so each
    // variant is its bare-string runtime form. Seeds the SOURCE cell `cards` — `todo` /
    // `inProgress` / `done` are derived from it. One card per status, so every column's
    // <each> renders exactly one seeded row. (S427: the old fixture seeded the derived `todo`
    // with a `column:` field the struct does not have.)
    cards: [
      { id: 101, title: "Seeded todo card", status: "Todo" },
      { id: 102, title: "Seeded doing card", status: "InProgress" },
      { id: 103, title: "Seeded done card", status: "Done" },
    ],
  },
  "examples/16-remote-data.scrml": {
    // The app's ONLY cell is `<phase>: ContactsPhase`; the list is `<each in=rows>` inside the
    // `<Loaded rows>` arm, reading the variant's payload. So the seed is the payload variant
    // itself, in its runtime form. Contact = { id: int, name: string, email: string }.
    // (S427: the old fixture seeded a `contacts` cell the app does not have.)
    phase: {
      variant: "Loaded",
      data: {
        rows: [
          { id: 1, name: "Ada Lovelace", email: "ada@x.io" },
          { id: 2, name: "Alan Turing", email: "alan@x.io" },
        ],
      },
    },
  },
  "examples/25-triage-board.scrml": {
    // Task = { id: number, title: string, column: string, order: number }; the board filters
    // `@tasks.filter(t => t.column == col)` over `const columns = ["Inbox", "Doing", "Done"]`,
    // so the seed uses those exact values. Done stays LEGITIMATELY empty (D6 must be quiet on
    // it). (S427: the old fixture's lowercase "todo"/"doing" matched no column.)
    tasks: [
      { id: 101, title: "Seeded inbox task", column: "Inbox", order: 0 },
      { id: 102, title: "Seeded doing task", column: "Doing", order: 0 },
    ],
  },
};

/** The seed object for an app's populated cell, or null if none registered. */
export function seedFor(relpath) {
  return POPULATED_SEEDS[relpath] ?? null;
}
