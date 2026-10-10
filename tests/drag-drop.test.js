import test from "node:test";
import assert from "node:assert/strict";
import { dropIntent, dropLineBox, folderGapGeometry } from "../drag-drop.js";
import { createBookmarkController } from "../bookmarks.js";
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
      return selector.split(", ").some(part => selectors.includes(part)) ? this : this.parentElement?.closest(selector) ?? null;
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.closest(selector) === child) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] ?? null; },
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; },
  };
  parent?.children.push(result);
  return result;
}

async function setup() {
  const api = createFakeBrowser();
  const tree = (await api.bookmarks.getSubTree("unfiled_____"))[0];
  const nodes = new Map();
  function index(node) {
    nodes.set(node.id, node);
    node.children?.forEach(index);
  }
  index(tree);
  const page = element(["#page"]);
  const grid = element(["#folders"], page);
  const unfoldered = element([".direct-bookmarks"], grid, {}, { left: 0, top: 0, width: 0, height: 0 });
  function folder(id, parent = grid, nested = false, box = { left: 0, top: 0, width: 400, height: 400 }) {
    const card = element(["[data-folder-id]", nested ? ".nested-folder" : ".folder-card"], parent, { folderId: id }, box);
    const heading = element([".folder-heading"], card, {}, { ...box, height: 40 });
    return { card, heading, name: element([], heading), content: element([".folder-content"], card) };
  }
  // Describe painted rows explicitly; keep container/page bounds in sync.
  function layoutGrid(rows, columns = 3) {
    const width = columns * 400 + (columns - 1) * 16;
    const height = rows.length ? rows.length * 400 + (rows.length - 1) * 16 : 0;
    grid.children = rows.flat().map(folder => folder.card);
    grid.box = { left: 0, top: 0, width, height };
    page.box = { left: -16, top: -16, width: width + 32, height: height + 32 };
    unfoldered.box.width = width;
    rows.forEach((row, y) => row.forEach((folder, x) => {
      folder.card.box = { left: x * 416, top: y * 416, width: 400, height: 400 };
      folder.heading.box = { ...folder.card.box, height: 40 };
    }));
  }
  const math = folder("math");
  const physics = folder("physics");
  layoutGrid([[math, physics]]);
  const algebra = folder("algebra", math.content, true, { left: 16, top: 80, width: 368, height: 80 });
  const intent = (source, target, x = 200, y = 40) => dropIntent({ target, clientX: x, clientY: y }, source, nodes);
  return { api, nodes, page, grid, unfoldered, math, physics, algebra, folder, layoutGrid, intent };
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
  assert.deepEqual(folderGapGeometry(result.boundary).hitBox, {
    left: 400, right: 416, top: 0, bottom: 400, vertical: true,
  });
  assert.equal(result.boundary.previous, math.card);
  assert.equal(result.boundary.next, physics.card);
  // A source bordering the gap anchors to the other sibling, never itself.
  assert.deepEqual(intent("physics", grid, 408, 40).destination, {
    parentId: "unfiled_____", anchorId: "math", position: "after",
  });
});

test("both sides of a wrapped boundary insert at the same position with a line beside the hovered row", async () => {
  const { page, grid, nodes, folder, math, physics, layoutGrid, intent } = await setup();
  nodes.set("chemistry", { id: "chemistry", parentId: "unfiled_____", type: "folder" });
  const chemistry = folder("chemistry");
  layoutGrid([[math, physics], [chemistry]], 2);
  for (const target of [page, grid]) {
    const right = intent("algebra", target, 824, 40);
    const left = intent("algebra", target, -8, 456);
    assert.deepEqual(right.destination, { parentId: "unfiled_____", anchorId: "chemistry", position: "before" });
    assert.deepEqual(left.destination, right.destination);
    assert.deepEqual(folderGapGeometry(right.boundary).hitBox, {
      left: 816, right: 832, top: 0, bottom: 400, vertical: true,
    });
    assert.deepEqual(folderGapGeometry(left.boundary).hitBox, {
      left: -16, right: 0, top: 416, bottom: 816, vertical: true,
    });
    assert.deepEqual(dropLineBox(right), { left: 823, top: 0, width: 2, height: 400 });
    assert.deepEqual(dropLineBox(left), { left: -9, top: 416, width: 2, height: 400 });
    for (const [x, y] of [[824, 40], [-8, 456]]) {
      assert.deepEqual(intent("chemistry", target, x, y).destination, {
        parentId: "unfiled_____", anchorId: "physics", position: "after",
      });
      assert.deepEqual(intent("physics", target, x, y).destination, right.destination);
    }
    for (const x of [-8, 8, 408, 800, 824, 1224]) assert.equal(intent("algebra", target, x, 408), null);
  }
  assert.deepEqual(intent("direct-a", grid, 200, 408).destination, { parentId: "unfiled_____" });
  assert.equal(intent("algebra", grid, 800, 500), null);
});

