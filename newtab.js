import "./theme-page.js";
import { nodeType, OTHER_BOOKMARKS_ID } from "./bookmarks.js";
import { createIconProvider } from "./bookmark-icons.js";
import { createOpenTabs } from "./open-tabs.js";
import { dropIntent, dropLineBox } from "./drag-drop.js";
import { gridColumns, topLevelGroups } from "./layout.js";
import { createRearrangement } from "./rearrangement.js";
import { icon } from "./icons.js";
import { createBookmarkEditor } from "./bookmark-editor.js";

const folders = document.querySelector("#folders");
const status = document.querySelector("#status");
const bookmarkMenu = document.querySelector("#bookmark-menu");
const editMenuLabel = bookmarkMenu.querySelector('[data-action="edit"] span');
const bookmarkEditor = document.querySelector("#bookmark-editor");
const dropLine = document.querySelector("#drop-line");
const rearrangement = createRearrangement(document.querySelector("#page"));
const DRAG_TYPE = "application/x-bmgrid-bookmark";
const SCROLL_SHADOW_FADE_DISTANCE = 16;
const DEFAULT_FAVICON = browser.runtime.getURL("bookmark.svg");
let nodes = new Map();
let editing = null;
let dragging = null;
let pendingRefresh = false;
let refreshTimer;
let refreshVersion = 0;
let menuTarget = null;
let activeDrop = null;
const icons = createIconProvider(browser, updateBookmarkIcons);
icons.ready.catch(error => { console.error("bmgrid icons:", error); });
const openTabs = createOpenTabs(browser, updateOpenBookmarks);
openTabs.ready.catch(error => { console.error("bmgrid open tabs:", error); });
const editor = createBookmarkEditor(bookmarkEditor, request, target => {
  editing = null;
  if (target?.row?.isConnected) target.row.querySelector(".item-name").focus();
  scheduleRefresh();
});

async function request(action, details = {}) {
  const response = await browser.runtime.sendMessage({ scope: "bmgrid", action, ...details });
  if (!response?.ok) throw new Error(response?.error ?? "Unable to access Firefox bookmarks.");
  return response.result;
}

function showError(error) {
  status.textContent = error.message ?? String(error);
  status.hidden = false;
}

async function perform(action, details) {
  status.hidden = true;
  try {
    await request(action, details);
    scheduleRefresh();
  } catch (error) {
    showError(error);
  }
}

function updateGridColumns() {
  const gap = parseFloat(getComputedStyle(folders).columnGap);
  folders.style.setProperty("--columns", gridColumns(folders.clientWidth, gap));
}

function updateLayout() {
  updateGridColumns();
  for (const card of folders.querySelectorAll(".folder-card")) {
    updateFolderScrollShadow(card.querySelector(".folder-content"));
  }
  updateDropIndicator();
}

function updateFolderScrollShadow(content) {
  const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
  const scrollTop = Math.max(0, Math.min(content.scrollTop, maxScroll));
  function strength(distance) {
    // Ignore rounding at the limit, then ease smoothly to full strength.
    const progress = Math.min(1, Math.max(0, distance - 1) / SCROLL_SHADOW_FADE_DISTANCE);
    return progress * progress * (3 - 2 * progress);
  }
  content.parentElement.style.setProperty("--top-shadow-opacity", strength(scrollTop));
  content.parentElement.style.setProperty("--bottom-shadow-opacity", strength(maxScroll - scrollTop));
}

function closeBookmarkMenu(restoreFocus = false) {
  const row = menuTarget?.row;
  menuTarget = null;
  bookmarkMenu.hidden = true;
  document.body.classList.remove("bookmark-menu-open");
  row?.closest(".bookmark, .folder-heading").removeAttribute("data-menu-target");
  if (restoreFocus && row?.isConnected) row.querySelector(".item-name").focus();
}

