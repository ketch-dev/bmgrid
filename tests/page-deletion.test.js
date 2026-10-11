import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkController } from "../bookmarks.js";
import { createFakeBrowser } from "./fake-browser.js";

const URL = "https://math.test/?x=%2F&y=+value#fragment";

async function setup() {
  const api = createFakeBrowser();
  api.tabs.items = [
    { id: 21, windowId: 1, active: true, url: URL },
    { id: 22, windowId: 1, active: false, url: "https://other.test/" },
    { id: 23, windowId: 2, active: true, url: "https://toolbar.test/path?a=1#two" },
  ];
  const controller = createBookmarkController(api);
  await controller.ready;
  const call = (action, details = {}) => controller.handle({ action, ...details });
  const remove = () => call("delete-page-bookmarks", { windowId: 1, tabId: 21, url: URL });
  return { api, controller, call, remove };
}

function contents(node) {
  return { title: node.title, type: node.type, ...(node.url ? { url: node.url } : {}),
    ...(node.children ? { children: node.children.map(contents) } : {}) };
}

test("eligibility uses native confirmation, only the requested window's active page, and the real Other Bookmarks subtree", async () => {
  const { api, call } = await setup();
  await api.bookmarks.create({ parentId: "toolbar_____", type: "bookmark", title: "Outside", url: URL });
  const named = await api.bookmarks.create({ parentId: "menu________", type: "folder", title: "Other Bookmarks" });
  await api.bookmarks.create({ parentId: named.id, type: "bookmark", title: "Same-name folder", url: URL });
  assert.equal(await call("page-bookmarks", { windowId: 1 }), 2);
  assert.equal(await call("page-bookmarks", { windowId: 2 }), 0);
  assert.equal(await call("page-bookmarks", { windowId: 3 }), 0);

  api.bookmarks.search = async query => {
    assert.deepEqual(query, { url: URL });
    return [];
  };
  assert.equal(await call("page-bookmarks", { windowId: 1 }), 0);
});

test("all direct and deeply nested copies are deleted individually, logged, and restored with placement intact", async () => {
  const { api, controller, call, remove } = await setup();
  const nested = await api.bookmarks.create({ parentId: "algebra", type: "folder", title: "Deep" });
  await api.bookmarks.create({ parentId: nested.id, type: "bookmark", title: "Deep saved café", url: URL });
  await api.bookmarks.create({ parentId: "unfiled_____", type: "bookmark", title: "Direct copy", url: URL });
  const outside = await api.bookmarks.create({ parentId: "toolbar_____", type: "bookmark", title: "Outside", url: URL });
  const before = contents(api.find("unfiled_____"));
  assert.equal(await call("page-bookmarks", { windowId: 1 }), 4);
  assert.equal(await remove(), 4);
  await controller.idle();
  assert.equal(await call("page-bookmarks", { windowId: 1 }), 0);
  assert.ok(api.find(outside.id));
  assert.ok(api.find("math"));
  assert.ok(api.find("algebra"));
  assert.ok(api.find(nested.id));
  assert.equal(api.storage.session.data.deletions.length, 4);
  const log = api.storage.local.data.deletionLog;
  assert.deepEqual(new Set(log), new Set(["First", "Second", "Deep saved café", "Direct copy"]
    .map(title => `Deleted: ${title} (${URL})`)));
  assert.equal(await call("log"), log.join("\n\n") + "\n\n");
  for (let count = 1; count <= 4; count++) {
    await call("undo");
    await controller.idle();
    assert.equal(await call("page-bookmarks", { windowId: 1 }), count);
    assert.equal(api.storage.session.data.deletions.length, 4 - count);
  }
  assert.deepEqual(contents(api.find("unfiled_____")), before);
  assert.deepEqual(api.storage.local.data.deletionLog, log);
});

test("different schemes, queries, and fragments survive page deletion", async () => {
  const { api, remove } = await setup();
  const urls = [URL.replace("https:", "http:"), URL.replace("x=%2F", "x=%2E"), URL.replace("#fragment", "#other")];
  const others = await Promise.all(urls.map(url => api.bookmarks.create({
    parentId: "math", type: "bookmark", title: "Distinct", url,
  })));
  assert.equal(await remove(), 2);
  assert.deepEqual(others.map(bookmark => api.find(bookmark.id).url), urls);
});

test("deletion revalidates the page on click and rejects missing or stale window/tab/URL information", async () => {
  const { api, call } = await setup();
  for (const details of [
    { tabId: 21, url: URL },
    { windowId: 1, tabId: 999, url: URL },
    { windowId: 1, tabId: 21, url: "https://old.test/" },
    { windowId: 2, tabId: 21, url: URL },
  ]) {
    await assert.rejects(call("delete-page-bookmarks", details), /window|active page/i);
  }
  assert.ok(api.find("math-a"));
  assert.ok(api.find("math-b"));
  assert.deepEqual(api.storage.session.data.deletions ?? [], []);
});

test("an outside-only page cannot delete a folder or create false history", async () => {
  const { api, call } = await setup();
  const tab = api.tabs.items.find(tab => tab.id === 23);
  await assert.rejects(call("delete-page-bookmarks", { windowId: tab.windowId, tabId: tab.id, url: tab.url }),
    /no bookmarks in Other Bookmarks/);
  assert.ok(api.find("toolbar-link"));
  assert.equal(await call("log"), "");
  assert.deepEqual(api.storage.session.data.deletions ?? [], []);
});

