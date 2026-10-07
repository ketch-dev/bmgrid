# Project instructions

## Scope
- This is a Firefox new-tab extension built with plain HTML, CSS, and JavaScript.
- Keep the UI minimal and grayscale. Add features or dependencies only when requested.

## Bookmark behavior
- Firefox bookmarks are the source of truth; mutations must update actual bookmarks through the bookmarks API.
- Display only the built-in Other Bookmarks subtree, identified by `unfiled_____`, not its localized name.
- Display direct bookmarks first, left to right with wrapping, retaining their relative native order.
- Display immediate child folders as grid cards in native order, left to right and then top to bottom.
- List folder contents vertically in native order. Render deeper folders as always-expanded, indented sections.
- The unfoldered-first presentation is a display rule; do not reorder native bookmarks just to render it.
- Support moving bookmarks within and between displayed folders and the unfoldered area, and reordering sibling folders.
- Observe bookmark events so changes made in Firefox's native UI appear in the grid.

## Layout
- Fit up to six columns, each at least 400px wide, accounting for padding and gaps.
- Fit up to two rows in the available height, each at least 400px tall; account for the unfoldered area.
- Additional folder rows use vertical page scrolling. Long folder contents scroll inside their cards.
- Preserve minimum dimensions on small windows rather than shrinking cards below these limits.

## Interactions
- Right-click a bookmark to show a small popup with the pen icon and Rename text, and the X icon and Delete text; each action uses a single click. Support the context-menu key and Shift+F10 as well.
- Show the pen and X beside hovered or focused folder names; single-click the pen to rename and double-click X to delete a folder and its descendants.
- Delete immediately and without confirmation. Dismiss the bookmark popup after an action, outside click, Escape, scrolling, resizing, or refresh.
- Left-click a bookmark to open it in the current tab; middle-click opens a new tab.
- Inline rename saves on Enter or blur and cancels on Escape.
- Ctrl+Z restores extension-made deletions during the browser session; keep normal text undo while editing.
- Extension undo is separate from Firefox's native undo history and recreates items with new IDs.

## State and deletion logs
- Use `storage.session` for the temporary bookmark-tree cache and deletion undo snapshots.
- Use `storage.local` for the latest 100 deletion events, oldest first and newest last, with no dates.
- Log deletions from all Firefox bookmark locations, including the native UI while the extension is enabled.
- Native folder-removal events omit descendants; use the pre-removal cache to capture all bookmark names and URLs.
- Single deletion format: `Deleted: {BOOKMARK_NAME} ({BOOKMARK_URL})`.
- Folder header: `Deleted {FOLDER_NAME} folder with bookmarks:`; list each descendant bookmark as `{BOOKMARK_NAME} ({BOOKMARK_URL})` on its own line.
- A folder deletion counts as one event. Append one empty line after every exported event, including the final event.
- Preserve exact URLs and duplicate bookmarks; normalize line breaks in names to keep each bookmark on one line.
- Keep log entries after undo. Preserve legacy entries without inventing missing bookmark names.
- Export UTF-8 `deletion-log.txt` from the embedded Firefox Preferences page in `about:addons`.

## Code map
- `manifest.json`: permissions, new-tab override, background module, and embedded Preferences registration.
- `background.js`: message routing and background startup.
- `bookmark-icons.js`: replaceable icon provider; encapsulates tab-derived collection, persistent caching, and update notifications. Its public interface is `startIconBackground(api)` and `createIconProvider(api, onChanged)` returning `ready` and `getUrl(bookmark)`.
- `bookmark.svg`: generic bookmark favicon fallback.
- `bookmarks.js`: native bookmark operations, event cache, undo, and persistent deletion logging.
- `newtab.html`, `newtab.css`, `newtab.js`: grid rendering and interactions.
- `layout.js`: column and row sizing calculations.
- `options.html`, `options.css`, `options.js`: Preferences UI and log download.
- `tests/`: Node tests and the fake bookmarks API.

## Verification
- Run `npm test` for bookmark behavior, logging, undo, and sizing changes.
- Validate extension changes with `npm exec --yes --package=web-ext -- web-ext lint --source-dir . --ignore-files "tests/**" package.json AGENTS.md`.
- Use a disposable, isolated Firefox-compatible profile for browser checks; the extension modifies real bookmarks.
- Check exports from the embedded Add-ons Manager Preferences page, not just a standalone options tab.

## Git
- Use read-only Git commands unless Git writes are explicitly requested. Preserve existing staged and unstaged work.
