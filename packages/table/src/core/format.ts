import type { GridColumn } from '../types';

/**
 * Returns the text that should be painted or copied for a cell.
 *
 * The renderer, DOM text layer, clipboard path, and tooltips all call this
 * helper so formatting decisions stay consistent. Consumer-provided formatters
 * always win; built-in editor formatting only applies when no formatter exists.
 */
export function getDisplayLabel<Row extends object>(column: GridColumn<Row>, row: Row, rowIndex: number): string {
  const value = column.dataIndex === undefined ? undefined : row[column.dataIndex];
  if (column.formatter) return column.formatter(value, row, rowIndex);
  if (value == null) return '';
  const label = String(value);

  // Stored date-time values may use an ISO "T" separator because the editor can
  // parse that reliably. For display, the grid defaults to a more readable space
  // while leaving the underlying row value untouched.
  if (column.editor?.type === 'date-time' || column.editor?.type === 'date-time-range') {
    return label.replace(/(\d{4}[-/]\d{2}[-/]\d{2})T(?=\d{2}:\d{2})/g, '$1 ');
  }
  return label;
}
