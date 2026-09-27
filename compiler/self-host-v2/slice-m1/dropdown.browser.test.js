// dropdown.browser.test.js — SPEC §66.19.3 run end to end (the dropdown
// library consumed three times + row-owned instances), and dpa-050 D1:
// ONE CLICK OPENS ONE DROPDOWN (impl#1 opens all three — CARRIED, §66.15.1).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadBootstrap } from "./harness.js";
import { loadProgram, expectNoPageErrors, click, instancesOf } from "./load-program.js";

let mods;
afterEach(() => expectNoPageErrors());
beforeAll(() => { ({ mods } = loadBootstrap()); }, { timeout: 60000 });

const dropdowns = () => [...document.querySelectorAll("div.dropdown")];
const toggles = () => dropdowns().map((d) => d.querySelector("button.dropdown__toggle"));
const labels = () => toggles().map((b) => b.textContent);
const openMenus = () => [...document.querySelectorAll("ul.dropdown__menu")];
const menuOf = (dd) => dd.querySelector("ul.dropdown__menu");
const byLabel = (prefix) => dropdowns().find((d) => d.querySelector("button").textContent.startsWith(prefix));
const appButton = (text) => [...document.querySelectorAll("main > button")].find((b) => b.textContent === text);
const shipping = () => document.querySelector("main > p").textContent;
const spans = () => [...document.querySelectorAll("main > span")].map((s) => s.textContent);

function pick(dd, option) {
  click(dd.querySelector("button.dropdown__toggle"));
  const li = [...menuOf(dd).querySelectorAll("li")].find((l) => l.textContent === option);
  click(li);
}

describe("§66.19.3 — initial render", () => {
  beforeAll(async () => { await loadProgram(mods["dropdown.core"].dropdownCore(), "dropdown"); });

  test("instances 1 and 2 plus one per row; the conditional instance is absent", () => {
    expect(labels()).toEqual(["Country: US", "Size: M", "Tea: 1", "Milk: 1"]);
    expect(openMenus().length).toBe(0);
    expect(shipping()).toBe("Shipping to US");
    expect(spans()).toEqual(["Tea × 1", "Milk × 1"]);
  });
});

describe("dpa-050 D1 — one click opens ONE dropdown; every instance toggles independently", () => {
  beforeAll(async () => { await loadProgram(mods["dropdown.core"].dropdownCore(), "dropdown"); });

  test("clicking Country opens exactly one menu, inside Country", () => {
    click(toggles()[0]);
    expect(openMenus().length).toBe(1);
    expect(menuOf(byLabel("Country"))).not.toBeNull();
    expect([...menuOf(byLabel("Country")).querySelectorAll("li")].map((l) => l.textContent)).toEqual(["US", "CA", "MX"]);
  });

  test("each of the 3 top-level instances and each row instance toggles on its own", () => {
    click(toggles()[0]); // close Country
    expect(openMenus().length).toBe(0);
    for (let i = 0; i < toggles().length; i++) {
      click(toggles()[i]);
      expect(openMenus().length).toBe(1);
      expect(menuOf(dropdowns()[i])).not.toBeNull();
      click(toggles()[i]);
      expect(openMenus().length).toBe(0);
    }
    // Opening two leaves exactly those two open.
    click(toggles()[1]);
    click(toggles()[3]);
    expect(openMenus().length).toBe(2);
    expect(menuOf(dropdowns()[1])).not.toBeNull();
    expect(menuOf(dropdowns()[3])).not.toBeNull();
    click(toggles()[1]);
    click(toggles()[3]);
    expect(openMenus().length).toBe(0);
  });

  test("the conditional Color instance toggles independently too", () => {
    click(appButton("Colours"));
    const color = byLabel("Color");
    expect(color).toBeDefined();
    click(color.querySelector("button"));
    expect(openMenus().length).toBe(1);
    expect(menuOf(color)).not.toBeNull();
    click(color.querySelector("button"));
    click(appButton("Colours"));
    expect(byLabel("Color")).toBeUndefined();
  });

  test("choosing an option writes THAT instance's value and closes only its menu", () => {
    click(toggles()[1]); // open Size, leave it open
    pick(byLabel("Country"), "CA");
    expect(byLabel("Country").querySelector("button").textContent).toBe("Country: CA");
    expect(byLabel("Size").querySelector("button").textContent).toBe("Size: M");
    expect(menuOf(byLabel("Country"))).toBeNull();
    expect(menuOf(byLabel("Size"))).not.toBeNull();
    click(toggles()[1]);
  });
});

