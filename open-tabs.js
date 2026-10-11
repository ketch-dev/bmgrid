function urlKey(url) {
  if (!url) return null;
  try {
    // Compare a rendered bookmark with the live bookmark returned by Firefox.
    // This is not used to decide whether a tab URL is bookmarked.
    return new URL(url).href;
  } catch {
    return null;
  }
}

export function createOpenTabs(api, onChanged) {
  let confirmed = new Map();
  let failedUrls = new Set();
  let version = 0;
  let revision = 0;

  async function refresh() {
    const currentVersion = ++version;
    try {
      // Resolve the grid's own tab each time: it can move to another window,
      // and the last-focused window need not be the one containing this page.
      const current = await api.tabs.getCurrent();
      const snapshot = await api.tabs.query({ windowId: current.windowId });
      snapshot.sort((a, b) => a.index - b.index);
      const lookups = new Map();
      const failures = new Map();
      async function lookup(tab) {
        let asynchronous = false;
        try {
          // Firefox's schema can throw before the API returns a Promise,
          // including when a parsed URL is inaccessible to the extension.
          const result = api.bookmarks.search({ url: tab.url });
          asynchronous = true;
          return await result;
        } catch (error) {
          failures.set(tab.url, { tabId: tab.id, error, level: asynchronous ? "error" : "warn" });
          // Leave this URL unconfirmed without discarding other matches.
          return [];
        }
      }
      for (const tab of snapshot) {
        if (!urlKey(tab.url) || lookups.has(tab.url)) continue;
        // Firefox's URL search uses the same Places URL equality as its star.
        // Pass the actual tab URL; do not substitute our own matching rules.
        lookups.set(tab.url, lookup(tab));
      }
      const results = new Map(await Promise.all([...lookups].map(async ([url, lookup]) =>
        [url, await lookup])));
      const matches = new Map();
      for (const tab of snapshot) {
        for (const bookmark of results.get(tab.url) ?? []) {
          if (bookmark.type !== "bookmark" || matches.has(bookmark.id)) continue;
          // The snapshot is in tab-strip order; only the first match is used.
          matches.set(bookmark.id, { url: urlKey(bookmark.url), tab });
        }
      }
      if (currentVersion === version) {
        // Log once per continuously failing URL, and only from the latest
        // snapshot. Success or absence resets suppression; lookups still retry.
        for (const [url, { tabId, error, level }] of failures) {
          if (!failedUrls.has(url)) {
            console[level]("bmgrid open tabs: bookmark lookup failed", { tabId, url }, error);
          }
        }
        failedUrls = new Set(failures.keys());
        confirmed = matches;
        onChanged();
      }
      return matches;
    } catch (error) {
      // A failed tab snapshot cannot leave previously confirmed dots behind.
      // An older failed refresh must not erase a newer successful snapshot.
      if (currentVersion === version) {
        confirmed = new Map();
        onChanged();
      }
      throw error;
    }
  }

  function observe() {
    revision++;
    refresh().catch(error => { console.error("bmgrid open tabs:", error); });
  }

  for (const event of [api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onMoved,
    api.tabs.onAttached, api.tabs.onDetached]) {
    event.addListener(observe);
  }
  api.tabs.onUpdated.addListener((_id, changes) => {
    if ("url" in changes) observe();
  });

  function invalidate(id) {
    const changed = id ? confirmed.delete(id) : confirmed.size > 0;
    if (!id) confirmed = new Map();
    if (changed) onChanged();
  }

  api.bookmarks.onCreated.addListener((_id, bookmark) => {
    if (bookmark.type === "bookmark") observe();
  });
  api.bookmarks.onChanged.addListener((id, changes) => {
    if (!("url" in changes)) return;
    invalidate(id);
    observe();
  });
  api.bookmarks.onRemoved.addListener((id, info) => {
    // Recursive folder removals only emit the folder's event, not descendants.
    invalidate(info.node.type === "folder" ? null : id);
    observe();
  });

  function matchingTab(matches, bookmark) {
    const key = urlKey(bookmark?.url);
    const entry = matches.get(bookmark?.id);
    // ID prevents a deleted row being confirmed by another bookmark with the
    // same URL; URL prevents an edited, not-yet-refreshed row being confirmed.
    return key && entry?.url === key ? entry.tab : undefined;
  }

  async function revalidate(bookmark) {
    let currentRevision;
    let matches;
    do {
      currentRevision = revision;
      matches = await refresh();
      // Retry on source changes, not on another click's refresh request:
      // overlapping clicks must not keep superseding each other's lookups.
    } while (currentRevision !== revision);
    return matchingTab(matches, bookmark);
  }

  async function activate(bookmark) {
    // Always recheck, even if no highlight is present yet or an old one remains.
    const tab = await revalidate(bookmark);
    if (!tab) return false;
    try {
      await api.tabs.update(tab.id, { active: true });
    } catch (error) {
      // A tab can close between querying and activating. Use another match,
      // or let the link navigate normally; retain real API errors for the UI.
      const replacement = await revalidate(bookmark);
      if (replacement?.id === tab.id) throw error;
      if (!replacement) return false;
      await api.tabs.update(replacement.id, { active: true });
    }
    return true;
  }

  const ready = refresh();
  return { ready, refresh, has: bookmark => Boolean(matchingTab(confirmed, bookmark)), activate };
}
