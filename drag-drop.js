import { OTHER_BOOKMARKS_ID, canMoveToFolder, nodeType } from "./bookmarks.js";

const GRID_EDGE_GAP = 16;
const CONTENT_EDGE_GAP = 8;
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
  // A cached wrapped-row side becomes the ordinary measured gap after resize.
  if (grid && previous && next && (edge === "left" || edge === "right")
      && sameRow(previous.getBoundingClientRect(), next.getBoundingClientRect())) edge = null;
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
  if (!intent) return null;
  const { element, indicator } = intent;
  const boundary = intent.boundary ?? (intent.empty ? null : bookmarkBoundary(element, indicator === "before"));
  let box;
  let viewport;
  if (intent.empty) {
    const bounds = element.getBoundingClientRect();
    if (element.id === "folders") {
      box = { left: bounds.left + DROP_LINE_WIDTH / 2, right: bounds.left + DROP_LINE_WIDTH / 2,
        top: bounds.top, bottom: bounds.top + 32, vertical: true };
    } else {
      box = { left: bounds.left + CONTENT_EDGE_GAP, right: bounds.right - CONTENT_EDGE_GAP,
        top: bounds.top + CONTENT_EDGE_GAP, bottom: bounds.top + CONTENT_EDGE_GAP, vertical: false };
      viewport = element.closest(".folder-card")?.querySelector(".folder-content").getBoundingClientRect();
    }
  } else {
    box = folderGapGeometry(boundary)?.indicatorBox;
    if (!box) return null;
    viewport = boundary.container.closest(".folder-card")
      ?.querySelector(".folder-content").getBoundingClientRect();
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

function bookmarkBoundary(element, before) {
  const container = element.parentElement.classList.contains("direct-bookmarks")
    ? element.closest("#folders") : element.parentElement;
  const children = renderedChildren(container);
  const index = children.indexOf(element);
  const previous = before ? children[index - 1] ?? null : element;
  const next = before ? element : children[index + 1] ?? null;
  const grid = container.id === "folders";
  const edge = !previous ? (grid ? "left" : "top")
    : !next ? (grid ? "right" : "bottom")
    : grid && !sameRow(previous.getBoundingClientRect(), next.getBoundingClientRect())
      ? (before ? "left" : "right") : null;
  // Row halves and surrounding padding identify the same native boundary;
  // keep its measured geometry identical instead of inventing a row offset.
  return { previous, next, container, edge };
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
    // Match painted rectangles: the leading edge belongs to the gap, while
    // the trailing edge belongs to the next item/row. Do not leave a pixel
    // at the leading edge that can fall through to a canvas append target.
    if (box && event.clientX >= box.left && event.clientX < box.right
        && event.clientY >= box.top && event.clientY < box.bottom) return boundary;
  }
  return null;
}

function reservedGridSpace(root, event) {
  const bounds = root.getBoundingClientRect();
  let left = bounds.left;
  let right = bounds.right;
  let previousRow = null;
  let inGutter = false;
  for (const child of root.children) {
    if (!child.dataset.folderId && !child.classList.contains("direct-bookmarks")) continue;
    const box = validBox(child.getBoundingClientRect());
    if (!box) continue;
    // Rounded corners can expose the grid background within a card's bounds.
    // Those pixels belong to the card, not to an unused canvas append area.
    if (child.dataset.folderId && event.clientX >= box.left && event.clientX < box.right
        && event.clientY >= box.top && event.clientY < box.bottom) return true;
    // Grid tracks can overflow the container on windows narrower than 400px.
    left = Math.min(left, box.left);
    right = Math.max(right, box.right);
    if (previousRow && sameRow(previousRow, box)) {
      previousRow.bottom = Math.max(previousRow.bottom, box.bottom);
    } else {
      if (previousRow && event.clientY >= previousRow.bottom && event.clientY < box.top) inGutter = true;
      previousRow = { top: box.top, bottom: box.bottom };
    }
  }
  return inGutter && event.clientX >= left && event.clientX < right;
}

export function dropIntent(event, sourceId, nodes) {
  const source = nodes.get(sourceId);
  if (!source || event.target.closest(".folder-heading")) return null;
  const folder = event.target.closest("[data-folder-id]");
  // A card/section border is not a gap target, even at a measured gap edge.
  if (folder && event.target.closest(".folder-content")?.closest("[data-folder-id]") !== folder) return null;

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

  function backgroundDestination(parentId, last) {
    const destination = { parentId };
    if (itemId(last) === sourceId) {
      // Keep already-last items in their native slot around hidden separators,
      // without using the source as its own insertion anchor.
      const siblings = nodes.get(parentId).children ?? [];
      const next = siblings[siblings.findIndex(item => item.id === sourceId) + 1];
      if (next) Object.assign(destination, { anchorId: next.id, position: "before" });
    }
    return destination;
  }

  const boundary = insertionGap(event);
  if (boundary) {
    // Anchor to the other sibling when the source borders its own gap.
    const before = !!boundary.next && itemId(boundary.next) !== sourceId;
    const element = before ? boundary.next : boundary.previous;
    const intent = beside(element, nodes.get(itemId(element)), before);
    return intent ? { ...intent, boundary } : null;
  }

  const row = event.target.closest("[data-bookmark-id]");
  if (row) {
    const target = nodes.get(row.dataset.bookmarkId);
    if (!target) return null;
    const box = row.getBoundingClientRect();
    const before = target.parentId === OTHER_BOOKMARKS_ID
      ? event.clientX < box.left + box.width / 2
      : event.clientY < box.top + box.height / 2;
    return beside(row, target, before);
  }
  if (folder) {
    const content = event.target.closest(".folder-content");
    if (!content || content.closest("[data-folder-id]") !== folder
        || !canMoveToFolder(nodes, sourceId, folder.dataset.folderId)) {
      return null;
    }
    const last = renderedChildren(content).at(-1);
    if (!last) {
      return { element: content, destination: { parentId: folder.dataset.folderId }, indicator: "before", empty: true };
    }
    return {
      element: last, destination: backgroundDestination(folder.dataset.folderId, last), indicator: "after",
      boundary: { previous: last, next: null, container: content, edge: "bottom" },
    };
  }
  const root = event.target.closest("#folders")
    ?? event.target.closest("#page, body, html")?.querySelector("#folders");
  if (!root || !canMoveToFolder(nodes, sourceId, OTHER_BOOKMARKS_ID)) return null;
  const children = renderedChildren(root);
  if (!children.length) {
    return { element: root, destination: { parentId: OTHER_BOOKMARKS_ID }, indicator: "before", empty: true };
  }
  const group = event.target.closest(".direct-bookmarks");
  if (!group && (nodeType(source) !== "bookmark" || reservedGridSpace(root, event))) return null;
  const items = group ? renderedChildren(group) : children;
  const last = items.at(-1);
  if (!last) return null;
  const destination = backgroundDestination(OTHER_BOOKMARKS_ID, last);
  if (group && itemId(last) !== sourceId) {
    // A group is a position in the root sequence, not a destination folder.
    Object.assign(destination, { anchorId: itemId(last), position: "after" });
  }
  return {
    element: last, destination, indicator: "after",
    boundary: { previous: last, next: null, container: root, edge: "right" },
  };
}
