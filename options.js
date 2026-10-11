import { createThemeSettings } from "./theme-settings.js";
import { OTHER_BOOKMARKS_ID } from "./bookmarks.js";
import { icon } from "./icons.js";
import { createBookmarkEditor, createEditorElement } from "./bookmark-editor.js";

const popup = document.body.classList.contains("toolbar-popup");
const actions = document.querySelector("#extension-actions");
const status = document.querySelector("#status");
let deleting = false;
let deleteVersion = 0;
createThemeSettings(document.querySelector("#theme-settings"), document.querySelector("#theme-colors"), error => {
  status.textContent = error ?? "";
  status.hidden = !error;
});
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
  { id: "delete-bookmark", label: "Delete Bookmark", kind: "trash", popupOnly: true,
    title: "Delete all bookmarks for this page in Other Bookmarks and its nested folders.", async run() {
      deleting = true;
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error("Unable to identify the active page.");
      await request("delete-page-bookmarks", { windowId: tab.windowId, tabId: tab.id, url: tab.url });
      window.close();
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
  if (action.popupOnly && !popup) continue;
  const button = document.createElement("button");
  button.type = "button";
  button.id = action.id;
  button.className = "action-button";
  button.autofocus = popup && action.id === "add-bookmark";
  button.disabled = action.id === "delete-bookmark";
  button.hidden = action.id === "delete-bookmark";
  if (action.title) button.title = action.title;
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
      if (action.id === "delete-bookmark") {
        deleting = false;
        refreshDeleteButton();
      } else button.disabled = false;
    }
  });
  actions.append(button);
}

async function refreshDeleteButton() {
  const button = document.querySelector("#delete-bookmark");
  const version = ++deleteVersion;
  button.disabled = true;
  let count = 0;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    count = tab?.url ? await request("page-bookmarks", { windowId: tab.windowId }) : 0;
  } catch {
    // Restricted pages and failed verification hide the deletion action.
  }
  if (version !== deleteVersion) return;
  if (count === 0 && document.activeElement === button) document.querySelector("#add-bookmark").focus();
  button.hidden = count === 0;
  button.disabled = deleting || button.hidden;
}

if (popup) {
  for (const event of [browser.tabs.onActivated, browser.tabs.onUpdated,
    browser.tabs.onCreated, browser.tabs.onRemoved, browser.tabs.onAttached, browser.tabs.onDetached,
    browser.bookmarks.onCreated, browser.bookmarks.onChanged, browser.bookmarks.onMoved, browser.bookmarks.onRemoved]) {
    event.addListener(refreshDeleteButton);
  }
  refreshDeleteButton();
  actions.querySelector("button").focus();
  window.addEventListener("focus", () => {
    if (editorElement.hidden && document.activeElement === document.body) actions.querySelector("button").focus();
  });
}
