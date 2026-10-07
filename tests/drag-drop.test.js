import test from "node:test";
import assert from "node:assert/strict";
import { dropIntent, dropLineBox, folderGapBox } from "../drag-drop.js";
import { createFakeBrowser } from "./fake-browser.js";

// A small element tree exercises closest-target resolution without a DOM dependency.
function element(selectors, parent = null, dataset = {}, box = { left: 0, top: 0, width: 400, height: 400 }) {
  const result = {
    dataset, children: [], box, parentElement: parent,
    id: selectors.find(selector => selector.startsWith("#"))?.slice(1),
    classList: { contains: name => selectors.includes(`.${name}`) },
    getBoundingClientRect() {
      const box = this.box;
      return { ...box, right: box.left + box.width, bottom: box.top + box.height };
    },
    closest(selector) {
      return selector.split(", ").some(part => selectors.includes(part)) ? this : parent?.closest(selector) ?? null;
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.closest(selector) === child) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
    get previousElementSibling() { return parent?.children[parent.children.indexOf(this) - 1] ?? null; },
    get nextElementSibling() { return parent?.children[parent.children.indexOf(this) + 1] ?? null; },
  };
  parent?.children.push(result);
  return result;
}

async function setup() {
  const tree = (await createFakeBrowser().bookmarks.getSubTree("unfiled_____"))[0];
  const nodes = new Map();
  function index(node) {
    nodes.set(node.id, node);
    node.children?.forEach(index);
  }
  index(tree);
  const grid = element(["#folders"], null, {}, { left: 0, top: 0, width: 1232, height: 816 });
  const unfoldered = element(["#unfoldered"]);
  function folder(id, parent = grid, nested = false, box = { left: 0, top: 0, width: 400, height: 400 }) {
    const card = element(["[data-folder-id]", nested ? ".nested-folder" : ".folder-card"], parent, { folderId: id }, box);
    const heading = element([".folder-heading"], card, {}, { ...box, height: 40 });
    return { card, heading, name: element([], heading), content: element([".folder-content"], card) };
  }
  const math = folder("math");
  const physics = folder("physics", grid, false, { left: 416, top: 0, width: 400, height: 400 });
  const algebra = folder("algebra", math.content, true, { left: 16, top: 80, width: 368, height: 80 });
  const intent = (source, target, x = 200, y = 40) => dropIntent({ target, clientX: x, clientY: y }, source, nodes);
  return { nodes, grid, unfoldered, math, physics, algebra, folder, intent };
}

test("the whole card nests, including its left and right edges", async () => {
  const { physics, intent } = await setup();
  for (const target of [physics.name, physics.content, physics.card]) {
    for (const x of [416, 417, 616, 815, 816]) {
      const result = intent("math", target, x);
      assert.deepEqual(result.destination, { parentId: "physics" });
      assert.equal(result.indicator, "inside");
      assert.equal(result.element, physics.card);
    }
  }
});

test("nested headings and contents nest even at their edges", async () => {
  const { algebra, intent } = await setup();
  for (const y of [80, 81, 100, 119, 120]) {
    const result = intent("physics", algebra.name, 200, y);
    assert.deepEqual(result.destination, { parentId: "algebra" });
    assert.equal(result.indicator, "inside");
  }
  assert.equal(intent("physics", algebra.content, 16, 140).indicator, "inside");
  const bookmark = element(["[data-bookmark-id]"], algebra.content, { bookmarkId: "algebra-a" });
  assert.deepEqual(intent("physics", bookmark).destination, { parentId: "algebra" });
});

test("the actual same-row gap inserts nested folders at the root", async () => {
  const { grid, math, physics, intent } = await setup();
  const result = intent("algebra", grid, 408, 40);
  assert.deepEqual(result.destination, {
    parentId: "unfiled_____", anchorId: "physics", position: "before",
  });
  assert.equal(result.indicator, "before");
  assert.deepEqual(folderGapBox(result.boundary), {
    left: 400, right: 416, top: 0, bottom: 400, vertical: true,
  });
  assert.equal(result.boundary.previous, math.card);
  assert.equal(result.boundary.next, physics.card);
  // A source bordering the gap anchors to the other sibling, never itself.
  assert.deepEqual(intent("physics", grid, 408, 40).destination, {
    parentId: "unfiled_____", anchorId: "math", position: "after",
  });
});

