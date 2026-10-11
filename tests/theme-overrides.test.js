import test from "node:test";
import assert from "node:assert/strict";
import { createThemeOverrides, colorOverrideKey, colorOverridesEnabledKey } from "../theme.js";
import { THEME_COLORS, normalizeHex, colorCss } from "../theme-colors.js";
import { createFakeBrowser } from "./fake-browser.js";

test("both built-in palettes cover the same 19 roles with valid colors and soft-gray light surfaces", () => {
  assert.equal(THEME_COLORS.length, 19);
  assert.equal(new Set(THEME_COLORS.map(role => role.id)).size, 19);
  for (const role of THEME_COLORS) {
    assert.equal(normalizeHex(role.dark), role.dark);
    assert.equal(normalizeHex(role.light), role.light);
    assert.notEqual(role.light, "#ffffff");
  }
  assert.deepEqual(THEME_COLORS.filter(role => ["canvas", "header", "surface", "surface-hover"].includes(role.id))
    .map(role => role.light), ["#e6e6e6", "#dedede", "#f2f2f2", "#d5d5d5"]);
});

test("overrides load without writes, normalize hex, and return independent records", async () => {
  const api = createFakeBrowser();
  const key = colorOverrideKey("light", "canvas");
  api.storage.sync.data[key] = { enabled: true, color: " #ABC " };
  const writes = [];
  api.storage.sync.set = async values => { writes.push(values); };
  const overrides = createThemeOverrides(api, () => {});
  await overrides.ready;
  assert.deepEqual(overrides.get("light", "canvas"), { enabled: true, color: "#aabbcc" });
  assert.deepEqual(overrides.get("dark", "canvas"), { enabled: false, color: "#101010" });
  const record = overrides.get("light", "canvas");
  record.color = "#ffffff";
  assert.equal(overrides.get("light", "canvas").color, "#aabbcc");
  assert.deepEqual(writes, []);
});

test("editing, disabling, and re-enabling writes only the selected sync key and retains custom colors", async () => {
  const api = createFakeBrowser();
  const overrides = createThemeOverrides(api, () => {});
  await overrides.ready;
  await overrides.set("dark", "canvas", true, " #123ABC ");
  await overrides.set("light", "text", true, "#abc");
  await overrides.set("dark", "canvas", false, overrides.get("dark", "canvas").color);
  assert.deepEqual(overrides.get("dark", "canvas"), { enabled: false, color: "#123abc" });
  assert.deepEqual(api.storage.sync.data, {
    "themeColor.dark.canvas": { enabled: false, color: "#123abc" },
    "themeColor.light.text": { enabled: true, color: "#aabbcc" },
  });
  assert.deepEqual(api.storage.local.data, {});
  const reopened = createThemeOverrides(api, () => {});
  await reopened.ready;
  await reopened.set("dark", "canvas", true, reopened.get("dark", "canvas").color);
  assert.deepEqual(overrides.get("dark", "canvas"), { enabled: true, color: "#123abc" });
  assert.equal(overrides.get("light", "text").color, "#aabbcc");
});

test("incoming device sync changes notify all pages without changing unrelated roles or theme palettes", async () => {
  const api = createFakeBrowser();
  const notifications = [[], []];
  const pages = notifications.map(events => createThemeOverrides(api, () => events.push("changed")));
  await Promise.all(pages.map(page => page.ready));
  await Promise.all([
    pages[0].set("dark", "canvas", true, "#123456"),
    pages[1].set("dark", "text", true, "#abcdef"),
  ]);
  api.storage.onChanged.emit({ "themeColor.light.canvas": { newValue: { enabled: true, color: "#fedcba" } } }, "sync");
  for (const page of pages) {
    assert.deepEqual(page.get("dark", "canvas"), { enabled: true, color: "#123456" });
    assert.deepEqual(page.get("dark", "text"), { enabled: true, color: "#abcdef" });
    assert.deepEqual(page.get("light", "canvas"), { enabled: true, color: "#fedcba" });
    assert.deepEqual(page.get("light", "text"), { enabled: false, color: "#303030" });
  }
  assert.deepEqual(notifications.map(events => events.length), [4, 4]);
});

test("initial loading merges per-key sync updates rather than replacing newer values with a stale snapshot", async () => {
  const api = createFakeBrowser();
  let finishRead;
  api.storage.sync.get = () => new Promise(resolve => { finishRead = resolve; });
  const overrides = createThemeOverrides(api, () => {});
  await api.storage.sync.set({ "themeColor.dark.canvas": { enabled: true, color: "#112233" } });
  finishRead({
    "themeColor.dark.canvas": { enabled: true, color: "#999999" },
    "themeColor.dark.text": { enabled: true, color: "#aabbcc" },
  });
  await overrides.ready;
  assert.equal(overrides.get("dark", "canvas").color, "#112233");
  assert.equal(overrides.get("dark", "text").color, "#aabbcc");
});

