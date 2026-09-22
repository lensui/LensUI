import type { GridColumn, ViewportRange } from '../types';

type LayoutColumn<Row> = GridColumn<Row> & {
  rowSelection?: boolean;
  rowDragHandle?: boolean;
  rowNumber?: boolean;
};

/**
 * Width used when a column does not provide an explicit width.
 *
 * The canvas renderer needs deterministic column positions before anything is
 * mounted in the DOM, so layout is calculated from data rather than measuring
 * rendered cells.
 */
export const DEFAULT_COLUMN_WIDTH = 140;

/**
 * Cached horizontal geometry for one column.
 *
 * `left` and `right` are measured in the full scrollable content coordinate
 * space. Fixed columns are still stored in this coordinate space first, then
 * translated to their pinned viewport position during rendering and hit tests.
 */
export interface ColumnMetric {
  left: number;
  width: number;
  right: number;
}

export const HEADER_ACTION_SLOT_WIDTH = 16;

export interface BuildColumnMetricsOptions {
  columnDraggable?: boolean;
  viewportWidth?: number;
  /** Columns whose manually resized widths must remain exact while spare width is distributed. */
  stretchExcludedIndices?: ReadonlySet<number>;
}

function isDataColumn<Row>(column: LayoutColumn<Row>): boolean {
  return !column.rowSelection && !column.rowDragHandle && !column.rowNumber;
}

function isColumnSortable<Row>(column: LayoutColumn<Row>): boolean {
  return isDataColumn(column) && column.sortable !== false;
}

function isColumnFilterable<Row>(column: LayoutColumn<Row>): boolean {
  return isDataColumn(column) && column.filterable !== false;
}

/**
 * Count the actions that may need header space.
 *
 * Selection and row-drag columns are icon-only utility columns, so they do not
 * show filter/sort/column-drag affordances in the header.
 */
export function getHeaderActionCount<Row>(column: LayoutColumn<Row>, columnDraggable = false): number {
  if (column.rowSelection || column.rowDragHandle || column.rowNumber) return 0;
  return Number(columnDraggable) + Number(isColumnFilterable(column)) + Number(isColumnSortable(column));
}

/**
 * Estimate the minimum room needed by the title text.
 *
 * Center-aligned titles need less side padding because the text can breathe on
 * both sides; left/right aligned titles reserve more room against the nearest
 * grid edge.
 */
export function getHeaderTitleRequiredWidth<Row>(column: LayoutColumn<Row>, titleWidth: number): number {
  const minimumReadableTitleWidth = Math.min(Math.ceil(titleWidth), 28);
  return minimumReadableTitleWidth + (column.align === 'center' ? 20 : 22);
}

/**
 * Decide which header controls are visible for a narrow column.
 *
 * The priority is intentionally biased toward controls closest to the right
 * edge of the header. When space is tight we keep the last actions from the
 * candidate list so the clickable positions remain stable while resizing.
 */
export function getVisibleHeaderActions<Row>(
  column: LayoutColumn<Row>,
  width: number,
  columnDraggable = false,
  titleWidth = 26,
  actionSlotWidth = HEADER_ACTION_SLOT_WIDTH,
) {
  const capacity = Math.max(0, Math.floor((width - getHeaderTitleRequiredWidth(column, titleWidth)) / actionSlotWidth));
  const candidates = [
    isColumnFilterable(column) ? 'filter' as const : null,
    isColumnSortable(column) ? 'sort' as const : null,
    columnDraggable ? 'drag' as const : null,
  ].filter((action): action is 'filter' | 'sort' | 'drag' => action !== null);
  const visible = new Set(candidates.slice(Math.max(0, candidates.length - capacity)));
  return { filter: visible.has('filter'), sort: visible.has('sort'), drag: visible.has('drag') };
}

/**
 * Smallest usable column width.
 *
 * The value protects pointer targets and selection borders from collapsing even
 * when consumers pass tiny widths. It is kept independent of header actions so
 * virtual layout stays predictable.
 */
