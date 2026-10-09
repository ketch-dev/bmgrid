export const THEME_COLORS = [
  { id: "canvas", label: "Canvas", dark: "#101010", light: "#e6e6e6" },
  { id: "header", label: "Folder headings", dark: "#191919", light: "#dedede" },
  { id: "surface", label: "Cards and dialogs", dark: "#151515", light: "#f2f2f2" },
  { id: "surface-hover", label: "Hover surfaces", dark: "#242424", light: "#d5d5d5" },
  { id: "border", label: "Borders", dark: "#222222", light: "#c4c4c4" },
  { id: "text", label: "Primary text", dark: "#cccccc", light: "#303030" },
  { id: "link", label: "Bookmark links", dark: "#bbbbbb", light: "#424242" },
  { id: "muted", label: "Muted text", dark: "#999999", light: "#616161" },
  { id: "destination", label: "Destination names", dark: "#ffffff", light: "#202020" },
  { id: "focus", label: "Focus outlines", dark: "#444444", light: "#707070" },
  { id: "indicator", label: "Action focus outlines", dark: "#bbbbbb", light: "#616161" },
  { id: "drop-indicator", label: "Drop indicators", dark: "#999999", light: "#616161" },
  { id: "scrollbar", label: "Scrollbars", dark: "#444444", light: "#999999" },
  { id: "selection-text", label: "Selection text", dark: "#ffffff", light: "#f2f2f2" },
  { id: "selection-background", label: "Selection background", dark: "#555555", light: "#555555" },
  { id: "card-shadow", label: "Card shadows", dark: "#000000", light: "#000000",
    opacity: { dark: 14, light: 8 } },
  { id: "popup-shadow", label: "Popup/dialog shadows", dark: "#000000", light: "#000000",
    opacity: { dark: 35, light: 16 } },
  { id: "backdrop", label: "Modal backdrop", dark: "#000000", light: "#000000",
    opacity: { dark: 55, light: 25 } },
  { id: "scroll-shadow", label: "Scroll shadows", dark: "#000000", light: "#000000",
    opacity: { dark: 40, light: 20 }, variable: "scroll-shadow-stops" },
];

export function normalizeHex(value) {
  const hex = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(hex)) {
    throw new Error("Use a hex color such as #a1b2c3.");
  }
  return hex.length === 4 ? `#${[...hex.slice(1)].map(digit => digit.repeat(2)).join("")}` : hex;
}

export function colorCss(role, theme, hex) {
  if (!role.opacity) return hex;
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(" ");
  const opacity = role.opacity[theme];
  if (role.id === "scroll-shadow") {
    return [[1, 0], [0.6, 20], [0.25, 45], [0.075, 70], [0.0125, 90], [0, 100]]
      .map(([strength, position]) => `rgb(${channels} / ${opacity * strength}%) ${position}%`).join(", ");
  }
  return `rgb(${channels} / ${opacity}%)`;
}
