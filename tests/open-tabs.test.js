import test from "node:test";
import assert from "node:assert/strict";
import { createOpenTabs } from "../open-tabs.js";
import { createFakeBrowser } from "./fake-browser.js";

const URL_A = "https://site.test/a?encoded=%2F&space=+value#fragment";
const URL_B = "https://site.test/b";
const variants = [URL_B, URL_A.replace("https:", "http:"),
  URL_A.replace("/a?", "/b?"), URL_A.replace("%2F", "/"),
  URL_A.replace("+value", "%20value"), URL_A.replace("#fragment", "#other"),
  URL_A.split("#")[0]];
const bookmark = (url, id = `saved:${url}`) => ({ id, url, title: url, type: "bookmark" });
function createBrowser() {
  return createFakeBrowser({ id: "root________", type: "folder", children: [
    { id: "unfiled_____", type: "folder", children:
      [URL_A, ...variants, "https://root.test"].map(url => bookmark(url)) },
  ] });
}
const tab = (id, url, index = id, windowId = 1) => ({ id, url, index, windowId });
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferInto = requests => new Promise((resolve, reject) => { requests.push({ resolve, reject }); });

test("highlights only full URLs in the grid's window, including browser root-slash normalization", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B, 0, 2), tab(3, "https://root.test/")];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(open.has(bookmark(URL_A)), true);
  assert.equal(open.has(bookmark("https://root.test")), true);
  for (const url of [...variants, "invalid URL", undefined]) {
    assert.equal(open.has(bookmark(url)), false, url);
  }
});

test("activation chooses the first matching tab in native order and only sets active", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(3, URL_A, 4), tab(2, URL_A, 2), tab(1, URL_A, 0, 2)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(await open.activate(bookmark(URL_A)), true);
  assert.deepEqual(api.tabs.updates, [{ id: 2, changes: { active: true } }]);
  api.tabs.items[0].index = 0;
  api.tabs.onMoved.emit(3, { windowId: 1, fromIndex: 4, toIndex: 0 });
  await settle();
  assert.equal(await open.activate(bookmark(URL_A)), true);
  assert.equal(api.tabs.updates.at(-1).id, 3);
  assert.equal(await open.activate(bookmark(URL_B)), false);
});

test("overlapping activations complete without repeatedly superseding each other", async () => {
  for (const secondURL of [URL_A, URL_B]) {
    const api = createBrowser();
    api.tabs.items = [tab(1, URL_A), tab(2, URL_B)];
    const open = createOpenTabs(api, () => {});
    await open.ready;
    const search = api.bookmarks.search;
    const lookups = [];
    api.bookmarks.search = query => deferInto(lookups).then(() => search(query));
    let completed = 0;
    const activations = [URL_A, secondURL].map(url => open.activate(bookmark(url)).then(result => {
      completed++;
      return result;
    }));
    await settle();
    assert.equal(lookups.length, 4, "each click queries the two distinct URLs once");
    for (const lookup of [...lookups]) lookup.resolve();
    await settle();
    assert.equal(lookups.length, 4, "overlapping requests do not force extra lookups");
    assert.equal(completed, 2, "both activations finish after one lookup round");
    assert.deepEqual(await Promise.all(activations), [true, true]);
    assert.deepEqual(api.tabs.updates, [
      { id: 1, changes: { active: true } },
      { id: secondURL === URL_A ? 1 : 2, changes: { active: true } },
    ]);
  }
});

test("opening, navigation, removal, and window transfers update highlights live", async () => {
  const api = createBrowser();
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await open.ready;
  api.tabs.items.push(tab(1, URL_A));
  api.tabs.onCreated.emit(api.tabs.items[0]);
  await settle();
  assert.equal(open.has(bookmark(URL_A)), true);

  api.tabs.items[0].url = URL_B;
  api.tabs.onUpdated.emit(1, { url: URL_B }, api.tabs.items[0]);
  await settle();
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(open.has(bookmark(URL_B)), true);

  api.tabs.items[0].windowId = 2;
  api.tabs.onDetached.emit(1, { oldWindowId: 1, oldPosition: 0 });
  await settle();
  assert.equal(open.has(bookmark(URL_B)), false);
  api.tabs.items[0].windowId = 1;
  api.tabs.onAttached.emit(1, { newWindowId: 1, newPosition: 0 });
  await settle();
  assert.equal(open.has(bookmark(URL_B)), true);

  api.tabs.items = [];
  api.tabs.onRemoved.emit(1, { windowId: 1, isWindowClosing: false });
  await settle();
  assert.equal(open.has(bookmark(URL_B)), false);
  assert.equal(changes, 6);
});

