/**
 * SVG helpers for DOM-only surfaces that cannot render React components, such
 * as the native drag preview supplied to the browser drag-and-drop API.
 */
export function createRowDragHandleSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  for (const [cx, cy] of [[5, 4], [11, 4], [5, 8], [11, 8], [5, 12], [11, 12]]) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '1');
    svg.appendChild(circle);
  }
  return svg;
}

export function createHeaderDragHandleSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('aria-hidden', 'true');
  for (const cy of [2.5, 7, 11.5]) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '7');
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '1.25');
    svg.appendChild(circle);
  }
  return svg;
}

export function createHeaderSortSvg(direction: 'asc' | 'desc' | null): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('aria-hidden', 'true');
  for (const [value, active] of [
    ['M3 5.5 7 1.5l4 4Z', direction === 'asc'],
    ['M3 8.5 7 12.5l4-4Z', direction === 'desc'],
  ] as const) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', value);
    if (active) path.classList.add('is-active');
    svg.appendChild(path);
  }
  return svg;
}

export function createHeaderSearchSvg(active: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('aria-hidden', 'true');
  if (active) svg.classList.add('is-active');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '5.5');
  circle.setAttribute('cy', '5.5');
  circle.setAttribute('r', '4.25');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm8.75 8.75 2.25 2.25');
  svg.append(circle, path);
  return svg;
}
