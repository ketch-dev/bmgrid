import { THEME_COLORS, normalizeHex } from "./theme-colors.js";

const THEME_KEY = "theme";

export function createThemePreference(api, onChanged) {
  let value = "browser";
  let updated = false;

  function apply(stored) {
    value = stored === "light" || stored === "dark" ? stored : "browser";
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
    if (!updated) apply("browser");
    throw error;
  });

  return {
    ready,
    get value() { return value; },
    async set(theme) {
      if (!["browser", "dark", "light"].includes(theme)) throw new Error("Choose Browser Theme, Dark, or Light.");
      await api.storage.local.set({ [THEME_KEY]: theme });
    },
  };
}

export function colorOverrideKey(theme, id) {
  if ((theme !== "dark" && theme !== "light") || !THEME_COLORS.some(role => role.id === id)) {
    throw new Error("Unknown theme color.");
  }
  return `themeColor.${theme}.${id}`;
}

export function colorOverridesEnabledKey(theme) {
  if (theme !== "dark" && theme !== "light") throw new Error("Unknown theme.");
  return `themeColorsEnabled.${theme}`;
}

export function createThemeOverrides(api, onChanged) {
  const themes = ["dark", "light"];
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
    for (const key of keys) {
      // Preserve newer incoming sync changes independently for each color.
      if (!updated.has(key)) read(key, stored[key]);
    }
    for (const theme of themes) {
      const key = colorOverridesEnabledKey(theme);
      if (updated.has(key)) continue;
      if (Object.hasOwn(stored, key)) {
        read(key, stored[key]);
      } else {
        // Preserve pre-switch customized palettes at startup. Later color
        // updates never enable the master switch automatically.
        enabledThemes.set(theme, THEME_COLORS.some(role => values.get(colorOverrideKey(theme, role.id))?.enabled));
      }
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
      const role = THEME_COLORS.find(role => role.id === id);
      return { ...(values.get(key) ?? { enabled: false, color: role[theme] }) };
    },
    async set(theme, id, enabled, color) {
      const key = colorOverrideKey(theme, id);
      if (typeof enabled !== "boolean") throw new Error("Choose whether to override this color.");
      await api.storage.sync.set({ [key]: { enabled, color: normalizeHex(color) } });
    },
  };
}