test("both wrapped row sides use identical native indices even with interleaved bookmarks", async () => {
  for (const source of ["math", "algebra"]) {
    const orders = [];
    for (const [x, y] of [[824, 40], [-8, 456]]) {
      const { api, nodes, grid, folder, math, physics, layoutGrid, intent } = await setup();
      const chemistry = await api.bookmarks.create({ parentId: "unfiled_____", type: "folder", title: "Chemistry" });
      nodes.set(chemistry.id, chemistry);
      layoutGrid([[math, physics], [folder(chemistry.id)]], 2);
      const controller = createBookmarkController(api);
      await controller.ready;
      await controller.handle({ action: "move", id: source, destination: intent(source, grid, x, y).destination });
      orders.push(api.find("unfiled_____").children.map(node => node.id));
      assert.deepEqual(orders.at(-1).slice(-2), [source, chemistry.id]);
      assert.deepEqual(orders.at(-1).filter(id => id.startsWith("direct-")), ["direct-a", "direct-b"]);
      assert.equal(api.find("algebra-a").parentId, "algebra");
    }
    assert.deepEqual(orders[0], orders[1]);
  }
});

test("the page margins and narrow end gaps insert before the first or after the last grid card", async () => {
  const { page, grid, intent } = await setup();
  for (const target of [page, grid]) {
    for (const [x, y] of [[-8, 40], [200, -8], [1000, -8]]) {
      const result = intent("physics", target, x, y);
      assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "math", position: "before" });
      assert.deepEqual(dropLineBox(result), { left: -9, top: 0, width: 2, height: 400 });
    }
    for (const [x, y] of [[824, 40], [200, 408], [1000, 408]]) {
      const result = intent("math", target, x, y);
      assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "physics", position: "after" });
      assert.deepEqual(dropLineBox(result), { left: 823, top: 0, width: 2, height: 400 });
    }
  }
  assert.equal(intent("math", page, -8, 40), null);
  assert.equal(intent("physics", page, 824, 40), null);
  // Card interiors and space beyond the measured end gaps are not targets.
  assert.equal(intent("physics", page, 200, -20), null);
  assert.deepEqual(intent("direct-a", page, -8, 40).destination, {
    parentId: "unfiled_____", anchorId: "math", position: "before",
  });
});

test("single-column and wrapped grids retain accessible last-position gaps", async () => {
  const { page, grid, math, physics, nodes, folder, layoutGrid, intent } = await setup();
  layoutGrid([[math], [physics]], 1);
  const last = intent("algebra", page, 200, 824);
  assert.deepEqual(last.destination, { parentId: "unfiled_____", anchorId: "physics", position: "after" });
  assert.deepEqual(dropLineBox(last), { left: 407, top: 416, width: 2, height: 400 });
  nodes.set("chemistry", { id: "chemistry", parentId: "unfiled_____", type: "folder" });
  const chemistry = folder("chemistry");
  layoutGrid([[math], [physics], [chemistry]], 1);
  for (const [x, y] of [[408, 40], [-8, 456]]) {
    assert.deepEqual(intent("algebra", page, x, y).destination, {
      parentId: "unfiled_____", anchorId: "physics", position: "before",
    });
  }
  for (const [x, y] of [[408, 456], [-8, 872]]) {
    assert.deepEqual(intent("algebra", page, x, y).destination, {
      parentId: "unfiled_____", anchorId: "chemistry", position: "before",
    });
  }
  assert.equal(intent("algebra", page, 200, 408), null);
  assert.equal(intent("algebra", page, 200, 824), null);
  assert.deepEqual(intent("algebra", page, 408, 900).destination, {
    parentId: "unfiled_____", anchorId: "chemistry", position: "after",
  });
  // A partial last row only exposes a narrow strip beside its final card.
  layoutGrid([[math, physics], [chemistry]], 2);
  assert.equal(intent("algebra", grid, 600, 500), null);
  assert.deepEqual(intent("algebra", grid, 200, 824).destination, {
    parentId: "unfiled_____", anchorId: "chemistry", position: "after",
  });
  assert.equal(intent("chemistry", grid, 408, 500), null);
});

