import test from "node:test";
import assert from "node:assert/strict";
import { createThemePreference } from "../theme.js";
import { createFakeBrowser } from "./fake-browser.js";

test("missing and unrecognized preferences default to dark without writing storage", async () => {
  for (const stored of [undefined, "system", null]) {
    const api = createFakeBrowser();
    if (stored !== undefined) api.storage.local.data.theme = stored;
    const changes = [];
    const theme = createThemePreference(api, value => changes.push(value));
    await theme.ready;
    assert.equal(theme.value, "dark");
    assert.deepEqual(changes, ["dark"]);
    assert.equal(api.storage.local.data.theme, stored);
  }
});

test("saved theme loads on new pages and changes update every open page", async () => {
  const api = createFakeBrowser();
  api.storage.local.data.theme = "light";
  const changes = [[], []];
  const pages = changes.map(events => createThemePreference(api, value => events.push(value)));
  await Promise.all(pages.map(page => page.ready));
  assert.deepEqual(pages.map(page => page.value), ["light", "light"]);

  await pages[0].set("dark");
  assert.equal(api.storage.local.data.theme, "dark");
  assert.deepEqual(changes, [["light", "dark"], ["light", "dark"]]);
  assert.deepEqual(pages.map(page => page.value), ["dark", "dark"]);

  const reopened = createThemePreference(api, () => {});
  await reopened.ready;
  assert.equal(reopened.value, "dark");
});

test("unrelated and session-storage changes do not affect the theme; removing it restores dark", async () => {
  const api = createFakeBrowser();
  const changes = [];
  const theme = createThemePreference(api, value => changes.push(value));
  await theme.ready;
  await theme.set("light");
  await api.storage.session.set({ theme: "dark" });
  await api.storage.local.set({ deletionLog: [] });
  assert.deepEqual(changes, ["dark", "light"]);
  api.storage.onChanged.emit({ theme: { oldValue: "light" } }, "local");
  assert.equal(theme.value, "dark");
  assert.deepEqual(changes, ["dark", "light", "dark"]);
});

test("a theme change while loading wins over an older storage snapshot", async () => {
  const api = createFakeBrowser();
  let finishRead;
  api.storage.local.get = () => new Promise(resolve => { finishRead = resolve; });
  const changes = [];
  const theme = createThemePreference(api, value => changes.push(value));
  await api.storage.local.set({ theme: "light" });
  finishRead({ theme: "dark" });
  await theme.ready;
  assert.equal(theme.value, "light");
  assert.deepEqual(changes, ["light"]);
});

test("failed saves preserve the active theme and invalid choices are rejected", async () => {
  const api = createFakeBrowser();
  api.storage.local.data.theme = "light";
  const changes = [];
  const theme = createThemePreference(api, value => changes.push(value));
  await theme.ready;
  api.storage.local.set = async () => { throw new Error("Storage unavailable"); };
  await assert.rejects(theme.set("dark"), /Storage unavailable/);
  await assert.rejects(theme.set("system"), /Choose Dark or Light/);
  assert.equal(theme.value, "light");
  assert.equal(api.storage.local.data.theme, "light");
  assert.deepEqual(changes, ["light"]);
});

test("failed loading reveals the default theme and still permits a later save", async () => {
  const api = createFakeBrowser();
  api.storage.local.get = async () => { throw new Error("Storage unavailable"); };
  const changes = [];
  const theme = createThemePreference(api, value => changes.push(value));
  await assert.rejects(theme.ready, /Storage unavailable/);
  assert.equal(theme.value, "dark");
  assert.deepEqual(changes, ["dark"]);
  await theme.set("light");
  assert.equal(theme.value, "light");
});
