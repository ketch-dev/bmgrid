export function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths = {
    pen: "M3 10.5 10.5 3l2.5 2.5L5.5 13 2 14l1-3.5ZM9 4.5 11.5 7",
    trash: "M2.5 4.5h11M6 4.5V2h4v2.5M4 4.5l.75 9h6.5l.75-9M6.5 7v4M9.5 7v4",
    plus: "M8 3v10M3 8h10",
    bookmark: "M4 2h8v12l-4-3-4 3Z",
    download: "M8 2v8M5 7l3 3 3-3M2.5 10.5V14h11v-3.5",
  };
  path.setAttribute("d", paths[kind]);
  svg.append(path);
  return svg;
}
