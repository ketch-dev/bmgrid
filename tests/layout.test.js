import test from "node:test";
import assert from "node:assert/strict";
import { gridMetrics } from "../layout.js";

test("column count respects the 400px minimum including grid gaps", () => {
  for (let count = 2; count <= 6; count++) {
    const threshold = count * 400 + (count - 1) * 16;
    assert.equal(gridMetrics(threshold, 1200, 20).columns, count);
    assert.equal(gridMetrics(threshold - 1, 1200, 20).columns, count - 1);
  }
  assert.equal(gridMetrics(4000, 1200, 20).columns, 6);
  assert.equal(gridMetrics(300, 1200, 20).columns, 1);
});

test("two rows require at least 400px per row plus the gap", () => {
  assert.deepEqual(gridMetrics(1000, 816, 10), { columns: 2, rows: 2, rowHeight: 400 });
  assert.deepEqual(gridMetrics(1000, 815, 10), { columns: 2, rows: 1, rowHeight: 815 });
  assert.deepEqual(gridMetrics(1000, 812, 10, 12), { columns: 2, rows: 2, rowHeight: 400 });
  assert.deepEqual(gridMetrics(1000, 811, 10, 12), { columns: 2, rows: 1, rowHeight: 811 });
  assert.equal(gridMetrics(1000, 3000, 20).rows, 2);
  assert.equal(gridMetrics(300, 300, 2).rowHeight, 400);
});

test("unused second rows do not leave a half-height grid", () => {
  assert.deepEqual(gridMetrics(1000, 1500, 2), { columns: 2, rows: 1, rowHeight: 1500 });
});

test("a 2560x1440 viewport keeps six columns and fits two rows after page padding", () => {
  const width = 2560 - 32;
  const height = 1440 - 32;
  assert.deepEqual(gridMetrics(width, height, 12), { columns: 6, rows: 2, rowHeight: 696 });
  assert.deepEqual(gridMetrics(width, height, 6), { columns: 6, rows: 1, rowHeight: 1408 });
  assert.deepEqual(gridMetrics(width, height, 18), { columns: 6, rows: 2, rowHeight: 696 });
});

test("odd and fractional heights fill the viewport without exposing the next row", () => {
  for (const height of [817, 1000.25, 1407, 1407.5]) {
    for (const folderCount of [6, 18]) {
      const { rows, rowHeight } = gridMetrics(2528, height, folderCount);
      assert.equal(rows * rowHeight + (rows - 1) * 16, height);
      // With 16px bottom padding, the next row starts at the viewport edge.
      assert.equal(rows * (rowHeight + 16), height + 16);
      assert.ok(rowHeight >= 400);
    }
  }
});
