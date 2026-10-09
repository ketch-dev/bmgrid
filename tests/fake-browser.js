const clone = value => structuredClone(value);

function event() {
  const listeners = new Set();
  return {
    addListener: listener => { listeners.add(listener); },
    removeListener: listener => { listeners.delete(listener); },
    emit: (...args) => { for (const listener of listeners) listener(...clone(args)); },
    clear: () => { listeners.clear(); },
  };
}

function storage(onChanged, area) {
  const data = {};
  return {
    data,
    async get(keys) {
      const result = {};
      for (const key of typeof keys === "string" ? [keys] : keys) {
        if (key in data) result[key] = clone(data[key]);
      }
      return result;
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
      }
      Object.assign(data, clone(values));
      onChanged.emit(changes, area);
    },
  };
}

export function fixture() {
  return {
    id: "root________", title: "", type: "folder", children: [
      { id: "toolbar_____", title: "Bookmarks Toolbar", type: "folder", children: [
        { id: "toolbar-link", title: "Toolbar link", type: "bookmark", url: "https://toolbar.test/path?a=1#two" },
      ] },
      { id: "unfiled_____", title: "Other Bookmarks", type: "folder", children: [
        { id: "math", title: "Math", type: "folder", children: [
          { id: "math-a", title: "First", type: "bookmark", url: "https://math.test/?x=%2F&y=+value#fragment" },
          { id: "algebra", title: "Algebra", type: "folder", children: [
            { id: "algebra-a", title: "Nested", type: "bookmark", url: "https://algebra.test/" },
          ] },
          { id: "separator", title: "", type: "separator" },
          { id: "math-b", title: "Second", type: "bookmark", url: "https://math.test/?x=%2F&y=+value#fragment" },
        ] },
        { id: "direct-a", title: "Direct A", type: "bookmark", url: "https://direct-a.test/" },
        { id: "physics", title: "Physics", type: "folder", children: [
          { id: "physics-a", title: "Physics link", type: "bookmark", url: "https://physics.test/" },
        ] },
        { id: "direct-b", title: "Direct B", type: "bookmark", url: "https://direct-b.test/" },
      ] },
      { id: "menu________", title: "Bookmarks Menu", type: "folder", children: [] },
    ],
  };
}

export function createFakeBrowser(tree = fixture()) {
  let nextId = 1;
  const onStorageChanged = event();
  const api = {
    storage: {
      local: storage(onStorageChanged, "local"),
      sync: storage(onStorageChanged, "sync"),
      session: storage(onStorageChanged, "session"),
      onChanged: onStorageChanged,
    },
    bookmarks: {
      onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event(),
    },
    tabs: {
      items: [], onCreated: event(), onUpdated: event(),
      async query() { return clone(api.tabs.items); },
    },
    runtime: { onMessage: event() },
    calls: [],
  };

  function normalize(node, parentId) {
    if (parentId) node.parentId = parentId;
    node.children?.forEach((child, index) => {
      child.index = index;
      normalize(child, node.id);
    });
  }
  normalize(tree);

  function find(id, node = tree) {
    if (node.id === id) return node;
    for (const child of node.children ?? []) {
      const result = find(id, child);
      if (result) return result;
    }
    return null;
  }

  function requireNode(id) {
    const node = find(id);
    if (!node) throw new Error(`Bookmark not found: ${id}`);
    return node;
  }

  function shallow(node) {
    const { children, ...result } = node;
    return clone(result);
  }

  async function remove(id, recursive) {
    const node = requireNode(id);
    if (!recursive && node.children?.length) throw new Error("Folder is not empty");
    const parent = requireNode(node.parentId);
    const info = { parentId: parent.id, index: node.index, node: shallow(node) };
    parent.children.splice(node.index, 1);
    normalize(parent, parent.parentId);
    api.bookmarks.onRemoved.emit(id, info);
  }

  Object.assign(api.bookmarks, {
    async getTree() { api.calls.push("getTree"); return [clone(tree)]; },
    async getSubTree(id) { return [clone(requireNode(id))]; },
    async getChildren(id) { return (requireNode(id).children ?? []).map(shallow); },
    async get(id) { return [shallow(requireNode(id))]; },
    async update(id, changes) {
      const node = requireNode(id);
      Object.assign(node, changes);
      api.bookmarks.onChanged.emit(id, changes);
      return shallow(node);
    },
    async create(details) {
      const parent = requireNode(details.parentId);
      const index = details.index ?? parent.children.length;
      if (index < 0 || index > parent.children.length) throw new Error("Invalid index");
      const node = {
        id: `created-${nextId++}`, title: "", ...details,
        ...(details.type === "folder" ? { children: [] } : {}),
      };
      parent.children.splice(index, 0, node);
      normalize(parent, parent.parentId);
      api.bookmarks.onCreated.emit(node.id, shallow(node));
      return shallow(node);
    },
    async move(id, destination) {
      const node = requireNode(id);
      const oldParent = requireNode(node.parentId);
      const info = { oldParentId: oldParent.id, oldIndex: node.index, ...destination };
      oldParent.children.splice(node.index, 1);
      normalize(oldParent, oldParent.parentId);
      const parent = requireNode(destination.parentId);
      const index = destination.index ?? parent.children.length;
      if (index < 0 || index > parent.children.length) throw new Error("Invalid index");
      parent.children.splice(index, 0, node);
      normalize(parent, parent.parentId);
      api.bookmarks.onMoved.emit(id, { ...info, index });
      return shallow(node);
    },
    remove: id => remove(id, false),
    removeTree: id => remove(id, true),
  });

  api.find = find;
  api.resetListeners = () => {
    for (const value of Object.values(api.bookmarks)) value.clear?.();
    for (const value of Object.values(api.tabs)) value.clear?.();
    api.storage.onChanged.clear();
  };
  return api;
}