test("wrapped row gaps insert before the first card in the next row", async () => {
  const { grid, nodes, folder, intent } = await setup();
  nodes.set("chemistry", { id: "chemistry", parentId: "unfiled_____", type: "folder" });
  folder("chemistry", grid, false, { left: 0, top: 416, width: 400, height: 400 });
  for (const x of [8, 408, 800, 1224]) {
    const result = intent("algebra", grid, x, 408);
    assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "chemistry", position: "before" });
    assert.deepEqual(folderGapBox(result.boundary), {
      left: 0, right: 1232, top: 400, bottom: 416, vertical: false,
    });
  }
  assert.equal(intent("algebra", grid, 800, 500), null);
});

test("nested sibling gaps insert into their parent and keep mixed bookmark ordering", async () => {
  const { nodes, folder, math, intent } = await setup();
  nodes.set("geometry", { id: "geometry", parentId: "math", type: "folder" });
  const geometry = folder("geometry", math.content, true, { left: 16, top: 168, width: 368, height: 80 });
  const result = intent("physics", math.content, 200, 164);
  assert.deepEqual(result.destination, { parentId: "math", anchorId: "geometry", position: "before" });
  assert.deepEqual(folderGapBox(result.boundary), {
    left: 16, right: 384, top: 160, bottom: 168, vertical: false,
  });
  element(["[data-bookmark-id]"], math.content, { bookmarkId: "math-b" }, { left: 16, top: 256, width: 368, height: 36 });
  assert.deepEqual(intent("physics", math.content, 200, 252).destination, {
    parentId: "math", anchorId: "math-b", position: "before",
  });
  // Geometry is recalculated rather than frozen when scrolling/resizing changes it.
  geometry.card.box.top = 200;
  assert.equal(folderGapBox(result.boundary).bottom, 200);
});

test("nested folders can return to root through the unfoldered area", async () => {
  const { unfoldered, intent } = await setup();
  assert.deepEqual(intent("algebra", unfoldered).destination, { parentId: "unfiled_____" });
});

test("unused grid space and outside-gap coordinates reject folders but accept bookmarks", async () => {
  const { grid, intent } = await setup();
  const unusedSpace = element([], grid);
  for (const target of [grid, unusedSpace]) {
    for (const source of ["math", "physics", "algebra"]) {
      for (const [x, y] of [[1000, 40], [408, 500], [408, -1], [-1, 40]]) {
        assert.equal(intent(source, target, x, y), null);
      }
    }
    for (const source of ["direct-a", "algebra-a"]) {
      const result = intent(source, target);
      assert.deepEqual(result.destination, { parentId: "unfiled_____" });
      assert.equal(result.indicator, "inside");
      assert.equal(result.element, grid);
    }
  }
});

test("self, descendant, and descendant-gap drops are rejected", async () => {
  const { math, algebra, nodes, folder, intent } = await setup();
  nodes.set("deep", { id: "deep", parentId: "algebra", type: "folder" });
  const deep = folder("deep", algebra.content, true, { left: 24, top: 128, width: 352, height: 40 });
  nodes.set("deeper", { id: "deeper", parentId: "algebra", type: "folder" });
  folder("deeper", algebra.content, true, { left: 24, top: 176, width: 352, height: 40 });
  for (const target of [math.name, math.content, algebra.name, algebra.content, deep.name, deep.content]) {
    for (const x of [0, 200, 400]) assert.equal(intent("math", target, x), null);
  }
  assert.deepEqual(intent("algebra", math.content).destination, { parentId: "math" });
  assert.equal(intent("math", algebra.content, 200, 172), null);
  assert.equal(intent("algebra", algebra.content, 200, 172), null);
  assert.equal(intent("missing", math.name), null);
});

