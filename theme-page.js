import { createThemePreference, createThemeOverrides } from "./theme.js";
import { THEME_COLORS, colorCss } from "./theme-colors.js";
import { createBrowserTheme } from "./browser-theme.js";

const listeners = new Set();
let loaded = false;

function applyTheme() {
  if (!loaded) return;
  const root = document.documentElement;
  const automatic = theme.value === "browser";
  const scheme = automatic ? browserTheme.value.scheme : theme.value;
  for (const role of THEME_COLORS) {
    let color = browserTheme.value.colors[role.id];
    if (!automatic) {
      const override = overrides.get(theme.value, role.id);
      color = overrides.isEnabled(theme.value) && override.enabled ? override.color : role[theme.value];
    }
    root.style.setProperty(`--${role.variable ?? role.id}`, colorCss(role, scheme, color));
  }
  root.dataset.theme = theme.value;
  root.dataset.colorScheme = scheme;
  for (const listener of listeners) listener();
}

export const theme = createThemePreference(browser, applyTheme);
export const overrides = createThemeOverrides(browser, applyTheme);
const browserTheme = createBrowserTheme(browser, matchMedia("(prefers-color-scheme: dark)"), applyTheme);

export function observeTheme(listener) {
  listeners.add(listener);
  listener();
  return () => { listeners.delete(listener); };
}

await Promise.all([theme.ready, overrides.ready, browserTheme.ready].map(ready =>
  ready.catch(error => { console.error("bmgrid theme:", error); })));
loaded = true;
applyTheme();
