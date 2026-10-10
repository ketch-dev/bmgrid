import { OTHER_BOOKMARKS_ID, canMoveToFolder, nodeType } from "./bookmarks.js";

const GRID_EDGE_GAP = 16;
const CONTENT_EDGE_GAP = 8;
const BOOKMARK_EDGE_GAP = 8;
const DROP_LINE_WIDTH = 2;

function sameRow(a, b) {
  return Math.abs(a.top - b.top) < 1;
}

function validBox(box) {
  return box.right > box.left && box.bottom > box.top ? box : null;
}

function sideGapBox(item, bounds, before, gap) {
  return {
    left: before ? Math.max(bounds.left, item.left - gap) : item.right,
    right: before ? item.left : Math.min(bounds.right, item.right + gap),
    top: item.top, bottom: item.bottom, vertical: true,
  };
}

// A boundary keeps its native siblings separate from the hovered edge. Most
// gaps share hit/indicator areas; grid top/bottom zones indicate at a card side.
export function folderGapGeometry({ previous, next, container, edge }) {
  const grid = container.id === "folders";
  let hitBox;
  let indicatorBox;
  if (edge) {
    const before = edge === "left" || edge === "top";
    const item = (before ? next : previous).getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    const outer = grid ? container.parentElement.getBoundingClientRect() : bounds;
    const gap = grid ? GRID_EDGE_GAP : CONTENT_EDGE_GAP;
    if (edge === "left" || edge === "right") {
      hitBox = sideGapBox(item, outer, before, gap);
      indicatorBox = hitBox;
    } else {
      const preceding = grid ? container.previousElementSibling?.getBoundingClientRect() : null;
      const start = preceding?.height > 0 ? preceding.bottom : outer.top;
      hitBox = {
        left: grid ? bounds.left : Math.max(bounds.left, item.left),
        right: grid ? bounds.right : Math.min(bounds.right, item.right),
        top: before ? Math.max(outer.top, start, item.top - gap) : item.bottom,
        bottom: before ? item.top : Math.min(outer.bottom, item.bottom + gap),
        vertical: false,
      };
      indicatorBox = grid ? sideGapBox(item, outer, before, gap) : hitBox;
    }
  } else {
    const a = previous.getBoundingClientRect();
    const b = next.getBoundingClientRect();
    // Wrapped boundaries have two explicit side gaps, never a between-row zone.
    if (grid && !sameRow(a, b)) return null;
    hitBox = grid
      ? { left: a.right, right: b.left, top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom), vertical: true }
      : { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: a.bottom, bottom: b.top, vertical: false };
    indicatorBox = hitBox;
  }
  return validBox(hitBox) ? { hitBox, indicatorBox: validBox(indicatorBox) } : null;
}

export function dropLineBox(intent) {
  if (!intent || intent.indicator === "inside") return null;
  if (intent.empty) {
    const bounds = intent.element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: DROP_LINE_WIDTH, height: 32 };
  }
  const { element, indicator, boundary } = intent;
  let box;
  let viewport;
  if (boundary) {
    box = folderGapGeometry(boundary)?.indicatorBox;
    if (!box) return null;
    viewport = boundary.container.closest(".folder-card")
      ?.querySelector(".folder-content").getBoundingClientRect();
  } else {
    // Only bookmarks use on-item insertion zones; folders always use gaps.
    const bounds = element.getBoundingClientRect();
    const vertical = element.parentElement.classList.contains("direct-bookmarks");
    const before = indicator === "before";
    const [start, end] = vertical ? ["left", "right"] : ["top", "bottom"];
    const neighbor = (before ? element.previousElementSibling : element.nextElementSibling)
      ?.getBoundingClientRect();
    let gap = vertical ? BOOKMARK_EDGE_GAP : 0;
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
  const x = box.vertical ? (box.left + box.right) / 2 - DROP_LINE_WIDTH / 2 : box.left;
  const y = box.vertical ? box.top : (box.top + box.bottom) / 2 - DROP_LINE_WIDTH / 2;
  const left = Math.max(x, viewport?.left ?? x);
  const right = Math.min(box.vertical ? x + DROP_LINE_WIDTH : box.right, viewport?.right ?? Infinity);
  const top = Math.max(y, viewport?.top ?? y);
  const bottom = Math.min(box.vertical ? box.bottom : y + DROP_LINE_WIDTH, viewport?.bottom ?? Infinity);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top } : null;
}

function itemId(element) {
  return element?.dataset.folderId ?? element?.dataset.bookmarkId;
}

function renderedChildren(container) {
  return [...container.children].flatMap(child =>
    child.classList.contains("direct-bookmarks") ? [...child.children] : [child])
    .filter(child => itemId(child));
}

function insertionGap(event) {
  const container = event.target.closest(".folder-content, #folders")
    ?? event.target.closest("#page")?.querySelector("#folders");
  if (!container) return null;
  const children = renderedChildren(container);
  if (!children.length) return null;
  const boundaries = [];
  for (let index = 1; index < children.length; index++) {
    const previous = children[index - 1];
    const next = children[index];
    const boundary = { previous, next, container };
    if (container.id === "folders"
        && !sameRow(previous.getBoundingClientRect(), next.getBoundingClientRect())) {
      // Both row sides share the same native insertion anchor, but each keeps
      // its own geometry so the marker stays beside the hovered row.
      boundaries.push({ ...boundary, edge: "right" }, { ...boundary, edge: "left" });
    } else {
      boundaries.push(boundary);
    }
  }
  for (const edge of container.id === "folders" ? ["left", "right", "top", "bottom"] : ["top", "bottom"]) {
    const before = edge === "left" || edge === "top";
    boundaries.push({
      previous: before ? null : children.at(-1),
      next: before ? children[0] : null,
      container, edge,
    });
  }
  for (const boundary of boundaries) {
    const box = folderGapGeometry(boundary)?.hitBox;
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

  const boundary = insertionGap(event);
  if (boundary) {
    // Anchor to the other sibling when the source borders its own gap.
    const before = !!boundary.next && itemId(boundary.next) !== sourceId;
    const element = before ? boundary.next : boundary.previous;
    const intent = beside(element, nodes.get(itemId(element)), before);
    return intent ? { ...intent, boundary } : null;
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
  const root = event.target.closest("#folders")
    ?? event.target.closest("#page, body, html")?.querySelector("#folders");
  if (!root || !canMoveToFolder(nodes, sourceId, OTHER_BOOKMARKS_ID)) return null;
  const children = renderedChildren(root);
  if (!children.length) {
    return { element: root, destination: { parentId: OTHER_BOOKMARKS_ID }, indicator: "before", empty: true };
  }
  const group = event.target.closest(".direct-bookmarks");
  if (!group && nodeType(source) !== "bookmark") return null;
  const items = group ? renderedChildren(group) : children;
  const last = items.at(-1);
  if (!last) return null;
  const destination = { parentId: OTHER_BOOKMARKS_ID };
  if (itemId(last) === sourceId) {
    // Keep already-last items in their exact native slot, including around
    // separators that are not displayed. Never use the source as its own anchor.
    const siblings = nodes.get(OTHER_BOOKMARKS_ID).children ?? [];
    const next = siblings[siblings.findIndex(item => item.id === sourceId) + 1];
    if (next) Object.assign(destination, { anchorId: next.id, position: "before" });
  } else if (group) {
    // A group is a position in the root sequence, not a destination folder.
    Object.assign(destination, { anchorId: itemId(last), position: "after" });
  }
  return {
    element: last, destination, indicator: "after",
    boundary: { previous: last, next: null, container: root, edge: "right" },
  };
}
