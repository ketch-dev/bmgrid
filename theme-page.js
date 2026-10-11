import { createThemePreference, createThemeOverrides } from "./theme.js";
import { THEME_COLORS, colorCss } from "./theme-colors.js";
import { createBrowserTheme } from "./browser-theme.js";

const listeners = new Set();
let loaded = false;

function applyTheme() {
  if (!loaded) return;
  const root = document.documentElement;
  const mode = theme.value;
  const automatic = mode === "browser";
  const { scheme, colors } = automatic ? browserTheme.value : {
    scheme: mode, colors: Object.fromEntries(THEME_COLORS.map(role => [role.id, role[mode]])),
  };
  const overridesEnabled = !automatic && overrides.isEnabled(mode);
  for (const role of THEME_COLORS) {
    let color = colors[role.id];
    if (overridesEnabled) {
      const override = overrides.get(mode, role.id);
      if (override.enabled) color = override.color;
    }
    root.style.setProperty(`--${role.variable ?? role.id}`, colorCss(role, scheme, color));
  }
  root.dataset.theme = mode;
  root.dataset.colorScheme = scheme;
  for (const listener of listeners) listener();
}

export const theme = createThemePreference(browser, applyTheme);
export const overrides = createThemeOverrides(browser, applyTheme);
const browserTheme = createBrowserTheme(browser, matchMedia("(prefers-color-scheme: dark)"), () => {
  if (theme.value === "browser") applyTheme();
});

export function observeTheme(listener) {
  listeners.add(listener);
  listener();
  return () => { listeners.delete(listener); };
}

await Promise.all([theme.ready, overrides.ready, browserTheme.ready].map(ready =>
  ready.catch(error => { console.error("bmgrid theme:", error); })));
loaded = true;
applyTheme();
