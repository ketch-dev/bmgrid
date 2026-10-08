const EDGE_SIZE = 32;
const MAX_SPEED = 700; // CSS pixels per second, independent of refresh rate.
const SCROLL_DELAY = 200;

function edgeSpeed(coordinate, start, end) {
  if (coordinate < start || coordinate > end || end <= start) return 0;
  const zone = Math.min(EDGE_SIZE, (end - start) / 3);
  if (coordinate < start + zone) return -MAX_SPEED * (1 - (coordinate - start) / zone);
  if (coordinate > end - zone) return MAX_SPEED * (1 - (end - coordinate) / zone);
  return 0;
}

function availableSpeed(speed, position, maximum) {
  return (speed < 0 && position > 0) || (speed > 0 && position < maximum) ? speed : 0;
}

// Only the outer card scrolls. Nested folder sections use its visible viewport.
export function dragScrollTarget(document, { clientX, clientY }) {
  const { innerWidth: width, innerHeight: height } = document.defaultView;
  if (clientX < 0 || clientX >= width || clientY < 0 || clientY >= height) return null;
  const content = document.elementFromPoint(clientX, clientY)?.closest(".folder-card")
    ?.querySelector(".folder-content");
  if (content) {
    const box = content.getBoundingClientRect();
    if (clientX >= box.left && clientX <= box.right) {
      const y = availableSpeed(edgeSpeed(clientY, Math.max(0, box.top), Math.min(height, box.bottom)),
        content.scrollTop, content.scrollHeight - content.clientHeight);
      if (y) return { element: content, x: 0, y };
    }
  }
  const page = document.scrollingElement;
  const x = availableSpeed(edgeSpeed(clientX, 0, width), page.scrollLeft, page.scrollWidth - page.clientWidth);
  const y = availableSpeed(edgeSpeed(clientY, 0, height), page.scrollTop, page.scrollHeight - page.clientHeight);
  return x || y ? { element: page, x, y } : null;
}

// Native DnD doesn't reliably deliver wheel events or auto-scroll on all window
// backends. This loop fills in edge scrolling and yields while Firefox scrolls.
export function createDragScroller(document, onScrolled) {
  const window = document.defaultView;
  let frame = null;
  let point = null;
  let current = null;
  let previousTime = null;
  let pagePosition = null;

  function tick(time) {
    frame = null;
    const elapsed = previousTime === null ? 0 : Math.min(50, time - previousTime);
    previousTime = time;
    const target = dragScrollTarget(document, point);
    const page = document.scrollingElement;
    const pageMoved = pagePosition && (page.scrollLeft !== pagePosition.x || page.scrollTop !== pagePosition.y);
    if (!target) {
      current = null;
    } else {
      if (target.element !== current?.element
          || Math.sign(target.x) !== current.signX || Math.sign(target.y) !== current.signY) {
        current = { element: target.element, signX: Math.sign(target.x), signY: Math.sign(target.y), idleSince: time,
          left: target.element.scrollLeft, top: target.element.scrollTop };
      }
      const element = target.element;
      // Compare with the position after our last write. Any other motion is
      // browser/manual scrolling: wait for it to stop before applying fallback.
      if (pageMoved || element.scrollLeft !== current.left || element.scrollTop !== current.top) current.idleSince = time;
      if (time - current.idleSince >= SCROLL_DELAY) {
        element.scrollBy({ left: target.x * elapsed / 1000, top: target.y * elapsed / 1000, behavior: "instant" });
        if (element.scrollLeft !== current.left || element.scrollTop !== current.top) onScrolled();
      }
      current.left = element.scrollLeft;
      current.top = element.scrollTop;
    }
    pagePosition = { x: page.scrollLeft, y: page.scrollTop };
    frame = window.requestAnimationFrame(tick);
  }

  return {
    update(position) {
      point = { clientX: position.clientX, clientY: position.clientY };
      if (frame === null) frame = window.requestAnimationFrame(tick);
    },
    stop() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = point = current = previousTime = pagePosition = null;
    },
  };
}
