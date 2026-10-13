import { theme, overrides, observeTheme } from "./theme-page.js";
import { THEME_COLORS, getTheme, normalizeHex, colorCss } from "./theme-colors.js";
import { createThemeDropdown } from "./theme-dropdown.js";

export function createThemeSettings(settings, colors, showError) {
  settings.innerHTML = `<div class="theme-setting">
    <span id="theme-label">Theme</span>
    <div class="theme-dropdown">
      <button id="theme-choice" type="button" role="combobox" aria-labelledby="theme-label"
        aria-haspopup="listbox" aria-controls="theme-menu" aria-expanded="false">
        <span id="theme-value"></span><span aria-hidden="true">▾</span>
      </button>
      <div id="theme-menu" role="listbox" aria-labelledby="theme-label" hidden></div>
    </div>
  </div>
  <p id="browser-theme-hint" class="theme-hint" hidden>Colors follow your Firefox theme and cannot be overridden here.</p>`;
  colors.innerHTML = `<h2><label id="theme-colors-title" class="override-colors-label" for="override-colors">
    <input id="override-colors" class="color-override" type="checkbox" aria-controls="color-overrides-details">
    Override Theme Colors</label></h2>
    <div id="color-overrides-details" hidden>
      <p id="theme-colors-description" class="theme-hint"></p>
      <div class="color-list" role="group" aria-labelledby="theme-colors-title"></div>
      <p class="theme-hint">Overrides sync with your Mozilla account when Add-ons sync is enabled.
        Shadow opacity is preserved.</p>
    </div>`;
  const browserHint = settings.querySelector("#browser-theme-hint");
  const master = colors.querySelector("#override-colors");
  const details = colors.querySelector("#color-overrides-details");
  const description = colors.querySelector("#theme-colors-description");
  const list = colors.querySelector(".color-list");
  const drafts = new Map();
  const rows = new Map();
  let rendering = false;
  let themeSave = Promise.resolve();
  let masterSave = Promise.resolve();
  let colorSave = Promise.resolve();
  const dropdown = createThemeDropdown(settings.querySelector(".theme-dropdown"), selected => {
    // Keep keyboard focus while serializing rapid selections.
    themeSave = themeSave.then(() => {
      showError();
      return theme.set(selected);
    }).catch(error => {
      render();
      showError(`Unable to save theme: ${error.message ?? String(error)}`);
    });
  });

  master.addEventListener("change", () => {
    const mode = theme.value;
    if (mode === "browser") return;
    const enabled = master.checked;
    masterSave = masterSave.then(() => {
      showError();
      return overrides.setEnabled(mode, enabled);
    }).catch(error => {
      render();
      showError(`Unable to save color override setting: ${error.message ?? String(error)}`);
    });
  });

  function key(mode, role) { return `${mode}.${role.id}`; }

  function save(mode, role, enabled, hex) {
    if (mode === "browser") return;
    const draft = { enabled, hex, error: "" };
    drafts.set(key(mode, role), draft);
    try {
      normalizeHex(hex);
    } catch (error) {
      draft.error = error.message;
      render();
      return;
    }
    render();
    colorSave = colorSave.then(async () => {
      try {
        await overrides.set(mode, role.id, enabled, hex);
        if (drafts.get(key(mode, role)) === draft) drafts.delete(key(mode, role));
      } catch (error) {
        if (drafts.get(key(mode, role)) === draft) {
          draft.error = `Unable to save color: ${error.message ?? String(error)}`;
        }
      }
      render();
    });
  }

  for (const role of THEME_COLORS) {
    const row = document.createElement("div");
    row.className = "color-row";
    row.dataset.colorId = role.id;
    row.innerHTML = `<input class="color-override" type="checkbox">
      <label class="color-label"></label>
      <span class="color-preview"><input class="color-picker" type="color"></span>
      <input class="color-hex" type="text" autocomplete="off" spellcheck="false">
      <p class="color-error" role="alert" hidden></p>`;
    const checkbox = row.querySelector(".color-override");
    const label = row.querySelector("label");
    const preview = row.querySelector(".color-preview");
    const picker = row.querySelector(".color-picker");
    const hex = row.querySelector(".color-hex");
    const error = row.querySelector(".color-error");
    checkbox.id = `override-${role.id}`;
    label.htmlFor = checkbox.id;
    error.id = `color-error-${role.id}`;
    hex.setAttribute("aria-describedby", error.id);
    label.textContent = role.label;
    picker.setAttribute("aria-label", `${role.label} color picker`);
    hex.setAttribute("aria-label", `${role.label} hex color`);
    hex.placeholder = "#rrggbb";
    rows.set(role.id, { row, checkbox, label, preview, picker, hex, error });
    list.append(row);

    checkbox.addEventListener("change", () => {
      const mode = theme.value;
      if (mode === "browser") return;
      const draft = drafts.get(key(mode, role));
      const stored = overrides.get(mode, role.id);
      let color = stored.color;
      // Turning an invalid draft off restores the default without saving invalid data.
      try { if (draft) color = normalizeHex(draft.hex); } catch {}
      save(mode, role, checkbox.checked, color);
    });

    hex.addEventListener("input", () => {
      if (theme.value === "browser") return;
      drafts.set(key(theme.value, role), { enabled: true, hex: hex.value, error: "" });
      render();
    });
    hex.addEventListener("change", () => {
      // Hiding the table can blur its input after the selected theme changes.
      // Preserve that draft rather than saving it into the new theme.
      if (!rendering) save(theme.value, role, true, hex.value);
    });
    hex.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      save(theme.value, role, true, hex.value);
    });

    // Capture the destination before the native picker opens, even if another
    // page changes the selected theme while its dialog is open.
    let pickerTheme = null;
    let pickerColor = null;
    picker.addEventListener("click", () => { pickerTheme = theme.value; pickerColor = null; });
    picker.addEventListener("input", () => {
      pickerColor = picker.value;
      drafts.set(key(pickerTheme ?? theme.value, role), { enabled: true, hex: picker.value, error: "" });
      render();
    });
    picker.addEventListener("change", () => {
      const mode = pickerTheme ?? theme.value;
      const color = pickerColor ?? picker.value;
      pickerTheme = null;
      pickerColor = null;
      save(mode, role, true, color);
    });
  }

  function render() {
    rendering = true;
    const mode = theme.value;
    const definition = getTheme(mode);
    dropdown.setValue(mode);
    const automatic = mode === "browser";
    const hidingColorsFocus = automatic && colors.contains(document.activeElement);
    browserHint.hidden = !automatic;
    colors.hidden = automatic;
    master.disabled = automatic;
    if (automatic) {
      master.checked = false;
      master.setAttribute("aria-expanded", "false");
      details.hidden = true;
      for (const { checkbox, picker, hex } of rows.values()) checkbox.disabled = picker.disabled = hex.disabled = true;
      if (hidingColorsFocus) dropdown.focus();
      rendering = false;
      return;
    }
    const enabled = overrides.isEnabled(mode);
    const hidingFocus = !enabled && details.contains(document.activeElement);
    master.checked = enabled;
    master.setAttribute("aria-expanded", String(enabled));
    details.hidden = !enabled;
    if (hidingFocus) master.focus();
    description.textContent = `${definition.label} theme. Unchecked colors use defaults.`;
    for (const role of THEME_COLORS) {
      const { row, checkbox, label, preview, picker, hex, error } = rows.get(role.id);
      const stored = overrides.get(mode, role.id);
      const draft = drafts.get(key(mode, role));
      const enabled = draft?.enabled ?? stored.enabled;
      const defaultColor = definition.colors[role.id];
      const text = enabled ? draft?.hex ?? stored.color : defaultColor;
      let color = enabled ? stored.color : defaultColor;
      try { color = normalizeHex(text); } catch {}
      checkbox.checked = enabled;
      checkbox.disabled = false;
      row.dataset.overridden = String(enabled);
      label.title = `Default: ${defaultColor}${role.opacity ? `; ${role.opacity[definition.scheme]}% opacity${role.id === "scroll-shadow" ? " fading to transparent" : ""}` : ""}`;
      hex.disabled = picker.disabled = !enabled;
      // Avoid resetting an unchanged input's caret or native text undo history.
      if (hex.value !== text) hex.value = text;
      if (picker.value !== color) picker.value = color;
      const css = colorCss(role, definition.scheme, color);
      preview.style.setProperty("--preview-color", role.id === "scroll-shadow" ? `linear-gradient(to right, ${css})` : css);
      error.textContent = draft?.error ?? "";
      error.hidden = !error.textContent;
      hex.setAttribute("aria-invalid", String(Boolean(error.textContent)));
    }
    rendering = false;
  }

  observeTheme(render);
}
