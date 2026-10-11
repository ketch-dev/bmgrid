import { nodeType } from "./bookmarks.js";

export function gridColumns(width, gap = 16) {
  return Math.max(1, Math.min(6, Math.floor((width + gap) / (400 + gap))));
}

// Count rendered folder rows; full-width bookmark groups break folder runs.
export function folderRowCount(types, columns) {
  let rows = 0;
  let column = 0;
  for (const type of types) {
    if (type === "bookmark") column = 0;
    else if (type === "folder") {
      if (column === 0) rows++;
      column = (column + 1) % columns;
    }
  }
  return rows;
}

// Each bookmark run spans the grid, forcing the surrounding folder cards onto
// separate rows without changing any native sibling positions.
export function topLevelGroups(children) {
  const groups = [];
  for (const node of children) {
    const type = nodeType(node);
    if (type !== "bookmark" && type !== "folder") continue;
    if (type === "bookmark" && groups.at(-1)?.type === "bookmark") {
      groups.at(-1).nodes.push(node);
    } else {
      groups.push({ type, nodes: [node] });
    }
  }
  return groups;
}
