import type { GridColumn, GridSelection, GridKey, GridSortState, TableResolvedCellSpan, ViewportRange } from '../types';
import { getDisplayLabel } from './format';
import { getVisibleHeaderActions, type ColumnMetric } from './layout';

type PaintColumn<Row> = GridColumn<Row> & {
  rowSelection?: boolean;
  rowDragHandle?: boolean;
  rowNumber?: boolean;
};

interface PaintOptions<Row extends object> {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  pixelRatio: number;
  scrollLeft: number;
  scrollTop: number;
  rowHeight: number;
  headerHeight: number;
  bodyTop?: number;
  suppressLastRowBottomBorder?: boolean;
  suppressFrameBottomBorder?: boolean;
  fixedHeader: boolean;
  verticalBorderless: boolean;
  striped: boolean;
  columnDraggable: boolean;
  sortState: GridSortState | null;
  filterValues: Record<string, string>;
  hoveredHeaderAction: { columnIndex: number; action: 'sort' | 'filter' | 'drag' | 'title' } | null;
  rows: Row[];
  columns: PaintColumn<Row>[];
  metrics: ColumnMetric[];
  range: ViewportRange;
  selection: GridSelection | null;
  editing: GridSelection | null;
  hoveredRowIndex: number | null;
  selectionRange: { anchor: GridSelection; focus: GridSelection } | null;
  selectedRowKeys: ReadonlySet<GridKey>;
  selectedColumnKeys: ReadonlySet<string>;
  cellSpans: ReadonlyMap<string, TableResolvedCellSpan>;
  maxRowSpan: number;
  highlightEditedCells: boolean;
  highlightInsertedRows: boolean;
  insertedRowKeys: ReadonlySet<GridKey>;
  editedCellKeys: ReadonlySet<string>;
  cellAnnotations: ReadonlyMap<string, { type: 'background' | 'corner'; color: string; content: string }>;
  getRowKey: (row: Row, index: number) => GridKey;
  rowDragPreview: { sourceIndex: number; targetIndex: number } | null;
  colors?: Partial<typeof COLORS>;
}

const getCellCoordKey = (rowIndex: number, columnIndex: number) => `${rowIndex}:${columnIndex}`;

const COLORS = {
  background: '#ffffff',
  header: '#f5f6f7',
  grid: '#e3e6e8',
  text: '#202124',
  muted: '#5f6368',
  selection: '#1677ff',
  selectionFill: '#edf4ff',
  axisSelectionFill: '#e8f2ff',
  rowHoverFill: '#f6f9fc',
  editedFill: '#fff1b8',
  insertedFill: '#c8ead4',
  stripe: '#fafbfc',
};

