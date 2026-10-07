import { OTHER_BOOKMARKS_ID, canMoveToFolder, nodeType } from "./bookmarks.js";

export function folderGapBox({ previous, next, container }) {
  const a = previous.getBoundingClientRect();
  const b = next.getBoundingClientRect();
  const grid = container.id === "folders";
  const vertical = grid && Math.abs(a.top - b.top) < 1;
  const box = vertical
    ? { left: a.right, right: b.left, top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) }
    : { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: a.bottom, bottom: b.top };
  // A wrapped grid boundary separates whole rows, rather than two columns.
  if (grid && !vertical) {
    const bounds = container.getBoundingClientRect();
    box.left = bounds.left;
    box.right = bounds.right;
  }
  return box.right > box.left && box.bottom > box.top ? { ...box, vertical } : null;
}

export function dropLineBox(intent) {
  if (!intent || intent.indicator === "inside") return null;
  const { element, indicator, boundary } = intent;
  let box;
  let viewport;
  if (boundary) {
    box = folderGapBox(boundary);
    if (!box) return null;
    viewport = boundary.container.closest(".folder-card")
      ?.querySelector(".folder-content").getBoundingClientRect();
  } else {
    // Only bookmarks use on-item insertion zones; folders always use gaps.
    const bounds = element.getBoundingClientRect();
    const vertical = element.parentElement.id === "direct-bookmarks";
    const before = indicator === "before";
    const [start, end] = vertical ? ["left", "right"] : ["top", "bottom"];
    const neighbor = (before ? element.previousElementSibling : element.nextElementSibling)
      ?.getBoundingClientRect();
    let gap = vertical ? 8 : 0;
    if (neighbor && (!vertical || neighbor.top === bounds.top)) {
      gap = before ? bounds[start] - neighbor[end] : neighbor[start] - bounds[end];
    }
    const center = bounds[before ? start : end] + (before ? -gap : gap) / 2;
    box = vertical
      ? { left: center, right: center, top: bounds.top, bottom: bounds.bottom, vertical }
      : { left: bounds.left, right: bounds.right, top: center, bottom: center, vertical };
    if (!vertical) {
      // Only the outer card's content scrolls; retain the bookmark row's width.
      const bounds = element.closest(".folder-card").querySelector(".folder-content").getBoundingClientRect();
      viewport = { top: bounds.top, bottom: bounds.bottom };
    }
  }
  const x = box.vertical ? (box.left + box.right) / 2 - 1 : box.left;
  const y = box.vertical ? box.top : (box.top + box.bottom) / 2 - 1;
  const left = Math.max(x, viewport?.left ?? x);
  const right = Math.min(box.vertical ? x + 2 : box.right, viewport?.right ?? Infinity);
  const top = Math.max(y, viewport?.top ?? y);
  const bottom = Math.min(box.vertical ? box.bottom : y + 2, viewport?.bottom ?? Infinity);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top } : null;
}

function folderGap(event) {
  const container = event.target.closest(".folder-content, #folders");
  if (!container) return null;
  const children = [...container.children];
  for (let index = 1; index < children.length; index++) {
    const previous = children[index - 1];
    const next = children[index];
    // Preserve insertion positions among mixed native folder contents as well.
    if (!previous.dataset.folderId && !next.dataset.folderId) continue;
    const boundary = { previous, next, container };
    const box = folderGapBox(boundary);
    if (box && event.clientX > box.left && event.clientX < box.right
        && event.clientY > box.top && event.clientY < box.bottom) return boundary;
  }
  return null;
}

export function dropIntent(event, sourceId, nodes) {
  const source = nodes.get(sourceId);
  if (!source) return null;

  function inside(element, parentId) {
    return canMoveToFolder(nodes, sourceId, parentId)
      ? { element, destination: { parentId }, indicator: "inside" } : null;
  }

  function beside(element, target, before) {
    if (!target || target.id === sourceId || !canMoveToFolder(nodes, sourceId, target.parentId)) {
      return null;
    }
    const position = before ? "before" : "after";
    return {
      element,
      destination: { parentId: target.parentId, anchorId: target.id, position },
      indicator: position,
    };
  }

  if (nodeType(source) === "folder") {
    const boundary = folderGap(event);
    if (boundary) {
      const id = element => element.dataset.folderId ?? element.dataset.bookmarkId;
      // Anchor to the other sibling when the source borders its own gap.
      const before = id(boundary.next) !== sourceId;
      const element = before ? boundary.next : boundary.previous;
      const intent = beside(element, nodes.get(id(element)), before);
      return intent ? { ...intent, boundary } : null;
    }
  }

  const folder = event.target.closest("[data-folder-id]");
  const row = event.target.closest("[data-bookmark-id]");
  if (nodeType(source) !== "folder" && row) {
    const target = nodes.get(row.dataset.bookmarkId);
    if (!target) return null;
    const box = row.getBoundingClientRect();
    const before = target.parentId === OTHER_BOOKMARKS_ID
      ? event.clientX < box.left + box.width / 2
      : event.clientY < box.top + box.height / 2;
    return beside(row, target, before);
  }
  if (folder) return inside(folder, folder.dataset.folderId);
  const root = event.target.closest("#unfoldered")
    ?? (nodeType(source) === "bookmark" ? event.target.closest("#folders") : null);
  return root ? inside(root, OTHER_BOOKMARKS_ID) : null;
}
