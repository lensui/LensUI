/** Creates the canvas font used for body cell labels. */
export const createCellFont = (fontSize = 13) => `${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;

export function getCellBaselineOffset(context: CanvasRenderingContext2D): number {
  context.save();
  context.textBaseline = 'alphabetic';
  const metrics = context.measureText('Mg');
  context.restore();
  // Center the font's line box, rather than the em square used by `middle`.
  // This matches a vertically centered native input at any row height.
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  return Number.isFinite(ascent) && Number.isFinite(descent) ? (ascent - descent) / 2 : 0;
}
