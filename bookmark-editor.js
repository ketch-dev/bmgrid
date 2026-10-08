export function createEditorElement(inline = false) {
  const element = document.createElement(inline ? "section" : "dialog");
  element.id = "bookmark-editor";
  element.setAttribute("aria-labelledby", "bookmark-editor-title");
  if (inline) element.hidden = true;
  element.innerHTML = `
    <form id="bookmark-edit-form">
      <h2 id="bookmark-editor-title">Add Bookmark</h2>
      <fieldset id="bookmark-edit-fields">
        <label for="bookmark-edit-name">Name</label>
        <input id="bookmark-edit-name" type="text" autocomplete="off" autofocus>
        <label id="bookmark-edit-url-label" for="bookmark-edit-url">URL</label>
        <input id="bookmark-edit-url" type="text" autocomplete="off" spellcheck="false">
        <p id="bookmark-edit-error" role="alert" hidden></p>
        <div class="editor-actions">
          <button id="bookmark-edit-cancel" type="button">Cancel</button>
          <button id="bookmark-edit-submit" type="submit">Add</button>
        </div>
      </fieldset>
    </form>`;
  return element;
}

export function createBookmarkEditor(element, request, onClose) {
  const title = element.querySelector("#bookmark-editor-title");
  const form = element.querySelector("form");
  const fields = element.querySelector("fieldset");
  const name = element.querySelector("#bookmark-edit-name");
  const url = element.querySelector("#bookmark-edit-url");
  const urlLabel = element.querySelector("#bookmark-edit-url-label");
  const errorMessage = element.querySelector("#bookmark-edit-error");
  const submit = element.querySelector('[type="submit"]');
  const modal = element.tagName === "DIALOG";
  let target = null;
  let saved = false;

  function finish() {
    const previous = target;
    target = null;
    onClose(previous, saved);
  }

  function close() {
    if (modal) element.close();
    else {
      element.hidden = true;
      finish();
    }
  }

  function cancel() {
    if (target && !fields.disabled) close();
  }

  element.querySelector("#bookmark-edit-cancel").addEventListener("click", cancel);
  element.addEventListener("cancel", event => {
    event.preventDefault();
    cancel();
  });
  if (modal) element.addEventListener("close", finish);
  element.addEventListener("keydown", event => {
    if (!modal && event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
    if (event.key !== "Tab") return;
    const controls = [...fields.querySelectorAll("input, button")]
      .filter(control => !control.matches(":disabled") && !control.hidden);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function outside(event) {
    const box = element.getBoundingClientRect();
    return event.target === element && (event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom);
  }
  let backdropPressed = false;
  if (modal) {
    element.addEventListener("pointerdown", event => { backdropPressed = outside(event); });
    element.addEventListener("click", event => {
      if (backdropPressed && outside(event)) cancel();
      backdropPressed = false;
    });
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!target || fields.disabled) return;
    const { node, mode, type, destination } = target;
    errorMessage.hidden = true;
    fields.disabled = true;
    try {
      if (mode === "add") {
        await request("add", { ...destination, type, title: name.value,
          ...(type === "bookmark" ? { url: url.value } : {}) });
      } else {
        const changes = {};
        if (name.value !== node.title) changes.title = name.value;
        if (url.value !== node.url) changes.url = url.value;
        if (Object.keys(changes).length) await request("edit", { id: node.id, ...changes });
      }
      saved = true;
      close();
    } catch (error) {
      errorMessage.textContent = error.message ?? String(error);
      errorMessage.hidden = false;
      fields.disabled = false;
      (type === "bookmark" ? url : name).focus();
    }
  });

  return {
    open(next) {
      if (target) return;
      target = next;
      saved = false;
      const adding = target.mode === "add";
      const isBookmark = target.type === "bookmark";
      title.textContent = adding ? isBookmark ? "Add Bookmark" : "Add Folder" : "Edit Bookmark";
      title.classList.toggle("creation-title", adding);
      if (adding && target.destinationName !== undefined) {
        const destination = document.createElement("span");
        destination.className = "destination-name";
        destination.textContent = target.destinationName;
        title.append(" to ", destination);
      }
      submit.textContent = adding ? "Add" : "Save";
      name.value = adding ? target.title ?? "" : target.node.title;
      url.value = adding ? target.url ?? "" : target.node.url;
      url.hidden = urlLabel.hidden = !isBookmark;
      errorMessage.hidden = true;
      fields.disabled = false;
      if (modal) element.showModal();
      else element.hidden = false;
      name.focus();
      name.select();
    },
  };
}
