import { THEMES, getTheme } from "./theme-colors.js";

const TYPE_AHEAD_TIMEOUT = 700;

export function createThemeDropdown(element, onSelect) {
  const selector = element.querySelector("#theme-choice");
  const selectedLabel = element.querySelector("#theme-value");
  const menu = element.querySelector("#theme-menu");
  const themeChoices = THEMES.map(choice => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "theme-option";
    option.id = `theme-option-${choice.id}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.dataset.theme = choice.id;
    option.tabIndex = -1;
    option.textContent = choice.label;
    menu.append(option);
    return option;
  });
  let value;
  let activeChoice = 0;
  let search = "";
  let searchTime = 0;

  function highlight(index) {
    activeChoice = (index + themeChoices.length) % themeChoices.length;
    themeChoices.forEach((choice, position) => { choice.dataset.active = String(position === activeChoice); });
    selector.setAttribute("aria-activedescendant", themeChoices[activeChoice].id);
  }

  function closeMenu() {
    menu.hidden = true;
    selector.setAttribute("aria-expanded", "false");
    selector.removeAttribute("aria-activedescendant");
    search = "";
  }

  function openMenu() {
    menu.hidden = false;
    selector.setAttribute("aria-expanded", "true");
    highlight(THEMES.findIndex(choice => choice.id === value));
  }

  function selectTheme(selected) {
    selector.focus();
    closeMenu();
    onSelect(selected);
  }

  selector.addEventListener("click", () => { if (menu.hidden) openMenu(); else closeMenu(); });
  // Keep combobox focus when choosing an option with the mouse.
  menu.addEventListener("pointerdown", event => { event.preventDefault(); });
  menu.addEventListener("click", event => {
    const option = event.target.closest('[role="option"]');
    if (themeChoices.includes(option)) selectTheme(option.dataset.theme);
  });
  menu.addEventListener("pointermove", event => {
    const index = themeChoices.indexOf(event.target.closest('[role="option"]'));
    if (index !== -1) highlight(index);
  });
  selector.addEventListener("keydown", event => {
    if (event.key === "Tab") { closeMenu(); return; }
    if (event.key === "Escape") {
      if (menu.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Enter" || (event.key === " " && (!search || Date.now() - searchTime >= TYPE_AHEAD_TIMEOUT))) {
      event.preventDefault();
      if (menu.hidden) openMenu(); else selectTheme(THEMES[activeChoice].id);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      search = "";
      if (menu.hidden) openMenu();
      else if (event.key === "ArrowDown") highlight(activeChoice + 1);
      else if (event.key === "ArrowUp") highlight(activeChoice - 1);
      if (event.key === "Home") highlight(0);
      if (event.key === "End") highlight(THEMES.length - 1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (menu.hidden) openMenu();
      const now = Date.now();
      if (now - searchTime >= TYPE_AHEAD_TIMEOUT) search = "";
      const character = event.key.toLowerCase();
      const repeating = search === character;
      search = repeating ? character : search + character;
      searchTime = now;
      const start = repeating ? activeChoice + 1 : 0;
      for (let offset = 0; offset < THEMES.length; offset++) {
        const index = (start + offset) % THEMES.length;
        if (THEMES[index].label.toLowerCase().startsWith(search)) {
          highlight(index);
          break;
        }
      }
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!element.contains(event.target)) closeMenu();
  });
  document.addEventListener("focusin", event => {
    if (!element.contains(event.target)) closeMenu();
  });
  window.addEventListener("blur", closeMenu);

  return {
    setValue(id) {
      // Color updates can rerender settings while the user navigates the list.
      if (id === value) return;
      const definition = getTheme(id);
      selectedLabel.textContent = definition.label;
      for (const choice of themeChoices) choice.setAttribute("aria-selected", String(choice.dataset.theme === id));
      if (!menu.hidden) highlight(THEMES.indexOf(definition));
      value = id;
    },
    focus() { selector.focus(); },
  };
}
