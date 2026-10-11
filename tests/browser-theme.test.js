import test from "node:test";
import assert from "node:assert/strict";
import { browserThemePalette, createBrowserTheme } from "../browser-theme.js";
import { THEME_COLORS, normalizeHex } from "../theme-colors.js";

test("empty browser themes follow the browser scheme and cover every role", () => {
  for (const scheme of ["dark", "light"]) {
    const palette = browserThemePalette({}, scheme === "dark");
    assert.equal(palette.scheme, scheme);
    assert.deepEqual(palette.colors, Object.fromEntries(THEME_COLORS.map(role => [role.id, role[scheme]])));
  }
});

test("new-tab colors take precedence and browser borders, focus, and selection are mapped", () => {
  const palette = browserThemePalette({ colors: {
    ntp_background: "#152030", toolbar: "#233044", frame: "#112233",
    ntp_card_background: [40, 50, 60], popup: "#abcdef", ntp_text: "#ddeeff", toolbar_text: "#bbbbbb",
    popup_border: "#445566", toolbar_field_border_focus: "#778899",
    toolbar_field_highlight: "#123456", toolbar_field_highlight_text: "#fedcba",
  } }, false);
  assert.equal(palette.scheme, "dark");
  assert.equal(palette.colors.canvas, "#152030");
  assert.equal(palette.colors.surface, "#28323c");
  assert.notEqual(palette.colors.header, palette.colors.surface);
  assert.notEqual(palette.colors.header, palette.colors.canvas);
  assert.equal(palette.colors.text, "#ddeeff");
  assert.equal(palette.colors.link, "#ddeeff");
  assert.equal(palette.colors.border, "#445566");
  assert.equal(palette.colors.indicator, "#778899");
  assert.equal(palette.colors["selection-background"], "#123456");
  assert.equal(palette.colors["selection-text"], "#fedcba");
  for (const color of Object.values(palette.colors)) assert.equal(normalizeHex(color), color);
});

test("partial and invalid palettes use valid fallbacks and derive missing colors", () => {
  const palette = browserThemePalette({ colors: {
    ntp_background: "invalid", toolbar: "#efe", ntp_text: [NaN, 0, 0], bookmark_text: "#123",
    popup_border: [999, 0, 0], ntp_card_background: "#ddeedd",
  } }, true);
  assert.equal(palette.scheme, "light");
  assert.equal(palette.colors.canvas, "#eeffee");
  assert.equal(palette.colors.text, "#112233");
  assert.notEqual(palette.colors.muted, "#616161");
  assert.notEqual(palette.colors.border, "#c4c4c4");
  assert.equal(palette.colors["selection-background"], palette.colors.muted);
  for (const color of Object.values(palette.colors)) assert.equal(normalizeHex(color), color);
});

test("transparent hover colors composite onto the card surface", () => {
  const palette = browserThemePalette({ colors: {
    ntp_background: "#000000", ntp_card_background: "#202020", button_background_hover: "translucent",
  } }, false, value => value === "translucent" ? [255, 255, 255, 0.5]
    : typeof value === "string" && value.startsWith("#")
      ? [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16)).concat(1) : null);
  assert.equal(palette.colors["surface-hover"], "#909090");
});

test("explicit content scheme wins over chrome scheme; system follows browser preference", () => {
  assert.equal(browserThemePalette({ properties: { color_scheme: "dark", content_color_scheme: "light" } }, true).scheme, "light");
  assert.equal(browserThemePalette({ colors: { toolbar: "#000000" }, properties: { content_color_scheme: "system" } }, false).scheme, "light");
});