describe("as=country — the handle reads/writes instance 1 only", () => {
  let rt;
  beforeAll(async () => { ({ rt } = await loadProgram(mods["dropdown.core"].dropdownCore(), "dropdown")); });

  test("the handle points at the first dropdown instance, and `Shipping to` follows it", () => {
    const program = instancesOf(rt, "program")[0];
    const country = program.handles[0].peek();
    expect(country).toBe(instancesOf(rt, "dropdown")[0]);
    expect(country.id).toBe(1);
    pick(byLabel("Size"), "L");
    expect(shipping()).toBe("Shipping to US");
    pick(byLabel("Country"), "MX");
    expect(shipping()).toBe("Shipping to MX");
    expect(country.fields[2].peek()).toBe("MX");
    expect(instancesOf(rt, "dropdown")[1].fields[2].peek()).toBe("L");
  });

  test("closeCountry() (a write through the handle) closes Country and nothing else", () => {
    click(toggles()[0]);
    click(toggles()[1]);
    expect(openMenus().length).toBe(2);
    click(appButton("Done"));
    expect(menuOf(byLabel("Country"))).toBeNull();
    expect(menuOf(byLabel("Size"))).not.toBeNull();
    // From .Closed it is a self-write no-op (§51.0.F.1), not an invalid transition.
    click(appButton("Done"));
    expect(menuOf(byLabel("Country"))).toBeNull();
    click(toggles()[1]);
  });
});

describe("the conditional Color instance mounts and disposes with showColor", () => {
  let rt;
  beforeAll(async () => { ({ rt } = await loadProgram(mods["dropdown.core"].dropdownCore(), "dropdown")); });

  test("hidden: no instance, handle is `not`; clearColor() is a no-op", () => {
    const program = instancesOf(rt, "program")[0];
    expect(program.handles[1].peek()).toBeNull();
    expect(instancesOf(rt, "dropdown").length).toBe(4);
    click(appButton("Clear colour"));
    expect(instancesOf(rt, "dropdown").length).toBe(4);
  });

  test("show → a new instance owns effects + listeners; hide → all of them are gone", () => {
    const program = instancesOf(rt, "program")[0];
    const before = { ...rt.stats };
    const childScopesBefore = program.scope.children.size;
    click(appButton("Colours"));
    const color = program.handles[1].peek();
    expect(color).not.toBeNull();
    expect(color.decl.name).toBe("dropdown");
    expect(byLabel("Color").querySelector("button").textContent).toBe("Color: ");
    // Open its menu so it owns more (the menu arm's effect + two <li> listeners).
    click(byLabel("Color").querySelector("button"));
    const shown = { ...rt.stats };
    expect(shown.instances).toBe(before.instances + 1);
    expect(shown.effects).toBeGreaterThan(before.effects);
    expect(shown.listeners).toBeGreaterThan(before.listeners);
    expect(shown.deriveds).toBe(before.deriveds + 2);           // its locked attributes: label, options
    expect(program.scope.children.size).toBe(childScopesBefore + 1); // the arm scope

    click(appButton("Colours")); // hide
    expect(color.scope.disposed).toBe(true);
    expect(program.handles[1].peek()).toBeNull();
    expect(rt.stats).toEqual(before);                           // effects, deriveds, listeners, instances
    expect(program.scope.children.size).toBe(childScopesBefore); // the disposed arm scope left its parent
    expect(color.fields[0].sources.size).toBe(0);
    expect(byLabel("Color")).toBeUndefined();
    // Its signals no longer drive anything: a write reaches no effect.
    const effectsNow = rt.stats.effects;
    color.fields[2].set("zzz");
    expect(rt.stats.effects).toBe(effectsNow);
    expect(document.body.textContent).not.toContain("zzz");
  });

  test("clearColor() writes through the narrowed handle — the mounted instance only", () => {
    click(appButton("Colours"));
    pick(byLabel("Color"), "blue");
    expect(byLabel("Color").querySelector("button").textContent).toBe("Color: blue");
    click(appButton("Clear colour"));
    expect(byLabel("Color").querySelector("button").textContent).toBe("Color: ");
    expect(byLabel("Country").querySelector("button").textContent).toBe("Country: US");
    // Re-showing makes a FRESH instance (a plain tag makes a new one, §66.6.1).
    const first = instancesOf(rt, "program")[0].handles[1].peek();
    click(appButton("Colours"));
    click(appButton("Colours"));
    const second = instancesOf(rt, "program")[0].handles[1].peek();
    expect(second).not.toBe(first);
    expect(first.scope.disposed).toBe(true);
  });
});

