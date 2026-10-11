import { OTHER_BOOKMARKS_ID } from "./bookmarks.js";

function toolbarColor(theme) {
  for (const value of [theme?.colors?.icons, theme?.colors?.toolbar_text, theme?.colors?.bookmark_text]) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length === 3) return `rgb(${value.join(", ")})`;
  }
  return null;
}

async function renderToolbarIcon(color, filled) {
  if (!CSS.supports("color", color)) throw new Error("Invalid browser toolbar color.");
  const response = await fetch("toolbar-icon.svg");
  if (!response.ok) throw new Error("Could not load the toolbar icon.");
  const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml").documentElement;
  svg.setAttribute("stroke", color);
  svg.setAttribute("fill", filled ? color : "none");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  const image = new Image();
  image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await image.decode();

  const imageData = {};
  for (const size of [16, 32, 64]) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, size, size);
    imageData[size] = context.getImageData(0, 0, size, size);
  }
  return imageData;
}

export function startToolbarIconBackground(api, renderIcon = renderToolbarIcon) {
  const states = new Map();
  let queue = Promise.resolve();

  async function isBookmarked(tab) {
    try {
      if (!tab?.url) return false;
      for (const bookmark of await api.bookmarks.search({ url: tab.url })) {
        if (bookmark.type !== "bookmark") continue;
        try {
          let parentId = bookmark.parentId;
          while (parentId) {
            if (parentId === OTHER_BOOKMARKS_ID) return true;
            const [parent] = await api.bookmarks.get(parentId);
            parentId = parent?.parentId;
          }
        } catch {
          // A removed or unavailable ancestor cannot confirm this match.
          // Continue checking other saved copies of the same page.
        }
      }
    } catch {
      // Restricted browser URLs and failed lookups are never confirmed saved.
    }
    return false;
  }

  async function refresh(windowId) {
    if (!states.has(windowId)) states.set(windowId, undefined);
    try {
      const color = toolbarColor(await api.theme.getCurrent(windowId));
      if (!states.has(windowId)) return;
      const [tab] = await api.tabs.query({ active: true, windowId });
      const filled = await isBookmarked(tab);
      const previous = states.get(windowId);
      if (previous?.color === color && previous?.filled === filled) return;
      const icon = color !== null ? { imageData: await renderIcon(color, filled) }
        : filled ? { path: "toolbar-icon-filled.svg" } : {};
      const [current] = await api.tabs.query({ active: true, windowId });
      // A tab can switch or navigate while the lookup or render is pending.
      if (!states.has(windowId) || current?.id !== tab?.id || current?.url !== tab?.url) return;
      // An empty icon restores the window's native outline theme icons.
      await api.action.setIcon({ windowId, ...icon });
      if (states.has(windowId)) states.set(windowId, { color, filled });
    } catch (error) {
      if (states.has(windowId)) console.error("bmgrid toolbar icon:", error);
    }
  }

  function update(windowId) {
    // One queue keeps reads, renders, and writes in order across all events.
    queue = queue.then(async () => {
      const windows = windowId === undefined
        ? await api.windows.getAll({ windowTypes: ["normal"] }) : [{ id: windowId }];
      for (const window of windows) await refresh(window.id);
    }).catch(error => console.error("bmgrid toolbar icon:", error));
    return queue;
  }

  // Register synchronously so these events can wake an idle background page.
  api.theme.onUpdated.addListener(({ windowId }) => update(windowId));
  api.windows.onCreated.addListener(window => {
    if (window.type === "normal") update(window.id);
  });
  api.windows.onRemoved.addListener(windowId => states.delete(windowId));
  api.tabs.onActivated.addListener(({ windowId }) => update(windowId));
  api.tabs.onUpdated.addListener((_id, changes, tab) => {
    if (tab.active && ("url" in changes || changes.status === "complete")) update(tab.windowId);
  });
  api.tabs.onCreated.addListener(tab => { if (tab.active) update(tab.windowId); });
  api.tabs.onRemoved.addListener((_id, info) => { if (!info.isWindowClosing) update(info.windowId); });
  api.tabs.onAttached.addListener((_id, info) => update(info.newWindowId));
  api.tabs.onDetached.addListener((_id, info) => update(info.oldWindowId));
  api.bookmarks.onCreated.addListener((_id, bookmark) => { if (bookmark.type === "bookmark") update(); });
  api.bookmarks.onChanged.addListener((_id, changes) => { if ("url" in changes) update(); });
  api.bookmarks.onMoved.addListener(() => update());
  api.bookmarks.onRemoved.addListener(() => update());

  return { ready: update(), idle: () => queue };
}
