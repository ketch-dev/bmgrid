import test from "node:test";
import assert from "node:assert/strict";
import { startToolbarIconBackground } from "../toolbar-icon.js";

function event() {
  const listeners = new Set();
  return {
    addListener: listener => listeners.add(listener),
    emit: (...args) => { for (const listener of listeners) listener(...args); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(themes = [{}]) {
  const windows = themes.map((theme, index) => ({ id: index + 1, type: "normal", theme }));
  const icons = new Map();
  const filled = new Map();
  const calls = [];
  const rendered = [];
  const api = {
    windows: {
      onCreated: event(), onRemoved: event(),
      async getAll() { return windows.filter(window => window.type === "normal"); },
    },
    theme: {
      onUpdated: event(),
      async getCurrent(id) {
        const window = windows.find(window => window.id === id);
        if (!window) throw new Error("Window closed.");
        return structuredClone(window.theme);
      },
    },
    tabs: {
      items: windows.map(window => ({ id: 100 + window.id, windowId: window.id, active: true, url: "about:blank" })),
      onActivated: event(), onUpdated: event(), onCreated: event(), onRemoved: event(),
      onAttached: event(), onDetached: event(),
      async query({ windowId, active }) {
        return structuredClone(api.tabs.items.filter(tab => tab.windowId === windowId && tab.active === active));
      },
    },
    bookmarks: {
      items: [], searches: [],
      folders: [
        { id: "root________", type: "folder" },
        { id: "toolbar_____", type: "folder", parentId: "root________" },
        { id: "menu________", type: "folder", parentId: "root________" },
        { id: "unfiled_____", type: "folder", parentId: "root________", title: "Localized built-in name" },
      ],
      onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event(),
      async search({ url }) {
        api.bookmarks.searches.push(url);
        return structuredClone(api.bookmarks.items.filter(bookmark => bookmark.url === url));
      },
      async get(id) {
        const node = [...api.bookmarks.folders, ...api.bookmarks.items].find(node => node.id === id);
        if (!node) throw new Error("Bookmark not found.");
        return [structuredClone(node)];
      },
    },
    action: {
      async setIcon(details) {
        calls.push(details);
        if (details.imageData) icons.set(details.windowId, details.imageData[16].color);
        else icons.delete(details.windowId);
        filled.set(details.windowId, details.imageData?.[16].filled ?? details.path === "toolbar-icon-filled.svg");
      },
    },
  };
  const render = async (color, filled = false) => {
    rendered.push(color);
    return Object.fromEntries([16, 32, 64].map(size => [size, { color, filled, width: size, height: size }]));
  };
  function update(id, theme) {
    windows.find(window => window.id === id).theme = theme;
    api.theme.onUpdated.emit({ windowId: id, theme });
  }
  return { api, windows, icons, filled, calls, rendered, render, update };
}

test("startup matches each window's toolbar color with Firefox's icon/text precedence", async () => {
  const { api, render, icons, calls } = fixture([
    { colors: { icons: "#DDDDDD", toolbar_text: "#eeeeee", bookmark_text: "#ffffff" } },
    { colors: { toolbar_text: "#123456", bookmark_text: "#ffffff" } },
    { colors: { bookmark_text: "#654321" } },
    { colors: { icons: [221, 221, 221] } },
    { colors: { icons: " ", toolbar_text: "rgb(50, 60, 70)" } },
  ]);
  await startToolbarIconBackground(api, render).ready;
  assert.deepEqual([...icons.values()], ["#DDDDDD", "#123456", "#654321", "rgb(221, 221, 221)", "rgb(50, 60, 70)"]);
  assert.deepEqual(Object.keys(calls[0].imageData), ["16", "32", "64"]);
  assert.ok(calls.every(call => call.windowId !== undefined && call.tabId === undefined));
});

test("theme changes recolor only the affected window and identical colors avoid redundant work", async () => {
  const { api, render, icons, rendered, update } = fixture([
    { colors: { toolbar_text: "#DDDDDD" } },
    { colors: { icons: "#123456" } },
  ]);
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  update(1, { colors: { icons: "#aabbcc" } });
  await controller.idle();
  assert.equal(icons.get(1), "#aabbcc");
  assert.equal(icons.get(2), "#123456");
  update(1, { colors: { toolbar_text: "#aabbcc", toolbar: "#ffffff" } });
  await controller.idle();
  assert.equal(rendered.length, 3);
});

test("global updates read effective themes for all normal windows, including per-window overrides", async () => {
  const { api, render, icons, windows } = fixture([
    { colors: { toolbar_text: "#DDDDDD" } },
    { colors: { icons: "#123456" } },
  ]);
  windows.push({ id: 3, type: "popup", theme: { colors: { icons: "#ffffff" } } });
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  windows[0].theme = { colors: { toolbar_text: "#aabbcc" } };
  api.theme.onUpdated.emit({ theme: windows[0].theme });
  await controller.idle();
  assert.deepEqual([...icons], [[1, "#aabbcc"], [2, "#123456"]]);
});

test("empty or missing theme colors restore native light/dark fallback selection", async () => {
  const { api, render, icons, calls, update } = fixture([{ colors: { icons: "#DDDDDD" } }, {}]);
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  assert.deepEqual(calls.find(call => call.windowId === 2), { windowId: 2 });
  update(1, {});
  await controller.idle();
  assert.equal(icons.has(1), false);
  assert.deepEqual(calls.at(-1), { windowId: 1 });
  update(1, { colors: { icons: null, toolbar_text: "", bookmark_text: [] } });
  await controller.idle();
  assert.equal(calls.length, 3);
});

test("new windows pick up their own theme and closing during a read prevents a stale icon write", async () => {
  const { api, render, icons, windows, calls } = fixture();
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  const window = { id: 2, type: "normal", theme: { colors: { icons: "#DDDDDD" } } };
  windows.push(window);
  api.windows.onCreated.emit(window);
  await controller.idle();
  assert.equal(icons.get(2), "#DDDDDD");

  const reading = deferred();
  const started = deferred();
  api.theme.getCurrent = async () => { started.resolve(); return reading.promise; };
  api.theme.onUpdated.emit({ windowId: 2, theme: {} });
  await started.promise;
  api.windows.onRemoved.emit(2);
  reading.resolve({ colors: { icons: "#ffffff" } });
  await controller.idle();
  assert.equal(calls.length, 2);
});

test("a newer theme supersedes a delayed startup read", async () => {
  const { api, render, icons, update, calls } = fixture([{ colors: { icons: "#111111" } }]);
  const reading = deferred();
  const started = deferred();
  const getCurrent = api.theme.getCurrent;
  api.theme.getCurrent = async id => {
    api.theme.getCurrent = getCurrent;
    started.resolve();
    return reading.promise;
  };
  const controller = startToolbarIconBackground(api, render);
  await started.promise;
  update(1, { colors: { icons: "#DDDDDD" } });
  reading.resolve({ colors: { icons: "#111111" } });
  await controller.idle();
  assert.equal(icons.get(1), "#DDDDDD");
  assert.equal(calls.at(-1).imageData[16].color, "#DDDDDD");
});

test("theme removal supersedes an in-progress colored render", async () => {
  const { api, icons, update, calls } = fixture([{ colors: { icons: "#DDDDDD" } }]);
  const rendering = deferred();
  const started = deferred();
  const controller = startToolbarIconBackground(api, async () => {
    started.resolve();
    return rendering.promise;
  });
  await started.promise;
  update(1, {});
  rendering.resolve({ 16: { color: "#DDDDDD" } });
  await controller.idle();
  assert.equal(icons.size, 0);
  assert.deepEqual(calls.at(-1), { windowId: 1 });
});

test("a slow icon write cannot overwrite the newer theme", async () => {
  const { api, render, icons, update, calls } = fixture([{ colors: { icons: "#111111" } }]);
  const writing = deferred();
  const started = deferred();
  const setIcon = api.action.setIcon;
  api.action.setIcon = async details => {
    api.action.setIcon = setIcon;
    started.resolve();
    await writing.promise;
    await setIcon(details);
  };
  const controller = startToolbarIconBackground(api, render);
  await started.promise;
  update(1, { colors: { icons: "#DDDDDD" } });
  writing.resolve();
  await controller.idle();
  assert.equal(icons.get(1), "#DDDDDD");
  assert.equal(calls.length, 2);
});

test("a failed render preserves the current icon and later events can retry", async t => {
  const { api, render, icons, update } = fixture([{ colors: { icons: "#111111" } }]);
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  let fail = false;
  const controller = startToolbarIconBackground(api, color => {
    if (fail) throw new Error("Render failed.");
    return render(color);
  });
  await controller.ready;
  fail = true;
  update(1, { colors: { icons: "#DDDDDD" } });
  await controller.idle();
  assert.equal(icons.get(1), "#111111");
  assert.equal(errors.length, 1);
  fail = false;
  update(1, { colors: { icons: "#DDDDDD" } });
  await controller.idle();
  assert.equal(icons.get(1), "#DDDDDD");
});

test("only active pages saved directly or deeply inside the built-in Other Bookmarks subtree fill the ribbon", async () => {
  const { api, render, filled, calls } = fixture(Array(7).fill({ colors: { icons: "#DDDDDD" } }));
  api.bookmarks.folders.push(
    { id: "top", type: "folder", parentId: "unfiled_____" },
    { id: "middle", type: "folder", parentId: "top" },
    { id: "deep", type: "folder", parentId: "middle" },
    { id: "outside", type: "folder", parentId: "toolbar_____" },
    { id: "same-name", type: "folder", parentId: "menu________", title: "Other Bookmarks" },
  );
  const parents = ["toolbar_____", "menu________", "unfiled_____", "deep", "outside", "same-name"];
  for (const [index, parentId] of parents.entries()) {
    const url = `https://saved.test/page-${index}?q=%2F#fragment`;
    api.tabs.items[index].url = url;
    api.bookmarks.items.push({ id: `saved-${index}`, type: "bookmark", parentId, url });
  }
  api.tabs.items.push({ id: 999, windowId: 7, active: false, url: api.tabs.items[2].url });
  await startToolbarIconBackground(api, render).ready;
  assert.deepEqual([...filled], [[1, false], [2, false], [3, true], [4, true], [5, false], [6, false], [7, false]]);
  assert.deepEqual(api.bookmarks.searches, api.tabs.items.slice(0, 7).map(tab => tab.url));
  assert.ok(calls.every(call => call.imageData[16].color === "#DDDDDD"));
  for (const size of [16, 32, 64]) assert.equal(calls[2].imageData[size].filled, true);
});

test("native URL lookup results are authoritative without an independent URL comparison", async () => {
  const { api, render, filled } = fixture();
  api.tabs.items[0].url = "https://native.test";
  api.bookmarks.search = async query => {
    assert.deepEqual(query, { url: "https://native.test" });
    return [{ id: "saved", type: "bookmark", parentId: "unfiled_____", url: "https://native.test/" }];
  };
  await startToolbarIconBackground(api, render).ready;
  assert.equal(filled.get(1), true);
});

test("bookmark creation, URL edits, duplicate removal, and recursive deletion update the icon live", async () => {
  const { api, render, filled, calls } = fixture([{ colors: { icons: "#DDDDDD" } }]);
  const tab = api.tabs.items[0];
  tab.url = "https://saved.test/page";
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  assert.equal(filled.get(1), false);

  const bookmark = { id: "first", type: "bookmark", url: tab.url, parentId: "unfiled_____" };
  api.bookmarks.items.push(bookmark);
  api.bookmarks.onCreated.emit(bookmark.id, bookmark);
  await controller.idle();
  assert.equal(filled.get(1), true);

  bookmark.url = "https://other.test/";
  api.bookmarks.onChanged.emit(bookmark.id, { url: bookmark.url });
  await controller.idle();
  assert.equal(filled.get(1), false);
  bookmark.url = tab.url;
  api.bookmarks.onChanged.emit(bookmark.id, { url: tab.url });
  await controller.idle();
  assert.equal(filled.get(1), true);

  api.bookmarks.folders.push({ id: "nested", type: "folder", parentId: "unfiled_____" });
  api.bookmarks.items.push({ id: "duplicate", type: "bookmark", url: tab.url, parentId: "nested" });
  api.bookmarks.items.push({ id: "outside", type: "bookmark", url: tab.url, parentId: "toolbar_____" });
  api.bookmarks.items.shift();
  api.bookmarks.onRemoved.emit(bookmark.id, { node: bookmark });
  await controller.idle();
  assert.equal(filled.get(1), true);
  assert.equal(calls.length, 4);
  api.bookmarks.items = api.bookmarks.items.filter(bookmark => bookmark.id === "outside");
  api.bookmarks.onRemoved.emit("parent-folder", { node: { type: "folder" } });
  await controller.idle();
  assert.equal(filled.get(1), false);
});

test("tab activation and URL changes preserve distinct schemes, paths, queries, and fragments", async () => {
  const { api, render, filled } = fixture([{ colors: { toolbar_text: "#DDDDDD" } }]);
  const saved = "https://saved.test/path?q=one#first";
  api.bookmarks.items.push({ id: "saved", type: "bookmark", parentId: "unfiled_____", url: saved });
  const tab = { id: 102, windowId: 1, active: false, url: saved };
  api.tabs.items.push(tab);
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  assert.equal(filled.get(1), false);
  api.tabs.items[0].active = false;
  tab.active = true;
  api.tabs.onActivated.emit({ tabId: tab.id, windowId: 1 });
  await controller.idle();
  assert.equal(filled.get(1), true);
  for (const url of ["http://saved.test/path?q=one#first", "https://saved.test/other?q=one#first",
    "https://saved.test/path?q=two#first", "https://saved.test/path?q=one#second", saved]) {
    tab.url = url;
    api.tabs.onUpdated.emit(tab.id, { url }, tab);
    await controller.idle();
    assert.equal(filled.get(1), url === saved);
  }
});

test("tab creation, removal, and transfers update the appropriate windows", async () => {
  const { api, render, filled } = fixture(Array(2).fill({ colors: { icons: "#DDDDDD" } }));
  const url = "https://saved.test/";
  api.bookmarks.items.push({ id: "saved", type: "bookmark", parentId: "unfiled_____", url });
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  const tab = { id: 200, windowId: 1, active: true, url };
  api.tabs.items[0].active = false;
  api.tabs.items.push(tab);
  api.tabs.onCreated.emit(tab);
  await controller.idle();
  assert.equal(filled.get(1), true);

  tab.windowId = 2;
  api.tabs.items[0].active = true;
  api.tabs.items[1].active = false;
  api.tabs.onDetached.emit(tab.id, { oldWindowId: 1 });
  api.tabs.onAttached.emit(tab.id, { newWindowId: 2 });
  await controller.idle();
  assert.deepEqual([...filled], [[1, false], [2, true]]);

  api.tabs.items.pop();
  api.tabs.items[1].active = true;
  api.tabs.onRemoved.emit(tab.id, { windowId: 2, isWindowClosing: false });
  await controller.idle();
  assert.equal(filled.get(2), false);
});

test("both synchronous API refusals and asynchronous failures clear a filled state and allow retries", async () => {
  const { api, render, filled } = fixture([{ colors: { icons: "#DDDDDD" } }]);
  api.tabs.items[0].url = "https://saved.test/";
  api.bookmarks.items.push({ id: "saved", type: "bookmark", parentId: "unfiled_____", url: api.tabs.items[0].url });
  const search = api.bookmarks.search;
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  for (const refusal of [() => { throw new Error("Restricted URL."); }, async () => { throw new Error("Lookup failed."); }]) {
    assert.equal(filled.get(1), true);
    api.bookmarks.search = refusal;
    api.bookmarks.onRemoved.emit("unrelated", { node: { type: "bookmark" } });
    await controller.idle();
    assert.equal(filled.get(1), false);
    api.bookmarks.search = search;
    const tab = api.tabs.items[0];
    api.tabs.onUpdated.emit(tab.id, { status: "complete" }, tab);
    await controller.idle();
    assert.equal(filled.get(1), true);
  }
});

test("a delayed saved-page lookup cannot paint the icon for a newly active tab", async () => {
  const { api, render, filled, calls } = fixture([{ colors: { icons: "#DDDDDD" } }]);
  const tab = api.tabs.items[0];
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  const reading = deferred();
  const started = deferred();
  const search = api.bookmarks.search;
  api.bookmarks.search = async () => {
    api.bookmarks.search = search;
    started.resolve();
    return reading.promise;
  };
  tab.url = "https://saved.test/";
  api.tabs.onUpdated.emit(tab.id, { url: tab.url }, tab);
  await started.promise;
  tab.active = false;
  api.tabs.items.push({ id: 200, windowId: 1, active: true, url: "https://unsaved.test/" });
  api.tabs.onActivated.emit({ tabId: 200, windowId: 1 });
  reading.resolve([{ id: "saved", type: "bookmark", parentId: "unfiled_____", url: tab.url }]);
  await controller.idle();
  assert.equal(filled.get(1), false);
  assert.equal(calls.length, 1);
});

test("navigation during a render rejects the old filled icon before writing", async () => {
  const { api, render, filled, calls } = fixture([{ colors: { icons: "#DDDDDD" } }]);
  const rendering = deferred();
  const started = deferred();
  let pause = false;
  const controller = startToolbarIconBackground(api, async (color, filled) => {
    const result = await render(color, filled);
    if (pause) { started.resolve(); await rendering.promise; }
    return result;
  });
  await controller.ready;
  const tab = api.tabs.items[0];
  const bookmark = { id: "saved", type: "bookmark", parentId: "unfiled_____", url: "https://saved.test/" };
  api.bookmarks.items.push(bookmark);
  tab.url = bookmark.url;
  pause = true;
  api.tabs.onUpdated.emit(tab.id, { url: tab.url }, tab);
  await started.promise;
  tab.url = "https://unsaved.test/";
  api.tabs.onUpdated.emit(tab.id, { url: tab.url }, tab);
  rendering.resolve();
  await controller.idle();
  assert.equal(filled.get(1), false);
  assert.equal(calls.length, 1);
});

test("saved pages with no exposed theme color use an adaptive filled fallback", async () => {
  const { api, render, filled, calls, update } = fixture();
  api.tabs.items[0].url = "https://saved.test/";
  api.bookmarks.items.push({ id: "saved", type: "bookmark", parentId: "unfiled_____", url: api.tabs.items[0].url });
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  assert.deepEqual(calls, [{ windowId: 1, path: "toolbar-icon-filled.svg" }]);
  assert.equal(filled.get(1), true);
  update(1, { colors: { toolbar_text: "#DDDDDD" } });
  await controller.idle();
  assert.equal(calls.at(-1).imageData[32].filled, true);
  update(1, {});
  await controller.idle();
  assert.equal(calls.at(-1).path, "toolbar-icon-filled.svg");
  api.bookmarks.items.length = 0;
  api.bookmarks.onRemoved.emit("saved", { node: { type: "bookmark" } });
  await controller.idle();
  assert.deepEqual(calls.at(-1), { windowId: 1 });
  assert.equal(filled.get(1), false);
});

test("background tab updates and bookmark-title edits avoid unnecessary lookups", async () => {
  const { api, render } = fixture();
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  const searches = api.bookmarks.searches.length;
  api.tabs.onUpdated.emit(200, { url: "https://background.test/" }, { active: false, windowId: 1 });
  api.bookmarks.onChanged.emit("saved", { title: "New title" });
  await controller.idle();
  assert.equal(api.bookmarks.searches.length, searches);
});

test("bookmark moves and ancestor-folder moves update subtree membership live", async () => {
  const { api, render, filled } = fixture([{ colors: { icons: "#DDDDDD" } }]);
  const url = "https://saved.test/";
  api.tabs.items[0].url = url;
  const top = { id: "top", type: "folder", parentId: "unfiled_____" };
  api.bookmarks.folders.push(top, { id: "deep", type: "folder", parentId: top.id });
  const bookmark = { id: "saved", type: "bookmark", url, parentId: "unfiled_____" };
  api.bookmarks.items.push(bookmark);
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  assert.equal(filled.get(1), true);
  for (const parentId of ["menu________", "deep"]) {
    bookmark.parentId = parentId;
    api.bookmarks.onMoved.emit(bookmark.id, { parentId });
    await controller.idle();
    assert.equal(filled.get(1), parentId === "deep");
  }
  for (const parentId of ["toolbar_____", "unfiled_____"]) {
    top.parentId = parentId;
    api.bookmarks.onMoved.emit(top.id, { parentId });
    await controller.idle();
    assert.equal(filled.get(1), parentId === "unfiled_____");
  }
});

test("a failed ancestor lookup cannot suppress another valid copy, and later ancestor failures clear stale fill", async () => {
  const { api, render, filled } = fixture();
  const url = "https://saved.test/";
  api.tabs.items[0].url = url;
  api.bookmarks.folders.push({ id: "nested", type: "folder", parentId: "unfiled_____" });
  api.bookmarks.items.push(
    { id: "unavailable", type: "bookmark", url, parentId: "missing-parent" },
    { id: "outside", type: "bookmark", url, parentId: "toolbar_____" },
    { id: "inside", type: "bookmark", url, parentId: "nested" },
  );
  const controller = startToolbarIconBackground(api, render);
  await controller.ready;
  assert.equal(filled.get(1), true);

  const get = api.bookmarks.get;
  api.bookmarks.get = async id => {
    if (id === "nested") throw new Error("Ancestor unavailable.");
    return get(id);
  };
  api.bookmarks.onMoved.emit("nested", { parentId: "unfiled_____" });
  await controller.idle();
  assert.equal(filled.get(1), false);
  api.bookmarks.get = get;
  api.bookmarks.onMoved.emit("nested", { parentId: "unfiled_____" });
  await controller.idle();
  assert.equal(filled.get(1), true);
});
