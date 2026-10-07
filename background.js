import { createBookmarkController } from "./bookmarks.js";

const controller = createBookmarkController(browser);

browser.runtime.onMessage.addListener(message => {
  if (message?.scope !== "bmgrid") return undefined;
  return controller.handle(message).then(
    result => ({ ok: true, result }),
    error => ({ ok: false, error: error.message ?? String(error) }),
  );
});

browser.runtime.onStartup.addListener(() => controller.ready);
browser.runtime.onInstalled.addListener(() => controller.ready);
