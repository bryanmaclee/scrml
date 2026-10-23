/**
 * mount-isolation — tear down the document/window listeners a previously-mounted program
 * installed, before the next program is mounted into the SAME happy-dom document.
 *
 * WHY (S469 browser-suite-health). Browser-tier files that mount several compiled programs
 * into one shared `document` leave every earlier program's DELEGATED listeners attached
 * (`document.addEventListener("click", …)` resolving `data-scrml-bind-onclick="_scrml_attr_onclick_N"`).
 * Handler ids restart at the same N per compile, so a later program's button can carry the
 * same id as an earlier program's handler — and the EARLIER program's listener runs ITS
 * handler against ITS cells. That is a fixture artifact (a real page boots one program per
 * document), and it leaked: browser-gated-handler-narrowing-s462's stale
 * `@out = @user.name` (with its `@user = not`) threw into the next file's window-error
 * collector. A real browser cannot produce this; the fixture must not either.
 *
 * Usage:
 *   const iso = createMountIsolation();
 *   iso.teardown();                 // before mounting the next program
 *   iso.track(() => exec(window, document));   // records listeners added during exec
 *   afterAll(() => iso.teardown());
 */
export function createMountIsolation() {
  let added = [];
  return {
    /** Run `fn` while recording every listener it adds to `document` / `window`. */
    track(fn) {
      const targets = [globalThis.document, globalThis.window].filter(Boolean);
      const saved = targets.map((t) => [t, Object.prototype.hasOwnProperty.call(t, "addEventListener"), t.addEventListener]);
      for (const [t, , orig] of saved) {
        t.addEventListener = function (type, listener, opts) {
          added.push([t, type, listener, opts]);
          return orig.call(t, type, listener, opts);
        };
      }
      try {
        return fn();
      } finally {
        for (const [t, hadOwn, orig] of saved) {
          if (hadOwn) t.addEventListener = orig;
          else delete t.addEventListener;
        }
      }
    },
    /** Remove every listener recorded by `track` so far. */
    teardown() {
      for (const [t, type, listener, opts] of added) {
        try { t.removeEventListener(type, listener, opts); } catch { /* target already gone */ }
      }
      added = [];
    },
  };
}