test("moving the grid itself changes its tracked window", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B, 0, 2)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  api.tabs.current.windowId = 2;
  api.tabs.onAttached.emit(0, { newWindowId: 2, newPosition: 1 });
  await settle();
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(open.has(bookmark(URL_B)), true);
  assert.equal(await open.activate(bookmark(URL_A)), false);
  assert.equal(await open.activate(bookmark(URL_B)), true);
  assert.equal(api.tabs.updates[0].id, 2);
});

test("click-time queries detect newly opened, closed, navigated, or transferred tabs before events arrive", async () => {
  const api = createBrowser();
  const open = createOpenTabs(api, () => {});
  await open.ready;
  api.tabs.items = [tab(1, URL_A)];
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(await open.activate(bookmark(URL_A)), true);
  api.tabs.items[0].url = URL_B;
  assert.equal(await open.activate(bookmark(URL_A)), false);
  api.tabs.items[0].windowId = 2;
  assert.equal(await open.activate(bookmark(URL_B)), false);
  api.tabs.items = [];
  assert.equal(await open.activate(bookmark(URL_B)), false);
  assert.equal(api.tabs.updates.length, 1);
});

test("a closed activation target falls back to another match or normal navigation", async () => {
  for (const duplicate of [false, true]) {
    const api = createBrowser();
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
    assert.equal(await open.activate(bookmark(URL_A)), duplicate);
    assert.deepEqual(api.tabs.updates, duplicate ? [{ id: 2, changes: { active: true } }] : []);
  }
});

test("real activation errors are exposed rather than causing duplicate navigation", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  api.tabs.update = async () => { throw new Error("Permission failure"); };
  const open = createOpenTabs(api, () => {});
  await open.ready;
  await assert.rejects(open.activate(bookmark(URL_A)), /Permission failure/);
});

test("late startup and overlapping query results never overwrite newer highlights", async () => {
  const api = createBrowser();
  const queries = [];
  api.tabs.query = () => deferInto(queries);
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await settle();
  api.tabs.onCreated.emit(tab(2, URL_B));
  await settle();
  queries[1].resolve([tab(2, URL_B)]);
  await settle();
  queries[0].resolve([tab(1, URL_A)]);
  await open.ready;
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(open.has(bookmark(URL_B)), true);
  assert.equal(changes, 1);
});

test("unrelated title and favicon events do not refresh the tab list", async () => {
  const api = createBrowser();
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await open.ready;
  api.tabs.onUpdated.emit(1, { title: "Changed", favIconUrl: "icon.svg" }, tab(1, URL_A));
  await settle();
  assert.equal(changes, 1);
});

test("an independently matching tab URL is insufficient without native confirmation", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  api.bookmarks.search = async () => [];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(await open.activate(bookmark(URL_A)), false);
  assert.deepEqual(api.tabs.updates, []);
});

test("native results require the displayed bookmark ID and its current saved URL", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const duplicate = await api.bookmarks.create({ parentId: "unfiled_____", url: URL_A, type: "bookmark" });
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(open.has(bookmark(URL_A)), true);
  assert.equal(open.has(duplicate), true);
  assert.equal(open.has(bookmark(URL_A, "missing-id")), false);
  assert.equal(open.has(bookmark(URL_B, duplicate.id)), false);
  await api.bookmarks.remove(duplicate.id);
  // Same-URL duplicates must not confirm the deleted row during deferred render.
  assert.equal(open.has(duplicate), false);
  await settle();
  assert.equal(open.has(duplicate), false);
  assert.equal(open.has(bookmark(URL_A)), true);
  assert.equal(await open.activate(duplicate), false);
});

