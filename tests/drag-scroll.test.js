import test from "node:test";
import assert from "node:assert/strict";
import { createDragScroller, dragScrollTarget } from "../drag-scroll.js";

function scroller({ left = 0, top = 0, width = 1000, height = 800, scrollHeight = 2400, scrollWidth = width } = {}) {
  return {
    scrollTop: 0, scrollLeft: 0, clientWidth: width, clientHeight: height, scrollHeight, scrollWidth,
    getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height }),
    scrollBy({ left, top, behavior }) {
      assert.equal(behavior, "instant");
      this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, this.scrollLeft + left));
      this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, this.scrollTop + top));
    },
  };
}

function setup() {
  const frames = new Map();
  let sequence = 0;
  let hit = null;
  let changes = 0;
  const page = scroller();
  const document = {
    defaultView: {
      innerWidth: 1000, innerHeight: 800,
      requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
    scrollingElement: page,
    elementFromPoint: () => hit,
  };
  const drag = createDragScroller(document, () => { changes++; });
  function card(content) {
    const outer = { querySelector: () => content };
    hit = { closest: () => outer };
  }
  function tick(time) {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  }
  return { document, page, drag, frames, card, tick, get changes() { return changes; } };
}

test("page edge zones reject middle/outside points and ramp speed toward either edge", () => {
  const { document, page } = setup();
  const target = (x, y) => dragScrollTarget(document, { clientX: x, clientY: y });
  for (const [x, y] of [[500, 400], [500, 768], [-1, 790], [1000, 790], [500, -1], [500, 800]]) {
    assert.equal(target(x, y), null);
  }
  const slow = target(500, 770), fast = target(500, 798);
  assert.equal(slow.element, page);
  assert.ok(slow.y > 0 && fast.y > slow.y);
  assert.equal(target(500, 2), null);
  page.scrollTop = 100;
  assert.ok(target(500, 2).y < target(500, 30).y);
  page.scrollTop = page.scrollHeight - page.clientHeight;
  assert.equal(target(500, 798), null);
  page.scrollWidth = 1400;
  assert.ok(target(998, 400).x > 0);
  page.scrollLeft = 100;
  assert.ok(target(2, 400).x < 0);
});

test("card content takes priority; its scrollbar limits yield to viewport-edge page scrolling", () => {
  const { document, page, card } = setup();
  const content = scroller({ left: 16, top: 40, width: 400, height: 760 });
  card(content);
  const point = { clientX: 200, clientY: 790 };
  assert.equal(dragScrollTarget(document, point).element, content);
  assert.equal(dragScrollTarget(document, { ...point, clientY: 400 }), null);
  content.scrollTop = content.scrollHeight - content.clientHeight;
  assert.equal(dragScrollTarget(document, point).element, page);
  page.scrollTop = page.scrollHeight - page.clientHeight;
  assert.equal(dragScrollTarget(document, point), null);
  content.scrollTop = 100;
  assert.equal(dragScrollTarget(document, { clientX: 200, clientY: 42 }).element, content);
  // Heading and sideways background coordinates never scroll the card.
  assert.equal(dragScrollTarget(document, { clientX: 200, clientY: 36 }), null);
  assert.equal(dragScrollTarget(document, { clientX: 450, clientY: 750 }), null);
});

test("partially visible cards use clipped edges and nested sections scroll only their outer card", () => {
  const { document, card } = setup();
  const content = scroller({ left: 16, top: -100, width: 400, height: 500 });
  content.scrollTop = 100;
  card(content);
  assert.equal(dragScrollTarget(document, { clientX: 200, clientY: 2 }).element, content);
  assert.equal(dragScrollTarget(document, { clientX: 200, clientY: 398 }).element, content);
  assert.equal(dragScrollTarget(document, { clientX: 200, clientY: 430 }), null);
});

test("stationary drags keep scrolling after a short dwell and stop when the pointer leaves the edge", () => {
  const fixture = setup();
  const { drag, tick, page, frames } = fixture;
  drag.update({ clientX: 500, clientY: 798 });
  tick(0); tick(100); tick(199);
  assert.equal(page.scrollTop, 0);
  tick(215);
  assert.ok(page.scrollTop > 0);
  const first = page.scrollTop;
  tick(231); tick(247);
  assert.ok(page.scrollTop > first);
  assert.ok(fixture.changes >= 3);
  drag.update({ clientX: 500, clientY: 400 });
  const stopped = page.scrollTop;
  tick(263); tick(1000);
  assert.equal(page.scrollTop, stopped);
  drag.stop();
  assert.equal(frames.size, 0);
  tick(2000);
  assert.equal(page.scrollTop, stopped);
});

test("browser/manual scrolling pauses the fallback until it settles, including page motion over a card", () => {
  const { document, drag, tick, page, card } = setup();
  const content = scroller({ left: 16, top: 40, width: 400, height: 500 });
  card(content);
  drag.update({ clientX: 200, clientY: 538 });
  tick(0); tick(200);
  const first = content.scrollTop;
  assert.ok(first > 0);
  content.scrollTop += 20; // Firefox/native wheel moved this scroller.
  tick(216); tick(300); tick(400);
  assert.equal(content.scrollTop, first + 20);
  tick(432);
  assert.ok(content.scrollTop > first + 20);
  page.scrollTop += 20; // Native page scrolling must not race a card fallback.
  const second = content.scrollTop;
  tick(448); tick(600);
  assert.equal(content.scrollTop, second);
  tick(664);
  assert.ok(content.scrollTop > second);
  // Manual scrolling hasn't been captured or cancelled by this controller.
  assert.equal(document.onwheel, undefined);
});

test("live targets are reselected after scrolling/resizing and each new direction has its own dwell", () => {
  const { document, page, drag, tick, card } = setup();
  const content = scroller({ left: 16, top: 40, width: 400, height: 500 });
  drag.update({ clientX: 200, clientY: 538 });
  tick(0); tick(250);
  assert.equal(page.scrollTop, 0);
  card(content); // Scrolling has brought a new card underneath the same point.
  tick(300); tick(450);
  assert.equal(content.scrollTop, 0);
  tick(516);
  assert.ok(content.scrollTop > 0);
  drag.update({ clientX: 200, clientY: 42 });
  tick(532);
  const position = content.scrollTop;
  tick(650);
  assert.equal(content.scrollTop, position);
  tick(750);
  assert.ok(content.scrollTop < position);
  document.defaultView.innerHeight = 300;
  drag.update({ clientX: 200, clientY: 500 });
  const resized = content.scrollTop;
  tick(800); tick(1100);
  assert.equal(content.scrollTop, resized);
});

test("scroll speed is frame-rate independent, long pauses are capped, and restart discards old timing", () => {
  function distance(step) {
    const { drag, tick, page } = setup();
    drag.update({ clientX: 500, clientY: 798 });
    tick(0);
    tick(200);
    const start = page.scrollTop;
    for (let time = 200 + step; time <= 600; time += step) tick(time);
    return page.scrollTop - start;
  }
  assert.ok(Math.abs(distance(10) - distance(20)) < 0.0001);
  const { drag, tick, page } = setup();
  drag.update({ clientX: 500, clientY: 798 });
  tick(0); tick(10000);
  assert.ok(page.scrollTop <= 35);
  drag.stop();
  const stopped = page.scrollTop;
  drag.update({ clientX: 500, clientY: 798 });
  tick(20000); tick(20100);
  assert.equal(page.scrollTop, stopped);
});
