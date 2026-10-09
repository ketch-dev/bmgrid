export function gridColumns(width, gap = 16) {
  return Math.max(1, Math.min(6, Math.floor((width + gap) / (400 + gap))));
}
