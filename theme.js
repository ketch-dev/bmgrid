const THEME_KEY = "theme";

export function createThemePreference(api, onChanged) {
  let value = "dark";
  let updated = false;

  function apply(stored) {
    value = stored === "light" ? "light" : "dark";
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
    if (!updated) apply("dark");
    throw error;
  });

  return {
    ready,
    get value() { return value; },
    async set(theme) {
      if (theme !== "dark" && theme !== "light") throw new Error("Choose Dark or Light.");
      await api.storage.local.set({ [THEME_KEY]: theme });
    },
  };
}