test("a single grid card supports both end gaps while an empty grid accepts its first item", async () => {
  const { page, grid, math, layoutGrid, intent } = await setup();
  layoutGrid([[math]]);
  assert.deepEqual(intent("algebra", page, -8, 40).destination, {
    parentId: "unfiled_____", anchorId: "math", position: "before",
  });
  assert.deepEqual(intent("algebra", grid, 408, 40).destination, {
    parentId: "unfiled_____", anchorId: "math", position: "after",
  });
  assert.equal(intent("math", grid, 408, 40), null);
  layoutGrid([]);
  assert.deepEqual(intent("algebra", page, -8, 40).destination, { parentId: "unfiled_____" });
  assert.deepEqual(intent("algebra", grid, 408, 40).destination, { parentId: "unfiled_____" });
  assert.equal(intent("direct-a", grid, 408, 40).indicator, "before");
});

test("nested end gaps reorder sibling folders and reject descendant destinations", async () => {
  const { nodes, folder, math, algebra, intent } = await setup();
  math.content.box = { left: 8, top: 72, width: 384, height: 320 };
  nodes.set("geometry", { id: "geometry", parentId: "math", type: "folder" });
  folder("geometry", math.content, true, { left: 16, top: 168, width: 368, height: 80 });
  assert.deepEqual(intent("geometry", math.content, 200, 76).destination, {
    parentId: "math", anchorId: "algebra", position: "before",
  });
  assert.deepEqual(intent("algebra", math.content, 200, 252).destination, {
    parentId: "math", anchorId: "geometry", position: "after",
  });
  algebra.content.box = { left: 16, top: 120, width: 368, height: 40 };
  element(["[data-bookmark-id]"], algebra.content, { bookmarkId: "algebra-a" },
    { left: 24, top: 128, width: 352, height: 24 });
  for (const source of ["math", "algebra"]) {
    for (const y of [124, 156]) assert.equal(intent(source, algebra.content, 200, y), null);
  }
});

test("nested first and last gaps preserve mixed ordering and avoid unused content space", async () => {
  const { math, intent } = await setup();
  math.content.children.length = 0;
  math.content.box = { left: 8, top: 40, width: 384, height: 352 };
  const first = element(["[data-bookmark-id]"], math.content, { bookmarkId: "math-a" },
    { left: 16, top: 48, width: 368, height: 36 });
  const last = element(["[data-bookmark-id]"], math.content, { bookmarkId: "math-b" },
    { left: 16, top: 84, width: 368, height: 36 });
  const start = intent("physics", math.content, 200, 44);
  assert.deepEqual(start.destination, { parentId: "math", anchorId: "math-a", position: "before" });
  assert.deepEqual(dropLineBox(start), { left: 16, top: 43, width: 368, height: 2 });
  const end = intent("physics", math.content, 200, 124);
  assert.deepEqual(end.destination, { parentId: "math", anchorId: "math-b", position: "after" });
  assert.deepEqual(dropLineBox(end), { left: 16, top: 123, width: 368, height: 2 });
  assert.equal(intent("physics", math.content, 200, 132).indicator, "inside");
  assert.equal(intent("math", math.content, 200, 44), null);
  assert.equal(intent("math", math.content, 200, 124), null);
  assert.equal(intent("physics", first, 200, 48).indicator, "inside");
  assert.equal(intent("physics", last, 200, 120).indicator, "inside");
  first.box.top -= 20;
  assert.equal(dropLineBox(start), null);
  last.box.top += 300;
  assert.equal(dropLineBox(end), null);
});

