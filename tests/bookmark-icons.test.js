import test from "node:test";
import assert from "node:assert/strict";
import { startIconBackground, createIconProvider } from "../bookmark-icons.js";
import { createFakeBrowser } from "./fake-browser.js";

// These constants describe the current tab-cache backend, not the provider API.
const FAVICON_CACHE_KEY = "faviconCache";
const FAVICON_CACHE_LIMIT = 1000;

function reader(api) {
  const provider = createIconProvider(api, () => {});
  return { ready: provider.ready, icon: url => provider.getUrl({ id: "bookmark", url }) };
}

async function setup(api) {
  const controller = startIconBackground(api);
  const { ready, icon } = reader(api);
  await Promise.all([controller.ready, ready]);
  return { controller, icon };
}

function tab(url, favIconUrl = "https://icons.test/icon.svg", extra = {}) {
  return { id: 1, url, favIconUrl, status: "complete", ...extra };
}

function stored(api) {
  return new Map(api.storage.local.data[FAVICON_CACHE_KEY] ?? []);
}

test("startup learns open-tab icons and retains the persistent cache across restarts", async () => {
  const api = createFakeBrowser();
  const old = "https://old.test/path?x=%2F#fragment";
  api.storage.local.data[FAVICON_CACHE_KEY] = [[`page:${old}`, "data:image/png;base64,old"]];
  api.tabs.items = [tab("https://new.test/path", "data:image/png;base64,new")];
  let { icon } = await setup(api);
  assert.equal(icon(old), "data:image/png;base64,old");
  assert.equal(icon("https://new.test/path"), "data:image/png;base64,new");

  api.resetListeners();
  api.tabs.items = [];
  ({ icon } = await setup(api));
  assert.equal(icon(old), "data:image/png;base64,old");
  assert.equal(icon("https://new.test/other"), "data:image/png;base64,new");
});

test("exact page URLs override origin fallback, which isolates schemes and ports", async () => {
  const api = createFakeBrowser();
  api.tabs.items = [
    tab("https://site.test/a?x=%2F#fragment", "a.svg"),
    tab("https://site.test/b", "b.svg"),
    tab("http://site.test/a", "http.svg"),
    tab("https://site.test:8443/a", "port.svg"),
    tab("about:blank", "blank.svg"),
  ];
  const { icon } = await setup(api);
  assert.equal(icon("https://site.test/a?x=%2F#fragment"), "a.svg");
  assert.equal(icon("https://site.test/unknown"), "b.svg");
  assert.equal(icon("http://site.test/unknown"), "http.svg");
  assert.equal(icon("https://site.test:8443/unknown"), "port.svg");
  assert.equal(icon("https://site.test:9443/unknown"), undefined);
  assert.equal(icon("https://sub.site.test/a"), undefined);
  assert.equal(icon("about:blank"), "blank.svg");
  assert.equal(icon("about:config"), undefined);
  assert.equal(icon("invalid URL"), undefined);
});

test("tab events ignore loading, empty, and private icons without erasing known icons", async () => {
  const api = createFakeBrowser();
  const { controller, icon } = await setup(api);
  api.tabs.onCreated.emit(tab("https://site.test/a", "a.svg"));
  api.tabs.onUpdated.emit(1, { status: "loading" }, tab("https://other.test/", "a.svg", { status: "loading" }));
  api.tabs.onUpdated.emit(1, { favIconUrl: "" }, tab("https://site.test/a", ""));
  api.tabs.onCreated.emit(tab("https://private.test/", "private.svg", { incognito: true }));
  await controller.idle();
  assert.equal(icon("https://site.test/a"), "a.svg");
  assert.equal(icon("https://other.test/"), undefined);
  assert.equal(icon("https://private.test/"), undefined);

  api.tabs.onUpdated.emit(1, { favIconUrl: "b.svg" }, tab("https://other.test/", "b.svg"));
  await controller.idle();
  assert.equal(icon("https://other.test/"), "b.svg");
});

test("unchanged tab updates avoid redundant storage writes", async () => {
  const api = createFakeBrowser();
  const set = api.storage.local.set;
  let writes = 0;
  api.storage.local.set = async values => { writes++; await set(values); };
  api.tabs.items = [tab("https://site.test/a"), tab("https://site.test/b", "b.svg")];
  const { controller, icon } = await setup(api);
  api.tabs.onUpdated.emit(1, { title: "New title" }, tab("https://site.test/a"));
  api.tabs.onCreated.emit(tab("https://site.test/a"));
  await controller.idle();
  assert.equal(writes, 1);
  assert.equal(icon("https://site.test/unknown"), "b.svg");
});

test("cache eviction removes the oldest entries while retaining newly changed icons", async () => {
  const api = createFakeBrowser();
  api.tabs.items = Array.from({ length: FAVICON_CACHE_LIMIT / 2 }, (_, i) => tab(`https://site-${i}.test/a`));
  const { controller, icon } = await setup(api);
  assert.equal(stored(api).size, FAVICON_CACHE_LIMIT);
  api.tabs.onUpdated.emit(1, {}, tab("https://site-0.test/a", "updated.svg"));
  api.tabs.onCreated.emit(tab("https://new.test/a"));
  await controller.idle();
  assert.equal(stored(api).size, FAVICON_CACHE_LIMIT);
  assert.equal(icon("https://site-0.test/a"), "updated.svg");
  assert.equal(icon("https://site-1.test/a"), undefined);
  assert.equal(icon("https://new.test/a"), "https://icons.test/icon.svg");
});

