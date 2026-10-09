import test from "node:test";
import assert from "node:assert/strict";
import { gridColumns } from "../layout.js";

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
