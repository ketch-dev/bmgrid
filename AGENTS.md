# Project instructions

## Scope
- This is a Firefox new-tab extension built with plain HTML, CSS, and JavaScript.
- Keep the UI minimal and grayscale. Add features or dependencies only when requested.

## Bookmark behavior
- Firefox bookmarks are the source of truth; mutations must update actual bookmarks through the bookmarks API.
- Display only the built-in Other Bookmarks subtree, identified by `unfiled_____`, not its localized name.
- Preserve native mixed bookmark/folder sibling order at the top level and at every nested level.
- Display consecutive direct bookmarks as compact, full-width bookmark-only groups, left to right with wrapping. Each switch between direct bookmarks and folder cards starts a new grid row; never put a folder on a direct-bookmark row.
- Display consecutive immediate child folders as grid cards in native order, left to right and then top to bottom.
- List folder contents vertically in native order. Render deeper folders as always-expanded, indented sections.
- Grouping is a display rule; do not reorder native bookmarks just to render it.
- Support moving bookmarks and folders within and between displayed folders and the unfoldered area, including reordering sibling folders. Prevent moving folders into themselves or their descendants.
- Folder headings and card/section borders do not accept drops. Inside filled folders, bookmarks and folders require a precise insertion position: a measured gap before, between, or after native children, or the before/after half of a bookmark row. Unused content background is not a generic append target. Empty folder contents accept their first item with a horizontal starting marker. Reordering uses the actual gaps between native siblings, including gaps between two bookmarks and across direct-bookmark groups. Grid insertion lines are always vertical. At a wrapped or mixed row boundary, the narrow gap right of the previous row's last item and the narrow gap left of the next row's first item insert at the same native position, with the line beside the hovered item; the space between rows is not a folder insertion target. Top/bottom end gaps show a line beside the first/last item. Inside folders, insertion lines are horizontal in the gap, preserving native mixed bookmark/folder ordering, and are clipped to the outer scrolling card.
- The `#folders` container holds the mixed native sequence. It accepts folder drops only in measured insertion gaps, never as a generic root destination, except when empty. Its background and unused grid space, plus the page/canvas background, accept bookmark drops that append to Other Bookmarks. Each `.direct-bookmarks` group accepts both bookmarks and folders; its background inserts after that group's last bookmark in the native order. Group/grid/page background drops show a vertical insertion line beside the destination's last item, or at the start of an empty grid. All drop indicators are insertion lines; never highlight a whole folder, group, grid, or page. Precise insertion gaps take priority over background drops; already-last background drops preserve native placement without self anchors.
- Observe bookmark events so changes made in Firefox's native UI appear in the grid.
- Use the same measured insertion-line geometry for equivalent bookmark-row, gap, and background targets so the marker never jumps between nearby positions at a native boundary. Preserve the distinct hovered-row sides at wrapped boundaries.
- Internal grid row gutters reject both bookmark and folder drops; they must never fall back to appending at the end of Other Bookmarks. Determine gutters from actual grid rows, including full-width bookmark-group wrappers and content-sized folder rows. Column insertion gaps include their leading edges; retain wrapped-row side targets and intentional append drops on unused grid space and the outside canvas.

## Layout
- Use a shared Dark/Light segmented selector backed by native radio inputs in Preferences and the toolbar popup; avoid the native select popup, which can trigger an embedded-frame dragging artifact in LibreWolf's Add-ons Manager.
- Gate the color table and custom palette behind an "Override Colors" master checkbox in both Preferences and the toolbar popup. Remember and synchronize its state separately for Dark and Light; disabling it restores the built-in palette while retaining individual overrides and drafts. New configurations default to unchecked; existing customized palettes without a master setting start checked.
- Offer matching Dark/Light selectors and color-override controls in embedded Preferences and the toolbar popup. Persist the selection in `storage.local` and update all open extension pages. Default to Dark. Keep the built-in Light palette grayscale with soft gray surfaces, never pure-white backgrounds. Both themes expose the same 19 color roles, one per line, with an override checkbox, native color picker/preview, and hex input. Dim unchecked default rows; disabling an override restores the default but retains its custom color for re-enabling. Preserve shadow opacity and gradient shapes. Store each theme/color override and enabled state independently in `storage.sync` for Mozilla account synchronization; accept incoming sync updates live and retain drafts on validation or save failure.
- Keep at least 4px between independently highlightable sibling items: toolbar/Preferences actions, grid context-menu actions, and bookmark rows inside folders. Preserve larger existing gaps.
- Fit up to six columns, each at least 400px wide, accounting for padding and gaps.
- Size each grid row to its tallest folder's contents, capped at 400px total height including the heading and padding. Stretch shorter folder cards to the same height within their row; different rows may have different heights.
- Folder rows exceeding the available height use vertical page scrolling. Long folder contents scroll inside their cards.
- Preserve the 400px minimum card width on small windows.