test("startup trims oversized caches and does not create an empty cache unnecessarily", async () => {
  const api = createFakeBrowser();
  await setup(api);
  assert.equal(api.storage.local.data[FAVICON_CACHE_KEY], undefined);
  api.resetListeners();
  api.storage.local.data[FAVICON_CACHE_KEY] = Array.from({ length: FAVICON_CACHE_LIMIT + 3 }, (_, i) => [`page:about:${i}`, "icon.svg"]);
  const { icon } = await setup(api);
  assert.equal(stored(api).size, FAVICON_CACHE_LIMIT);
  assert.equal(icon("about:0"), undefined);
  assert.equal(icon("about:3"), "icon.svg");
});

test("events received during startup and overlapping writes are serialized", async () => {
  const api = createFakeBrowser();
  let finishQuery;
  api.tabs.query = () => new Promise(resolve => { finishQuery = resolve; });
  const controller = startIconBackground(api);
  const { icon } = reader(api);
  // Yield until startup has loaded storage and requested the initial tab list.
  await Promise.resolve();
  api.tabs.onUpdated.emit(1, {}, tab("https://site.test/a", "new.svg"));
  finishQuery([tab("https://site.test/a", "old.svg")]);
  await controller.idle();
  assert.equal(icon("https://site.test/a"), "new.svg");

  const set = api.storage.local.set;
  let release;
  let started;
  const firstWrite = new Promise(resolve => { started = resolve; });
  let writes = 0;
  api.storage.local.set = async values => {
    writes++;
    if (writes === 1) {
      started();
      await new Promise(resolve => { release = resolve; });
    }
    await set(values);
  };
  api.tabs.onUpdated.emit(1, {}, tab("https://site.test/a", "first.svg"));
  await firstWrite;
  api.tabs.onUpdated.emit(1, {}, tab("https://site.test/a", "last.svg"));
  api.tabs.onCreated.emit(tab("https://another.test/a", "another.svg"));
  release();
  await controller.idle();
  assert.equal(icon("https://site.test/a"), "last.svg");
  assert.equal(icon("https://another.test/a"), "another.svg");
});

test("a failed write is retried on the next event even if its icon is unchanged", async t => {
  const api = createFakeBrowser();
  const set = api.storage.local.set;
  let writes = 0;
  api.storage.local.set = async values => {
    if (++writes === 1) throw new Error("Temporary storage failure");
    await set(values);
  };
  const errors = t.mock.method(console, "error", () => {});
  const { controller, icon } = await setup(api);
  api.tabs.onCreated.emit(tab("https://site.test/a"));
  await controller.idle();
  assert.equal(errors.mock.callCount(), 1);
  api.tabs.onUpdated.emit(1, {}, tab("https://site.test/a"));
  await controller.idle();
  assert.equal(icon("https://site.test/a"), "https://icons.test/icon.svg");
});

test("provider accepts bookmark objects and notifies after initial loading and cache updates", async () => {
  const api = createFakeBrowser();
  const bookmark = api.find("direct-a");
  api.storage.local.data[FAVICON_CACHE_KEY] = [[`page:${bookmark.url}`, "first.svg"]];
  const notifications = [];
  // A grid provider needs no tab access; all backend details stay in the module.
  const provider = createIconProvider({ storage: api.storage }, () => {
    notifications.push(provider.getUrl(bookmark));
  });
  assert.equal(provider.getUrl(bookmark), undefined);
  await provider.ready;
  assert.deepEqual(notifications, ["first.svg"]);

  await api.storage.session.set({ [FAVICON_CACHE_KEY]: [[`page:${bookmark.url}`, "session.svg"]] });
  await api.storage.local.set({ deletionLog: ["Unrelated change"] });
  assert.deepEqual(notifications, ["first.svg"]);

  await api.storage.local.set({ [FAVICON_CACHE_KEY]: [[`page:${bookmark.url}`, "updated.svg"]] });
  assert.deepEqual(notifications, ["first.svg", "updated.svg"]);
  api.storage.onChanged.emit({ [FAVICON_CACHE_KEY]: { newValue: undefined } }, "local");
  assert.deepEqual(notifications, ["first.svg", "updated.svg", undefined]);
  assert.equal(provider.getUrl(bookmark), undefined);
});

test("provider keeps an update received during initial loading instead of its stale snapshot", async () => {
  const api = createFakeBrowser();
  let finishRead;
  api.storage.local.get = () => new Promise(resolve => { finishRead = resolve; });
  let notifications = 0;
  const provider = createIconProvider(api, () => { notifications++; });
  const bookmark = api.find("direct-a");
  await api.storage.local.set({ [FAVICON_CACHE_KEY]: [[`page:${bookmark.url}`, "new.svg"]] });
  finishRead({ [FAVICON_CACHE_KEY]: [[`page:${bookmark.url}`, "old.svg"]] });
  await provider.ready;
  assert.equal(provider.getUrl(bookmark), "new.svg");
  assert.equal(notifications, 1);
});

test("provider with an empty source resolves readiness and returns no icon", async () => {
  const api = createFakeBrowser();
  let notifications = 0;
  const provider = createIconProvider(api, () => { notifications++; });
  await provider.ready;
  assert.equal(provider.getUrl(api.find("direct-a")), undefined);
  assert.equal(notifications, 1);
});

test("provider exposes initial read failures and can still receive later source updates", async () => {
  const api = createFakeBrowser();
  api.storage.local.get = async () => { throw new Error("Read failed"); };
  let notifications = 0;
  const provider = createIconProvider(api, () => { notifications++; });
  await assert.rejects(provider.ready, /Read failed/);
  const bookmark = api.find("direct-a");
  assert.equal(provider.getUrl(bookmark), undefined);
  await api.storage.local.set({ [FAVICON_CACHE_KEY]: [[`page:${bookmark.url}`, "recovered.svg"]] });
  assert.equal(provider.getUrl(bookmark), "recovered.svg");
  assert.equal(notifications, 1);
});