function rgb(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function assertLayered(palette) {
  const surfaces = ["canvas", "surface", "header", "surface-hover"].map(role => palette.colors[role]);
  for (let index = 0; index < surfaces.length; index++) {
    const current = rgb(surfaces[index]);
    for (const other of surfaces.slice(index + 1).map(rgb)) {
      const distance = Math.sqrt([0.2126, 0.7152, 0.0722].reduce((sum, weight, channel) =>
        sum + weight * (current[channel] - other[channel]) ** 2, 0));
      assert.ok(distance >= 10, `Palette layers need visible separation: ${surfaces.join(", ")}`);
    }
  }
  for (const role of ["surface", "header"]) assert.notEqual(palette.colors.border, palette.colors[role]);
}

test("a single browser background produces layered tinted surfaces in dark and light themes", () => {
  for (const base of ["#182838", "#e8d4c0"]) {
    const palette = browserThemePalette({ colors: { ntp_background: base } }, false);
    assert.equal(palette.colors.canvas, base);
    assertLayered(palette);
    for (const role of ["surface", "header", "surface-hover"]) {
      const [r, g, b] = rgb(palette.colors[role]);
      assert.ok(base === "#182838" ? r < g && g < b : r > g && g > b, "Derived shades retain the base color's channel order");
    }
  }
});

test("repeated and nearly identical browser colors receive visibly different UI shades", () => {
  for (const [base, nearby] of [["#20252a", "#22272c"], ["#e8e0d8", "#e6ded6"]]) {
    for (const card of [base, nearby]) {
      const palette = browserThemePalette({ colors: {
        ntp_background: base, ntp_card_background: card, toolbar: base, popup: base,
        button_background_hover: card, popup_border: card,
      } }, false);
      assert.equal(palette.colors.canvas, base);
      assertLayered(palette);
    }
  }
});

test("very light and dark bases stay layered, including a scheme pointing toward a clipped endpoint", () => {
  for (const base of ["#000000", "#010203", "#fcfdfe", "#ffffff", "#0000ff", "#ff0000", "#ffff00"]) {
    for (const scheme of ["dark", "light"]) {
      const palette = browserThemePalette({ colors: {
        ntp_background: base, ntp_card_background: base, button_background_hover: base,
      }, properties: { content_color_scheme: scheme } }, false);
      assert.equal(palette.colors.canvas, base);
      assertLayered(palette);
      for (const color of Object.values(palette.colors)) assert.equal(normalizeHex(color), color);
    }
  }
});

test("distinct browser surfaces, hover shades, and borders retain their supplied colors", () => {
  const palette = browserThemePalette({ colors: {
    ntp_background: "#102030", ntp_card_background: "#405060", button_background_hover: "#788898", popup_border: "#a0b0c0",
  } }, false);
  assert.equal(palette.colors.canvas, "#102030");
  assert.equal(palette.colors.surface, "#405060");
  assert.equal(palette.colors["surface-hover"], "#788898");
  assert.equal(palette.colors.border, "#a0b0c0");
  assertLayered(palette);
});

test("translucent browser surfaces that resolve too close to the canvas are shaded", () => {
  const palette = browserThemePalette({ colors: {
    ntp_background: "base", ntp_card_background: "transparent-card", button_background_hover: "transparent-card",
  } }, false, value => value === "base" ? [20, 40, 60, 1] : value === "transparent-card" ? [255, 255, 255, 0.01] : null);
  assert.equal(palette.colors.canvas, "#14283c");
  assertLayered(palette);
});

function event() {
  const listeners = [];
  return { addListener: listener => listeners.push(listener), addEventListener: (_type, listener) => listeners.push(listener),
    emit: (...args) => listeners.forEach(listener => listener(...args)) };
}

function fixture() {
  let windowId = 1;
  const calls = [];
  const media = { ...event(), matches: true };
  const api = {
    windows: { async getCurrent() { return { id: windowId }; } },
    tabs: { async getCurrent() { return { id: 10, windowId }; }, onAttached: event() },
    theme: { onUpdated: event(), async getCurrent(id) { calls.push(id); return { colors: { ntp_background: id === 1 ? "#112233" : "#eeeeee" } }; } },
  };
  let changed = 0;
  const theme = createBrowserTheme(api, media, () => { changed++; });
  return { api, media, calls, theme, move: id => { windowId = id; }, changed: () => changed };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("updates are window-scoped, global changes refresh, and a transferred grid follows its new window", async () => {
  const f = fixture();
  await f.theme.ready;
  assert.deepEqual(f.calls, [1]);
  f.api.theme.onUpdated.emit({ windowId: 2 });
  f.api.tabs.onAttached.emit(20);
  await settle();
  assert.deepEqual(f.calls, [1]);
  f.api.theme.onUpdated.emit({});
  await settle();
  assert.deepEqual(f.calls, [1, 1]);
  f.move(2);
  f.api.tabs.onAttached.emit(10);
  await settle();
  assert.equal(f.theme.value.colors.canvas, "#eeeeee");
  assert.equal(f.theme.value.scheme, "light");
  assert.deepEqual(f.calls, [1, 1, 2]);
});

test("newer theme updates win over delayed reads, even when the old lookup fails", async () => {
  const f = fixture();
  await f.theme.ready;
  for (const fail of [false, true]) {
    let finish;
    f.api.theme.getCurrent = () => new Promise((resolve, reject) => { finish = fail ? reject : resolve; });
    const old = f.theme.refresh();
    await settle();
    f.api.theme.getCurrent = async () => ({ colors: { ntp_background: "#abcdef" } });
    await f.theme.refresh();
    const count = f.changed();
    finish(fail ? new Error("Obsolete failure") : { colors: { ntp_background: "#000000" } });
    await old;
    assert.equal(f.theme.value.colors.canvas, "#abcdef");
    assert.equal(f.changed(), count);
  }
});

test("removing a browser theme and preferred-scheme changes restore live automatic defaults", async () => {
  const f = fixture();
  await f.theme.ready;
  f.api.theme.getCurrent = async () => ({});
  f.api.theme.onUpdated.emit({ windowId: 1 });
  await settle();
  assert.equal(f.theme.value.colors.canvas, "#101010");
  f.media.matches = false;
  f.media.emit();
  assert.equal(f.theme.value.scheme, "light");
  assert.equal(f.theme.value.colors.canvas, "#e6e6e6");
});

test("failed current theme lookups clear stale colors and later updates can recover", async t => {
  const errors = t.mock.method(console, "error", () => {});
  const f = fixture();
  await f.theme.ready;
  f.api.theme.getCurrent = async () => { throw new Error("Unavailable theme"); };
  await f.theme.refresh();
  assert.equal(f.theme.value.colors.canvas, "#101010");
  assert.equal(errors.mock.callCount(), 1);
  f.api.theme.getCurrent = async () => ({ colors: { ntp_background: "#223344" } });
  await f.theme.refresh();
  assert.equal(f.theme.value.colors.canvas, "#223344");
});
