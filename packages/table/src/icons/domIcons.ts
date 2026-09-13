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
