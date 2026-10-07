import test from "node:test";
import assert from "node:assert/strict";
import { gridMetrics } from "../layout.js";

test("column count respects the 400px minimum including grid gaps", () => {
  for (let count = 2; count <= 6; count++) {
    const threshold = count * 400 + (count - 1) * 12;
    assert.equal(gridMetrics(threshold, 1200, 20).columns, count);
    assert.equal(gridMetrics(threshold - 1, 1200, 20).columns, count - 1);
  }
  assert.equal(gridMetrics(4000, 1200, 20).columns, 6);
  assert.equal(gridMetrics(300, 1200, 20).columns, 1);
});

test("two rows require at least 500px per row plus the gap", () => {
  assert.deepEqual(gridMetrics(1000, 1012, 10), { columns: 2, rows: 2, rowHeight: 500 });
  assert.deepEqual(gridMetrics(1000, 1011, 10), { columns: 2, rows: 1, rowHeight: 1011 });
  assert.equal(gridMetrics(1000, 3000, 20).rows, 2);
  assert.equal(gridMetrics(300, 300, 2).rowHeight, 500);
});

test("unused second rows do not leave a half-height grid", () => {
  assert.deepEqual(gridMetrics(1000, 1500, 2), { columns: 2, rows: 1, rowHeight: 1500 });
});