function openBookmarkMenu(event) {
  const itemRow = event.target.closest(".bookmark, .folder-heading");
  const folder = event.target.closest(".folder-card, .nested-folder");
  const row = itemRow ?? folder?.querySelector(".folder-heading");
  const background = [document.documentElement, document.body, document.querySelector("#page"),
    folders].includes(event.target) || event.target.matches(".direct-bookmarks");
  if ((!row && !background) || editing || dragging) return;
  event.preventDefault();
  closeBookmarkMenu();
  const container = row ? row.querySelector(".item-title-group") ?? row : null;
  const node = container ? nodes.get(container.dataset.itemId) : null;
  const isBookmark = node && nodeType(node) === "bookmark";
  menuTarget = { node, row: container };
  editMenuLabel.textContent = isBookmark ? "Edit" : "Rename";
  for (const button of bookmarkMenu.querySelectorAll('[data-action^="add-"]')) {
    button.hidden = Boolean(isBookmark);
  }
  for (const action of ["edit", "delete"]) {
    bookmarkMenu.querySelector(`[data-action="${action}"]`).hidden = !node || !itemRow;
  }
  bookmarkMenu.hidden = false;
  document.body.classList.add("bookmark-menu-open");
  row?.setAttribute("data-menu-target", "");
  const box = (container?.querySelector(".item-name") ?? folders).getBoundingClientRect();
  const keyboard = event.type === "keydown" || (event.clientX === 0 && event.clientY === 0);
  const x = keyboard ? box.left : event.clientX;
  const y = keyboard ? box.bottom : event.clientY;
  bookmarkMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bookmarkMenu.offsetWidth - 8))}px`;
  bookmarkMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bookmarkMenu.offsetHeight - 8))}px`;
  bookmarkMenu.querySelector("button:not([hidden])").focus();
}

for (const button of bookmarkMenu.children) {
  button.prepend(icon(button.dataset.action.startsWith("add-") ? "plus"
    : button.dataset.action === "edit" ? "pen" : "trash"));
}
bookmarkMenu.addEventListener("click", event => {
  const action = event.target.closest("button")?.dataset.action;
  if (!action || !menuTarget) return;
  const { node, row } = menuTarget;
  closeBookmarkMenu(action === "delete");
  if (action === "add-bookmark" || action === "add-folder") {
    const type = action === "add-bookmark" ? "bookmark" : "folder";
    const destination = { parentId: node?.id ?? OTHER_BOOKMARKS_ID };
    startEditor({ mode: "add", type, destination, row });
  } else if (action === "edit") {
    if (nodeType(node) === "bookmark") startBookmarkEdit(node, row);
    else startFolderRename(node, row);
  } else if (action === "delete") perform("delete", { id: node.id });
});
bookmarkMenu.addEventListener("focusout", event => {
  if (!bookmarkMenu.contains(event.relatedTarget)) closeBookmarkMenu();
});
document.addEventListener("pointerdown", event => {
  if (!bookmarkMenu.contains(event.target)) closeBookmarkMenu();
});
document.addEventListener("contextmenu", event => {
  closeBookmarkMenu();
  openBookmarkMenu(event);
});
document.addEventListener("scroll", () => { closeBookmarkMenu(); }, true);
window.addEventListener("resize", () => { closeBookmarkMenu(); });
window.addEventListener("blur", () => { closeBookmarkMenu(); });

function startBookmarkEdit(node, row) {
  startEditor({ mode: "edit", type: "bookmark", node, row });
}

function startEditor(target) {
  if (editing) return;
  editing = bookmarkEditor;
  if (target.mode === "add") {
    const parentId = target.destination.parentId ?? nodes.get(target.destination.afterId)?.parentId;
    const folder = parentId === OTHER_BOOKMARKS_ID ? null : nodes.get(parentId);
    if (folder) target.destinationName = folder.title || "Untitled";
  }
  editor.open(target);
}

function startFolderRename(node, container) {
  if (editing) return;
  const name = container.querySelector(".item-name");
  const input = document.createElement("input");
  input.className = "folder-rename-input";
  input.value = node.title;
  input.setAttribute("aria-label", `Rename ${node.title || "folder"}`);
  editing = input;
  name.hidden = true;
  container.insertBefore(input, name);
  input.focus();
  input.select();
  let finished = false;

  async function finish(save) {
    if (finished) return;
    finished = true;
    const title = input.value;
    input.disabled = true;
    if (save && title !== node.title) {
      try {
        await request("edit", { id: node.id, title });
      } catch (error) {
        showError(error);
      }
    }
    editing = null;
    input.remove();
    name.hidden = false;
    scheduleRefresh();
  }

  input.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === "Enter");
    }
  });
  input.addEventListener("blur", () => { finish(true); });
}