describe("row-scoped qty follows its row on reorder; disposed with its row (§66.7.3/§66.7.4)", () => {
  let rt, program;
  beforeAll(async () => {
    ({ rt, program } = await loadProgram(mods["dropdown.core"].dropdownReorderCore(), "dropdown-rows",
      ["reorderLines", "dropTea", "addCoffee", "renameTea"]));
  });

  const rowDropdown = (name) => byLabel(name + ":");

  test("each row's `qty` names that row's own instance", () => {
    pick(rowDropdown("Tea"), "3");
    expect(spans()).toEqual(["Tea × 3", "Milk × 1"]);
    expect(rowDropdown("Milk").querySelector("button").textContent).toBe("Milk: 1");
  });

  test("reorder: the Tea row — its DOM, its instance, its state — moves with its key", () => {
    const teaDom = rowDropdown("Tea");
    const teaInst = instancesOf(rt, "dropdown").find((i) => i.fields[0].peek() === "Tea");
    const effectsBefore = rt.stats.effects;
    program.reorderLines();
    expect(spans()).toEqual(["Milk × 1", "Tea × 3"]);
    expect(labels().slice(2)).toEqual(["Milk: 1", "Tea: 3"]);
    expect(rowDropdown("Tea")).toBe(teaDom);                 // moved, not re-created
    expect(instancesOf(rt, "dropdown").find((i) => i.fields[0].peek() === "Tea")).toBe(teaInst);
    expect(teaInst.scope.disposed).toBe(false);
    expect(rt.stats.effects).toBe(effectsBefore);            // nothing created or disposed
  });

  test("remove: dropping the Tea row disposes its instance and everything it owned", () => {
    const teaInst = instancesOf(rt, "dropdown").find((i) => i.fields[0].peek() === "Tea");
    click(rowDropdown("Tea").querySelector("button"));        // give it an open menu too
    const before = { ...rt.stats };
    const teaLabel = teaInst.fields[0];                         // a Derived tracking the row's `line`
    expect(teaLabel.sources.size).toBe(1);
    program.dropTea();
    expect(teaInst.scope.disposed).toBe(true);
    expect(teaLabel.sources.size).toBe(0);                      // unsubscribed from the row cell
    expect(rt.stats.deriveds).toBe(before.deriveds - 2);
    expect(spans()).toEqual(["Milk × 1"]);
    expect(rowDropdown("Tea")).toBeUndefined();
    expect(rt.stats.instances).toBe(before.instances - 1);
    expect(rt.stats.effects).toBeLessThan(before.effects);
    expect(rt.stats.listeners).toBeLessThan(before.listeners);
    expect(openMenus().length).toBe(0);
  });

  test("insert: returning rows get FRESH instances (state is per instance, not per key forever)", () => {
    program.addCoffee();
    expect(spans()).toEqual(["Milk × 1", "Tea × 1", "Coffee × 1"]);
    expect(instancesOf(rt, "dropdown").filter((i) => i.fields[0].peek() === "Tea").length).toBe(1);
  });
});

describe("a surviving key whose item CHANGES updates in place (review F2)", () => {
  let rt, program;
  beforeAll(async () => {
    ({ rt, program } = await loadProgram(mods["dropdown.core"].dropdownReorderCore(), "dropdown-rename", ["renameTea"]));
  });

  test("renaming row 1 updates its span and its dropdown label; the row, its DOM and its instance survive", () => {
    const teaDom = byLabel("Tea:");
    const teaInst = instancesOf(rt, "dropdown").find((i) => i.fields[0].peek() === "Tea");
    pick(teaDom, "2");                                          // row state that must survive the update
    const before = { ...rt.stats };
    program.renameTea();
    expect(spans()).toEqual(["Green tea × 2", "Milk × 1"]);     // the row binding `line` updated
    expect(teaDom.querySelector("button").textContent).toBe("Green tea: 2"); // label=line.name tracks (L6)
    expect(byLabel("Green tea:")).toBe(teaDom);
    expect(teaInst.fields[0].peek()).toBe("Green tea");
    expect(teaInst.scope.disposed).toBe(false);
    expect(rt.stats).toEqual(before);                           // nothing created or disposed
  });
});
