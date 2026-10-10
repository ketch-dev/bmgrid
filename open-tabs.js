function urlKey(url) {
  if (!url) return null;
  try {
    // Normalize browser URL serialization (such as a missing root slash),
    // while keeping paths, queries, fragments, and schemes distinct.
    return new URL(url).href;
  } catch {
    return null;
  }
}

export function createOpenTabs(api, onChanged) {
  let urls = new Set();
  let version = 0;

  async function refresh() {
    const currentVersion = ++version;
    // Resolve the grid's own tab each time: it can move to another window,
    // and the last-focused window need not be the one containing this page.
    const current = await api.tabs.getCurrent();
    const snapshot = await api.tabs.query({ windowId: current.windowId });
    snapshot.sort((a, b) => a.index - b.index);
    if (currentVersion === version) {
      urls = new Set(snapshot.map(tab => urlKey(tab.url)).filter(Boolean));
      onChanged();
    }
    return snapshot;
  }

  function observe() {
    refresh().catch(error => { console.error("bmgrid open tabs:", error); });
  }

  for (const event of [api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onMoved,
    api.tabs.onAttached, api.tabs.onDetached]) {
    event.addListener(observe);
  }
  api.tabs.onUpdated.addListener((_id, changes) => {
    if ("url" in changes) observe();
  });

  function matchingTab(snapshot, url) {
    const key = urlKey(url);
    return key ? snapshot.find(tab => urlKey(tab.url) === key) : undefined;
  }

  async function activate(url) {
    // Always recheck, even if no highlight is present yet or an old one remains.
    const tab = matchingTab(await refresh(), url);
    if (!tab) return false;
    try {
      await api.tabs.update(tab.id, { active: true });
    } catch (error) {
      // A tab can close between querying and activating. Use another match,
      // or let the link navigate normally; retain real API errors for the UI.
      const replacement = matchingTab(await refresh(), url);
      if (replacement?.id === tab.id) throw error;
      if (!replacement) return false;
      await api.tabs.update(replacement.id, { active: true });
    }
    return true;
  }

  const ready = refresh();
  return { ready, refresh, has: url => urls.has(urlKey(url)), activate };
}