test("unrelated storage changes are ignored and removed or malformed sync values restore defaults", async () => {
  const api = createFakeBrowser();
  let notifications = 0;
  const overrides = createThemeOverrides(api, () => { notifications++; });
  await overrides.ready;
  await overrides.set("light", "canvas", true, "#123456");
  await api.storage.local.set({ "themeColor.light.canvas": { enabled: true, color: "#abcdef" } });
  await api.storage.session.set({ "themeColor.light.canvas": { enabled: true, color: "#abcdef" } });
  await api.storage.sync.set({ irrelevant: {}, "themeColor.light.unknown": {} });
  assert.equal(notifications, 2);
  for (const value of [undefined, null, "#abcdef", { enabled: true, color: "red" },
    { enabled: true, color: "#ffffff; background: red" }]) {
    api.storage.onChanged.emit({ "themeColor.light.canvas": { newValue: value } }, "sync");
    assert.deepEqual(overrides.get("light", "canvas"), { enabled: false, color: "#e6e6e6" });
  }
});

test("invalid choices and failed writes preserve persisted and active overrides", async () => {
  const api = createFakeBrowser();
  const overrides = createThemeOverrides(api, () => {});
  await overrides.ready;
  await overrides.set("dark", "canvas", true, "#112233");
  for (const color of ["red", "112233", "#12345", "#11223344", "#123456; color: red", null]) {
    await assert.rejects(overrides.set("dark", "canvas", true, color), /Use a hex color/);
  }
  await assert.rejects(overrides.set("unknown", "canvas", true, "#123456"), /Unknown theme color/);
  await assert.rejects(overrides.set("browser", "canvas", true, "#123456"), /Unknown theme color/);
  await assert.rejects(overrides.set("dark", "unknown", true, "#123456"), /Unknown theme color/);
  await assert.rejects(overrides.set("dark", "canvas", "yes", "#123456"), /whether to override/);
  api.storage.sync.set = async () => { throw new Error("Sync storage quota exceeded"); };
  await assert.rejects(overrides.set("dark", "canvas", false, "#abcdef"), /quota exceeded/);
  assert.deepEqual(overrides.get("dark", "canvas"), { enabled: true, color: "#112233" });
  assert.deepEqual(api.storage.sync.data["themeColor.dark.canvas"], { enabled: true, color: "#112233" });
});

test("failed loading retains sync events already received and still permits later saves", async () => {
  const api = createFakeBrowser();
  let failRead;
  api.storage.sync.get = () => new Promise((_resolve, reject) => { failRead = reject; });
  const overrides = createThemeOverrides(api, () => {});
  await overrides.set("dark", "text", true, "#abcdef");
  failRead(new Error("Sync unavailable"));
  await assert.rejects(overrides.ready, /Sync unavailable/);
  assert.deepEqual(overrides.get("dark", "text"), { enabled: true, color: "#abcdef" });
  assert.deepEqual(overrides.get("dark", "canvas"), { enabled: false, color: "#101010" });
  await overrides.set("dark", "canvas", true, "#123456");
  assert.equal(overrides.get("dark", "canvas").color, "#123456");
});

test("shadow overrides keep the theme's opacity and scroll gradient geometry", () => {
  const card = THEME_COLORS.find(role => role.id === "card-shadow");
  assert.equal(colorCss(card, "dark", "#336699"), "rgb(51 102 153 / 14%)");
  assert.equal(colorCss(card, "light", "#336699"), "rgb(51 102 153 / 8%)");
  const scroll = THEME_COLORS.find(role => role.id === "scroll-shadow");
  assert.equal(colorCss(scroll, "light", "#336699"),
    "rgb(51 102 153 / 20%) 0%, rgb(51 102 153 / 12%) 20%, rgb(51 102 153 / 5%) 45%, rgb(51 102 153 / 1.5%) 70%, rgb(51 102 153 / 0.25%) 90%, rgb(51 102 153 / 0%) 100%");
});

test("new configurations start with both master switches off; color changes cannot enable them", async () => {
  const api = createFakeBrowser();
  const overrides = createThemeOverrides(api, () => {});
  await overrides.ready;
  assert.equal(overrides.isEnabled("dark"), false);
  assert.equal(overrides.isEnabled("light"), false);
  assert.deepEqual(api.storage.sync.data, {});
  await overrides.set("dark", "canvas", true, "#123456");
  await overrides.set("light", "canvas", true, "#abcdef");
  assert.equal(overrides.isEnabled("dark"), false);
  assert.equal(overrides.isEnabled("light"), false);
});

