import { OTHER_BOOKMARKS_ID, nodeType } from "./bookmarks.js";
import { gridMetrics } from "./layout.js";

const unfoldered = document.querySelector("#unfoldered");
const direct = document.querySelector("#direct-bookmarks");
const folders = document.querySelector("#folders");
const status = document.querySelector("#status");
const DRAG_TYPE = "application/x-bmgrid-bookmark";
let nodes = new Map();
let folderCount = 0;
let editing = null;
let dragging = null;
let pendingRefresh = false;
let refreshTimer;
let refreshVersion = 0;

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

function updateLayout() {
  const pageTop = folders.getBoundingClientRect().top + window.scrollY;
  const statusHeight = status.hidden ? 0 : status.offsetHeight + 12;
  const bottomPadding = parseFloat(getComputedStyle(document.querySelector("#page")).paddingBottom);
  const gap = parseFloat(getComputedStyle(folders).rowGap);
  const height = window.innerHeight - pageTop - statusHeight - bottomPadding;
  const metrics = gridMetrics(folders.clientWidth, height, folderCount, gap);
  folders.style.setProperty("--columns", metrics.columns);
  folders.style.setProperty("--row-height", `${metrics.rowHeight}px`);
}

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths = {
    pen: "M3 10.5 10.5 3l2.5 2.5L5.5 13 2 14l1-3.5ZM9 4.5 11.5 7",
    cross: "M4 4l8 8M12 4l-8 8",
  };
  path.setAttribute("d", paths[kind]);
  svg.append(path);
  return svg;
}

function iconButton(name, kind) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.title = name;
  button.setAttribute("aria-label", name);
  button.append(icon(kind));
  return button;
}

function startRename(node, container, name, actions) {
  if (editing) return;
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = node.title;
  input.setAttribute("aria-label", `Rename ${node.title || node.url || "folder"}`);
  editing = input;
  name.hidden = true;
  for (const button of actions) button.hidden = true;
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
        await request("rename", { id: node.id, title });
      } catch (error) {
        showError(error);
      }
    }
    editing = null;
    input.remove();
    name.hidden = false;
    for (const button of actions) button.hidden = false;
    scheduleRefresh();
  }

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === "Enter");
    }
  });
  input.addEventListener("blur", () => { finish(true); });
}

function appendTitle(node, container, isLink) {
  const name = document.createElement(isLink ? "a" : "span");
  name.className = "item-name";
  name.textContent = node.title || node.url || "Untitled folder";
  name.title = isLink ? `${node.title}\n${node.url}` : node.title;
  if (isLink) {
    // Native links give current-tab left clicks and new-tab middle clicks,
    // without requesting access to browsing history or tab information.
    name.href = node.url;
  }
  const rename = iconButton(`Rename ${node.title || node.url || "folder"}`, "pen");
  const remove = iconButton(`Delete ${node.title || node.url || "folder"}`, "cross");
  rename.addEventListener("click", () => { startRename(node, container, name, [rename, remove]); });
  remove.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();
    perform("delete", { id: node.id });
  });
  container.append(name, rename, remove);
}

function makeDraggable(element, node) {
  element.draggable = true;
  element.addEventListener("dragstart", event => {
    if (editing || event.target.closest("button, input")) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
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
  appendTitle(node, row, true);
  makeDraggable(row, node);
  return row;
}

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
  const scrollPositions = new Map([...folders.querySelectorAll(".folder-card")]
    .map(card => [card.dataset.folderId, card.querySelector(".folder-content").scrollTop]));
  nodes = new Map();
  function index(node) {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  }
  index(tree);
  direct.replaceChildren();
  folders.replaceChildren();
  folderCount = 0;
  for (const node of tree.children ?? []) {
    if (nodeType(node) === "bookmark") direct.append(renderBookmark(node));
    else if (nodeType(node) === "folder") {
      folderCount++;
      const card = renderFolder(node);
      folders.append(card);
      card.querySelector(".folder-content").scrollTop = scrollPositions.get(node.id) ?? 0;
    }
  }
  updateLayout();
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
  for (const element of document.querySelectorAll("[data-drop]")) {
    delete element.dataset.drop;
  }
}

function dropIntent(event, sourceId) {
  const source = nodes.get(sourceId);
  if (!source) return null;
  if (nodeType(source) === "folder") {
    const target = event.target.closest("[data-folder-id]");
    const targetNode = nodes.get(target?.dataset.folderId);
    if (!targetNode || targetNode.id === sourceId || targetNode.parentId !== source.parentId) {
      return null;
    }
    const box = target.classList.contains("folder-card")
      ? target.getBoundingClientRect()
      : target.querySelector(".folder-heading").getBoundingClientRect();
    const before = target.classList.contains("folder-card")
      ? event.clientX < box.left + box.width / 2
      : event.clientY < box.top + box.height / 2;
    return {
      element: target,
      destination: { parentId: source.parentId, anchorId: targetNode.id, position: before ? "before" : "after" },
      indicator: before ? "before" : "after",
    };
  }

  const row = event.target.closest("[data-bookmark-id]");
  if (row) {
    const targetNode = nodes.get(row.dataset.bookmarkId);
    if (!targetNode || targetNode.id === sourceId) return null;
    const box = row.getBoundingClientRect();
    const before = targetNode.parentId === OTHER_BOOKMARKS_ID
      ? event.clientX < box.left + box.width / 2
      : event.clientY < box.top + box.height / 2;
    return {
      element: row,
      destination: { parentId: targetNode.parentId, anchorId: targetNode.id, position: before ? "before" : "after" },
      indicator: before ? "before" : "after",
    };
  }
  const folder = event.target.closest("[data-folder-id]");
  if (folder) {
    return { element: folder, destination: { parentId: folder.dataset.folderId }, indicator: "inside" };
  }
  if (event.target.closest("#unfoldered")) {
    return { element: unfoldered, destination: { parentId: OTHER_BOOKMARKS_ID }, indicator: "inside" };
  }
  if (event.target.closest("#folders")) {
    return { element: folders, destination: { parentId: OTHER_BOOKMARKS_ID }, indicator: "inside" };
  }
  return null;
}

document.addEventListener("dragover", event => {
  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
  const intent = dropIntent(event, dragging);
  clearDropIndicator();
  if (intent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    intent.element.dataset.drop = intent.indicator;
  }
});

document.addEventListener("dragleave", event => {
  if (!event.relatedTarget) clearDropIndicator();
});

document.addEventListener("drop", event => {
  const sourceId = event.dataTransfer.getData(DRAG_TYPE);
  const intent = dropIntent(event, sourceId);
  if (!intent) return;
  event.preventDefault();
  clearDropIndicator();
  dragging = null;
  perform("move", { id: sourceId, destination: intent.destination });
});

document.addEventListener("keydown", event => {
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z"
      && !event.target.closest("input, textarea, [contenteditable]")) {
    event.preventDefault();
    perform("undo");
  }
});

for (const event of [browser.bookmarks.onCreated, browser.bookmarks.onChanged,
  browser.bookmarks.onMoved, browser.bookmarks.onRemoved]) {
  event.addListener(scheduleRefresh);
}

window.addEventListener("resize", updateLayout);
const observer = new ResizeObserver(updateLayout);
observer.observe(unfoldered);
observer.observe(status);
refresh();