test("new grid end targets move actual folders without reordering direct bookmarks", async () => {
  for (const [id, x, expected] of [
    ["physics", -8, ["physics", "math", "direct-a", "direct-b"]],
    ["math", 824, ["direct-a", "physics", "math", "direct-b"]],
    ["algebra", -8, ["algebra", "math", "direct-a", "physics", "direct-b"]],
    ["algebra", 824, ["math", "direct-a", "physics", "algebra", "direct-b"]],
  ]) {
    const { api, page, intent } = await setup();
    const controller = createBookmarkController(api);
    await controller.ready;
    await controller.handle({ action: "move", id, destination: intent(id, page, x, 40).destination });
    assert.deepEqual(api.find("unfiled_____").children.map(node => node.id), expected);
    assert.equal(api.find("algebra-a").parentId, "algebra");
  }
});

test("nested sibling gaps insert into their parent and keep mixed bookmark ordering", async () => {
  const { nodes, folder, math, intent } = await setup();
  nodes.set("geometry", { id: "geometry", parentId: "math", type: "folder" });
  const geometry = folder("geometry", math.content, true, { left: 16, top: 168, width: 368, height: 80 });
  const result = intent("physics", math.content, 200, 164);
  assert.deepEqual(result.destination, { parentId: "math", anchorId: "geometry", position: "before" });
  assert.deepEqual(folderGapGeometry(result.boundary).hitBox, {
    left: 16, right: 384, top: 160, bottom: 168, vertical: false,
  });
  element(["[data-bookmark-id]"], math.content, { bookmarkId: "math-b" }, { left: 16, top: 256, width: 368, height: 36 });
  assert.deepEqual(intent("physics", math.content, 200, 252).destination, {
    parentId: "math", anchorId: "math-b", position: "before",
  });
  // Geometry is recalculated rather than frozen when scrolling/resizing changes it.
  geometry.card.box.top = 200;
  assert.equal(folderGapGeometry(result.boundary).hitBox.bottom, 200);
});

test("nested folders can return to root through a bookmark group", async () => {
  const { firstRun, intent } = await mixedRoot();
  assert.deepEqual(intent("algebra", firstRun, 800, 130).destination, {
    parentId: "unfiled_____", anchorId: "direct-a", position: "after",
  });
});