test("bookmark insertion and nesting retain their existing targeting", async () => {
  const { math, algebra, unfoldered, intent } = await setup();
  const direct = element(["[data-bookmark-id]"], unfoldered, { bookmarkId: "direct-b" });
  const nested = element(["[data-bookmark-id]"], algebra.content, { bookmarkId: "algebra-a" });
  assert.deepEqual(intent("direct-a", direct, 0).destination, {
    parentId: "unfiled_____", anchorId: "direct-b", position: "before",
  });
  assert.deepEqual(intent("direct-a", nested, 200, 300).destination, {
    parentId: "algebra", anchorId: "algebra-a", position: "after",
  });
  assert.equal(intent("algebra-a", nested), null);
  assert.deepEqual(intent("direct-a", math.name, 0).destination, { parentId: "math" });
  assert.deepEqual(intent("algebra", direct).destination, { parentId: "unfiled_____" });
});

test("the line follows the same boundary when a grid resize wraps its cards", async () => {
  const { grid, physics, intent } = await setup();
  const result = intent("algebra", grid, 408, 40);
  assert.deepEqual(dropLineBox(result), { left: 407, top: 0, width: 2, height: 400 });
  physics.card.box = { left: 0, top: 416, width: 400, height: 400 };
  grid.box.width = 400;
  assert.deepEqual(dropLineBox(result), { left: 0, top: 407, width: 400, height: 2 });
  physics.card.box.top = 400;
  assert.equal(dropLineBox(result), null);
});

test("nested gap lines are clipped to the outer card and recalculated when scrolled", async () => {
  const { math, algebra, nodes, folder, intent } = await setup();
  nodes.set("geometry", { id: "geometry", parentId: "math", type: "folder" });
  const geometry = folder("geometry", math.content, true, { left: 16, top: 168, width: 368, height: 80 });
  const result = intent("physics", math.content, 200, 164);
  math.content.box = { left: 50, top: 164, width: 200, height: 100 };
  assert.deepEqual(dropLineBox(result), { left: 50, top: 164, width: 200, height: 1 });
  algebra.card.box.top -= 20;
  geometry.card.box.top -= 20;
  assert.equal(dropLineBox(result), null);
  math.content.box.top = 40;
  math.content.box.height = 200;
  assert.deepEqual(dropLineBox(result), { left: 50, top: 143, width: 200, height: 2 });
});

test("direct bookmark lines use measured gaps and retain end and wrapped-row placement", () => {
  const direct = element(["#direct-bookmarks"]);
  const first = element([".bookmark"], direct, {}, { left: 16, top: 0, width: 80, height: 30 });
  const second = element([".bookmark"], direct, {}, { left: 108, top: 0, width: 80, height: 30 });
  const line = (element, indicator) => dropLineBox({ element, indicator });
  assert.deepEqual(line(first, "before"), { left: 11, top: 0, width: 2, height: 30 });
  assert.deepEqual(line(first, "after"), { left: 101, top: 0, width: 2, height: 30 });
  assert.deepEqual(line(second, "before"), line(first, "after"));
  assert.deepEqual(line(second, "after"), { left: 191, top: 0, width: 2, height: 30 });
  second.box = { left: 16, top: 38, width: 80, height: 30 };
  assert.deepEqual(line(first, "after"), { left: 99, top: 0, width: 2, height: 30 });
  assert.deepEqual(line(second, "before"), { left: 11, top: 38, width: 2, height: 30 });
});

test("nested bookmark lines preserve row width and disappear outside the scrolling viewport", async () => {
  const { math, algebra } = await setup();
  math.content.box = { left: 8, top: 40, width: 384, height: 352 };
  const bookmark = element([".bookmark"], algebra.content, {}, { left: 16, top: 392, width: 368, height: 36 });
  const result = { element: bookmark, indicator: "before" };
  assert.deepEqual(dropLineBox(result), { left: 16, top: 391, width: 368, height: 1 });
  bookmark.box.top = 500;
  assert.equal(dropLineBox(result), null);
});

test("nesting and absent targets never produce an insertion line", () => {
  assert.equal(dropLineBox(null), null);
  assert.equal(dropLineBox({ indicator: "inside" }), null);
});