test("copies URL-edited or moved outside after lookup survive without undo snapshots", async () => {
  const { api, controller, remove } = await setup();
  const getSubTree = api.bookmarks.getSubTree;
  let reads = 0;
  api.bookmarks.getSubTree = async id => {
    const tree = await getSubTree(id);
    if (++reads === 1) {
      await api.bookmarks.update("math-a", { url: "https://edited.test/" });
      await api.bookmarks.move("math-b", { parentId: "toolbar_____" });
    }
    return tree;
  };
  assert.equal(await remove(), 0);
  await controller.idle();
  assert.equal(api.find("math-a").url, "https://edited.test/");
  assert.equal(api.find("math-b").parentId, "toolbar_____");
  assert.deepEqual(api.storage.session.data.deletions ?? [], []);
  assert.deepEqual(api.storage.local.data.deletionLog ?? [], []);
});

test("a late ancestor move during snapshot persistence preserves its bookmarks", async () => {
  const { api, controller, remove } = await setup();
  const set = api.storage.session.set;
  let moved = false;
  api.storage.session.set = async values => {
    await set(values);
    if (values.deletions?.length && !moved) {
      moved = true;
      await api.bookmarks.move("math", { parentId: "toolbar_____" });
    }
  };
  assert.equal(await remove(), 0);
  await controller.idle();
  assert.equal(api.find("math").parentId, "toolbar_____");
  assert.ok(api.find("math-a"));
  assert.ok(api.find("math-b"));
  assert.deepEqual(api.storage.session.data.deletions, []);
  assert.deepEqual(api.storage.local.data.deletionLog ?? [], []);
});

test("a URL edit between native search and subtree loading invalidates the earlier match", async () => {
  const { api, controller, remove } = await setup();
  const search = api.bookmarks.search;
  api.bookmarks.search = async query => {
    const found = await search(query);
    await api.bookmarks.update("math-a", { url: "https://edited.test/" });
    return found;
  };
  assert.equal(await remove(), 1);
  await controller.idle();
  assert.equal(api.find("math-a").url, "https://edited.test/");
  assert.equal(api.find("math-b"), null);
  assert.deepEqual(api.storage.local.data.deletionLog, [`Deleted: Second (${URL})`]);
});

test("a copy URL-edited while its undo snapshot is saved survives without a false deletion entry", async () => {
  const { api, controller, remove } = await setup();
  const set = api.storage.session.set;
  let edited = false;
  api.storage.session.set = async values => {
    await set(values);
    if (values.deletions?.at(-1)?.node.id === "math-b" && !edited) {
      edited = true;
      await api.bookmarks.update("math-b", { url: "https://edited.test/" });
    }
  };
  assert.equal(await remove(), 1);
  await controller.idle();
  assert.equal(api.find("math-a"), null);
  assert.equal(api.find("math-b").url, "https://edited.test/");
  assert.equal(api.storage.session.data.deletions.length, 1);
  assert.equal(api.storage.session.data.deletions[0].node.id, "math-a");
  assert.deepEqual(api.storage.local.data.deletionLog, [`Deleted: First (${URL})`]);
});

test("partial native failure preserves successful deletion history and permits retry", async () => {
  const { api, controller, call, remove } = await setup();
  const nativeRemove = api.bookmarks.remove;
  api.bookmarks.remove = async id => {
    if (id === "math-b") throw new Error("Deletion failed.");
    return nativeRemove(id);
  };
  await assert.rejects(remove(), /Deletion failed/);
  await controller.idle();
  assert.equal(api.find("math-a"), null);
  assert.ok(api.find("math-b"));
  assert.equal(api.storage.session.data.deletions.length, 1);
  assert.deepEqual(api.storage.local.data.deletionLog, [`Deleted: First (${URL})`]);
  assert.equal(await call("page-bookmarks", { windowId: 1 }), 1);
  api.bookmarks.remove = nativeRemove;
  assert.equal(await remove(), 1);
  await controller.idle();
  assert.equal(api.storage.session.data.deletions.length, 2);
  assert.equal(api.storage.local.data.deletionLog.length, 2);
});

test("a page that switches during a delayed lookup cannot be deleted", async () => {
  const { api, remove } = await setup();
  const search = api.bookmarks.search;
  api.bookmarks.search = async query => {
    const found = await search(query);
    api.tabs.items[0].active = false;
    api.tabs.items[1].active = true;
    return found;
  };
  await assert.rejects(remove(), /active page changed/);
  assert.ok(api.find("math-a"));
  assert.ok(api.find("math-b"));
});

test("native lookup failures never authorize deletion and later attempts can recover", async () => {
  const { api, call, remove } = await setup();
  const search = api.bookmarks.search;
  api.bookmarks.search = () => { throw new Error("Restricted URL."); };
  await assert.rejects(call("page-bookmarks", { windowId: 1 }), /Restricted URL/);
  await assert.rejects(remove(), /Restricted URL/);
  assert.ok(api.find("math-a"));
  api.bookmarks.search = async () => { throw new Error("Lookup failed."); };
  await assert.rejects(remove(), /Lookup failed/);
  api.bookmarks.search = search;
  assert.equal(await remove(), 2);
});
