import test from "node:test";
import assert from "node:assert/strict";
import { createThemeDropdown } from "../theme-dropdown.js";

// Minimal DOM events and mutation tracking keep these controller checks dependency-free.
function setup(t) {
  const globals = new Map(["document", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const mutations = [];
  function eventTarget() {
    const listeners = new Map();
    return {
      addEventListener(name, listener) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(listener);
      },
      emit(name, details = {}) {
        const event = { target: this, defaultPrevented: false, propagationStopped: false,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.propagationStopped = true; }, ...details };
        for (const listener of listeners.get(name) ?? []) listener(event);
        return event;
      },
    };
  }
  function element(id = "") {
    const attributes = new Map();
    let text = "";
    return {
      ...eventTarget(), id, dataset: {}, children: [], hidden: false,
      get textContent() { return text; },
      set textContent(value) { text = value; mutations.push([id, "textContent", value]); },
      setAttribute(name, value) { attributes.set(name, value); mutations.push([this.id, name, value]); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); mutations.push([this.id, name, null]); },
      append(child) { child.parentElement = this; this.children.push(child); },
      querySelector(selector) { return this.children.find(child => `#${child.id}` === selector); },
      closest(selector) {
        return selector === '[role="option"]' && attributes.get("role") === "option"
          ? this : this.parentElement?.closest(selector) ?? null;
      },
      contains(target) { return this === target || this.children.some(child => child.contains(target)); },
      focus() { document.activeElement = this; document.emit("focusin", { target: this }); },
    };
  }
  globalThis.document = { ...eventTarget(), createElement: () => element(), activeElement: null };
  globalThis.window = eventTarget();
  const root = element();
  const selector = element("theme-choice");
  const label = element("theme-value");
  const menu = element("theme-menu");
  menu.hidden = true;
  for (const child of [selector, label, menu]) root.append(child);
  const selections = [];
  const dropdown = createThemeDropdown(root, id => selections.push(id));
  const key = key => selector.emit("keydown", { key });
  const option = id => menu.children.find(option => option.dataset.theme === id);
  return { dropdown, selector, label, menu, selections, mutations, key, option };
}

test("same-theme updates leave the DOM, focus, and pending keyboard selection untouched", t => {
  const { dropdown, selector, label, menu, selections, mutations, key, option } = setup(t);
  dropdown.setValue("dark");
  dropdown.focus();
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-brown");
  const before = mutations.length;

  dropdown.setValue("dark");
  dropdown.setValue("dark");
  assert.equal(mutations.length, before);
  assert.equal(document.activeElement, selector);
  assert.equal(menu.hidden, false);
  assert.equal(selector.getAttribute("aria-expanded"), "true");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-brown");
  assert.equal(label.textContent, "Dark (Gray)");
  assert.equal(option("dark").getAttribute("aria-selected"), "true");
  assert.deepEqual(selections, []);

  key("Enter");
  assert.deepEqual(selections, ["dark-brown"]);
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, selector);
});

test("changed values synchronize an open list and determine its selection when reopened", t => {
  const { dropdown, selector, label, menu, selections, key, option } = setup(t);
  dropdown.setValue("dark");
  dropdown.focus();
  key("ArrowDown");
  key("ArrowDown");
  dropdown.setValue("dark-blue");
  assert.equal(label.textContent, "Dark (Blue)");
  assert.equal(option("dark").getAttribute("aria-selected"), "false");
  assert.equal(option("dark-blue").getAttribute("aria-selected"), "true");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-blue");
  assert.equal(document.activeElement, selector);
  assert.equal(menu.hidden, false);
  assert.deepEqual(selections, []);

  key("Escape");
  dropdown.setValue("light");
  assert.equal(menu.hidden, true);
  assert.equal(label.textContent, "Light");
  key("Enter");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-light");
  key("Enter");
  assert.deepEqual(selections, ["light"]);
});

test("pointer and keyboard navigation share a single active option", t => {
  const { dropdown, selector, menu, key, option } = setup(t);
  dropdown.setValue("dark");
  dropdown.focus();
  key("Enter");
  menu.emit("pointermove", { target: option("dark-brown") });
  assert.deepEqual(menu.children.filter(option => option.dataset.active === "true"), [option("dark-brown")]);
  key("ArrowDown");
  assert.deepEqual(menu.children.filter(option => option.dataset.active === "true"), [option("dark-green")]);
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-green");
});