function appendTitle(node, container, isLink) {
  container.dataset.itemId = node.id;
  const name = document.createElement(isLink ? "a" : "span");
  name.className = "item-name";
  name.textContent = node.title || node.url || "Untitled folder";
  name.title = isLink ? `${node.title}\n${node.url}` : node.title;
  if (isLink) {
    // Keep native links for middle-clicks, modifier-clicks, and context menus.
    name.href = node.url;
  } else {
    name.tabIndex = 0;
  }
  container.append(name);
}

function makeDraggable(element, node) {
  element.draggable = true;
  element.addEventListener("dragstart", event => {
    if (editing || event.target.closest("button, input")) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    closeBookmarkMenu();
    rearrangement.finish();
    dragging = node.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, node.id);
    element.dataset.dragging = "true";
  });
  element.addEventListener("dragend", () => {
    dragging = null;
    delete element.dataset.dragging;
    clearDropIndicator();
    if (pendingRefresh) scheduleRefresh();
  });
}

function renderBookmark(node) {
  const row = document.createElement("div");
  row.className = "bookmark";
  row.dataset.bookmarkId = node.id;
  const image = document.createElement("img");
  image.className = "bookmark-icon";
  image.alt = "";
  image.width = image.height = 16;
  image.draggable = false;
  image.decoding = "async";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    if (image.getAttribute("src") !== DEFAULT_FAVICON) image.src = DEFAULT_FAVICON;
  });
  updateBookmarkIcon(image, node);
  row.append(image);
  appendTitle(node, row, true);
  updateBookmarkOpenState(row, node);
  makeDraggable(row, node);
  return row;
}

function updateBookmarkIcon(image, bookmark) {
  const source = icons.getUrl(bookmark) ?? DEFAULT_FAVICON;
  // Remember the requested source even after an error, to avoid retrying a
  // broken icon whenever an unrelated cache entry changes.
  if (image.dataset.source === source) return;
  image.dataset.source = source;
  image.src = source;
}

function updateBookmarkIcons() {
  for (const image of document.querySelectorAll(".bookmark-icon")) {
    const bookmark = nodes.get(image.closest(".bookmark").dataset.bookmarkId);
    updateBookmarkIcon(image, bookmark);
  }
}

function updateBookmarkOpenState(row, bookmark) {
  const open = openTabs.has(bookmark);
  row.classList.toggle("bookmark-open", open);
  const name = row.querySelector("a.item-name");
  name.title = `${bookmark.title}\n${bookmark.url}`;
  if (open) {
    const description = "Open in this window and confirmed bookmarked by Firefox. Click to switch to its tab; middle-click to open a new tab.";
    name.title += `\n${description}`;
    name.setAttribute("aria-description", description);
  } else {
    name.removeAttribute("aria-description");
  }
}

function updateOpenBookmarks() {
  for (const row of folders.querySelectorAll(".bookmark")) {
    updateBookmarkOpenState(row, nodes.get(row.dataset.bookmarkId));
  }
}

