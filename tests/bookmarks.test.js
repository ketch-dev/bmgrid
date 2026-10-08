import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkController, deletionMessage } from "../bookmarks.js";
import { createFakeBrowser } from "./fake-browser.js";

async function setup() {
  const api = createFakeBrowser();
  const controller = createBookmarkController(api);
  await controller.ready;
  return { api, controller, call: (action, details = {}) => controller.handle({ action, ...details }) };
}

test("only Other Bookmarks is exposed and native sibling ordering is retained", async () => {
  const { call } = await setup();
  const tree = await call("tree");
  assert.equal(tree.id, "unfiled_____");
  assert.deepEqual(tree.children.map(node => node.id), ["math", "direct-a", "physics", "direct-b"]);
});

test("name-only editing renames native folders without modifying their contents or outside items", async () => {
  const { api, call } = await setup();
  const original = structuredClone(api.find("math"));
  await call("edit", { id: "math", title: "A renamed folder" });
  assert.deepEqual(api.find("math"), { ...original, title: "A renamed folder" });
  await call("edit", { id: "algebra", title: "A renamed nested folder" });
  assert.equal(api.find("algebra").title, "A renamed nested folder");
  await assert.rejects(call("edit", { id: "toolbar-link", title: "Wrong" }));
  await assert.rejects(call("delete", { id: "unfiled_____" }));
  assert.equal(api.find("toolbar-link").title, "Toolbar link");
});

