export function gridMetrics(width, height, folderCount, gap = 12) {
  const columns = Math.max(1, Math.min(6, Math.floor((width + gap) / (400 + gap))));
  const fittingRows = Math.max(1, Math.min(2, Math.floor((height + gap) / (500 + gap))));
  const rows = Math.min(fittingRows, Math.max(1, Math.ceil(folderCount / columns)));
  const rowHeight = Math.max(500, Math.floor((height - gap * (rows - 1)) / rows));
  return { columns, rows, rowHeight };
}
