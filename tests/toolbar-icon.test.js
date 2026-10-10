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
    action: {
      async setIcon(details) {
        calls.push(details);
        if (details.imageData) icons.set(details.windowId, details.imageData[16].color);
        else icons.delete(details.windowId);
      },
    },
  };
  const render = async color => {
    rendered.push(color);
    return Object.fromEntries([16, 32, 64].map(size => [size, { color, width: size, height: size }]));
  };
  function update(id, theme) {
    windows.find(window => window.id === id).theme = theme;
    api.theme.onUpdated.emit({ windowId: id, theme });
  }
  return { api, windows, icons, calls, rendered, render, update };
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
