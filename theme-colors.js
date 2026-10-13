export const THEME_COLORS = [
  { id: "canvas", label: "Canvas", dark: "#1a1a1a", light: "#e6e6e6" },
  { id: "header", label: "Folder headings", dark: "#262626", light: "#dedede" },
  { id: "surface", label: "Cards and dialogs", dark: "#202020", light: "#f2f2f2" },
  { id: "surface-hover", label: "Hover surfaces", dark: "#303030", light: "#d5d5d5" },
  { id: "border", label: "Borders", dark: "#383838", light: "#c4c4c4" },
  { id: "text", label: "Primary text", dark: "#d4d4d4", light: "#303030" },
  { id: "link", label: "Bookmark links", dark: "#c4c4c4", light: "#424242" },
  { id: "muted", label: "Muted text", dark: "#a3a3a3", light: "#616161" },
  { id: "destination", label: "Destination names", dark: "#ffffff", light: "#202020" },
  { id: "focus", label: "Focus outlines", dark: "#606060", light: "#707070" },
  { id: "indicator", label: "Action focus outlines", dark: "#bbbbbb", light: "#616161" },
  { id: "drop-indicator", label: "Drop indicators", dark: "#999999", light: "#616161" },
  { id: "scrollbar", label: "Scrollbars", dark: "#555555", light: "#999999" },
  { id: "selection-text", label: "Selection text", dark: "#ffffff", light: "#f2f2f2" },
  { id: "selection-background", label: "Selection background", dark: "#606060", light: "#555555" },
  { id: "card-shadow", label: "Card shadows", dark: "#000000", light: "#000000",
    opacity: { dark: 14, light: 8 } },
  { id: "popup-shadow", label: "Popup/dialog shadows", dark: "#000000", light: "#000000",
    opacity: { dark: 35, light: 16 } },
  { id: "backdrop", label: "Modal backdrop", dark: "#000000", light: "#000000",
    opacity: { dark: 55, light: 25 } },
  { id: "scroll-shadow", label: "Scroll shadows", dark: "#000000", light: "#000000",
    opacity: { dark: 40, light: 20 }, variable: "scroll-shadow-stops" },
];

// Bundled from ~/.dotfiles/nix/profile-palettes.nix: Personal, Dev, and Work.
// Surface and interaction roles use the profile's literal, pre-blended shades.
function profileColors(palette) {
  return {
    canvas: palette.background,
    header: palette.fieldBackground,
    surface: palette.contentBackground,
    "surface-hover": palette.badgeHover,
    border: palette.border,
    text: palette.text,
    link: palette.link,
    muted: palette.inactiveText,
    destination: "#ffffff",
    focus: palette.accent,
    indicator: palette.link,
    "drop-indicator": palette.link,
    scrollbar: palette.dimText,
    "selection-text": "#ffffff",
    "selection-background": palette.accent,
    "card-shadow": palette.shadow,
    "popup-shadow": palette.shadow,
    backdrop: palette.shadow,
    "scroll-shadow": palette.shadow,
  };
}

export const DEFAULT_THEME = "dark";
export const THEMES = [
  { id: "dark", label: "Dark (Gray)", scheme: "dark",
    colors: Object.fromEntries(THEME_COLORS.map(role => [role.id, role.dark])) },
  { id: "dark-brown", label: "Dark (Brown)", scheme: "dark", colors: profileColors({
    accent: "#a96437", background: "#201a16", fieldBackground: "#2d2623",
    contentBackground: "#261f1e", text: "#e4d9d3", inactiveText: "#aaa5a1",
    dimText: "#635c5c", border: "#3b3434", badgeHover: "#45352d",
    link: "#c79a7d", shadow: "#2b1f17",
  }) },
  { id: "dark-green", label: "Dark (Green)", scheme: "dark", colors: profileColors({
    accent: "#317349", background: "#151b17", fieldBackground: "#222824",
    contentBackground: "#1b2120", text: "#d2dbd5", inactiveText: "#a0a5a2",
    dimText: "#575d5d", border: "#2f3535", badgeHover: "#2b3930",
    link: "#79a489", shadow: "#17211b",
  }) },
  { id: "dark-blue", label: "Dark (Blue)", scheme: "dark", colors: profileColors({
    accent: "#3c62b3", background: "#161a21", fieldBackground: "#21252f",
    contentBackground: "#1d1f29", text: "#d3d9e5", inactiveText: "#a1a4aa",
    dimText: "#585c66", border: "#30343e", badgeHover: "#2d3547",
    link: "#8099ce", shadow: "#181f2d",
  }) },
  { id: "light", label: "Light", scheme: "light",
    colors: Object.fromEntries(THEME_COLORS.map(role => [role.id, role.light])) },
  { id: "browser", label: "Browser Theme" },
];

export function getTheme(id) {
  return THEMES.find(theme => theme.id === id);
}

export function normalizeHex(value) {
  const hex = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(hex)) {
    throw new Error("Use a hex color such as #a1b2c3.");
  }
  return hex.length === 4 ? `#${[...hex.slice(1)].map(digit => digit.repeat(2)).join("")}` : hex;
}

export function colorCss(role, scheme, hex) {
  if (!role.opacity) return hex;
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(" ");
  const opacity = role.opacity[scheme];
  if (role.id === "scroll-shadow") {
    return [[1, 0], [0.6, 20], [0.25, 45], [0.075, 70], [0.0125, 90], [0, 100]]
      .map(([strength, position]) => `rgb(${channels} / ${opacity * strength}%) ${position}%`).join(", ");
  }
  return `rgb(${channels} / ${opacity}%)`;
}
