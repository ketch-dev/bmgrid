const ITEMS = ".bookmark, .folder-card, .nested-folder";
const TIMING = { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

function itemId(element) {
  return element.dataset.bookmarkId ?? element.dataset.folderId;
}

function parentId(element) {
  const parent = element.parentElement.closest(ITEMS);
  return parent ? itemId(parent) : null;
}

export function createRearrangement(root) {
  // Keep the explicitly requested rearrangement animations enabled even when
  // the browser reports prefers-reduced-motion; this is intentional.
  const active = new Set();
  const floating = new Map();
  let scrollPositions = new WeakMap();

  function finish() {
    for (const animation of active) {
      animation.onfinish = null;
      animation.cancel();
    }
    active.clear();
    for (const { element, overlay } of floating.values()) {
      element.style.removeProperty("visibility");
      overlay.remove();
    }
    floating.clear();
  }

  function capture() {
    // Read the currently painted positions before cancelling in-flight motion.
    const visible = new Map();
    for (const { overlay } of floating.values()) {
      visible.set(itemId(overlay), overlay);
      for (const child of overlay.querySelectorAll(ITEMS)) visible.set(itemId(child), child);
    }
    const positions = new Map([...root.querySelectorAll(ITEMS)].map(element => {
      const replacement = visible.get(itemId(element));
      return [itemId(element), {
        box: (replacement ?? element).getBoundingClientRect(),
        parent: parentId(element),
        floating: Boolean(replacement),
      }];
    }));
    finish();
    return positions;
  }

  function track(element, frames, cleanup = () => {}) {
    const animation = element.animate(frames, TIMING);
    active.add(animation);
    animation.onfinish = () => {
      active.delete(animation);
      cleanup();
    };
  }

  function play(previous) {
    if (!previous.size) return;
    scrollPositions = new WeakMap([document.scrollingElement,
      ...root.querySelectorAll(".folder-content")].map(element =>
      [element, { top: element.scrollTop, left: element.scrollLeft }]));
    // Measure the complete final layout before writing any animation styles.
    const entries = [...root.querySelectorAll(ITEMS)].map(element => {
      const id = itemId(element);
      const before = previous.get(id);
      const box = element.getBoundingClientRect();
      return {
        id, element, box, before, parent: parentId(element),
        x: before ? before.box.left - box.left : 0,
        y: before ? before.box.top - box.top : 0,
      };
    });
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const floatingParents = new Set();
    for (const entry of entries) {
      const { id, element, box, before, parent } = entry;
      if (!before) continue;
      // A floating folder already carries its descendants with it.
      if (floatingParents.has(parent)) {
        floatingParents.add(id);
        continue;
      }
      if (before.parent !== parent || before.floating) {
        const overlay = element.cloneNode(true);
        const style = getComputedStyle(element);
        // Keep contextual styling (in particular the unfoldered chips) outside
        // the original parent, without carrying its scroll clipping with us.
        for (const property of ["background", "border", "border-radius", "padding", "box-shadow"]) {
          overlay.style.setProperty(property, style.getPropertyValue(property));
        }
        overlay.classList.add("rearrangement-overlay");
        overlay.setAttribute("aria-hidden", "true");
        overlay.inert = true;
        for (const node of [overlay, ...overlay.querySelectorAll("[id], [data-dragging]")]) {
          node.removeAttribute("id");
          node.removeAttribute("data-dragging");
        }
        Object.assign(overlay.style, {
          left: `${box.left}px`, top: `${box.top}px`,
          width: `${box.width}px`, height: `${box.height}px`,
        });
        document.body.append(overlay);
        element.style.visibility = "hidden";
        floating.set(id, { element, overlay });
        floatingParents.add(id);
        track(overlay, [
          { transform: `translate(${entry.x}px, ${entry.y}px)`,
            width: `${before.box.width}px`, height: `${before.box.height}px` },
          { transform: "translate(0, 0)", width: `${box.width}px`, height: `${box.height}px` },
        ], () => {
          element.style.removeProperty("visibility");
          overlay.remove();
          floating.delete(id);
        });
        continue;
      }
      // Descendants inherit their folder's translation; only animate the
      // remaining local offset so a card and its contents never move twice.
      const ancestor = byId.get(parent);
      const x = entry.x - (ancestor?.x ?? 0);
      const y = entry.y - (ancestor?.y ?? 0);
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      track(element, [
        { transform: `translate(${x}px, ${y}px)` },
        { transform: "translate(0, 0)" },
      ]);
    }
  }

  // Fixed-position flights should not outlive a change of viewport/scroll.
  window.addEventListener("resize", finish);
  document.addEventListener("scroll", event => {
    const element = event.target === document ? document.scrollingElement : event.target;
    const previous = scrollPositions.get(element);
    // Restoring card scroll positions during render also queues scroll events.
    if (previous?.top === element.scrollTop && previous.left === element.scrollLeft) return;
    finish();
  }, true);
  return { capture, play, finish };
}