test("legacy active palettes start enabled, remembered disabled colors do not, and explicit off wins", async () => {
  for (const master of [undefined, false, true]) {
    const api = createFakeBrowser();
    api.storage.sync.data["themeColor.dark.canvas"] = { enabled: true, color: "#123456" };
    api.storage.sync.data["themeColor.light.canvas"] = { enabled: false, color: "#abcdef" };
    if (master !== undefined) api.storage.sync.data[colorOverridesEnabledKey("dark")] = master;
    const overrides = createThemeOverrides(api, () => {});
    await overrides.ready;
    assert.equal(overrides.isEnabled("dark"), master ?? true);
    assert.equal(overrides.isEnabled("light"), false);
    await overrides.set("dark", "canvas", false, "#123456");
    assert.equal(overrides.isEnabled("dark"), master ?? true);
  }
});

test("master switches sync independently and disabling preserves every individual record across reopening", async () => {
  const api = createFakeBrowser();
  const pages = [createThemeOverrides(api, () => {}), createThemeOverrides(api, () => {})];
  await Promise.all(pages.map(page => page.ready));
  const overrides = pages[0];
  await overrides.set("dark", "canvas", true, "#123456");
  await overrides.set("light", "text", false, "#abcdef");
  await overrides.setEnabled("dark", true);
  for (const page of pages) {
    assert.equal(page.isEnabled("dark"), true);
    assert.equal(page.isEnabled("light"), false);
  }
  await overrides.setEnabled("light", true);
  await overrides.setEnabled("dark", false);
  const reopened = createThemeOverrides(api, () => {});
  await reopened.ready;
  assert.equal(reopened.isEnabled("dark"), false);
  assert.equal(reopened.isEnabled("light"), true);
  assert.deepEqual(api.storage.sync.data, {
    "themeColor.dark.canvas": { enabled: true, color: "#123456" },
    "themeColor.light.text": { enabled: false, color: "#abcdef" },
    "themeColorsEnabled.dark": false,
    "themeColorsEnabled.light": true,
  });
  await reopened.setEnabled("dark", true);
  assert.deepEqual(reopened.get("dark", "canvas"), { enabled: true, color: "#123456" });
  assert.deepEqual(reopened.get("light", "text"), { enabled: false, color: "#abcdef" });
  assert.deepEqual(api.storage.local.data, {});
});

test("incoming sync master changes win over loading snapshots and legacy migration", async () => {
  const api = createFakeBrowser();
  let finishRead;
  api.storage.sync.get = () => new Promise(resolve => { finishRead = resolve; });
  const overrides = createThemeOverrides(api, () => {});
  await api.storage.sync.set({ "themeColorsEnabled.dark": false, "themeColorsEnabled.light": true });
  finishRead({
    "themeColor.dark.canvas": { enabled: true, color: "#123456" },
    "themeColorsEnabled.light": false,
  });
  await overrides.ready;
  assert.equal(overrides.isEnabled("dark"), false);
  assert.equal(overrides.isEnabled("light"), true);
  await overrides.set("dark", "canvas", true, "#abcdef");
  assert.equal(overrides.isEnabled("dark"), false);
  api.storage.onChanged.emit({ "themeColorsEnabled.light": { newValue: false } }, "sync");
  assert.equal(overrides.isEnabled("light"), false);
});

test("failed or invalid master saves preserve the prior enabled state and override records", async () => {
  const api = createFakeBrowser();
  const overrides = createThemeOverrides(api, () => {});
  await overrides.ready;
  await overrides.setEnabled("dark", true);
  await overrides.set("dark", "canvas", true, "#123456");
  await assert.rejects(overrides.setEnabled("unknown", false), /Unknown theme/);
  await assert.rejects(overrides.setEnabled("browser", true), /Unknown theme/);
  await assert.rejects(overrides.setEnabled("dark", "false"), /whether to override colors/);
  api.storage.sync.set = async () => { throw new Error("Sync storage quota exceeded"); };
  await assert.rejects(overrides.setEnabled("dark", false), /quota exceeded/);
  assert.equal(overrides.isEnabled("dark"), true);
  assert.equal(api.storage.sync.data["themeColorsEnabled.dark"], true);
  assert.deepEqual(overrides.get("dark", "canvas"), { enabled: true, color: "#123456" });
});
