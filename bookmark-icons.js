/**
 * Replacement boundary for bookmark icons:
 * - startIconBackground(api): starts any background work needed by the source.
 * - createIconProvider(api, onChanged): page-lifetime provider with ready and
 *   synchronous getUrl(bookmark), returning undefined when no icon is known.
 *   onChanged() runs after initial loading and subsequent source updates.
 *
 * To adopt a future native bookmarks icon API, replace these two functions,
 * using the full bookmark object (including its ID) passed to getUrl(). The
 * background entry point may become a no-op; remove the tabs permission if it
 * is no longer needed. The grid owns image rendering and fallback icons.
 */
const FAVICON_CACHE_KEY = "faviconCache";
const FAVICON_CACHE_LIMIT = 1000;

function originKey(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `origin:${parsed.origin}`;
    }
  } catch {
    // Non-web URLs can still have a page-specific icon, but no origin fallback.
  }
  return null;
}

function faviconUrl(cache, url) {
  return cache.get(`page:${url}`) ?? cache.get(originKey(url));
}

export function createIconProvider(api, onChanged) {
  let cache = new Map();
  let loaded = false;

  function update(entries) {
    loaded = true;
    cache = new Map(entries ?? []);
    onChanged();
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[FAVICON_CACHE_KEY]) {
      update(changes[FAVICON_CACHE_KEY].newValue);
    }
  });
  const ready = api.storage.local.get(FAVICON_CACHE_KEY).then(stored => {
    // An event received during this read is newer than its initial snapshot.
    if (!loaded) update(stored[FAVICON_CACHE_KEY]);
  });

  return { ready, getUrl: bookmark => faviconUrl(cache, bookmark.url) };
}

export function startIconBackground(api) {
  let cache = new Map();
  let dirty = false;
  let queue;

  function remember(key, icon) {
    if (cache.get(key) === icon) return false;
    cache.delete(key);
    cache.set(key, icon);
    dirty = true;
    while (cache.size > FAVICON_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return true;
  }

  function learn(tab) {
    // During navigation Firefox can pair the new URL with the previous icon.
    if (tab.status !== "complete" || !tab.url || !tab.favIconUrl || tab.incognito) return;
    const changed = remember(`page:${tab.url}`, tab.favIconUrl);
    const origin = originKey(tab.url);
    // Unrelated tab updates should not flip the fallback between known pages.
    if (origin && (changed || !cache.has(origin))) remember(origin, tab.favIconUrl);
  }

  async function save() {
    if (!dirty) return;
    await api.storage.local.set({ [FAVICON_CACHE_KEY]: [...cache] });
    dirty = false;
  }

  function report(error) {
    console.error("Bookmark Grid favicons:", error);
  }

  function observe(tab) {
    queue = queue.then(async () => {
      learn(tab);
      await save();
    }).catch(report);
  }

  // Register synchronously so tab events can wake an idle background page.
  api.tabs.onCreated.addListener(observe);
  api.tabs.onUpdated.addListener((_id, _changes, tab) => { observe(tab); });

  const ready = (async () => {
    const stored = await api.storage.local.get(FAVICON_CACHE_KEY);
    const entries = stored[FAVICON_CACHE_KEY] ?? [];
    cache = new Map(entries.slice(-FAVICON_CACHE_LIMIT));
    dirty = entries.length > FAVICON_CACHE_LIMIT;
    for (const tab of await api.tabs.query({})) learn(tab);
    await save();
  })();
  // Serialize startup and events, and keep later events working after a failure.
  queue = ready.catch(report);

  return { ready, idle: () => queue };
}
