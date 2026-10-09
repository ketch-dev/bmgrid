import { createThemePreference } from "./theme.js";

export const theme = createThemePreference(browser, value => {
  document.documentElement.dataset.theme = value;
  const selector = document.querySelector("#theme-choice");
  if (selector) selector.value = value;
});

await theme.ready.catch(error => { console.error("Bookmark Grid theme:", error); });