test("unused grid space and outside-gap coordinates reject folders but accept bookmarks", async () => {
  const { grid, physics, intent } = await setup();
  const unusedSpace = element([], grid);
  for (const target of [grid, unusedSpace]) {
    for (const source of ["math", "physics", "algebra"]) {
      for (const [x, y] of [[1000, 40], [408, 500], [408, -20], [-20, 40]]) {
        assert.equal(intent(source, target, x, y), null);
      }
    }
    for (const source of ["direct-a", "algebra-a"]) {
      const result = intent(source, target);
      assert.deepEqual(result.destination, { parentId: "unfiled_____" });
      assert.equal(result.indicator, "after");
      assert.equal(result.element, physics.card);
      assert.deepEqual(dropLineBox(result), { left: 823, top: 0, width: 2, height: 400 });
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
  assert.deepEqual(intent("algebra", direct).destination, {
    parentId: "unfiled_____", anchorId: "direct-b", position: "after",
  });
});

test("resizing replaces a same-row gap with two live row-side gaps", async () => {
  const { grid, math, physics, layoutGrid, intent } = await setup();
  const result = intent("algebra", grid, 408, 40);
  assert.deepEqual(dropLineBox(result), { left: 407, top: 0, width: 2, height: 400 });
  layoutGrid([[math], [physics]], 1);
  assert.equal(dropLineBox(result), null);
  const right = intent("algebra", grid, 408, 40);
  const left = intent("algebra", grid, -8, 456);
  assert.deepEqual(right.destination, left.destination);
  assert.deepEqual(dropLineBox(right), { left: 407, top: 0, width: 2, height: 400 });
  assert.deepEqual(dropLineBox(left), { left: -9, top: 416, width: 2, height: 400 });
  physics.card.box.top -= 100;
  assert.deepEqual(dropLineBox(left), { left: -9, top: 316, width: 2, height: 400 });
  assert.deepEqual(intent("algebra", grid, -8, 356).destination, left.destination);
  layoutGrid([[math, physics]]);
  assert.deepEqual(dropLineBox(result), { left: 407, top: 0, width: 2, height: 400 });
  assert.deepEqual(dropLineBox(left), dropLineBox(result));
  assert.deepEqual(dropLineBox(right), dropLineBox(result));
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
  const direct = element([".direct-bookmarks"]);
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

async function mixedRoot() {
  const setupResult = await setup();
  const { grid, page, math, physics } = setupResult;
  grid.children.length = 0;
  math.card.box = { left: 0, top: 0, width: 400, height: 100 };
  physics.card.box = { left: 0, top: 162, width: 400, height: 120 };
  grid.children.push(math.card);
  const firstRun = element([".direct-bookmarks"], grid, {}, { left: 0, top: 116, width: 1232, height: 30 });
  const first = element(["[data-bookmark-id]", ".bookmark"], firstRun, { bookmarkId: "direct-a" },
    { left: 0, top: 116, width: 80, height: 30 });
  grid.children.push(physics.card);
  const lastRun = element([".direct-bookmarks"], grid, {}, { left: 0, top: 298, width: 1232, height: 30 });
  const last = element(["[data-bookmark-id]", ".bookmark"], lastRun, { bookmarkId: "direct-b" },
    { left: 0, top: 298, width: 80, height: 30 });
  grid.box = { left: 0, top: 0, width: 1232, height: 328 };
  page.box = { left: -16, top: -16, width: 1264, height: 360 };
  return { ...setupResult, firstRun, lastRun, first, last };
}

test("mixed root row sides anchor to native siblings across bookmark groups", async () => {
  const { grid, page, intent } = await mixedRoot();
  for (const [positions, anchorId] of [
    [[[408, 40], [-8, 130]], "direct-a"],
    [[[88, 130], [-8, 200]], "physics"],
    [[[408, 200], [-8, 310]], "direct-b"],
  ]) {
    for (const target of [grid, page]) {
      const results = positions.map(([x, y]) => intent("algebra", target, x, y));
      for (const result of results) {
        assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId, position: "before" });
        assert.equal(dropLineBox(result).width, 2);
      }
      assert.notEqual(dropLineBox(results[0]).top, dropLineBox(results[1]).top);
    }
  }
  // Blank grid space is never a generic folder destination.
  assert.equal(intent("algebra", grid, 800, 200), null);
});

test("bookmarks use folder-card gaps to insert at their exact native position", async () => {
  const { api, grid, intent } = await mixedRoot();
  const controller = createBookmarkController(api);
  await controller.ready;
  const result = intent("direct-b", grid, -8, 200);
  assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "physics", position: "before" });
  await controller.handle({ action: "move", id: "direct-b", destination: result.destination });
  assert.deepEqual(api.find("unfiled_____").children.map(node => node.id),
    ["math", "direct-a", "direct-b", "physics"]);
});

test("folder drops between root bookmarks split their native run", async () => {
  const { api, grid, firstRun, lastRun, last, intent } = await mixedRoot();
  await api.bookmarks.move("direct-b", { parentId: "unfiled_____", index: 2 });
  grid.children = grid.children.filter(child => child !== lastRun);
  lastRun.children.length = 0;
  firstRun.children.push(last);
  last.parentElement = firstRun;
  last.box = { left: 88, top: 116, width: 80, height: 30 };
  for (const source of ["physics", "algebra"]) {
    const result = intent(source, firstRun, 84, 130);
    assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "direct-b", position: "before" });
    assert.deepEqual(dropLineBox(result), { left: 83, top: 116, width: 2, height: 30 });
  }
  const controller = createBookmarkController(api);
  await controller.ready;
  await controller.handle({ action: "move", id: "physics", destination: intent("physics", grid, 84, 130).destination });
  assert.deepEqual(api.find("unfiled_____").children.map(node => node.id),
    ["math", "direct-a", "physics", "direct-b"]);
});

test("wrapped bookmark gap sides insert folders at the same native position", async () => {
  const { grid, firstRun, last, lastRun, intent } = await mixedRoot();
  grid.children = grid.children.filter(child => child !== lastRun);
  firstRun.children.push(last);
  last.parentElement = firstRun;
  firstRun.box.height = 68;
  last.box = { left: 0, top: 154, width: 80, height: 30 };
  const right = intent("algebra", grid, 88, 130);
  const left = intent("algebra", grid, -8, 168);
  assert.deepEqual(right.destination, { parentId: "unfiled_____", anchorId: "direct-b", position: "before" });
  assert.deepEqual(left.destination, right.destination);
  assert.deepEqual(dropLineBox(right), { left: 87, top: 116, width: 2, height: 30 });
  assert.deepEqual(dropLineBox(left), { left: -9, top: 154, width: 2, height: 30 });
});

