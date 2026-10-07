import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkController, deletionMessage } from "../bookmarks.js";
import { createFakeBrowser, fixture } from "./fake-browser.js";

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

test("renaming updates the actual bookmark and cannot modify items outside Other Bookmarks", async () => {
  const { api, call } = await setup();
  await call("rename", { id: "algebra-a", title: "A renamed bookmark" });
  assert.equal(api.find("algebra-a").title, "A renamed bookmark");
  await assert.rejects(call("rename", { id: "toolbar-link", title: "Wrong" }));
  await assert.rejects(call("delete", { id: "unfiled_____" }));
  assert.equal(api.find("toolbar-link").title, "Toolbar link");
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
  await assert.rejects(call("move", { id: "math", destination: { parentId: "physics" } }));
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
  assert.equal(await call("log"), "Deleted https://math.test/?x=%2F&y=+value#fragment\n");
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
  const expected = deletionMessage(fixture().children[1].children[0]);
  await call("delete", { id: "math" });
  await controller.idle();
  assert.deepEqual(api.storage.local.data.deletionLog, [expected]);
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
  assert.equal(await call("log"), "Deleted Native folder folder that had bookmarks:\nhttps://native.test/?a=%20#b\n");
  assert.deepEqual(api.storage.session.data.deletions ?? [], []);
});

test("the log retains the most recent 100 events in oldest-to-newest order", async () => {
  const { api, controller, call } = await setup();
  for (let index = 0; index < 105; index++) {
    const bookmark = await api.bookmarks.create({ parentId: "menu________", type: "bookmark", title: "", url: `https://log.test/${index}` });
    await api.bookmarks.remove(bookmark.id);
  }
  await controller.idle();
  assert.equal(api.storage.local.data.deletionLog.length, 100);
  assert.equal(api.storage.local.data.deletionLog[0], "Deleted https://log.test/5");
  assert.equal(api.storage.local.data.deletionLog.at(-1), "Deleted https://log.test/104");
  assert.equal((await call("log")).split("\n\n").length, 100);
});

test("native URL edits, folder renames, and moves update the pre-deletion cache", async () => {
  const { api, controller, call } = await setup();
  await api.bookmarks.update("physics", { title: '物理 "Physics"' });
  await api.bookmarks.update("algebra-a", { url: "https://edited.test/?a=%2F#exact" });
  await api.bookmarks.move("algebra-a", { parentId: "physics", index: 0 });
  await api.bookmarks.move("physics-a", { parentId: "physics", index: 0 });
  await api.bookmarks.removeTree("physics");
  await controller.idle();
  assert.equal(await call("log"), 'Deleted 物理 "Physics" folder that had bookmarks:\nhttps://physics.test/\nhttps://edited.test/?a=%2F#exact\n');
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
  assert.equal(await restarted.handle({ action: "log" }), "Deleted https://direct-a.test/\n");
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