export function getMinimumColumnWidth<Row>(column: LayoutColumn<Row>, columnDraggable = false): number {
  if (column.rowDragHandle) return 36;
  if (column.rowSelection) return Math.max(24, column.width ?? 44);
  if (column.rowNumber) return 44;
  return 60;
}

/**
 * Build cumulative column positions used by both canvas painting and DOM
 * overlay placement.
 */
export function buildColumnMetrics<Row>(
  columns: LayoutColumn<Row>[],
  columnDraggableOrOptions: boolean | BuildColumnMetricsOptions = false,
): ColumnMetric[] {
  const options = typeof columnDraggableOrOptions === 'boolean'
    ? { columnDraggable: columnDraggableOrOptions }
    : columnDraggableOrOptions;
  const columnDraggable = options.columnDraggable ?? false;
  const stretchExcludedIndices = options.stretchExcludedIndices ?? new Set<number>();
  let left = 0;
  const metrics = columns.map((column) => {
    const width = Math.max(getMinimumColumnWidth(column, columnDraggable), column.width ?? DEFAULT_COLUMN_WIDTH);
    const metric = { left, width, right: left + width };
    left += width;
    return metric;
  });
  const viewportWidth = options.viewportWidth ?? 0;
  if (viewportWidth <= left || columns.length === 0) return metrics;

  const unsetWidthStretchable = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column, index }) => !stretchExcludedIndices.has(index) && column.width === undefined && column.fixed === undefined && !column.rowSelection && !column.rowDragHandle && !column.rowNumber);
  const allDataStretchable = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.fixed === undefined && !column.rowSelection && !column.rowDragHandle && !column.rowNumber);
  const dataStretchable = allDataStretchable.filter(({ index }) => !stretchExcludedIndices.has(index));
  const targets = unsetWidthStretchable.length > 0
    ? unsetWidthStretchable
    : dataStretchable.length > 0
      ? dataStretchable
      : allDataStretchable.slice(-1);
  if (targets.length === 0) return metrics;

  const extra = viewportWidth - left;
  const baseTotal = targets.reduce((sum, { index }) => sum + metrics[index].width, 0);
  let assigned = 0;
  const targetIndexSet = new Set(targets.map(({ index }) => index));
  const nextWidths = metrics.map((metric, index) => {
    if (!targetIndexSet.has(index)) return metric.width;
    const isLastTarget = index === targets[targets.length - 1].index;
    const addition = isLastTarget ? extra - assigned : Math.floor(extra * (metric.width / baseTotal));
    assigned += addition;
    return metric.width + addition;
  });

  left = 0;
  return nextWidths.map((width) => {
    const metric = { left, width, right: left + width };
    left += width;
    return metric;
  });
}

/**
 * Return the first metric whose right edge is after `value`.
 *
 * This binary search lets horizontal virtualization find the visible column
 * window without scanning every column on each scroll event.
 */
function lowerBound(metrics: ColumnMetric[], value: number): number {
  let low = 0;
  let high = metrics.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (metrics[middle].right <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Compute the row and column slice that should be painted for the current
 * viewport.
 *
 * Overscan deliberately includes a small buffer around the visible rectangle so
 * fast scrolling does not reveal blank canvas while React and the browser catch
 * up to the next paint.
 */
export function getViewportRange(
  scrollLeft: number,
  scrollTop: number,
  viewportWidth: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  metrics: ColumnMetric[],
  overscan: number,
): ViewportRange {
  const rowStart = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const rowEnd = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const columnStart = Math.max(0, lowerBound(metrics, scrollLeft) - overscan);
  const visibleEnd = lowerBound(metrics, scrollLeft + viewportWidth);
  const columnEnd = Math.min(metrics.length, visibleEnd + 1 + overscan);
  return { rowStart, rowEnd, columnStart, columnEnd };
}

/**
 * Convert a content-space x coordinate into a column index.
 *
 * The caller is responsible for translating fixed-column viewport coordinates
 * back into content coordinates when needed.
 */
export function hitTestColumn(metrics: ColumnMetric[], contentX: number): number {
  const index = lowerBound(metrics, contentX);
  return index < metrics.length ? index : -1;
}