test("folders can be inserted between two bookmarks inside any nested folder", async () => {
  const { algebra, nodes, intent } = await setup();
  nodes.set("second", { id: "second", parentId: "algebra", type: "bookmark", url: "https://second.test/" });
  algebra.content.box = { left: 16, top: 120, width: 368, height: 72 };
  element(["[data-bookmark-id]"], algebra.content, { bookmarkId: "algebra-a" },
    { left: 24, top: 128, width: 352, height: 24 });
  element(["[data-bookmark-id]"], algebra.content, { bookmarkId: "second" },
    { left: 24, top: 156, width: 352, height: 24 });
  const result = intent("physics", algebra.content, 200, 154);
  assert.deepEqual(result.destination, { parentId: "algebra", anchorId: "second", position: "before" });
  assert.deepEqual(dropLineBox(result), { left: 24, top: 153, width: 352, height: 2 });
  for (const source of ["math", "algebra"]) assert.equal(intent(source, algebra.content, 200, 154), null);
});

test("bookmark-group backgrounds insert after that group rather than the root end", async () => {
  for (const source of ["direct-b", "math-b"]) {
    const { api, firstRun, first, intent } = await mixedRoot();
    const result = intent(source, firstRun, 800, 130);
    assert.deepEqual(result.destination, {
      parentId: "unfiled_____", anchorId: "direct-a", position: "after",
    });
    assert.equal(result.indicator, "after");
    assert.equal(result.element, first);
    assert.deepEqual(dropLineBox(result), { left: 87, top: 116, width: 2, height: 30 });
    const controller = createBookmarkController(api);
    await controller.ready;
    await controller.handle({ action: "move", id: source, destination: result.destination });
    assert.deepEqual(api.find("unfiled_____").children.map(node => node.id),
      ["math", "direct-a", source, "physics", ...(source === "direct-b" ? [] : ["direct-b"])]);
  }
});

test("wrapped group backgrounds mark the last bookmark and follow live geometry", async () => {
  const { grid, firstRun, lastRun, last, intent } = await mixedRoot();
  grid.children = grid.children.filter(child => child !== lastRun);
  firstRun.children.push(last);
  last.parentElement = firstRun;
  firstRun.box.height = 68;
  last.box = { left: 0, top: 154, width: 80, height: 30 };
  const result = intent("math-b", firstRun, 800, 130);
  assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "direct-b", position: "after" });
  assert.deepEqual(dropLineBox(result), { left: 87, top: 154, width: 2, height: 30 });
  last.box = { left: 200, top: 100, width: 90, height: 30 };
  assert.deepEqual(dropLineBox(result), { left: 297, top: 100, width: 2, height: 30 });
});

test("measured gaps take priority over bookmark-group and canvas background destinations", async () => {
  const { grid, firstRun, lastRun, last, intent } = await mixedRoot();
  grid.children = grid.children.filter(child => child !== lastRun);
  firstRun.children.push(last);
  last.parentElement = firstRun;
  last.box = { left: 88, top: 116, width: 80, height: 30 };
  for (const target of [firstRun, grid]) {
    const result = intent("math-b", target, 84, 130);
    assert.deepEqual(result.destination, { parentId: "unfiled_____", anchorId: "direct-b", position: "before" });
    assert.deepEqual(dropLineBox(result), { left: 83, top: 116, width: 2, height: 30 });
  }
});

