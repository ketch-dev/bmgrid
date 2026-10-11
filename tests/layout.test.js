import test from "node:test";
import assert from "node:assert/strict";
import { gridColumns, folderRowCount, topLevelGroups } from "../layout.js";

test("column count respects the 400px minimum including grid gaps", () => {
  for (let count = 2; count <= 6; count++) {
    const threshold = count * 400 + (count - 1) * 16;
    assert.equal(gridColumns(threshold), count);
    assert.equal(gridColumns(threshold - 1), count - 1);
  }
  assert.equal(gridColumns(4000), 6);
  assert.equal(gridColumns(300), 1);
});

test("column thresholds account for custom grid gaps", () => {
  for (const gap of [0, 12, 24]) {
    for (let count = 2; count <= 6; count++) {
      const threshold = count * 400 + (count - 1) * gap;
      assert.equal(gridColumns(threshold, gap), count);
      assert.equal(gridColumns(threshold - 1, gap), count - 1);
    }
  }
});

test("a 2560px viewport keeps six columns after page padding", () => {
  const width = 2560 - 32;
  assert.equal(gridColumns(width), 6);
});

test("folder rows count partial final rows and respond to column changes", () => {
  const types = Array(7).fill("folder");
  assert.equal(folderRowCount(types, 6), 2);
  assert.equal(folderRowCount(types, 3), 3);
  assert.equal(folderRowCount(types, 1), 7);
  assert.equal(folderRowCount(["folder"], 6), 1);
  assert.equal(folderRowCount(Array(6).fill("folder"), 6), 1);
});

test("full-width bookmark groups start new folder rows without using folder capacity", () => {
  const types = ["bookmark", "folder", "folder", "bookmark", "folder", "bookmark"];
  assert.equal(folderRowCount(types, 3), 2);
  assert.equal(folderRowCount(types, 1), 3);
  assert.equal(folderRowCount(["folder", "folder", "folder", "bookmark", "folder"], 3), 2);
  assert.equal(folderRowCount([], 3), 0);
  assert.equal(folderRowCount(["bookmark", "bookmark"], 3), 0);
});

test("top-level groups retain native mixed order and isolate each bookmark run", () => {
  const children = [
    { id: "a", type: "folder" }, { id: "b", type: "folder" },
    { id: "1", type: "bookmark" }, { id: "2", type: "bookmark" },
    { id: "c", type: "folder" }, { id: "3", type: "bookmark" },
    { id: "d", type: "folder" },
  ];
  const original = structuredClone(children);
  const groups = topLevelGroups(children);
  assert.deepEqual(groups.map(group => group.nodes.map(node => node.id)),
    [["a"], ["b"], ["1", "2"], ["c"], ["3"], ["d"]]);
  assert.deepEqual(groups.flatMap(group => group.nodes), children);
  assert.deepEqual(children, original);
});

test("bookmark groups merge and split as native placement changes", () => {
  const one = { id: "1", url: "https://one.test/" };
  const two = { id: "2", url: "https://two.test/" };
  const folder = { id: "folder", children: [] };
  assert.deepEqual(topLevelGroups([]), []);
  assert.deepEqual(topLevelGroups([one, two]), [{ type: "bookmark", nodes: [one, two] }]);
  assert.deepEqual(topLevelGroups([one, folder, two]).map(group => group.type),
    ["bookmark", "folder", "bookmark"]);
  assert.deepEqual(topLevelGroups([folder, one, { type: "separator" }, two]),
    [{ type: "folder", nodes: [folder] }, { type: "bookmark", nodes: [one, two] }]);
});
