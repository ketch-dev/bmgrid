import test from "node:test";
import assert from "node:assert/strict";
import { createOpenTabs } from "../open-tabs.js";
import { createFakeBrowser } from "./fake-browser.js";

const URL_A = "https://site.test/a?encoded=%2F&space=+value#fragment";
const URL_B = "https://site.test/b";
const tab = (id, url, index = id, windowId = 1) => ({ id, url, index, windowId });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("highlights only full URLs in the grid's window, including browser root-slash normalization", async () => {
  const api = createFakeBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B, 0, 2), tab(3, "https://root.test/")];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(open.has(URL_A), true);
  assert.equal(open.has("https://root.test"), true);
  for (const url of [URL_B, URL_A.replace("https:", "http:"),
    URL_A.replace("/a?", "/b?"), URL_A.replace("%2F", "/"),
    URL_A.replace("+value", "%20value"), URL_A.replace("#fragment", "#other"),
    URL_A.split("#")[0], "invalid URL", undefined]) {
    assert.equal(open.has(url), false, url);
  }
});

test("activation chooses the first matching tab in native order and only sets active", async () => {
  const api = createFakeBrowser();
  api.tabs.items = [tab(3, URL_A, 4), tab(2, URL_A, 2), tab(1, URL_A, 0, 2)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(await open.activate(URL_A), true);
  assert.deepEqual(api.tabs.updates, [{ id: 2, changes: { active: true } }]);
  api.tabs.items[0].index = 0;
  api.tabs.onMoved.emit(3, { windowId: 1, fromIndex: 4, toIndex: 0 });
  await settle();
  assert.equal(await open.activate(URL_A), true);
  assert.equal(api.tabs.updates.at(-1).id, 3);
  assert.equal(await open.activate(URL_B), false);
});

test("opening, navigation, removal, and window transfers update highlights live", async () => {
  const api = createFakeBrowser();
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await open.ready;
  api.tabs.items.push(tab(1, URL_A));
  api.tabs.onCreated.emit(api.tabs.items[0]);
  await settle();
  assert.equal(open.has(URL_A), true);

  api.tabs.items[0].url = URL_B;
  api.tabs.onUpdated.emit(1, { url: URL_B }, api.tabs.items[0]);
  await settle();
  assert.equal(open.has(URL_A), false);
  assert.equal(open.has(URL_B), true);

  api.tabs.items[0].windowId = 2;
  api.tabs.onDetached.emit(1, { oldWindowId: 1, oldPosition: 0 });
  await settle();
  assert.equal(open.has(URL_B), false);
  api.tabs.items[0].windowId = 1;
  api.tabs.onAttached.emit(1, { newWindowId: 1, newPosition: 0 });
  await settle();
  assert.equal(open.has(URL_B), true);

  api.tabs.items = [];
  api.tabs.onRemoved.emit(1, { windowId: 1, isWindowClosing: false });
  await settle();
  assert.equal(open.has(URL_B), false);
  assert.equal(changes, 6);
});

test("moving the grid itself changes its tracked window", async () => {
  const api = createFakeBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B, 0, 2)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  api.tabs.current.windowId = 2;
  api.tabs.onAttached.emit(0, { newWindowId: 2, newPosition: 1 });
  await settle();
  assert.equal(open.has(URL_A), false);
  assert.equal(open.has(URL_B), true);
  assert.equal(await open.activate(URL_A), false);
  assert.equal(await open.activate(URL_B), true);
  assert.equal(api.tabs.updates[0].id, 2);
});

test("click-time queries detect newly opened, closed, navigated, or transferred tabs before events arrive", async () => {
  const api = createFakeBrowser();
  const open = createOpenTabs(api, () => {});
  await open.ready;
  api.tabs.items = [tab(1, URL_A)];
  assert.equal(open.has(URL_A), false);
  assert.equal(await open.activate(URL_A), true);
  api.tabs.items[0].url = URL_B;
  assert.equal(await open.activate(URL_A), false);
  api.tabs.items[0].windowId = 2;
  assert.equal(await open.activate(URL_B), false);
  api.tabs.items = [];
  assert.equal(await open.activate(URL_B), false);
  assert.equal(api.tabs.updates.length, 1);
});

test("a closed activation target falls back to another match or normal navigation", async () => {
  for (const duplicate of [false, true]) {
    const api = createFakeBrowser();
    api.tabs.items = [tab(1, URL_A), ...(duplicate ? [tab(2, URL_A)] : [])];
    const update = api.tabs.update;
    api.tabs.update = async (id, changes) => {
      if (id === 1) {
        api.tabs.items.shift();
        throw new Error("Tab closed");
      }
      return update(id, changes);
    };
    const open = createOpenTabs(api, () => {});
    await open.ready;
    assert.equal(await open.activate(URL_A), duplicate);
    assert.deepEqual(api.tabs.updates, duplicate ? [{ id: 2, changes: { active: true } }] : []);
  }
});

test("real activation errors are exposed rather than causing duplicate navigation", async () => {
  const api = createFakeBrowser();
  api.tabs.items = [tab(1, URL_A)];
  api.tabs.update = async () => { throw new Error("Permission failure"); };
  const open = createOpenTabs(api, () => {});
  await open.ready;
  await assert.rejects(open.activate(URL_A), /Permission failure/);
});

test("late startup and overlapping query results never overwrite newer highlights", async () => {
  const api = createFakeBrowser();
  const queries = [];
  api.tabs.query = () => new Promise(resolve => { queries.push(resolve); });
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await settle();
  api.tabs.onCreated.emit(tab(2, URL_B));
  await settle();
  queries[1]([tab(2, URL_B)]);
  await settle();
  queries[0]([tab(1, URL_A)]);
  await open.ready;
  assert.equal(open.has(URL_A), false);
  assert.equal(open.has(URL_B), true);
  assert.equal(changes, 1);
});

test("unrelated title and favicon events do not refresh the tab list", async () => {
  const api = createFakeBrowser();
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await open.ready;
  api.tabs.onUpdated.emit(1, { title: "Changed", favIconUrl: "icon.svg" }, tab(1, URL_A));
  await settle();
  assert.equal(changes, 1);
});