test("already-last group bookmarks keep their native placement without self anchors", async () => {
  for (const multiple of [false, true]) {
    const { api, nodes, grid, firstRun, lastRun, first, last, intent } = await mixedRoot();
    if (multiple) {
      await api.bookmarks.move("direct-b", { parentId: "unfiled_____", index: 2 });
      nodes.set("unfiled_____", (await api.bookmarks.getSubTree("unfiled_____"))[0]);
      grid.children = grid.children.filter(child => child !== lastRun);
      firstRun.children.push(last);
      last.parentElement = firstRun;
      last.box = { left: 88, top: 116, width: 80, height: 30 };
    }
    const source = multiple ? "direct-b" : "direct-a";
    const result = intent(source, firstRun, 800, 130);
    assert.notEqual(result.destination.anchorId, source);
    assert.equal(result.element, multiple ? last : first);
    assert.equal(dropLineBox(result).width, 2);
    const original = api.find("unfiled_____").children.map(node => node.id);
    const controller = createBookmarkController(api);
    await controller.ready;
    await controller.handle({ action: "move", id: source, destination: result.destination });
    assert.deepEqual(api.find("unfiled_____").children.map(node => node.id), original);
  }
});

test("grid, page and document backgrounds append bookmarks with a line at the actual last item", async () => {
  const { api, grid, page, last, intent } = await mixedRoot();
  const html = element(["html"]);
  const body = element(["body"], html);
  body.children.push(page);
  page.parentElement = body;
  for (const target of [grid, page, body, html]) {
    const result = intent("math-b", target, 1000, 200);
    assert.deepEqual(result.destination, { parentId: "unfiled_____" });
    assert.equal(result.indicator, "after");
    assert.equal(result.element, last);
    assert.deepEqual(dropLineBox(result), { left: 87, top: 298, width: 2, height: 30 });
    assert.equal(intent("algebra", target, 1000, 200), null);
  }
  const controller = createBookmarkController(api);
  await controller.ready;
  await controller.handle({ action: "move", id: "math-b", destination: intent("math-b", page, 1000, 200).destination });
  assert.deepEqual(api.find("unfiled_____").children.map(node => node.id),
    ["math", "direct-a", "physics", "direct-b", "math-b"]);
});

test("canvas drops of the last bookmark are valid no-ops with a vertical marker", async () => {
  const { api, page, lastRun, intent } = await mixedRoot();
  for (const target of [page, lastRun]) {
    const result = intent("direct-b", target, 1000, 310);
    assert.notEqual(result.destination.anchorId, "direct-b");
    assert.deepEqual(dropLineBox(result), { left: 87, top: 298, width: 2, height: 30 });
    const controller = createBookmarkController(api);
    await controller.ready;
    await controller.handle({ action: "move", id: "direct-b", destination: result.destination });
    assert.deepEqual(api.find("unfiled_____").children.map(node => node.id),
      ["math", "direct-a", "physics", "direct-b"]);
  }
});

test("already-last background drops preserve native positions around hidden separators", async () => {
  const { api, nodes, firstRun, lastRun, page, intent } = await mixedRoot();
  for (const index of [1, 3, 6]) {
    await api.bookmarks.create({ parentId: "unfiled_____", type: "separator", index });
  }
  nodes.set("unfiled_____", (await api.bookmarks.getSubTree("unfiled_____"))[0]);
  const original = api.find("unfiled_____").children.map(node => node.id);
  const controller = createBookmarkController(api);
  await controller.ready;
  for (const [source, target, y] of [["direct-a", firstRun, 130], ["direct-b", lastRun, 310], ["direct-b", page, 310]]) {
    const result = intent(source, target, 1000, y);
    assert.notEqual(result.destination.anchorId, source);
    assert.equal(dropLineBox(result).width, 2);
    await controller.handle({ action: "move", id: source, destination: result.destination });
    assert.deepEqual(api.find("unfiled_____").children.map(node => node.id), original);
  }
});

test("empty root drops display a starting line rather than a container highlight", async () => {
  const { grid, page, layoutGrid, intent } = await setup();
  layoutGrid([]);
  grid.box = { left: 16, top: 16, width: 800, height: 32 };
  for (const target of [grid, page]) {
    for (const source of ["math-b", "algebra"]) {
      const result = intent(source, target, 200, 24);
      assert.deepEqual(result.destination, { parentId: "unfiled_____" });
      assert.equal(result.indicator, "before");
      assert.deepEqual(dropLineBox(result), { left: 16, top: 16, width: 2, height: 32 });
      grid.box.left += 10;
      assert.equal(dropLineBox(result).left, grid.box.left);
      grid.box.left -= 10;
    }
  }
});