test("clicks toggle the list and choose an option without moving combobox focus", t => {
  const { dropdown, selector, menu, selections, option } = setup(t);
  dropdown.setValue("dark");
  dropdown.focus();
  selector.emit("click");
  assert.equal(menu.hidden, false);
  selector.emit("click");
  assert.equal(menu.hidden, true);
  selector.emit("click");

  const target = document.createElement("span");
  option("dark-blue").append(target);
  const press = menu.emit("pointerdown", { target });
  assert.equal(press.defaultPrevented, true);
  assert.equal(document.activeElement, selector);
  document.emit("pointerdown", { target });
  assert.equal(menu.hidden, false);
  menu.emit("click", { target });
  assert.deepEqual(selections, ["dark-blue"]);
  assert.equal(menu.hidden, true);
  assert.equal(selector.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, selector);
});

test("Home and End open the list at its ends and arrow navigation wraps without committing", t => {
  const { dropdown, selector, menu, selections, key } = setup(t);
  dropdown.setValue("dark-green");
  dropdown.focus();
  for (const [pressed, expected] of [
    ["Home", "dark"], ["ArrowUp", "browser"], ["ArrowDown", "dark"], ["End", "browser"],
  ]) {
    assert.equal(key(pressed).defaultPrevented, true);
    assert.equal(selector.getAttribute("aria-activedescendant"), `theme-option-${expected}`);
    assert.equal(menu.hidden, false);
    assert.equal(document.activeElement, selector);
    assert.deepEqual(selections, []);
  }
  key("Escape");
  key("End");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-browser");
});

for (const dismissal of ["Escape", "Tab", "outside click", "focus leaving", "window blur"]) {
  test(`${dismissal} dismisses pending selection without committing or stealing focus`, t => {
    const { dropdown, selector, label, menu, selections, key } = setup(t);
    dropdown.setValue("dark");
    dropdown.focus();
    key("End");
    assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-browser");
    const outside = document.createElement("button");
    let expectedFocus = selector;
    if (dismissal === "Escape" || dismissal === "Tab") {
      const event = key(dismissal);
      assert.equal(event.defaultPrevented, dismissal === "Escape");
      assert.equal(event.propagationStopped, dismissal === "Escape");
    } else if (dismissal === "outside click") {
      document.emit("pointerdown", { target: outside });
    } else if (dismissal === "focus leaving") {
      outside.focus();
      expectedFocus = outside;
    } else window.emit("blur");

    assert.equal(menu.hidden, true);
    assert.equal(selector.getAttribute("aria-expanded"), "false");
    assert.equal(selector.getAttribute("aria-activedescendant"), null);
    assert.equal(document.activeElement, expectedFocus);
    assert.equal(label.textContent, "Dark (Gray)");
    assert.deepEqual(selections, []);
    dropdown.focus();
    key("Enter");
    assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark");
  });
}

test("repeated letters cycle matching themes, wrap, and commit only on selection", t => {
  const { dropdown, selector, menu, selections, key } = setup(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  dropdown.setValue("light");
  dropdown.focus();
  for (const [character, expected] of [
    ["d", "dark"], ["D", "dark-brown"], ["d", "dark-green"], ["d", "dark-blue"], ["d", "dark"],
  ]) {
    key(character);
    assert.equal(selector.getAttribute("aria-activedescendant"), `theme-option-${expected}`);
    assert.equal(menu.hidden, false);
    assert.equal(document.activeElement, selector);
    assert.deepEqual(selections, []);
    now += 100;
  }
  key("Enter");
  assert.deepEqual(selections, ["dark"]);
});

test("the typing timeout and reopening reset repeated-letter cycling", t => {
  const { dropdown, selector, key } = setup(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  dropdown.setValue("dark-blue");
  key("d");
  now += 100;
  key("d");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-brown");
  now += 700;
  key("d");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark");
  key("d");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-brown");
  key("Escape");
  key("d");
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark");
});

test("multi-character prefixes still work after cycling, including spaces in labels", t => {
  const { dropdown, selector, selections, key } = setup(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  dropdown.setValue("dark");
  key("d");
  key("d");
  for (const character of "ark (blue)") {
    now += 20;
    key(character);
  }
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-dark-blue");
  assert.deepEqual(selections, []);
  key("Enter");
  assert.deepEqual(selections, ["dark-blue"]);

  for (const character of "light") key(character);
  assert.equal(selector.getAttribute("aria-activedescendant"), "theme-option-light");
  now += 700;
  key(" ");
  assert.deepEqual(selections, ["dark-blue", "light"]);
});