folders.addEventListener("click", async event => {
  const link = event.target.closest(".bookmark > a.item-name");
  if (!link || event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  try {
    const bookmark = nodes.get(link.closest(".bookmark").dataset.bookmarkId);
    if (!await openTabs.activate(bookmark)) window.location.assign(link.href);
  } catch (error) {
    showError(error);
  }
});

function renderFolder(node, nested = false) {
  const section = document.createElement(nested ? "section" : "article");
  section.className = nested ? "nested-folder" : "folder-card";
  section.dataset.folderId = node.id;
  const heading = document.createElement(nested ? "h3" : "h2");
  heading.className = "folder-heading";
  heading.id = `heading-${node.id}`;
  const group = document.createElement("div");
  group.className = "item-title-group";
  appendTitle(node, group, false);
  heading.append(group);
  makeDraggable(heading, node);
  section.setAttribute("aria-labelledby", heading.id);
  const content = document.createElement("div");
  content.className = "folder-content";
  for (const child of node.children ?? []) {
    if (nodeType(child) === "bookmark") content.append(renderBookmark(child));
    else if (nodeType(child) === "folder") content.append(renderFolder(child, true));
  }
  section.append(heading, content);
  return section;
}

function render(tree) {
  const focusedId = document.activeElement.closest("[data-item-id]")?.dataset.itemId;
  closeBookmarkMenu();
  clearDropIndicator();
  const previousPositions = rearrangement.capture();
  const scrollPositions = new Map([...folders.querySelectorAll(".folder-card")]
    .map(card => [card.dataset.folderId, card.querySelector(".folder-content").scrollTop]));
  nodes = new Map();
  function index(node) {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  }
  index(tree);
  folders.replaceChildren();
  for (const group of topLevelGroups(tree.children ?? [])) {
    if (group.type === "folder") folders.append(renderFolder(group.nodes[0]));
    else {
      const direct = document.createElement("div");
      direct.className = "direct-bookmarks";
      direct.setAttribute("role", "group");
      direct.setAttribute("aria-label", "Bookmarks directly in Other Bookmarks");
      for (const node of group.nodes) direct.append(renderBookmark(node));
      folders.append(direct);
    }
  }
  updateGridColumns();
  for (const card of folders.querySelectorAll(".folder-card")) {
    const content = card.querySelector(".folder-content");
    content.scrollTop = scrollPositions.get(card.dataset.folderId) ?? 0;
    updateFolderScrollShadow(content);
  }
  rearrangement.play(previousPositions);
  if (focusedId) {
    document.querySelector(`[data-item-id="${CSS.escape(focusedId)}"] .item-name`)?.focus();
  }
}

async function refresh() {
  if (editing || dragging) {
    pendingRefresh = true;
    return;
  }
  const version = ++refreshVersion;
  try {
    const tree = await request("tree");
    if (version !== refreshVersion) return;
    if (editing || dragging) {
      pendingRefresh = true;
      return;
    }
    pendingRefresh = false;
    render(tree);
  } catch (error) {
    showError(error);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 20);
}

function clearDropIndicator() {
  if (activeDrop) delete activeDrop.element.dataset.drop;
  activeDrop = null;
  dropLine.hidden = true;
}

function updateDropIndicator() {
  const box = dropLineBox(activeDrop);
  dropLine.hidden = !box;
  if (!box) return;
  Object.assign(dropLine.style, {
    left: `${box.left}px`, top: `${box.top}px`,
    width: `${box.width}px`, height: `${box.height}px`,
  });
}

document.addEventListener("dragover", event => {
  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
  const intent = dropIntent(event, dragging, nodes);
  clearDropIndicator();
  if (intent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    intent.element.dataset.drop = intent.indicator;
    activeDrop = intent;
    updateDropIndicator();
  }
});

document.addEventListener("dragleave", event => {
  if (!event.relatedTarget) clearDropIndicator();
});

document.addEventListener("drop", event => {
  const sourceId = event.dataTransfer.getData(DRAG_TYPE);
  const intent = dropIntent(event, sourceId, nodes);
  if (!intent) return;
  event.preventDefault();
  clearDropIndicator();
  dragging = null;
  perform("move", { id: sourceId, destination: intent.destination });
});

document.addEventListener("keydown", event => {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    openBookmarkMenu(event);
    return;
  }
  if (event.key === "Escape" && menuTarget) {
    event.preventDefault();
    event.stopPropagation();
    closeBookmarkMenu(true);
    return;
  }
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z"
      && !editing && !event.target.closest("input, textarea, [contenteditable]")) {
    event.preventDefault();
    perform("undo");
  }
});

for (const event of [browser.bookmarks.onCreated, browser.bookmarks.onChanged,
  browser.bookmarks.onMoved, browser.bookmarks.onRemoved]) {
  event.addListener(scheduleRefresh);
}

window.addEventListener("resize", updateLayout);
document.addEventListener("scroll", event => {
  if (event.target.matches?.(".folder-card > .folder-content")) {
    updateFolderScrollShadow(event.target);
  }
  updateDropIndicator();
}, true);
refresh();