test("editing updates the native name and exact URL, retaining placement and deletion history", async () => {
  const { api, controller, call } = await setup();
  const original = structuredClone(api.find("algebra-a"));
  const title = "Edited bookmark";
  const url = "https://edited.test/path_(item)?x=%2F&value=+text#fragment";
  await call("edit", { id: original.id, title, url });
  await controller.idle();
  assert.deepEqual(api.find(original.id), { ...original, title, url });
  const cached = api.storage.session.data.bookmarkCache.find(node => node.id === original.id);
  assert.equal(cached.title, title);
  assert.equal(cached.url, url);
  await call("delete", { id: "math" });
  await controller.idle();
  assert.match(await call("log"), /Edited bookmark \(https:\/\/edited\.test\/path_\(item\)\?x=%2F&value=\+text#fragment\)/);
  await call("undo");
  const restored = (await call("tree")).children[0].children[1].children[0];
  assert.equal(restored.title, title);
  assert.equal(restored.url, url);
});

test("name-only and URL-only edits preserve the other field, including non-web URLs", async () => {
  const { api, call } = await setup();
  const url = api.find("direct-a").url;
  await call("edit", { id: "direct-a", title: "" });
  assert.equal(api.find("direct-a").title, "");
  assert.equal(api.find("direct-a").url, url);
  await call("edit", { id: "direct-a", url: "about:blank" });
  assert.equal(api.find("direct-a").title, "");
  assert.equal(api.find("direct-a").url, "about:blank");
});

test("URL editing defaults bare addresses to HTTPS and preserves explicit URLs", async () => {
  const { api, call } = await setup();
  for (const [input, expected] of [
    ["yandex.by", "https://yandex.by"],
    ["  yandex.by/path?x=%2F&value=+text#fragment  ", "https://yandex.by/path?x=%2F&value=+text#fragment"],
    ["example.test:8443/path", "https://example.test:8443/path"],
    ["localhost:8080/path", "https://localhost:8080/path"],
    ["127.0.0.1:8080/path", "https://127.0.0.1:8080/path"],
    ["[::1]:8080/path", "https://[::1]:8080/path"],
    ["//yandex.by/path", "https://yandex.by/path"],
    ["http://yandex.by/path?x=%2f&value=+#fragment", "http://yandex.by/path?x=%2f&value=+#fragment"],
    ["https://yandex.by", "https://yandex.by"],
    ["about:blank", "about:blank"],
    ["mailto:person@example.test", "mailto:person@example.test"],
    ["file:///tmp/bookmark.html", "file:///tmp/bookmark.html"],
    ["custom:123", "custom:123"],
  ]) {
    await call("edit", { id: "direct-a", url: input });
    assert.equal(api.find("direct-a").url, expected);
    assert.equal(api.find("direct-a").title, "Direct A");
  }
});

test("malformed edited URLs produce readable errors before updating either field", async () => {
  const { api, call } = await setup();
  const before = await call("tree");
  let updates = 0;
  api.bookmarks.update = async () => { updates++; };
  for (const url of ["", "  ", "not a valid URL", "https://", "https://[invalid]", "yandex.by:99999/path"]) {
    await assert.rejects(call("edit", { id: "direct-a", title: "Unsaved name", url }),
      /Enter a valid URL, such as https:\/\/example\.com\./);
  }
  assert.equal(updates, 0);
  assert.deepEqual(await call("tree"), before);
});

test("native invalid-bookmark errors are readable while other failures remain specific", async () => {
  const { api, call } = await setup();
  api.bookmarks.update = async () => {
    throw new Error('Invalid bookmark: {"guid":"example","url":"https://example.test"}');
  };
  await assert.rejects(call("edit", { id: "direct-a", url: "example.test" }),
    /^Error: Enter a valid URL, such as https:\/\/example\.com\.$/);
  api.bookmarks.update = async () => { throw new Error("Bookmark not found"); };
  await assert.rejects(call("edit", { id: "direct-a", url: "example.test" }), /Bookmark not found/);
});

test("invalid edits and native update failures leave bookmarks intact and later edits work", async () => {
  const { api, call } = await setup();
  const before = await call("tree");
  for (const details of [
    { id: "toolbar-link", title: "Wrong", url: "https://wrong.test/" },
    { id: "unfiled_____", title: "Wrong" },
    { id: "math", url: "https://wrong.test/" },
    { id: "math", title: "Wrong", url: "https://wrong.test/" },
    { id: "separator", title: "Wrong" },
    { id: "missing", title: "Wrong" },
    { id: "direct-a", title: 42 },
    { id: "direct-a", title: "Wrong", url: null },
    { id: "direct-a" },
  ]) {
    await assert.rejects(call("edit", details));
  }
  const update = api.bookmarks.update;
  api.bookmarks.update = async () => { throw new Error("Invalid native URL"); };
  await assert.rejects(call("edit", { id: "direct-a", title: "Wrong", url: "invalid" }), /Invalid native URL/);
  assert.deepEqual(await call("tree"), before);
  assert.equal(api.find("toolbar-link").title, "Toolbar link");
  api.bookmarks.update = update;
  await call("edit", { id: "direct-a", url: "https://corrected.test/" });
  assert.equal(api.find("direct-a").url, "https://corrected.test/");
  assert.equal(await call("log"), "");
});

test("moves use real sibling indices with interleaved direct bookmarks and folders", async () => {
  const { api, call } = await setup();
  await call("move", { id: "math", destination: { parentId: "unfiled_____", anchorId: "physics", position: "after" } });
  assert.deepEqual(api.find("unfiled_____").children.map(node => node.id), ["direct-a", "physics", "math", "direct-b"]);
  await call("move", { id: "math", destination: { parentId: "unfiled_____", anchorId: "physics", position: "before" } });
  assert.deepEqual(api.find("unfiled_____").children.map(node => node.id), ["direct-a", "math", "physics", "direct-b"]);
});

test("bookmarks move in both directions between root, folders, and nested folders", async () => {
  const { api, call } = await setup();
  await call("move", { id: "direct-a", destination: { parentId: "algebra", anchorId: "algebra-a", position: "before" } });
  assert.deepEqual(api.find("algebra").children.map(node => node.id), ["direct-a", "algebra-a"]);
  await call("move", { id: "math-a", destination: { parentId: "physics" } });
  assert.deepEqual(api.find("physics").children.map(node => node.id), ["physics-a", "math-a"]);
  await call("move", { id: "direct-a", destination: { parentId: "unfiled_____" } });
  assert.equal(api.find("direct-a").parentId, "unfiled_____");
});

test("folders nest with their existing descendants and can move back to the root", async () => {
  const { api, controller, call } = await setup();
  await call("move", { id: "math", destination: { parentId: "physics" } });
  assert.deepEqual(api.find("physics").children.map(node => node.id), ["physics-a", "math"]);
  assert.equal(api.find("math").parentId, "physics");
  assert.equal(api.find("algebra-a").parentId, "algebra");
  await controller.idle();
  assert.equal(api.storage.session.data.bookmarkCache.find(node => node.id === "math").parentId, "physics");
  await call("move", { id: "math", destination: { parentId: "unfiled_____", anchorId: "physics", position: "before" } });
  assert.deepEqual(api.find("unfiled_____").children.map(node => node.id), ["direct-a", "math", "physics", "direct-b"]);
  assert.deepEqual(api.find("math").children.map(node => node.id), ["math-a", "algebra", "separator", "math-b"]);
});

test("nested folders move between parents, reorder siblings, and move to the unfoldered area", async () => {
  const { api, call } = await setup();
  await call("move", { id: "algebra", destination: { parentId: "physics", anchorId: "physics-a", position: "before" } });
  assert.deepEqual(api.find("physics").children.map(node => node.id), ["algebra", "physics-a"]);
  await call("move", { id: "math", destination: { parentId: "physics", anchorId: "algebra", position: "after" } });
  assert.deepEqual(api.find("physics").children.map(node => node.id), ["algebra", "math", "physics-a"]);
  await call("move", { id: "math", destination: { parentId: "physics", anchorId: "algebra", position: "before" } });
  assert.deepEqual(api.find("physics").children.map(node => node.id), ["math", "algebra", "physics-a"]);
  await call("move", { id: "algebra", destination: { parentId: "unfiled_____" } });
  assert.equal(api.find("unfiled_____").children.at(-1).id, "algebra");
  assert.equal(api.find("algebra-a").parentId, "algebra");
});

test("folders cannot move into themselves or descendants, and invalid moves leave the tree intact", async () => {
  const { api, call } = await setup();
  const deep = await api.bookmarks.create({ parentId: "algebra", type: "folder", title: "Deeper" });
  const before = await call("tree");
  for (const parentId of ["math", "algebra", deep.id]) {
    await assert.rejects(call("move", { id: "math", destination: { parentId } }), /itself or one of its descendants/);
  }
  await assert.rejects(call("move", { id: "math", destination: { parentId: "toolbar_____" } }), /no longer exists/);
  await assert.rejects(call("move", { id: "math", destination: { parentId: "physics-a" } }), /no longer exists/);
  assert.deepEqual(await call("tree"), before);
});

test("same-folder forward and backward moves land at the requested position", async () => {
  const { api, call } = await setup();
  await call("move", { id: "math-a", destination: { parentId: "math", anchorId: "math-b", position: "after" } });
  assert.deepEqual(api.find("math").children.map(node => node.id), ["algebra", "separator", "math-b", "math-a"]);
  await call("move", { id: "math-a", destination: { parentId: "math", anchorId: "algebra", position: "before" } });
  assert.equal(api.find("math").children[0].id, "math-a");
});

test("single deletion is logged once with its exact URL and undo restores native placement", async () => {
  const { api, controller, call } = await setup();
  await call("delete", { id: "math-a" });
  await controller.idle();
  assert.equal(api.find("math-a"), null);
  assert.equal(await call("log"), "Deleted: First (https://math.test/?x=%2F&y=+value#fragment)\n\n");
  await call("undo");
  await controller.idle();
  const restored = api.find("math").children[0];
  assert.equal(restored.title, "First");
  assert.equal(restored.url, "https://math.test/?x=%2F&y=+value#fragment");
  assert.notEqual(restored.id, "math-a");
  assert.equal(api.storage.local.data.deletionLog.length, 1);
});

test("folder deletion logs one full recursive event, retaining duplicate URLs and skipping separators", async () => {
  const { api, controller, call } = await setup();
  const expected = "Deleted Math folder with bookmarks:\nFirst (https://math.test/?x=%2F&y=+value#fragment)\nNested (https://algebra.test/)\nSecond (https://math.test/?x=%2F&y=+value#fragment)";
  await call("delete", { id: "math" });
  await controller.idle();
  assert.deepEqual(api.storage.local.data.deletionLog, [expected]);
  assert.equal(await call("log"), `${expected}\n\n`);
  await call("undo");
  await controller.idle();
  const restored = api.find("unfiled_____").children[0];
  assert.equal(restored.title, "Math");
  assert.deepEqual(restored.children.map(node => node.type), ["bookmark", "folder", "separator", "bookmark"]);
  assert.equal(restored.children[1].children[0].url, "https://algebra.test/");
  assert.deepEqual(api.storage.local.data.deletionLog, [expected]);
});

test("undoing a parent then an earlier-deleted child remaps the parent's ID", async () => {
  const { api, controller, call } = await setup();
  await call("delete", { id: "algebra-a" });
  await call("delete", { id: "math" });
  await call("undo");
  await call("undo");
  await controller.idle();
  const restored = api.find("unfiled_____").children[0];
  assert.equal(restored.children[1].children[0].title, "Nested");
  assert.equal(restored.children[1].children[0].parentId, restored.children[1].id);
  assert.equal(api.storage.local.data.deletionLog.length, 2);
});

test("native folder deletions outside Other Bookmarks include all descendant URLs", async () => {
  const { api, controller, call } = await setup();
  await api.bookmarks.create({ parentId: "toolbar_____", type: "folder", title: "Native folder" });
  await controller.idle();
  const folder = api.find("toolbar_____").children[1];
  await api.bookmarks.create({ parentId: folder.id, type: "bookmark", title: "Native", url: "https://native.test/?a=%20#b" });
  await controller.idle();
  await api.bookmarks.removeTree(folder.id);
  await controller.idle();
  assert.equal(await call("log"), "Deleted Native folder folder with bookmarks:\nNative (https://native.test/?a=%20#b)\n\n");
  assert.deepEqual(api.storage.session.data.deletions ?? [], []);
});

test("the log retains the most recent 100 events in oldest-to-newest order", async () => {
  const { api, controller, call } = await setup();
  for (let index = 0; index < 105; index++) {
    const bookmark = await api.bookmarks.create({ parentId: "menu________", type: "bookmark", title: `Bookmark ${index}`, url: `https://log.test/${index}` });
    await api.bookmarks.remove(bookmark.id);
  }
  await controller.idle();
  assert.equal(api.storage.local.data.deletionLog.length, 100);
  assert.equal(api.storage.local.data.deletionLog[0], "Deleted: Bookmark 5 (https://log.test/5)");
  assert.equal(api.storage.local.data.deletionLog.at(-1), "Deleted: Bookmark 104 (https://log.test/104)");
  assert.equal(await call("log"), Array.from({ length: 100 }, (_, position) => {
    const index = position + 5;
    return `Deleted: Bookmark ${index} (https://log.test/${index})\n\n`;
  }).join(""));
});

test("native URL edits, folder renames, and moves update the pre-deletion cache", async () => {
  const { api, controller, call } = await setup();
  await api.bookmarks.update("physics", { title: '物理 "Physics"' });
  await api.bookmarks.update("algebra-a", { title: "Edited bookmark", url: "https://edited.test/?a=%2F#exact" });
  await api.bookmarks.move("algebra-a", { parentId: "physics", index: 0 });
  await api.bookmarks.move("physics-a", { parentId: "physics", index: 0 });
  await api.bookmarks.removeTree("physics");
  await controller.idle();
  assert.equal(await call("log"), 'Deleted 物理 "Physics" folder with bookmarks:\nPhysics link (https://physics.test/)\nEdited bookmark (https://edited.test/?a=%2F#exact)\n\n');
});

test("undo and native folder logging survive a background-page unload", async () => {
  const { api, controller, call } = await setup();
  await call("delete", { id: "direct-a" });
  await controller.idle();
  api.resetListeners();
  // The removal wakes the background after Firefox has already removed the
  // folder. getTree() cannot recover its contents, but the session cache can.
  await api.bookmarks.removeTree("math");
  const resumed = createBookmarkController(api);
  api.bookmarks.onRemoved.emit("math", { parentId: "unfiled_____", index: 0,
    node: { id: "math", title: "Math", parentId: "unfiled_____", type: "folder", index: 0 } });
  await resumed.idle();
  assert.match(await resumed.handle({ action: "log" }), /https:\/\/algebra.test\//);
  assert.equal(api.calls.filter(call => call === "getTree").length, 1);
  await resumed.handle({ action: "undo" });
  assert.ok(api.find("unfiled_____").children.some(node => node.url === "https://direct-a.test/"));
});

test("browser restart clears undo while retaining the deletion log", async () => {
  const { api, controller, call } = await setup();
  await call("delete", { id: "direct-a" });
  await controller.idle();
  api.resetListeners();
  for (const key of Object.keys(api.storage.session.data)) delete api.storage.session.data[key];
  const restarted = createBookmarkController(api);
  await restarted.handle({ action: "undo" });
  assert.equal(api.find("direct-a"), null);
  assert.equal(await restarted.handle({ action: "log" }), "Deleted: Direct A (https://direct-a.test/)\n\n");
});

test("failed deletions leave bookmarks intact and do not retain false undo entries", async () => {
  const { api, call } = await setup();
  api.bookmarks.remove = async () => { throw new Error("Deletion failed"); };
  await assert.rejects(call("delete", { id: "direct-a" }), /Deletion failed/);
  assert.ok(api.find("direct-a"));
  assert.deepEqual(api.storage.session.data.deletions, []);
  assert.equal(await call("log"), "");
});

test("failed recursive restoration rolls back partial bookmarks and remains retryable", async () => {
  const { api, controller, call } = await setup();
  await call("delete", { id: "math" });
  await controller.idle();
  const create = api.bookmarks.create;
  let count = 0;
  api.bookmarks.create = async details => {
    if (++count === 3) throw new Error("Restoration failed");
    return create(details);
  };
  await assert.rejects(call("undo"), /Restoration failed/);
  await controller.idle();
  assert.ok(!api.find("unfiled_____").children.some(node => node.title === "Math"));
  assert.equal(api.storage.session.data.deletions.length, 1);
  assert.equal(api.storage.local.data.deletionLog.length, 1);
  api.bookmarks.create = create;
  await call("undo");
  assert.ok(api.find("unfiled_____").children.some(node => node.title === "Math"));
});

test("export preserves legacy entries and appends named events with a blank line after every event", async () => {
  const api = createFakeBrowser();
  const legacy = [
    "Deleted https://legacy.test/?exact=%2F#url",
    "Deleted Old folder folder that had bookmarks:\nhttps://legacy.test/nested",
  ];
  await api.storage.local.set({ deletionLog: legacy });
  const controller = createBookmarkController(api);
  await controller.handle({ action: "delete", id: "direct-a" });
  await controller.idle();
  const latest = "Deleted: Direct A (https://direct-a.test/)";
  assert.deepEqual(api.storage.local.data.deletionLog, [...legacy, latest]);
  assert.equal(await controller.handle({ action: "log" }), `${legacy[0]}\n\n${legacy[1]}\n\n${latest}\n\n`);
});

test("multiline names stay on a single bookmark line without changing the URL", async () => {
  const { api, controller, call } = await setup();
  const url = "https://example.test/path_(item)?query=%2F&value=+#anchor";
  await api.bookmarks.update("math", { title: "Math\nnotes" });
  await api.bookmarks.update("math-a", { title: 'Linear\r\nAlgebra "notes"', url });
  await call("delete", { id: "math-a" });
  await controller.idle();
  assert.equal(await call("log"), `Deleted: Linear Algebra "notes" (${url})\n\n`);
  assert.equal(deletionMessage({ type: "folder", title: "Math\nnotes", children: [] }), "Deleted Math notes folder with bookmarks:");
});
