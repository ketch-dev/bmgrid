import { createBookmarkController } from "./bookmarks.js";
import { startIconBackground } from "./bookmark-icons.js";
import { startToolbarIconBackground } from "./toolbar-icon.js";

const controller = createBookmarkController(browser);
startIconBackground(browser);
startToolbarIconBackground(browser);

browser.runtime.onMessage.addListener(message => {
  if (message?.scope !== "bmgrid") return undefined;
  return controller.handle(message).then(
    result => ({ ok: true, result }),
    error => ({ ok: false, error: error.message ?? String(error) }),
  );
});

browser.runtime.onStartup.addListener(() => controller.ready);
browser.runtime.onInstalled.addListener(() => controller.ready);
