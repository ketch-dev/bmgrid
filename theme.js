import { THEME_COLORS, THEMES, DEFAULT_THEME, getTheme, normalizeHex } from "./theme-colors.js";

const THEME_KEY = "theme";

export function createThemePreference(api, onChanged) {
  let value = DEFAULT_THEME;
  let updated = false;

  function apply(stored) {
    value = getTheme(stored) ? stored : DEFAULT_THEME;
    onChanged(value);
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[THEME_KEY]) {
      updated = true;
      apply(changes[THEME_KEY].newValue);
    }
  });

  const ready = api.storage.local.get(THEME_KEY).then(stored => {
    // A change received while loading is newer than the initial snapshot.
    if (!updated) apply(stored[THEME_KEY]);
  }).catch(error => {
    if (!updated) apply(DEFAULT_THEME);
    throw error;
  });

  return {
    ready,
    get value() { return value; },
    async set(theme) {
      if (!getTheme(theme)) throw new Error("Choose a theme from the list.");
      await api.storage.local.set({ [THEME_KEY]: theme });
    },
  };
}

export function colorOverrideKey(theme, id) {
  if (!getTheme(theme)?.scheme || !THEME_COLORS.some(role => role.id === id)) {
    throw new Error("Unknown theme color.");
  }
  return `themeColor.${theme}.${id}`;
}

export function colorOverridesEnabledKey(theme) {
  if (!getTheme(theme)?.scheme) throw new Error("Unknown theme.");
  return `themeColorsEnabled.${theme}`;
}

export function createThemeOverrides(api, onChanged) {
  const themes = THEMES.filter(theme => theme.scheme).map(theme => theme.id);
  const keys = themes.flatMap(theme => THEME_COLORS.map(role => colorOverrideKey(theme, role.id)));
  const masterKeys = new Map(themes.map(theme => [colorOverridesEnabledKey(theme), theme]));
  const knownKeys = new Set([...keys, ...masterKeys.keys()]);
  const updated = new Set();
  const values = new Map();
  const enabledThemes = new Map();

  function read(key, stored) {
    if (masterKeys.has(key)) {
      enabledThemes.set(masterKeys.get(key), stored === true);
      return;
    }
    try {
      values.set(key, { enabled: stored.enabled === true, color: normalizeHex(stored.color) });
    } catch {
      // Corrupt or removed sync entries restore the built-in default.
      values.delete(key);
    }
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let changed = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!knownKeys.has(key)) continue;
      updated.add(key);
      read(key, change.newValue);
      changed = true;
    }
    if (changed) onChanged();
  });

  const ready = api.storage.sync.get([...knownKeys]).then(stored => {
    for (const key of knownKeys) {
      // Preserve newer incoming sync changes independently for each setting.
      if (!updated.has(key)) read(key, stored[key]);
    }
    onChanged();
  }).catch(error => {
    onChanged();
    throw error;
  });

  return {
    ready,
    isEnabled(theme) {
      colorOverridesEnabledKey(theme);
      return enabledThemes.get(theme) ?? false;
    },
    async setEnabled(theme, enabled) {
      const key = colorOverridesEnabledKey(theme);
      if (typeof enabled !== "boolean") throw new Error("Choose whether to override colors.");
      await api.storage.sync.set({ [key]: enabled });
    },
    get(theme, id) {
      const key = colorOverrideKey(theme, id);
      return { ...(values.get(key) ?? { enabled: false, color: getTheme(theme).colors[id] }) };
    },
    async set(theme, id, enabled, color) {
      const key = colorOverrideKey(theme, id);
      if (typeof enabled !== "boolean") throw new Error("Choose whether to override this color.");
      await api.storage.sync.set({ [key]: { enabled, color: normalizeHex(color) } });
    },
  };
}