test("lookups use raw tab URLs, deduplicate identical URLs, and skip unavailable or invalid URLs", async () => {
  const api = createBrowser();
  const rawURL = "https://SITE.test:443/a?encoded=%2F&space=+value#fragment";
  api.tabs.items = [tab(1, rawURL), tab(2, rawURL), tab(3, URL_A),
    tab(4, undefined), tab(5, "invalid URL"), tab(6, URL_B, 0, 2)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.deepEqual(api.calls, [{ action: "search", url: rawURL }, { action: "search", url: URL_A }]);
  assert.equal(open.has(bookmark(URL_A)), true);
});

test("bookmark creation and URL editing update dots without any tab event or grid refresh", async () => {
  const api = createBrowser();
  const newURL = "https://new.test/path?query=exact#fragment";
  api.tabs.items = [tab(1, newURL), tab(2, URL_B)];
  let changes = 0;
  const open = createOpenTabs(api, () => { changes++; });
  await open.ready;
  const created = await api.bookmarks.create({ parentId: "unfiled_____", url: newURL, type: "bookmark" });
  await settle();
  assert.equal(open.has(created), true);
  assert.equal(changes, 2);
  const edited = await api.bookmarks.update(created.id, { url: URL_B });
  assert.equal(open.has(created), false);
  await settle();
  assert.equal(open.has(created), false);
  assert.equal(open.has(edited), true);
  assert.equal(await open.activate(created), false);
  assert.equal(await open.activate(edited), true);
  assert.equal(api.tabs.updates.at(-1).id, 2);
});

test("recursive folder deletion invalidates descendant dots while rows remain rendered", async () => {
  const api = createBrowser();
  const folder = await api.bookmarks.create({ parentId: "unfiled_____", type: "folder" });
  const nested = await api.bookmarks.create({ parentId: folder.id, type: "folder" });
  const direct = await api.bookmarks.create({ parentId: folder.id, url: URL_A, type: "bookmark" });
  const descendant = await api.bookmarks.create({ parentId: nested.id, url: URL_B, type: "bookmark" });
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(open.has(direct), true);
  assert.equal(open.has(descendant), true);
  await api.bookmarks.removeTree(folder.id);
  assert.equal(open.has(direct), false);
  assert.equal(open.has(descendant), false);
  await settle();
  assert.equal(open.has(direct), false);
  assert.equal(open.has(descendant), false);
  assert.equal(open.has(bookmark(URL_A)), true);
  assert.equal(open.has(bookmark(URL_B)), true);
});

test("click-time verification catches bookmark deletion and URL editing before events arrive", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  api.bookmarks.onChanged.clear();
  await api.bookmarks.update(bookmark(URL_A).id, { url: URL_B });
  assert.equal(await open.activate(bookmark(URL_A)), false);
  api.bookmarks.onRemoved.clear();
  await api.bookmarks.remove(bookmark(URL_B).id);
  assert.equal(await open.activate(bookmark(URL_B)), false);
  assert.deepEqual(api.tabs.updates, []);
});

test("failed tab queries clear stale confirmation and expose errors", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.equal(open.has(bookmark(URL_A)), true);
  api.tabs.query = async () => { throw new Error("Lookup failed"); };
  await assert.rejects(open.refresh(), /Lookup failed/);
  assert.equal(open.has(bookmark(URL_A)), false);
  await assert.rejects(open.activate(bookmark(URL_A)), /Lookup failed/);
  assert.deepEqual(api.tabs.updates, []);
});

test("restricted URLs cannot suppress a newly opened bookmark's dot or tab activation", async t => {
  const warnings = t.mock.method(console, "warn", () => {});
  const errors = t.mock.method(console, "error", () => {});
  for (const synchronous of [true, false]) {
    const logged = synchronous ? warnings : errors;
    const countBefore = logged.mock.callCount();
    const api = createBrowser();
    const restrictedURL = "about:addons";
    api.tabs.items = [tab(1, restrictedURL), tab(2, restrictedURL)];
    const search = api.bookmarks.search;
    let deniedLookups = 0;
    const failure = new Error('Type error for parameter query: .url must match the format "url"');
    api.bookmarks.search = query => {
      if (query.url !== restrictedURL) return search(query);
      deniedLookups++;
      if (synchronous) throw failure;
      return Promise.reject(failure);
    };
    const open = createOpenTabs(api, () => {});
    await open.ready;
    assert.equal(deniedLookups, 1, "identical restricted URLs are deduplicated");
    assert.equal(open.has(bookmark(URL_A)), false);
    const message = logged.mock.calls.at(-1).arguments;
    assert.deepEqual(message, ["bmgrid open tabs: bookmark lookup failed", { tabId: 1, url: restrictedURL }, failure]);

    api.tabs.items.push(tab(3, URL_A));
    api.tabs.onCreated.emit(api.tabs.items.at(-1));
    await settle();
    assert.equal(open.has(bookmark(URL_A)), true);
    assert.equal(await open.activate(bookmark(URL_A)), true);
    assert.deepEqual(api.tabs.updates, [{ id: 3, changes: { active: true } }]);

    api.tabs.items.pop();
    api.tabs.onRemoved.emit(3, { windowId: 1 });
    await settle();
    assert.equal(open.has(bookmark(URL_A)), false);
    assert.equal(deniedLookups, 4, "failed lookups continue retrying on events and clicks");
    assert.equal(logged.mock.callCount(), countBefore + 1, "one diagnostic across all refreshes and clicks");
  }
});