## Interactions
- Right-click a bookmark or folder heading to show a small popup with the pen icon and Edit text for bookmarks or Rename text for folders, and the trash-bin icon and Delete text; each action uses a single click. Support the context-menu key and Shift+F10 as well, with keyboard-focusable folder names.
- Bookmark-row popups offer only Edit and Delete. Folder-heading popups put plus-icon Add Bookmark and Add Folder actions first, followed by Rename and Delete. Empty folder areas, including content padding and gaps between items, offer only Add Bookmark and Add Folder; target the innermost folder containing the clicked space. Creation actions from headings or empty folder areas append inside that folder. Grid gaps and the unfoldered/canvas background offer both creation actions, appending to Other Bookmarks. Focus the first visible popup action when opening. Use the compact bookmark modal for creation, with Name and URL for bookmarks and Name only for folders; preserve drafts on failure and defer refresh while open. Creation headings show "Add Bookmark to {FOLDER_NAME}" or "Add Folder to {FOLDER_NAME}", with the destination name white in Dark or dark in Light and surrounding text dimmed; additions to Other Bookmarks show only "Add Bookmark" or "Add Folder" in dimmed text.
- Delete immediately and without confirmation; deleting a folder removes its descendants. Dismiss the action popup after an action, outside click, Escape, scrolling, resizing, or refresh.
- Left-click a bookmark to open it in the current tab; middle-click opens a new tab.
- Bookmark Edit opens a compact modal with Name and URL fields. Save or Enter updates changed fields in the native bookmark; Cancel, Escape, or clicking outside cancels. Retain input and show errors when saving fails. Defer grid refresh while editing, preserve text undo, and restore bookmark focus after closing.
- When editing a URL, trim surrounding whitespace and default scheme-less addresses to HTTPS. Preserve explicit schemes and exact query/fragment text; show readable validation errors without discarding the draft.
- Inline folder rename saves on Enter or blur and cancels on Escape.
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
- The toolbar popup and embedded Preferences share three actions: Add Bookmark (plus icon), Open Grid (outline bookmark icon), and Download Deletion Log (download icon). Toolbar creation prefills the active tab's name and URL; Preferences creation starts empty. Both append to Other Bookmarks using the compact editor. Open Grid opens a new tab.
- Use the same outline bookmark ribbon everywhere. Reserve Firefox dark-theme text color (`#fbfbfe`) exclusively for the toolbar button. Tab favicons and Add-ons Manager branding use `#cccccc`; popup and Preferences action icons inherit `currentColor` so all actions match.

## Code map
- `manifest.json`: permissions, new-tab override, background module, and embedded Preferences registration.
- `background.js`: message routing and background startup.
- `bookmark-icons.js`: replaceable icon provider; encapsulates tab-derived collection, persistent caching, and update notifications. Its public interface is `startIconBackground(api)` and `createIconProvider(api, onChanged)` returning `ready` and `getUrl(bookmark)`.
- `bookmark.svg`: generic bookmark favicon fallback.
- `bookmarks.js`: native bookmark operations, event cache, undo, and persistent deletion logging.
- `newtab.html`, `newtab.css`, `newtab.js`: grid rendering and interactions.
- `layout.js`: column sizing calculation; CSS controls content-sized row heights.
- `drag-drop.js`: bookmark and folder drop targeting, measured insertion-gap and indicator geometry, and cycle prevention.
- `rearrangement.js`: captures item positions, animates grid rearrangements and cross-folder moves, and cleans up interrupted animations. Rearrangement animations intentionally remain enabled regardless of `prefers-reduced-motion`, per user preference.
- `popup.html`, `options.html`, `options.css`, `options.js`: shared toolbar/Preferences actions and log download.
- `theme.css`, `theme.js`, `theme-page.js`: shared styles, local theme preference, synchronized color overrides, and live page updates.
- `theme-colors.js`, `theme-settings.js`: built-in palette/role definitions, color validation, and shared Preferences/popup controls.
- `icons.js`: shared action icons inheriting the surrounding text color.
- `toolbar-icon.svg`: bright outline bookmark branding exclusively for the toolbar button.
- `extension-icon.svg`: dimmer outline bookmark branding for the Add-ons Manager and extension-owned tab favicons.
- `bookmark-editor.js`, `bookmark-editor.css`: shared compact bookmark/folder creation and bookmark editing UI.
- `tests/`: Node tests and the fake bookmarks API.

## Verification
- Run `npm test` for bookmark behavior, logging, undo, and sizing changes.
- Validate extension changes with `npm exec --yes --package=web-ext -- web-ext lint --source-dir . --ignore-files "tests/**" package.json AGENTS.md`.
- Use a disposable, isolated Firefox-compatible profile for browser checks; the extension modifies real bookmarks.
- Check exports from the embedded Add-ons Manager Preferences page, not just a standalone options tab.

## Git
- Use read-only Git commands unless Git writes are explicitly requested. Preserve existing staged and unstaged work.
