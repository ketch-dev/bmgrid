import { OTHER_BOOKMARKS_ID } from "./bookmarks.js";
import { icon } from "./icons.js";
import { createBookmarkEditor, createEditorElement } from "./bookmark-editor.js";

const popup = document.body.classList.contains("toolbar-popup");
const actions = document.querySelector("#extension-actions");
const status = document.querySelector("#status");
const editorElement = createEditorElement(popup);
document.querySelector("main").append(editorElement);
const editor = createBookmarkEditor(editorElement, request, (_target, saved) => {
  if (popup && saved) {
    window.close();
    return;
  }
  actions.hidden = false;
  document.querySelector("#add-bookmark").focus();
  if (saved) {
    status.textContent = "Bookmark added to Other Bookmarks.";
    status.hidden = false;
  }
});

async function request(action, details = {}) {
  const response = await browser.runtime.sendMessage({ scope: "bmgrid", action, ...details });
  if (!response?.ok) throw new Error(response?.error ?? "Unable to access Firefox bookmarks.");
  return response.result;
}

const definitions = [
  { id: "add-bookmark", label: "Add Bookmark", kind: "plus", async run() {
    const [tab] = popup ? await browser.tabs.query({ active: true, currentWindow: true }) : [];
    editor.open({ mode: "add", type: "bookmark", destination: { parentId: OTHER_BOOKMARKS_ID },
      title: tab?.title ?? "", url: tab?.url ?? "" });
    if (popup) actions.hidden = true;
  } },
  { id: "open-grid", label: "Open Grid", kind: "bookmark", async run() {
    await browser.tabs.create({ url: browser.runtime.getURL("newtab.html") });
    if (popup) window.close();
  } },
  { id: "download-log", label: "Download Deletion Log", kind: "download", async run() {
    const log = await request("log");
    const url = URL.createObjectURL(new Blob([log], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "deletion-log.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); }, 60000);
  } },
];

for (const action of definitions) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = action.id;
  button.className = "action-button";
  button.autofocus = popup && action.id === "add-bookmark";
  button.append(icon(action.kind), action.label);
  button.addEventListener("click", async () => {
    status.hidden = true;
    button.disabled = true;
    try {
      await action.run();
    } catch (error) {
      status.textContent = error.message ?? String(error);
      status.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  actions.append(button);
}

if (popup) {
  actions.querySelector("button").focus();
  window.addEventListener("focus", () => {
    if (editorElement.hidden) actions.querySelector("button").focus();
  });
}
