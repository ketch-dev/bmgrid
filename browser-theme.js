import { THEME_COLORS, normalizeHex } from "./theme-colors.js";

const BRIGHTNESS_WEIGHTS = [0.2126, 0.7152, 0.0722];
const MIN_COLOR_DISTANCE = 12;
const MIN_SHADE_STRENGTH = 0.08;
const SHADE_STEP = 0.04;

let colorContext;

function readColor(value) {
  if (Array.isArray(value)) {
    if (value.length !== 3 || value.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
    return [...value, 1];
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const hex = normalizeHex(value);
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).concat(1);
  } catch {
    // Firefox also exposes named, RGB, HSL, and translucent CSS colors.
  }
  if (!globalThis.CSS?.supports("color", value) || /\b(?:currentcolor|inherit|initial|unset|revert|var|env|light-dark)\b/i.test(value)) return null;
  if (!colorContext) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
  return [r, g, b, alpha / 255];
}

function channels(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function mix(front, back, strength) {
  return `#${front.slice(0, 3).map((channel, index) => Math.round(channel * strength + back[index] * (1 - strength))
    .toString(16).padStart(2, "0")).join("")}`;
}

function brightness(rgb) {
  return BRIGHTNESS_WEIGHTS.reduce((sum, weight, index) => sum + weight * rgb[index], 0);
}

function colorDistance(a, b) {
  // Weight channel differences by their visible contribution; a one-channel
  // or one-step difference alone should not qualify as a separate UI layer.
  return Math.sqrt(BRIGHTNESS_WEIGHTS.reduce((sum, weight, index) =>
    sum + weight * (a[index] - b[index]) ** 2, 0));
}

function separateColor(candidate, base, neighbors, scheme) {
  const baseChannels = channels(base);
  const neighborChannels = neighbors.map(channels);
  const distinct = color => {
    const rgb = channels(color);
    return neighborChannels.every(neighbor => colorDistance(rgb, neighbor) >= MIN_COLOR_DISTANCE);
  };
  if (candidate && distinct(candidate)) return candidate;
  const preferred = scheme === "dark" ? [255, 255, 255] : [0, 0, 0];
  const opposite = preferred.map(channel => 255 - channel);
  // Mix only toward black/white so derived shades retain the browser's hue.
  // Reverse direction near an endpoint rather than clipping layers together.
  for (const shade of [preferred, opposite]) {
    for (let step = MIN_SHADE_STRENGTH / SHADE_STEP; step <= 1 / SHADE_STEP; step++) {
      const color = mix(baseChannels, shade, 1 - step * SHADE_STEP);
      if (distinct(color)) return color;
    }
  }
  return base;
}

export function browserThemePalette(info, prefersDark, decode = readColor) {
  const colors = info?.colors ?? {};
  function find(...names) {
    for (const name of names) {
      const value = decode(colors[name]);
      if (value && value[3] > 0) return value;
    }
    return null;
  }
  const background = find("ntp_background", "toolbar", "frame", "sidebar", "popup");
  const requestedScheme = info?.properties?.content_color_scheme ?? info?.properties?.color_scheme;
  let scheme = prefersDark ? "dark" : "light";
  if (requestedScheme === "dark" || requestedScheme === "light") scheme = requestedScheme;
  else if (requestedScheme !== "system" && background) {
    scheme = brightness(background) < 128 ? "dark" : "light";
  }
  const palette = Object.fromEntries(THEME_COLORS.map(role => [role.id, role[scheme]]));
  // An empty built-in theme uses the browser's preferred scheme, without
  // inheriting the user's overrides for the independent Dark/Light palettes.
  if (!Object.keys(colors).length) return { scheme, colors: palette };
  function resolve(value, fallback) {
    return value ? mix(value, channels(fallback), value[3]) : fallback;
  }
  palette.canvas = resolve(background, palette.canvas);
  palette.surface = separateColor(resolve(find("ntp_card_background", "popup", "toolbar_field", "toolbar"), palette.canvas),
    palette.canvas, [palette.canvas], scheme);
  palette.text = resolve(find("ntp_text", "popup_text", "toolbar_text", "bookmark_text", "sidebar_text", "tab_text", "tab_background_text"), palette.text);
  palette.link = palette.destination = palette.text;
  // Stay in the new-tab palette: its text need not contrast with the toolbar.
  // Composite translucent heading colors over the card before separating;
  // opaque repeated colors instead get a derived shade of the card surface.
  palette.header = separateColor(resolve(find("ntp_card_background", "ntp_background", "toolbar", "frame"), palette.surface),
    palette.surface, [palette.canvas, palette.surface], scheme);
  const hover = find("button_background_hover");
  palette["surface-hover"] = separateColor(resolve(hover, palette.surface), palette.surface,
    [palette.canvas, palette.surface, palette.header], scheme);
  palette.border = separateColor(resolve(find("popup_border", "sidebar_border", "toolbar_field_border", "toolbar_bottom_separator"),
    mix(channels(palette.text), channels(palette.surface), 0.25)), palette.surface, [palette.surface, palette.header], scheme);
  palette.muted = mix(channels(palette.text), channels(palette.canvas), 0.7);
  palette.focus = palette.indicator = palette["drop-indicator"] = resolve(find("toolbar_field_border_focus", "tab_line", "icons_attention"), palette.text);
  palette.scrollbar = mix(channels(palette.text), channels(palette.surface), 0.45);
  palette["selection-background"] = resolve(find("toolbar_field_highlight", "popup_highlight", "sidebar_highlight"), palette.muted);
  palette["selection-text"] = resolve(find("toolbar_field_highlight_text", "popup_highlight_text", "sidebar_highlight_text"),
    brightness(channels(palette["selection-background"])) < 128 ? "#ffffff" : "#202020");
  return { scheme, colors: palette };
}

export function createBrowserTheme(api, media, onChanged) {
  let info = {};
  let windowId;
  let tabId;
  let version = 0;
  let value = browserThemePalette(info, media.matches);

  function apply() {
    value = browserThemePalette(info, media.matches);
    onChanged();
  }

  async function refresh() {
    const current = ++version;
    try {
      const [window, tab] = await Promise.all([api.windows.getCurrent(), api.tabs.getCurrent()]);
      if (current !== version) return;
      windowId = window.id;
      tabId = tab?.id;
      const theme = await api.theme.getCurrent(windowId);
      if (current !== version) return;
      info = theme;
    } catch (error) {
      if (current !== version) return;
      info = {};
      console.error("bmgrid browser theme:", error);
    }
    apply();
  }

  api.theme.onUpdated.addListener(update => {
    if (windowId === undefined || update.windowId === undefined || update.windowId === windowId) refresh();
  });
  api.tabs.onAttached.addListener(id => { if (tabId === undefined || id === tabId) refresh(); });
  media.addEventListener("change", apply);
  return { ready: refresh(), get value() { return value; }, refresh };
}
