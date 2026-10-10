function toolbarColor(theme) {
  for (const value of [theme?.colors?.icons, theme?.colors?.toolbar_text, theme?.colors?.bookmark_text]) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length === 3) return `rgb(${value.join(", ")})`;
  }
  return null;
}

async function renderToolbarIcon(color) {
  if (!CSS.supports("color", color)) throw new Error("Invalid browser toolbar color.");
  const response = await fetch("toolbar-icon.svg");
  if (!response.ok) throw new Error("Could not load the toolbar icon.");
  const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml").documentElement;
  svg.setAttribute("stroke", color);
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
  const colors = new Map();
  let queue = Promise.resolve();

  async function refresh(windowId) {
    if (!colors.has(windowId)) colors.set(windowId, undefined);
    try {
      const color = toolbarColor(await api.theme.getCurrent(windowId));
      if (!colors.has(windowId) || color === colors.get(windowId)) return;
      const imageData = color === null ? undefined : await renderIcon(color);
      if (!colors.has(windowId)) return;
      // Omitting imageData/path restores this window's manifest theme icons.
      await api.action.setIcon({ windowId, ...(imageData ? { imageData } : {}) });
      if (colors.has(windowId)) colors.set(windowId, color);
    } catch (error) {
      if (colors.has(windowId)) console.error("bmgrid toolbar icon:", error);
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
  api.windows.onRemoved.addListener(windowId => colors.delete(windowId));

  return { ready: update(), idle: () => queue };
}
