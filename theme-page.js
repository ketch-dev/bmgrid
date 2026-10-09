import { createThemePreference, createThemeOverrides } from "./theme.js";
import { THEME_COLORS, colorCss } from "./theme-colors.js";

const listeners = new Set();
let loaded = false;

function applyTheme() {
  if (!loaded) return;
  const root = document.documentElement;
  for (const role of THEME_COLORS) {
    const override = overrides.get(theme.value, role.id);
    const color = overrides.isEnabled(theme.value) && override.enabled ? override.color : role[theme.value];
    root.style.setProperty(`--${role.variable ?? role.id}`, colorCss(role, theme.value, color));
  }
  root.dataset.theme = theme.value;
  for (const listener of listeners) listener();
}

export const theme = createThemePreference(browser, applyTheme);
export const overrides = createThemeOverrides(browser, applyTheme);

export function observeTheme(listener) {
  listeners.add(listener);
  listener();
  return () => { listeners.delete(listener); };
}

await Promise.all([theme.ready, overrides.ready].map(ready =>
  ready.catch(error => { console.error("bmgrid theme:", error); })));
loaded = true;
applyTheme();