function ellipsizeText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (context.measureText(text).width <= maxWidth) return text;
  const ellipsis = '...';
  const ellipsisWidth = context.measureText(ellipsis).width;
  if (ellipsisWidth >= maxWidth) return '';
  let start = 0;
  let end = text.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    const candidate = `${text.slice(0, middle)}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) start = middle;
    else end = middle - 1;
  }
  return `${text.slice(0, start)}${ellipsis}`;
}

/**
 * Paints the canvas portion of Table.
 *
 * The DOM layer handles selectable text and interactive controls, but the
 * canvas owns the high-volume parts: cell backgrounds, grid lines, selection
 * fills, headers, frozen-pane shadows, and selection borders. This keeps large
 * datasets cheap to scroll because only the visible viewport is painted.
 */
export function paintGrid<Row extends object>(options: PaintOptions<Row>): void {
  const { context: ctx, width, height, pixelRatio, scrollLeft, scrollTop, rowHeight, headerHeight, fixedHeader, verticalBorderless, striped, columnDraggable, sortState, filterValues, hoveredHeaderAction, rows, columns, metrics, range, selection, editing, hoveredRowIndex, selectionRange, selectedRowKeys, selectedColumnKeys, highlightEditedCells, highlightInsertedRows, insertedRowKeys, editedCellKeys, cellAnnotations, getRowKey, rowDragPreview } = options;
  const colors = { ...COLORS, ...options.colors };
  const bodyTop = options.bodyTop ?? headerHeight;
  const getCellSpan = (rowIndex: number, columnIndex: number) => options.cellSpans.get(getCellCoordKey(rowIndex, columnIndex));
  const getCellWidth = (columnIndex: number, colSpan: number) => {
    let cellWidth = 0;
    for (let index = columnIndex; index < Math.min(columns.length, columnIndex + colSpan); index += 1) {
      cellWidth += metrics[index]?.width ?? 0;
    }
    return cellWidth;
  };

  // Match the backing store to device pixels while keeping all drawing
  // coordinates in CSS pixels. Capping at 2 keeps very dense displays from
  // turning a large grid into an oversized bitmap.
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = '13px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const leftFixedWidth = columns.reduce((value, column, index) => column.fixed === 'left' ? Math.max(value, metrics[index].right) : value, 0);
  const rightFixedWidth = columns.reduce((value, column, index) => column.fixed === 'right' ? value + metrics[index].width : value, 0);
  const rightFixedLeft = width - rightFixedWidth;

  // Right-fixed columns are laid out from the right edge inward, so each column
  // needs an offset from the fixed area's trailing edge.
  const rightOffsets = new Map<number, number>();
  let rightOffset = 0;
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    if (columns[index].fixed !== 'right') continue;
    rightOffsets.set(index, rightOffset);
    rightOffset += metrics[index].width;
  }
  const getColumnX = (index: number) => {
    // Normal columns subtract scrollLeft. Fixed columns ignore horizontal
    // scrolling and stay pinned to their fixed region.
    return columns[index].fixed === 'left'
      ? metrics[index].left
      : columns[index].fixed === 'right'
        ? width - (rightOffsets.get(index) ?? 0) - metrics[index].width
        : metrics[index].left - scrollLeft;
  };

  const paintBodyColumns = (layer: 'scroll' | 'left' | 'right') => {
  // Body cells are painted in three passes: scrolling columns, left-fixed
  // columns, and right-fixed columns. Later fixed passes intentionally cover the
  // scrolling pass at frozen boundaries.
  const rowStart = Math.max(0, range.rowStart - Math.max(0, options.maxRowSpan - 1));
  for (let rowIndex = rowStart; rowIndex < range.rowEnd; rowIndex += 1) {
    if (rowDragPreview?.sourceIndex === rowIndex) continue;
    // While dragging a row, shift neighboring rows to preview the final order.
    const shift = rowDragPreview
      ? rowDragPreview.sourceIndex < rowDragPreview.targetIndex
        ? rowIndex > rowDragPreview.sourceIndex && rowIndex <= rowDragPreview.targetIndex ? -rowHeight : 0
        : rowIndex >= rowDragPreview.targetIndex && rowIndex < rowDragPreview.sourceIndex ? rowHeight : 0
      : 0;
    const y = bodyTop + rowIndex * rowHeight - scrollTop + shift;
    const row = rows[rowIndex];
    const rowKey = getRowKey(row, rowIndex);
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      if (layer === 'scroll' ? columns[columnIndex].fixed !== undefined : columns[columnIndex].fixed !== layer) continue;
      if (layer === 'scroll' && (columnIndex < range.columnStart || columnIndex >= range.columnEnd)) continue;
      const metric = metrics[columnIndex];
      const x = getColumnX(columnIndex);
      const column = columns[columnIndex];
      const span = getCellSpan(rowIndex, columnIndex);
      if (span && (span.rowIndex !== rowIndex || span.columnIndex !== columnIndex)) continue;
      const rowSpan = span?.rowSpan ?? 1;
      const colSpan = span?.colSpan ?? 1;
      const cellWidth = getCellWidth(columnIndex, colSpan);
      const cellHeight = rowHeight * rowSpan;
      const rangeRowStart = selectionRange ? Math.min(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex) : -1;
      const rangeRowEnd = selectionRange ? Math.max(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex) : -1;
      const rangeColumnStart = selectionRange ? Math.min(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex) : -1;
      const rangeColumnEnd = selectionRange ? Math.max(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex) : -1;
      const isRangeCell = !column.rowDragHandle && !column.rowSelection && !column.rowNumber && rowIndex >= rangeRowStart && rowIndex <= rangeRowEnd && columnIndex >= rangeColumnStart && columnIndex <= rangeColumnEnd;

      // Fixed layers need their own background because they paint over the
      // scrolled layer. Striped mode paints alternating row backgrounds without
      // affecting whether vertical grid lines are visible.
      if (layer !== 'scroll' || (striped && rowIndex % 2 === 1)) {
        ctx.fillStyle = striped && rowIndex % 2 === 1 ? colors.stripe : colors.background;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      if (selectedRowKeys.has(rowKey) || selectedColumnKeys.has(column.key)) {
        ctx.fillStyle = colors.axisSelectionFill;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      if (hoveredRowIndex === rowIndex) {
        ctx.fillStyle = colors.rowHoverFill;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      if (highlightInsertedRows && insertedRowKeys.has(rowKey)) {
        ctx.fillStyle = colors.insertedFill;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      const isSelectedCell = !column.rowDragHandle && !column.rowSelection && !column.rowNumber
        && selection?.rowIndex === rowIndex
        && selection.columnIndex === columnIndex
        && selection.rowKey === rowKey
        && selection.columnKey === column.key;
      const annotation = cellAnnotations.get(`${typeof rowKey}:${String(rowKey)}\u0000${column.key}`);
      const rawValue = column.dataIndex === undefined ? undefined : row[column.dataIndex];
      const cellStyle = column.cellStyle?.(rawValue, row, rowIndex);
      if (!isSelectedCell && !isRangeCell && cellStyle?.backgroundColor) {
        ctx.fillStyle = cellStyle.backgroundColor;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      if (highlightEditedCells && !insertedRowKeys.has(rowKey) && !isSelectedCell && editedCellKeys.has(`${typeof rowKey}:${String(rowKey)}\u0000${column.key}`)) {
        ctx.fillStyle = colors.editedFill;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      if (isSelectedCell || isRangeCell) {
        ctx.fillStyle = colors.selectionFill;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      if (annotation?.type === 'background') {
        ctx.fillStyle = annotation.color;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      ctx.fillStyle = colors.grid;
      if (!verticalBorderless) ctx.fillRect(x + cellWidth - 1, y, 1, cellHeight);
      if (!options.suppressLastRowBottomBorder || rowIndex !== rows.length - 1) {
        ctx.fillRect(x, y + cellHeight - 1, cellWidth, 1);
      }
      if (rowSpan > 1) {
        const mergedFill = annotation?.type === 'background'
          ? annotation.color
          : isSelectedCell || isRangeCell
            ? colors.selectionFill
            : highlightEditedCells && !insertedRowKeys.has(rowKey) && editedCellKeys.has(`${typeof rowKey}:${String(rowKey)}\u0000${column.key}`)
              ? colors.editedFill
              : highlightInsertedRows && insertedRowKeys.has(rowKey)
                ? colors.insertedFill
                : hoveredRowIndex === rowIndex
                  ? colors.rowHoverFill
                  : selectedRowKeys.has(rowKey) || selectedColumnKeys.has(column.key)
                    ? colors.axisSelectionFill
                    : cellStyle?.backgroundColor ?? (striped && rowIndex % 2 === 1 ? colors.stripe : colors.background);
        ctx.fillStyle = mergedFill;
        for (let offset = 1; offset < rowSpan; offset += 1) {
          ctx.fillRect(x, y + offset * rowHeight - 1, cellWidth, 2);
        }
      }
      if (colSpan > 1 && !verticalBorderless) {
        const mergedFill = annotation?.type === 'background'
          ? annotation.color
          : isSelectedCell || isRangeCell
            ? colors.selectionFill
            : highlightEditedCells && !insertedRowKeys.has(rowKey) && editedCellKeys.has(`${typeof rowKey}:${String(rowKey)}\u0000${column.key}`)
              ? colors.editedFill
              : highlightInsertedRows && insertedRowKeys.has(rowKey)
                ? colors.insertedFill
                : hoveredRowIndex === rowIndex
                  ? colors.rowHoverFill
                  : selectedRowKeys.has(rowKey) || selectedColumnKeys.has(column.key)
                    ? colors.axisSelectionFill
                    : cellStyle?.backgroundColor ?? (striped && rowIndex % 2 === 1 ? colors.stripe : colors.background);
        ctx.fillStyle = mergedFill;
        let offsetLeft = 0;
        for (let offset = 1; offset < colSpan; offset += 1) {
          offsetLeft += metrics[columnIndex + offset - 1]?.width ?? 0;
          ctx.fillRect(x + offsetLeft - 1, y, 2, cellHeight);
        }
      }
      if (isRangeCell) {
        ctx.fillStyle = colors.selection;
        if (rowIndex === rangeRowStart) ctx.fillRect(x, y, cellWidth, 2);
        if (rowIndex === rangeRowEnd) ctx.fillRect(x, y + cellHeight - 2, cellWidth, 2);
        if (columnIndex === rangeColumnStart) ctx.fillRect(x, y, 2, cellHeight);
        if (columnIndex === rangeColumnEnd) ctx.fillRect(x + cellWidth - 2, y, 2, cellHeight);
      }
      if (!column.rowDragHandle && !column.rowSelection && !column.renderCell && !(editing?.rowIndex === rowIndex && editing.columnIndex === columnIndex)) {
        let label = '';
        try {
          label = column.rowNumber ? String(rowIndex + 1) : getDisplayLabel(column, row, rowIndex);
        } catch {
          label = 'Render error';
        }
        if (label) {
          // Clip text to the cell rectangle. Canvas does not support CSS text
          // overflow, so clipping is the reliable way to prevent bleed.
          const padding = 10;
          const textX = column.align === 'right' ? x + cellWidth - padding : column.align === 'center' ? x + cellWidth / 2 : x + padding;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 2, y + 1, Math.max(0, cellWidth - 4), cellHeight - 2);
          ctx.clip();
          ctx.fillStyle = cellStyle?.color ?? colors.text;
          ctx.font = '13px Inter, ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left';
          ctx.fillText(label, textX, y + cellHeight / 2);
          ctx.restore();
        }
      }
      if (annotation?.type === 'corner') {
        // Corner annotations are drawn last so the small marker stays visible
        // above normal cell fills and grid lines.
        const cornerTop = y - 1;
        ctx.fillStyle = annotation.color;
        ctx.beginPath();
        ctx.moveTo(x + cellWidth - 10, cornerTop);
        ctx.lineTo(x + cellWidth, cornerTop);
        ctx.lineTo(x + cellWidth, y + 10);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  };
  paintBodyColumns('scroll');
  paintBodyColumns('left');
  paintBodyColumns('right');

  const headerY = fixedHeader ? 0 : -scrollTop;
  ctx.fillStyle = colors.header;
  ctx.fillRect(0, headerY, width, headerHeight);
  ctx.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
  const paintHeaderColumns = (layer: 'scroll' | 'left' | 'right') => {
  // Header cells use the same three-layer strategy as body cells so fixed
  // headers line up with fixed body columns.
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    if (layer === 'scroll' ? columns[columnIndex].fixed !== undefined : columns[columnIndex].fixed !== layer) continue;
    if (layer === 'scroll' && (columnIndex < range.columnStart || columnIndex >= range.columnEnd)) continue;
    const metric = metrics[columnIndex];
    const x = getColumnX(columnIndex);
    if (layer !== 'scroll') {
      ctx.fillStyle = colors.header;
      ctx.fillRect(x, headerY, metric.width, headerHeight);
    }
    if (selectedColumnKeys.has(columns[columnIndex].key)) {
      ctx.fillStyle = colors.selectionFill;
      ctx.fillRect(x, headerY, metric.width, headerHeight);
    }
    ctx.fillStyle = colors.grid;
    if (!verticalBorderless) ctx.fillRect(x + metric.width - 1, headerY, 1, headerHeight);
    ctx.fillRect(x, headerY + headerHeight - 1, metric.width, 1);
    const column = columns[columnIndex];
    if (!column.rowSelection && !column.rowDragHandle && !column.rowNumber && column.title) {
      ctx.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
      const titleWidth = ctx.measureText(column.title).width;
      const visibleActions = getVisibleHeaderActions(column, metric.width, columnDraggable, titleWidth);
      const actionWidth = (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * 18;
      const contentWidth = Math.max(0, metric.width - actionWidth);
      const padding = 10;
      const clipWidth = contentWidth;
      const centeredTextX = metric.width / 2;
      const centerTitleWidth = Math.max(0, Math.min(centeredTextX - padding, contentWidth - padding - centeredTextX) * 2);
      const centerOverflows = column.align === 'center' && titleWidth > centerTitleWidth;
      const titleAlign = centerOverflows ? 'right' : column.align;
      const maxTitleWidth = titleAlign === 'center' ? centerTitleWidth : Math.max(0, clipWidth - padding * 2);
      const title = ellipsizeText(ctx, column.title, maxTitleWidth);
      const textX = titleAlign === 'right' ? x + contentWidth - padding : titleAlign === 'center' ? x + centeredTextX : x + padding;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, headerY + 1, Math.max(0, clipWidth - 4), headerHeight - 2);
      ctx.clip();
      ctx.fillStyle = colors.muted;
      ctx.textAlign = titleAlign === 'right' ? 'right' : titleAlign === 'center' ? 'center' : 'left';
      ctx.fillText(title, textX, headerY + headerHeight / 2);
      ctx.restore();
    }
  }
  };
  paintHeaderColumns('scroll');
  paintHeaderColumns('left');
  paintHeaderColumns('right');

  if (leftFixedWidth > 0 && scrollLeft > 0) {
    // Frozen-pane shadows communicate that hidden content exists beneath the
    // pinned region.
    const shadowWidth = 10;
    const shadow = ctx.createLinearGradient(leftFixedWidth, 0, leftFixedWidth + shadowWidth, 0);
    shadow.addColorStop(0, 'rgba(5, 5, 5, 0.06)');
    shadow.addColorStop(1, 'rgba(5, 5, 5, 0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(leftFixedWidth, 0, shadowWidth, height);
  }
  if (rightFixedWidth > 0 && scrollLeft < (metrics[metrics.length - 1]?.right ?? 0) - width) {
    const shadowWidth = 10;
    const shadow = ctx.createLinearGradient(rightFixedLeft - shadowWidth, 0, rightFixedLeft, 0);
    shadow.addColorStop(0, 'rgba(5, 5, 5, 0)');
    shadow.addColorStop(1, 'rgba(5, 5, 5, 0.06)');
    ctx.fillStyle = shadow;
    ctx.fillRect(rightFixedLeft - shadowWidth, 0, shadowWidth, height);
  }
  if (rightFixedWidth > 0 && !verticalBorderless) {
    ctx.fillStyle = colors.grid;
    ctx.fillRect(rightFixedLeft - 1, 0, 1, height);
  }

  // Keep the table frame in the same paint layer so selection edges can replace it.
  ctx.fillStyle = colors.grid;
  ctx.fillRect(0, 0, width, 1);
  if (!verticalBorderless) {
    ctx.fillRect(0, 0, 1, height);
    ctx.fillRect(width - 1, 0, 1, height);
  }
  if (!options.suppressFrameBottomBorder) ctx.fillRect(0, height - 1, width, 1);

  if (selectionRange) {
    // Multi-cell range borders can be partially clipped by fixed headers or
    // frozen columns. Paint replacement markers at the visible boundaries so the
    // user still sees where the range continues offscreen.
    const rowStart = Math.min(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex);
    const rowEnd = Math.max(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex);
    const columnStart = Math.min(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex);
    const columnEnd = Math.max(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex);
    const top = bodyTop + rowStart * rowHeight - scrollTop;
    const bottom = bodyTop + (rowEnd + 1) * rowHeight - scrollTop;
    const clipTop = fixedHeader ? bodyTop : 0;
    const markerTop = Math.max(top, clipTop);
    const markerBottom = Math.min(bottom, height);
    const startX = getColumnX(columnStart);
    const endX = getColumnX(columnEnd) + metrics[columnEnd].width;
    const visibleLeft = columns[columnStart].fixed === 'left' ? Math.max(0, startX) : Math.max(leftFixedWidth - 1, startX);
    const visibleRight = columns[columnEnd].fixed === 'right' ? Math.min(width, endX) : Math.min(rightFixedLeft, endX);
    ctx.fillStyle = colors.selection;
    if (markerBottom > markerTop) {
      if (columns[columnStart].fixed === undefined && startX < leftFixedWidth) {
        ctx.fillRect(Math.max(0, leftFixedWidth - 1), markerTop, 2, markerBottom - markerTop);
      }
      if (columns[columnEnd].fixed === undefined && endX > rightFixedLeft) {
        ctx.fillRect(Math.max(0, rightFixedLeft - 1), markerTop, 2, markerBottom - markerTop);
      }
    }
    if (visibleRight > visibleLeft) {
      if (top < clipTop) ctx.fillRect(visibleLeft, clipTop, visibleRight - visibleLeft, 2);
      if (bottom > height) ctx.fillRect(visibleLeft, height - 2, visibleRight - visibleLeft, 2);
    } else if (top < clipTop || bottom > height) {
      const markerX = endX <= leftFixedWidth ? Math.max(0, leftFixedWidth - 1) : Math.max(0, rightFixedLeft - 1);
      ctx.fillRect(markerX, top < clipTop ? clipTop : height - 2, 2, 2);
    }
  }

  const selectedRow = selection ? rows[selection.rowIndex] : undefined;
  const hasValidSelection = Boolean(selection && selectedRow && getRowKey(selectedRow, selection.rowIndex) === selection.rowKey);
  if (selection && hasValidSelection && !selectionRange) {
    // Single-cell selection border has special handling when the selected cell
    // is hidden behind a frozen column or fixed header. Tiny edge markers keep
    // keyboard navigation understandable even when the cell itself is clipped.
    const metric = metrics[selection.columnIndex];
    if (metric) {
      const fixedSide = columns[selection.columnIndex].fixed;
      const isFixed = fixedSide !== undefined;
      const span = getCellSpan(selection.rowIndex, selection.columnIndex);
      const selectionWidth = getCellWidth(selection.columnIndex, span?.colSpan ?? 1);
      const selectionHeight = rowHeight * (span?.rowSpan ?? 1);
      const x = Math.round(getColumnX(selection.columnIndex));
      const y = Math.round(bodyTop + selection.rowIndex * rowHeight - scrollTop);
      const borderWidth = 2;
      const visibleLeft = fixedSide === 'left' ? 0 : leftFixedWidth;
      const selectionAreaRight = fixedSide === 'right' ? width : width - rightFixedWidth;
      const visibleRight = x + selectionWidth;
      const visibleBottom = y + selectionHeight;
      const selectionTop = fixedHeader ? bodyTop : 0;
      const selectionClipTop = fixedHeader ? Math.max(0, selectionTop - 1) : selectionTop;
      const hiddenAboveHeader = visibleBottom <= selectionTop;
      const hiddenBelowViewport = y >= height;
      const hiddenBehindLeft = !isFixed && visibleRight <= visibleLeft;
      const hiddenBehindRight = !isFixed && x >= selectionAreaRight;
      const leftMarkerX = Math.max(0, leftFixedWidth - 1);
      if ((hiddenAboveHeader || hiddenBelowViewport) && (hiddenBehindLeft || hiddenBehindRight)) {
        const markerSize = 2;
        const markerX = hiddenBehindLeft ? leftMarkerX : selectionAreaRight - borderWidth;
        const markerY = hiddenAboveHeader ? selectionClipTop : height - markerSize;
        ctx.fillStyle = colors.selection;
        ctx.fillRect(markerX, markerY, markerSize, markerSize);
        return;
      }
      ctx.save();
      ctx.beginPath();
      const clipLeft = fixedSide === 'left' ? 0 : Math.max(0, leftFixedWidth - 1);
      const clipRight = Math.min(width, selectionAreaRight + 1);
      ctx.rect(clipLeft, selectionClipTop, clipRight - clipLeft, height - selectionClipTop);
      ctx.clip();
      ctx.fillStyle = colors.selection;
      if (hiddenAboveHeader) {
        const markerLeft = Math.max(x - borderWidth, visibleLeft - 1);
        const markerRight = Math.min(visibleRight + 1, selectionAreaRight);
        if (markerRight > markerLeft) ctx.fillRect(markerLeft, selectionClipTop, markerRight - markerLeft, borderWidth);
      }
      if (hiddenBelowViewport) {
        const markerLeft = Math.max(x - borderWidth, visibleLeft - 1);
        const markerRight = Math.min(visibleRight + 1, selectionAreaRight);
        if (markerRight > markerLeft) ctx.fillRect(markerLeft, height - borderWidth, markerRight - markerLeft, borderWidth);
      }
      if (hiddenBehindLeft || hiddenBehindRight) {
        const markerTop = Math.max(y - borderWidth, selectionTop);
        const markerBottom = Math.min(y + selectionHeight + 1, height);
        const markerX = hiddenBehindLeft ? leftMarkerX : selectionAreaRight - borderWidth;
        ctx.fillRect(markerX, markerTop, borderWidth, Math.max(0, markerBottom - markerTop));
      }
      if (hiddenAboveHeader || hiddenBelowViewport || hiddenBehindLeft || hiddenBehindRight) {
        ctx.restore();
        return;
      }
      // Hidden edges stick to the frozen-pane boundaries, matching spreadsheet selection behavior.
      const borderLeft = x <= 0 ? 0 : Math.max(x - borderWidth, visibleLeft - 1);
      const borderRight = Math.min(x + selectionWidth - 1, selectionAreaRight - borderWidth, width - borderWidth);
      const borderTop = Math.max(y - borderWidth, selectionClipTop);
      const borderBottom = Math.min(y + selectionHeight - 1, height - borderWidth);
      const borderOuterWidth = borderRight + borderWidth - borderLeft;
      ctx.fillRect(borderLeft, borderTop, borderOuterWidth, borderWidth);
      ctx.fillRect(borderLeft, borderBottom, borderOuterWidth, borderWidth);
      ctx.fillRect(borderLeft, borderTop, borderWidth, borderBottom + borderWidth - borderTop);
      ctx.fillRect(borderRight, borderTop, borderWidth, borderBottom + borderWidth - borderTop);
      ctx.restore();
    }
  }
}
