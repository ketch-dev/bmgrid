import { nodeType } from "./bookmarks.js";

export function gridColumns(width, gap = 16) {
  return Math.max(1, Math.min(6, Math.floor((width + gap) / (400 + gap))));
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