test("a failed URL loses stale dots while successful matches survive and failed lookups can recover", async t => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  for (const synchronous of [true, false]) {
    const api = createBrowser();
    api.tabs.items = [tab(1, URL_A), tab(2, URL_B)];
    const open = createOpenTabs(api, () => {});
    await open.ready;
    assert.equal(open.has(bookmark(URL_A)), true);
    assert.equal(open.has(bookmark(URL_B)), true);
    const search = api.bookmarks.search;
    api.bookmarks.search = query => {
      if (query.url !== URL_B) return search(query);
      const failure = new Error("Lookup failed");
      if (synchronous) throw failure;
      return Promise.reject(failure);
    };
    await open.refresh();
    assert.equal(open.has(bookmark(URL_A)), true);
    assert.equal(open.has(bookmark(URL_B)), false);
    assert.equal(await open.activate(bookmark(URL_A)), true);
    assert.equal(await open.activate(bookmark(URL_B)), false);
    assert.deepEqual(api.tabs.updates, [{ id: 1, changes: { active: true } }]);
    api.bookmarks.search = search;
    await open.refresh();
    assert.equal(open.has(bookmark(URL_B)), true);
  }
});

test("diagnostics reset after recovery or leaving the window, and remain independent per URL", async t => {
  const warnings = t.mock.method(console, "warn", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B)];
  const search = api.bookmarks.search;
  let refuseA = true;
  const failureA = new Error("Synchronous refusal");
  const failureB = new Error("Asynchronous failure");
  let lookups = 0;
  api.bookmarks.search = query => {
    lookups++;
    if (query.url === URL_A) {
      if (refuseA) throw failureA;
      return search(query);
    }
    return Promise.reject(failureB);
  };
  const open = createOpenTabs(api, () => {});
  await open.ready;
  assert.deepEqual(warnings.mock.calls[0].arguments,
    ["bmgrid open tabs: bookmark lookup failed", { tabId: 1, url: URL_A }, failureA]);
  assert.deepEqual(errors.mock.calls[0].arguments,
    ["bmgrid open tabs: bookmark lookup failed", { tabId: 2, url: URL_B }, failureB]);
  await open.refresh();
  assert.equal(lookups, 4);
  assert.equal(warnings.mock.callCount(), 1);
  assert.equal(errors.mock.callCount(), 1);
  refuseA = false;
  await open.refresh();
  assert.equal(open.has(bookmark(URL_A)), true);
  refuseA = true;
  await open.refresh();
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(warnings.mock.callCount(), 2, "success starts a new failure episode");
  assert.equal(errors.mock.callCount(), 1, "the other URL's episode is unaffected");
  api.tabs.items[1].windowId = 2;
  await open.refresh();
  api.tabs.items[1].windowId = 1;
  await open.refresh();
  assert.equal(warnings.mock.callCount(), 2);
  assert.equal(errors.mock.callCount(), 2, "leaving the tracked window resets suppression");
  api.tabs.items[1].url = URL_A;
  await open.refresh();
  assert.equal(warnings.mock.callCount(), 2, "two tabs sharing the URL retain one episode");
  api.tabs.items[0].url = URL_B;
  await open.refresh();
  assert.equal(warnings.mock.callCount(), 2, "the same URL still exists in the second tab");
  assert.equal(errors.mock.callCount(), 3, "returning after navigation starts a new episode");
});

test("new grid pages maintain their own diagnostic suppression", async t => {
  const warnings = t.mock.method(console, "warn", () => {});
  const api = createBrowser();
  api.tabs.items = [tab(1, "about:debugging#/runtime/this-firefox")];
  api.bookmarks.search = () => { throw new Error("Access denied"); };
  const first = createOpenTabs(api, () => {});
  const second = createOpenTabs(api, () => {});
  await Promise.all([first.ready, second.ready]);
  assert.equal(warnings.mock.callCount(), 2);
  await Promise.all([first.refresh(), second.refresh()]);
  assert.equal(warnings.mock.callCount(), 2);
});

test("superseded failures neither emit diagnostics nor suppress a subsequent current failure", async t => {
  const errors = t.mock.method(console, "error", () => {});
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const lookups = [];
  api.bookmarks.search = () => deferInto(lookups);
  const open = createOpenTabs(api, () => {});
  await settle();
  const newest = open.refresh();
  await settle();
  lookups[0].reject(new Error("Superseded failure"));
  await open.ready;
  assert.equal(errors.mock.callCount(), 0, "a stale failure is silent even before the newest lookup finishes");
  lookups[1].reject(new Error("Current failure"));
  await newest;
  assert.equal(errors.mock.callCount(), 1);
  const repeated = open.refresh();
  await settle();
  lookups[2].reject(new Error("Repeated failure"));
  await repeated;
  assert.equal(errors.mock.callCount(), 1);
});

