export const OTHER_BOOKMARKS_ID = "unfiled_____";
export const LOG_LIMIT = 100;
const INVALID_URL_MESSAGE = "Enter a valid URL, such as https://example.com.";

export function nodeType(node) {
  return node.type ?? (node.url === undefined ? "folder" : "bookmark");
}

function normalizeBookmarkUrl(value) {
  if (typeof value !== "string") throw new Error(INVALID_URL_MESSAGE);
  const url = value.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(url);
  // Hostnames with ports look like schemes to the URL parser.
  const hostWithPort = /^(?:localhost|[^\s/?#:]+\.[^\s/?#:]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(url);
  const normalized = url.startsWith("//") ? `https:${url}`
    : hasScheme && !hostWithPort ? url : `https://${url}`;
  try {
    new URL(normalized);
  } catch {
    throw new Error(INVALID_URL_MESSAGE);
  }
  // Validate without serializing: keep query encoding, fragments, and schemes.
  return normalized;
}

export function canMoveToFolder(nodes, sourceId, parentId) {
  let parent = nodes.get(parentId);
  if (!parent || nodeType(parent) !== "folder") return false;
  while (parent) {
    if (parent.id === sourceId) return false;
    parent = nodes.get(parent.parentId);
  }
  return true;
}

function copyNode(node) {
  const copy = {
    id: node.id,
    parentId: node.parentId,
    index: node.index ?? 0,
    type: nodeType(node),
    title: node.title ?? "",
  };
  if (copy.type === "bookmark") copy.url = node.url;
  if (node.children) copy.children = node.children.map(copyNode);
  return copy;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function deletionMessage(node) {
  const name = item => (item.title ?? "").replace(/[\r\n\u2028\u2029]+/g, " ");
  const bookmarkLine = item => `${name(item)} (${item.url})`;
  if (nodeType(node) === "bookmark") return `Deleted: ${bookmarkLine(node)}`;
  const bookmarks = [];
  walk(node, child => {
    if (nodeType(child) === "bookmark") bookmarks.push(bookmarkLine(child));
  });
  return `Deleted ${name(node)} folder with bookmarks:${bookmarks.length ? `\n${bookmarks.join("\n")}` : ""}`;
}

export function createBookmarkController(api) {
  let cache = new Map();
  let deletions = [];
  let log = [];
  const ignoredRemovals = new Set();
  let queue = Promise.resolve();
  let ready;

  function enqueue(operation) {
    const result = queue.then(() => ready).then(operation);
    // A failed operation must not prevent later events or undo attempts.
    queue = result.catch(() => {});
    return result;
  }

  function children(parentId) {
    return [...cache.values()]
      .filter(node => node.parentId === parentId)
      .sort((a, b) => a.index - b.index);
  }

  function reindex(nodes) {
    nodes.forEach((node, index) => { node.index = index; });
  }

  function rememberTree(tree) {
    walk(tree, node => {
      const { children: ignored, ...entry } = copyNode(node);
      cache.set(node.id, entry);
    });
  }

  function cachedTree(id) {
    const node = cache.get(id);
    if (!node) return null;
    const tree = { ...node };
    if (tree.type === "folder") {
      tree.children = children(id).map(child => cachedTree(child.id));
    }
    return tree;
  }

  function saveCache() {
    return api.storage.session.set({ bookmarkCache: [...cache.values()] });
  }

  function saveDeletions() {
    return api.storage.session.set({ deletions });
  }

  function observe(event, operation) {
    event.addListener((...args) => {
      enqueue(() => operation(...args)).catch(error => {
        console.error("bmgrid:", error);
      });
    });
  }

  // Register synchronously so Firefox can wake an idle background page even
  // when no grid tab is open. Read the session cache before handling events:
  // querying the live tree on wake would lose an already-deleted folder.
  observe(api.bookmarks.onCreated, async (id, node) => {
    const siblings = children(node.parentId).filter(child => child.id !== id);
    const entry = copyNode(node);
    delete entry.children;
    siblings.splice(entry.index, 0, entry);
    cache.set(id, entry);
    reindex(siblings);
    await saveCache();
  });

  observe(api.bookmarks.onChanged, async (id, changes) => {
    const node = cache.get(id);
    if (node) Object.assign(node, changes);
    await saveCache();
  });

  observe(api.bookmarks.onMoved, async (id, info) => {
    const node = cache.get(id);
    if (node) {
      reindex(children(node.parentId).filter(child => child.id !== id));
      const siblings = children(info.parentId).filter(child => child.id !== id);
      node.parentId = info.parentId;
      siblings.splice(info.index, 0, node);
      reindex(siblings);
    }
    await saveCache();
  });

  observe(api.bookmarks.onRemoved, async (id, info) => {
    const tree = cachedTree(id) ?? copyNode(info.node);
    // Firefox emits one removal event for a recursively deleted folder,
    // without its children. Our pre-removal cache supplies the full URL list.
    if (!ignoredRemovals.delete(id) && tree.type !== "separator") {
      log = [...log, deletionMessage(tree)].slice(-LOG_LIMIT);
      await api.storage.local.set({ deletionLog: log });
    }
    walk(tree, node => { cache.delete(node.id); });
    reindex(children(info.parentId));
    await saveCache();
  });

  ready = (async () => {
    const [session, local] = await Promise.all([
      api.storage.session.get(["bookmarkCache", "deletions"]),
      api.storage.local.get("deletionLog"),
    ]);
    deletions = session.deletions ?? [];
    log = (local.deletionLog ?? []).slice(-LOG_LIMIT);
    if (session.bookmarkCache) {
      cache = new Map(session.bookmarkCache.map(node => [node.id, node]));
    } else {
      for (const tree of await api.bookmarks.getTree()) rememberTree(tree);
      await saveCache();
    }
  })();

  async function otherTree() {
    return (await api.bookmarks.getSubTree(OTHER_BOOKMARKS_ID))[0];
  }

  async function editableNodes() {
    const nodes = new Map();
    walk(await otherTree(), node => { nodes.set(node.id, node); });
    return nodes;
  }

  function requireItem(nodes, id) {
    const node = nodes.get(id);
    if (!node || id === OTHER_BOOKMARKS_ID || nodeType(node) === "separator") {
      throw new Error("This item is no longer in Other Bookmarks.");
    }
    return node;
  }

  async function remove(id) {
    const nodes = await editableNodes();
    const node = requireItem(nodes, id);
    const siblings = await api.bookmarks.getChildren(node.parentId);
    const index = siblings.findIndex(child => child.id === id);
    const entry = {
      node: copyNode(node),
      beforeId: siblings[index - 1]?.id ?? null,
      afterId: siblings[index + 1]?.id ?? null,
    };
    // Capture current descendants even if their change events are still queued.
    rememberTree(node);
    deletions.push(entry);
    try {
      // Don't remove anything until its undo snapshot is safely in memory.
      await saveDeletions();
      if (nodeType(node) === "folder") await api.bookmarks.removeTree(id);
      else await api.bookmarks.remove(id);
    } catch (error) {
      deletions.pop();
      await saveDeletions();
      throw error;
    }
  }

  async function move(id, destination) {
    const nodes = await editableNodes();
    const node = requireItem(nodes, id);
    const parent = nodes.get(destination.parentId);
    if (!parent || nodeType(parent) !== "folder") {
      throw new Error("The destination folder no longer exists.");
    }
    if (!canMoveToFolder(nodes, node.id, parent.id)) {
      throw new Error("A folder cannot be moved into itself or one of its descendants.");
    }
    const siblings = (await api.bookmarks.getChildren(parent.id))
      .filter(child => child.id !== id);
    let index = siblings.length;
    if (destination.anchorId) {
      index = siblings.findIndex(child => child.id === destination.anchorId);
      if (index < 0) throw new Error("The drop target no longer exists.");
      if (destination.position === "after") index++;
    }
    await api.bookmarks.move(id, { parentId: parent.id, index });
  }

  async function add(message) {
    if (message.type !== "bookmark" && message.type !== "folder") {
      throw new Error("Invalid bookmark type.");
    }
    if (typeof message.title !== "string") throw new Error("Invalid name.");
    const details = { type: message.type, title: message.title };
    if (message.type === "bookmark") details.url = normalizeBookmarkUrl(message.url);
    else if (message.url !== undefined) throw new Error("Folders cannot have a URL.");
    const nodes = await editableNodes();
    if (message.afterId !== undefined) {
      const anchor = requireItem(nodes, message.afterId);
      const siblings = await api.bookmarks.getChildren(anchor.parentId);
      const index = siblings.findIndex(child => child.id === anchor.id);
      if (index < 0) throw new Error("The insertion target no longer exists.");
      details.parentId = anchor.parentId;
      details.index = index + 1;
    } else {
      const parent = nodes.get(message.parentId);
      if (!parent || nodeType(parent) !== "folder") {
        throw new Error("The destination folder no longer exists.");
      }
      details.parentId = parent.id;
    }
    try {
      return await api.bookmarks.create(details);
    } catch (error) {
      if (details.url !== undefined && error.message?.startsWith("Invalid bookmark:")) {
        throw new Error(INVALID_URL_MESSAGE);
      }
      throw error;
    }
  }

  async function undo() {
    const entry = deletions.at(-1);
    if (!entry) return;
    const siblings = await api.bookmarks.getChildren(entry.node.parentId);
    let index = siblings.findIndex(node => node.id === entry.afterId);
    if (index < 0) {
      const before = siblings.findIndex(node => node.id === entry.beforeId);
      index = before < 0 ? Math.min(entry.node.index, siblings.length) : before + 1;
    }
    const ids = new Map();
    let restoredRoot;

    async function restore(node, parentId, childIndex) {
      const details = { parentId, index: childIndex, type: node.type };
      if (node.type !== "separator") details.title = node.title;
      if (node.type === "bookmark") details.url = node.url;
      const created = await api.bookmarks.create(details);
      if (!restoredRoot) restoredRoot = created;
      ids.set(node.id, created.id);
      for (const [position, child] of (node.children ?? []).entries()) {
        await restore(child, created.id, position);
      }
    }

    try {
      await restore(entry.node, entry.node.parentId, index);
    } catch (error) {
      // Keep the undo entry retryable, without leaving half a restored folder.
      if (restoredRoot) {
        // Rolling back a failed undo is not a new user deletion event.
        ignoredRemovals.add(restoredRoot.id);
        if (nodeType(restoredRoot) === "folder") {
          await api.bookmarks.removeTree(restoredRoot.id);
        } else {
          await api.bookmarks.remove(restoredRoot.id);
        }
      }
      throw error;
    }

    deletions.pop();
    // A child deleted before its parent must undo into the parent's NEW ID.
    for (const previous of deletions) {
      walk(previous.node, node => {
        node.id = ids.get(node.id) ?? node.id;
        node.parentId = ids.get(node.parentId) ?? node.parentId;
      });
      previous.beforeId = ids.get(previous.beforeId) ?? previous.beforeId;
      previous.afterId = ids.get(previous.afterId) ?? previous.afterId;
    }
    await saveDeletions();
  }

  async function handle(message) {
    return enqueue(async () => {
      switch (message.action) {
        case "tree": return otherTree();
        case "add": return add(message);
        case "edit": {
          const node = requireItem(await editableNodes(), message.id);
          const changes = {};
          if (message.title !== undefined) {
            if (typeof message.title !== "string") throw new Error("Invalid name.");
            changes.title = message.title;
          }
          if (message.url !== undefined) {
            if (nodeType(node) !== "bookmark") throw new Error("Only bookmarks have a URL to edit.");
            changes.url = normalizeBookmarkUrl(message.url);
          }
          if (!Object.keys(changes).length) throw new Error("No bookmark changes provided.");
          try {
            return await api.bookmarks.update(message.id, changes);
          } catch (error) {
            if (changes.url !== undefined && error.message?.startsWith("Invalid bookmark:")) {
              throw new Error(INVALID_URL_MESSAGE);
            }
            throw error;
          }
        }
        case "move": return move(message.id, message.destination);
        case "delete": return remove(message.id);
        case "undo": return undo();
        case "log": return log.join("\n\n") + (log.length ? "\n\n" : "");
        default: throw new Error("Unknown bookmark operation.");
      }
    });
  }

  return { ready, handle, idle: () => enqueue(() => {}) };
}