test("superseded successes cannot reset the latest failure episode", async t => {
  const errors = t.mock.method(console, "error", () => {});
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const lookups = [];
  api.bookmarks.search = () => deferInto(lookups);
  const open = createOpenTabs(api, () => {});
  await settle();
  const newest = open.refresh();
  await settle();
  lookups[1].reject(new Error("Current failure"));
  await newest;
  assert.equal(errors.mock.callCount(), 1);
  lookups[0].resolve([bookmark(URL_A)]);
  await open.ready;
  const repeated = open.refresh();
  await settle();
  lookups[2].reject(new Error("Still failing"));
  await repeated;
  assert.equal(errors.mock.callCount(), 1, "stale success must not restart diagnostics");
  assert.equal(open.has(bookmark(URL_A)), false);
});

test("a failure completed in an unfinished snapshot is silent if that snapshot is superseded", async t => {
  const warnings = t.mock.method(console, "warn", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A), tab(2, URL_B)];
  const lookups = [];
  api.bookmarks.search = ({ url }) => {
    if (url === URL_A) throw new Error("Immediate refusal");
    return deferInto(lookups);
  };
  const open = createOpenTabs(api, () => {});
  await settle();
  assert.equal(warnings.mock.callCount(), 0, "defer diagnostics until the complete snapshot commits");
  api.tabs.items = [tab(2, URL_B)];
  const newest = open.refresh();
  await settle();
  lookups[1].resolve([bookmark(URL_B)]);
  await newest;
  lookups[0].resolve([bookmark(URL_B)]);
  await open.ready;
  assert.equal(warnings.mock.callCount(), 0);
  assert.equal(errors.mock.callCount(), 0);
  assert.equal(open.has(bookmark(URL_B)), true);
});

test("late native lookup results and failures cannot replace newer confirmations", async () => {
  for (const failOlder of [false, true]) {
    const api = createBrowser();
    api.tabs.items = [tab(1, URL_A)];
    const lookups = [];
    api.bookmarks.search = () => deferInto(lookups);
    const open = createOpenTabs(api, () => {});
    const startup = assert.doesNotReject(open.ready);
    await settle();
    api.tabs.items = [tab(2, URL_B)];
    const newest = open.refresh();
    await settle();
    lookups[1].resolve([bookmark(URL_B)]);
    await newest;
    if (failOlder) lookups[0].reject(new Error("Late failure"));
    else lookups[0].resolve([bookmark(URL_A)]);
    await startup;
    assert.equal(open.has(bookmark(URL_A)), false);
    assert.equal(open.has(bookmark(URL_B)), true);
  }
});

test("activation retries when bookmark events supersede its pending verification", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  const search = api.bookmarks.search;
  const lookups = [];
  api.bookmarks.search = () => deferInto(lookups);
  const activation = open.activate(bookmark(URL_A));
  await settle();
  api.bookmarks.search = search;
  await api.bookmarks.remove(bookmark(URL_A).id);
  await settle();
  lookups[0].resolve([bookmark(URL_A)]);
  assert.equal(await activation, false);
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.deepEqual(api.tabs.updates, []);
});

test("activation retries when a tab navigates during its pending verification", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  const search = api.bookmarks.search;
  const lookups = [];
  api.bookmarks.search = () => deferInto(lookups);
  const activation = open.activate(bookmark(URL_A));
  await settle();
  api.bookmarks.search = search;
  api.tabs.items[0].url = URL_B;
  api.tabs.onUpdated.emit(1, { url: URL_B }, api.tabs.items[0]);
  await settle();
  lookups[0].resolve([bookmark(URL_A)]);
  assert.equal(await activation, false);
  assert.equal(open.has(bookmark(URL_A)), false);
  assert.equal(open.has(bookmark(URL_B)), true);
  assert.deepEqual(api.tabs.updates, []);
});

test("bookmark title edits, folder creation, and bookmark reordering leave confirmations intact", async () => {
  const api = createBrowser();
  api.tabs.items = [tab(1, URL_A)];
  const open = createOpenTabs(api, () => {});
  await open.ready;
  api.calls.length = 0;
  await api.bookmarks.update(bookmark(URL_A).id, { title: "Renamed" });
  const folder = await api.bookmarks.create({ parentId: "unfiled_____", type: "folder" });
  await api.bookmarks.move(bookmark(URL_A).id, { parentId: folder.id, index: 0 });
  await settle();
  assert.deepEqual(api.calls, []);
  assert.equal(open.has(bookmark(URL_A)), true);
});
