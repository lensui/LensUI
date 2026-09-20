import { forwardRef, useImperativeHandle, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ForwardedRef, type ReactElement, type RefAttributes, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { DefaultEmptyState } from './components/EmptyState';
import { ChoiceEditor } from './components/editors/ChoiceEditor';
import { DateEditor, type DateEditorConfig } from './components/editors/DateEditor';
import { CompactTimeEditor } from './components/editors/TimeEditors';
import { TextEditor } from './components/editors/TextEditor';
import { timeFormatHasSeconds } from './core/dateTime';
import { resolveGridLocale } from './core/i18n';
import { createHeaderDragHandleSvg, createHeaderSearchSvg, createHeaderSortSvg, createRowDragHandleSvg } from './icons/domIcons';
import { ContextMenuIcon, HeaderDragIcon, HeaderSearchIcon, HeaderSortIcon, LoadingSpinnerIcon, SelectionIcon, SubmenuArrowIcon } from './icons/gridIcons';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getDisplayLabel } from './core/format';
import { buildColumnMetrics, getHeaderTitleRequiredWidth, getMinimumColumnWidth, getViewportRange, getVisibleHeaderActions, HEADER_ACTION_SLOT_WIDTH, hitTestColumn } from './core/layout';
import { paintGrid } from './core/render';
import { useControllableKeys, useControllableValue } from './hooks/useControllable';
import type { CellContextMenuBuiltin, CellContextMenuContext, ContextMenuItem, ContextMenuSection, CustomContextMenuItem, GridColumn, GridKey, GridSelection, GridSelectionTarget, GridSortState, HeaderContextMenuBuiltin, HeaderContextMenuContext, RangeContextMenuBuiltin, RangeContextMenuContext, TableCellSpan, TableProps, TableRef, TableResolvedCellSpan, ViewportRange } from './types';

interface ScrollPosition { left: number; top: number }
interface SelectionEdgeIndicator {
  side: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  orientation: 'vertical' | 'horizontal' | 'corner';
  style: CSSProperties;
  corner?: { width: number; height: number };
  viewportEdge?: 'left' | 'right' | 'top' | 'bottom';
}
type ColumnDrag =
  {
    type: 'resize';
    columnIndex: number;
    startX: number;
    startWidth: number;
    guideTop: number;
    resizeEdge: 'left' | 'right';
    resizeStartIndex: number;
    resizeEndIndex: number;
    resizeIndices: number[];
    startWidths: number[];
  };
type ConfirmAction<Row> =
  | { type: 'undo'; cell: GridSelection; row: Row; dataIndex: keyof Row; previousValue: unknown; value: unknown }
  | { type: 'clear'; cell: GridSelection; row: Row; dataIndex: keyof Row; previousValue: unknown }
  | { type: 'delete-row'; rows: Array<{ rowIndex: number; row: Row }> };

interface PendingInsert<Row> {
  id: string;
  index: number;
  rows: Row[];
  keys: GridKey[];
}

interface ColumnDropState {
  sourceIndex: number;
  targetIndex: number;
  rawTargetIndex: number;
  targetKey: string;
  headerKind: 'column' | 'group';
  parentKey?: string;
  fixed?: 'left' | 'right';
  columnEdge: 'left' | 'right';
}

type InternalGridColumn<Row> = GridColumn<Row> & {
  rowSelection?: boolean;
  rowDragHandle?: boolean;
  rowNumber?: boolean;
};

interface HeaderCell<Row> {
  key: string;
  column: GridColumn<Row>;
  level: number;
  startIndex: number;
  endIndex: number;
  leaf: boolean;
  parentKey?: string;
  rootIndex: number;
}

interface HeaderTooltipState {
  key: string;
  columnIndex: number;
  action: 'sort' | 'filter' | 'drag' | 'title';
  left: number;
  top: number;
  label: string;
  placement: 'left' | 'right';
}

interface HeaderResizeHit<Row> {
  cell: HeaderCell<Row>;
  edge: 'left' | 'right';
}

interface CellSpanLookup {
  anchors: Map<string, TableResolvedCellSpan>;
  covered: Map<string, TableResolvedCellSpan>;
  maxRowSpan: number;
}

const ANNOTATION_COLORS = ['#f44336', '#ff7a45', '#f5a623', '#f2c94c', '#52c41a', '#13a8a8', '#1677ff', '#597ef7', '#9254de', '#eb2f96'];
const FALLBACK_HEIGHT = 480;
const EMPTY_BODY_HEIGHT = 240;
const VIRTUAL_OVERSCAN = 4;
const TOOLTIP_DELAY = 1000;
const SUMMARY_CHUNK_SIZE = 5000;
const DEFAULT_HEADER_CONTEXT_MENU: Array<HeaderContextMenuBuiltin | '|'> = ['copy', 'select-column'];
const DEFAULT_CELL_CONTEXT_MENU: Array<CellContextMenuBuiltin | '|'> = ['edit', 'copy', 'annotation', '|', 'select-row', 'select-column', '|', 'insert-above', 'insert-below', 'move-up', 'move-down', '|', 'undo', 'clear', 'delete-row'];
const DEFAULT_RANGE_CONTEXT_MENU: Array<RangeContextMenuBuiltin | '|'> = ['copy', 'annotation', '|', 'undo', 'clear'];

const getRowNumberColumnWidth = (rowCount: number) => {
  const digits = String(Math.max(1, rowCount)).length;
  return digits <= 4 ? 44 : 44 + (digits - 4) * 8;
};

function getColumnDepth<Row>(column: GridColumn<Row>): number {
  if (!column.children?.length) return 1;
  return 1 + Math.max(...column.children.map(getColumnDepth));
}

function flattenDataColumns<Row>(columns: GridColumn<Row>[], inheritedFixed?: 'left' | 'right', insideGroup = false): GridColumn<Row>[] {
  return columns.flatMap((column) => {
    if (!column.children?.length) {
      return insideGroup ? [{ ...column, fixed: inheritedFixed }] : [column];
    }
    return flattenDataColumns(column.children, column.fixed ?? inheritedFixed, true);
  });
}

function reconcileColumns<Row>(current: GridColumn<Row>[], incoming: GridColumn<Row>[]): GridColumn<Row>[] {
  const incomingByKey = new Map(incoming.map((column) => [column.key, column] as const));
  const ordered: GridColumn<Row>[] = current.flatMap((column) => {
    const replacement = incomingByKey.get(column.key);
    if (!replacement) return [];
    incomingByKey.delete(column.key);
    return [{
      ...replacement,
      children: replacement.children
        ? reconcileColumns(column.children ?? [], replacement.children)
        : undefined,
    }];
  });
  incoming.forEach((column) => {
    if (incomingByKey.has(column.key)) ordered.push(column);
  });
  return ordered;
}

function reorderColumns<Row>(
  columns: GridColumn<Row>[],
  detail: { type: 'column' | 'group'; sourceKey: string; targetKey: string; parentKey?: string; placement: 'before' | 'after' },
): GridColumn<Row>[] {
  const reorder = (items: GridColumn<Row>[]) => {
    const sourceIndex = items.findIndex((column) => column.key === detail.sourceKey);
    const targetIndex = items.findIndex((column) => column.key === detail.targetKey);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
    const next = items.slice();
    const [column] = next.splice(sourceIndex, 1);
    let insertIndex = targetIndex + (detail.placement === 'after' ? 1 : 0);
    if (sourceIndex < insertIndex) insertIndex -= 1;
    next.splice(insertIndex, 0, column);
    return next;
  };
  if (!detail.parentKey) return reorder(columns);
  return columns.map((column) => {
    if (column.key === detail.parentKey && column.children) return { ...column, children: reorder(column.children) };
    return column.children ? { ...column, children: reorderColumns(column.children, detail) } : column;
  });
}

function buildHeaderCells<Row>(sourceColumns: GridColumn<Row>[], utilityColumnCount: number, depth: number): HeaderCell<Row>[] {
  const cells: HeaderCell<Row>[] = [];
  let leafIndex = utilityColumnCount;
  const walk = (column: GridColumn<Row>, level: number, inheritedFixed: 'left' | 'right' | undefined, insideGroup: boolean, rootIndex: number, parentKey?: string) => {
    const fixedColumn = insideGroup ? { ...column, fixed: inheritedFixed } : column;
    if (!fixedColumn.children?.length) {
      const startIndex = leafIndex;
      leafIndex += 1;
      cells.push({ key: fixedColumn.key, column: fixedColumn, level: depth - 1, startIndex, endIndex: startIndex, leaf: true, parentKey, rootIndex });
      return { startIndex, endIndex: startIndex };
    }
    const startIndex = leafIndex;
    fixedColumn.children.forEach((child) => walk(child, level + 1, fixedColumn.fixed, true, rootIndex, fixedColumn.key));
    const endIndex = leafIndex - 1;
    cells.push({ key: fixedColumn.key, column: fixedColumn, level, startIndex, endIndex, leaf: false, parentKey, rootIndex });
    return { startIndex, endIndex };
  };
  sourceColumns.forEach((column, index) => walk(column, 0, undefined, false, index));
  return cells;
}

function hasNestedFixedColumns<Row>(columns: GridColumn<Row>[], insideGroup = false): boolean {
  return columns.some((column) => (
    (insideGroup && column.fixed !== undefined)
    || (column.children?.length ? hasNestedFixedColumns(column.children, true) : false)
  ));
}

function isProductionRuntime(): boolean {
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  return env === 'production';
}

const createPendingInsertId = () =>
  `table-inserted-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

function readThemeColor(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback;
}

function getDefaultRowKey<Row extends object>(row: Row, index: number): GridKey {
  const id = (row as Record<string, unknown>).id;
  return typeof id === 'string' || typeof id === 'number' ? id : index;
}

function isEmptyCellValue(value: unknown) {
  return value === null || value === undefined || value === '';
}

const getCellCoordKey = (rowIndex: number, columnIndex: number) => `${rowIndex}:${columnIndex}`;

const createEmptyCellSpanLookup = (): CellSpanLookup => ({
  anchors: new Map(),
  covered: new Map(),
  maxRowSpan: 1,
});

const summaryFunctionIds = new WeakMap<Function, number>();
let nextSummaryFunctionId = 1;

function getSummaryFunctionId(fn: Function | undefined) {
  if (!fn) return '';
  const existing = summaryFunctionIds.get(fn);
  if (existing !== undefined) return existing;
  const next = nextSummaryFunctionId;
  nextSummaryFunctionId += 1;
  summaryFunctionIds.set(fn, next);
  return next;
}

function getSummarySignature<Row extends object>(columns: InternalGridColumn<Row>[]) {
  return columns
    .filter((column) => Boolean(column.summary))
    .map((column) => [
      column.key,
      String(column.dataIndex ?? ''),
      typeof column.summary === 'function' ? getSummaryFunctionId(column.summary) : 'sum',
      getSummaryFunctionId(column.formatter),
    ].join('\u0001'))
    .join('\u0002');
}

async function calculateSummaryValues<Row extends object>(
  columns: InternalGridColumn<Row>[],
  rows: Row[],
) {
  const values = new Map<string, ReactNode>();
  for (const column of columns) {
    if (!column.summary) continue;
    if (typeof column.summary === 'function') {
      values.set(column.key, column.summary(rows, column));
      await waitForPaint();
      continue;
    }
    if (column.dataIndex === undefined) continue;
    let total = 0;
    let hasNumber = false;
    for (let start = 0; start < rows.length; start += SUMMARY_CHUNK_SIZE) {
      const end = Math.min(rows.length, start + SUMMARY_CHUNK_SIZE);
      for (let index = start; index < end; index += 1) {
        const value = rows[index][column.dataIndex];
        if (typeof value === 'number' && Number.isFinite(value)) {
          total += value;
          hasNumber = true;
        }
      }
      await waitForPaint();
    }
    if (!hasNumber) continue;
    values.set(column.key, column.formatter ? column.formatter(total, {} as Row, -1) : total.toLocaleString());
  }
  return values;
}

function resolveContextMenuSection<Row, Builtin extends string, Context>(
  section: ContextMenuSection<Row, Builtin, Context> | undefined,
  defaults: Array<Builtin | '|'>,
) {
  if (section === false) return [];
  if (Array.isArray(section)) return section;
  if (section && typeof section === 'object') {
    const excluded = new Set(section.exclude ?? []);
    return defaults.filter((item) => item === '|' || !excluded.has(item));
  }
  return defaults;
}

function TableInner<Row extends object>({
  columns: columnProps,
  rows: sourceRows,
  rowKey,
  width = '100%',
  height = '100%',
  autoHeight = true,
  layout,
  rowHeight: rowHeightProp,
  headerHeight: headerHeightProp,
  fixedHeader = true,
  locale = 'zh-CN',
  borderless,
  verticalBorderless,
  striped = false,
  highlight,
  cellSpans = [],
  loading = false,
  loadingContent,
  virtualized = true,
  tooltip = true,
  summary = false,
  rowNumber = true,
  selectedCell,
  defaultSelectedCell,
  onSelectedCellChange,
  rangeSelection = false,
  rowSelection,
  selectedRowKeys,
  defaultSelectedRowKeys,
  onSelectedRowChange,
  columnSelection,
  selectedColumnKeys,
  defaultSelectedColumnKeys,
  onSelectedColumnChange,
  columnDraggable = true,
  columnResizable = true,
  onColumnsReorder,
  onColumnResize,
  rowDraggable = false,
  onRowsReorder,
  onInsertRows,
  onDeleteRows,
  onSortChange,
  onFilterChange,
  onCellChange,
  onCellClick,
  onCellDoubleClick,
  onCellContextMenu,
  contextMenu: contextMenuConfig = true,
  emptyContent,
  className = '',
  style,
  ariaLabel = 'Data grid',
}: TableProps<Row>, ref: ForwardedRef<TableRef<Row>>) {
  const [sourceColumns, setSourceColumns] = useState(columnProps);
  useEffect(() => {
    setSourceColumns((current) => reconcileColumns(current, columnProps));
  }, [columnProps]);
  const rowHeight = layout?.rowHeight ?? rowHeightProp ?? 36;
  const baseHeaderHeight = layout?.headerHeight ?? headerHeightProp ?? 40;
  const headerDepth = useMemo(() => Math.max(1, ...sourceColumns.map(getColumnDepth)), [sourceColumns]);
  const { language, labels } = useMemo(() => resolveGridLocale(locale), [locale]);
  const customHeaderContentRefs = useRef(new Map<string, HTMLElement>());
  const customHeaderMeasurementsRef = useRef(new Map<string, { level: number; height: number }>());
  const [measuredHeaderRowHeights, setMeasuredHeaderRowHeights] = useState<number[]>([]);
  const headerRowHeights = useMemo(() => (
    Array.from({ length: headerDepth }, (_, level) => Math.max(baseHeaderHeight, measuredHeaderRowHeights[level] ?? 0))
  ), [baseHeaderHeight, headerDepth, measuredHeaderRowHeights]);
  const headerRowOffsets = useMemo(() => {
    const offsets: number[] = [];
    let top = 0;
    headerRowHeights.forEach((height) => {
      offsets.push(top);
      top += height;
    });
    return offsets;
  }, [headerRowHeights]);
  const headerHeight = headerRowHeights.reduce((total, height) => total + height, 0);
  const headerLeafTop = headerRowOffsets[headerDepth - 1] ?? 0;
  const headerLeafHeight = headerRowHeights[headerDepth - 1] ?? baseHeaderHeight;
  const hasVerticalBorders = !(borderless ?? verticalBorderless ?? false);
  const hasStripedRows = Boolean(striped);
  const stripedColor = typeof striped === 'string' ? striped : undefined;
  const editedCellsHighlight = highlight?.editedCells ?? false;
  const insertedRowsHighlight = highlight?.insertedRows ?? false;
  const highlightsEditedCells = Boolean(editedCellsHighlight);
  const editedCellHighlightColor = typeof editedCellsHighlight === 'string' ? editedCellsHighlight : undefined;
  const highlightsInsertedRows = Boolean(insertedRowsHighlight);
  const insertedRowHighlightColor = typeof insertedRowsHighlight === 'string' ? insertedRowsHighlight : undefined;
  const hasCustomLoading = loadingContent !== undefined;
  const isVirtualized = typeof virtualized === 'object' ? virtualized.enabled ?? true : virtualized;
  const virtualOverscan = typeof virtualized === 'object' ? Math.max(0, Math.floor(virtualized.overscan ?? VIRTUAL_OVERSCAN)) : VIRTUAL_OVERSCAN;
  const tooltipConfig = typeof tooltip === 'object'
    ? { header: tooltip.header ?? true, cell: tooltip.cell ?? true }
    : { header: tooltip, cell: tooltip };
  const summaryEnabled = summary === true || typeof summary === 'object';
  const summaryPosition = typeof summary === 'object' ? summary.position ?? 'bottom' : 'bottom';
  const summaryVerticalBordered = hasVerticalBorders && (typeof summary === 'object' ? summary.verticalBordered ?? true : true);
  const summaryEmptyValue = typeof summary === 'object' ? summary.emptyValue ?? '' : '';
  const contextMenuEnabled = contextMenuConfig !== false;
  const customContextMenuConfig = typeof contextMenuConfig === 'object' ? contextMenuConfig : undefined;
  const [resizedColumnWidths, setResizedColumnWidths] = useState<Record<string, number>>({});
  const leafSourceColumns = useMemo(() => flattenDataColumns(sourceColumns), [sourceColumns]);
  const sourceColumnWidthsRef = useRef(new Map(leafSourceColumns.map((column) => [column.key, column.width] as const)));
  const showRowCheckbox = Boolean(rowSelection) && (typeof rowSelection !== 'object' || rowSelection.showCheckbox !== false);
  useEffect(() => {
    if (!isProductionRuntime() && hasNestedFixedColumns(sourceColumns)) {
      console.warn('[Table] Multi-level headers only support fixed columns on top-level columns. Nested fixed values are ignored.');
    }
  }, [sourceColumns]);
  const columns = useMemo<InternalGridColumn<Row>[]>(() => {
    const utilityColumns: InternalGridColumn<Row>[] = [];
    if (rowDraggable) {
      utilityColumns.push({ key: '__rvg_row_drag__', title: '', width: 36, align: 'center', fixed: 'left', rowDragHandle: true });
    }
    if (showRowCheckbox) {
      utilityColumns.push({ key: '__rvg_row_selection__', title: '', width: 44, align: 'center', fixed: 'left', rowSelection: true });
    }
    if (rowNumber) {
      utilityColumns.push({ key: '__rvg_row_number__', title: '#', width: getRowNumberColumnWidth(sourceRows.length), align: 'center', fixed: typeof rowNumber === 'object' && rowNumber.fixed === false ? undefined : 'left', rowNumber: true });
    }
    const dataColumns = leafSourceColumns.map((column) => {
      const resizedWidth = resizedColumnWidths[column.key];
      return resizedWidth === undefined ? column : { ...column, width: resizedWidth };
    });
    return [...utilityColumns, ...dataColumns];
  }, [leafSourceColumns, resizedColumnWidths, rowDraggable, rowNumber, showRowCheckbox, sourceRows.length]);
  const utilityColumnCount = (rowDraggable ? 1 : 0) + (showRowCheckbox ? 1 : 0) + (rowNumber ? 1 : 0);
  const headerCells = useMemo(() => buildHeaderCells(sourceColumns, utilityColumnCount, headerDepth), [headerDepth, sourceColumns, utilityColumnCount]);
  const activeCustomHeaderLevels = useMemo(() => {
    const levels = new Map<string, number>();
    columns.forEach((column) => {
      if (column.renderHeader) levels.set(column.key, headerDepth - 1);
    });
    headerCells.forEach((cell) => {
      if (cell.column.renderHeader) levels.set(`group:${cell.key}:${cell.level}`, cell.level);
    });
    return levels;
  }, [columns, headerCells, headerDepth]);

  // Canvas and scroll container references form the physical rendering surface.
  // The canvas paints grid cells, while the scroller supplies native scrolling,
  // focus, clipboard, and keyboard events.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Animation frame refs throttle expensive work. frameRef is for canvas
  // repainting; textFrameRef is for synchronizing the DOM text overlay with
  // scroll position without forcing React to update on every scroll event.
  const frameRef = useRef<number | null>(null);
  const textFrameRef = useRef<number | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHeaderTooltipKeyRef = useRef('');
  const pendingCellTooltipKeyRef = useRef('');

  // Pointer interaction refs hold short-lived gestures that should not trigger
  // React renders on every movement.
  const clickedCellRef = useRef<GridSelection | null>(null);
  const rowAnchorRef = useRef<number | null>(null);
  const columnAnchorRef = useRef<number | null>(null);
  const columnDragRef = useRef<ColumnDrag | null>(null);

  // Visual guide elements are regular DOM nodes because moving a single guide
  // with style.transform is cheaper than rerendering the whole grid.
  const dragGuideRef = useRef<HTMLDivElement>(null);
  const rowDragGuideRef = useRef<HTMLDivElement>(null);
  const selectionFocusRef = useRef<HTMLDivElement>(null);
  const selectionEdgeTargetRef = useRef<HTMLButtonElement>(null);
  const verticalScrollbarRef = useRef<HTMLDivElement>(null);
  const verticalScrollbarThumbRef = useRef<HTMLDivElement>(null);
  const verticalScrollbarDragRef = useRef<{ pointerId: number; startY: number; startTop: number; trackHeight: number; thumbHeight: number; maxScrollTop: number } | null>(null);
  const horizontalScrollbarRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarThumbRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarDragRef = useRef<{ pointerId: number; startX: number; startLeft: number; trackWidth: number; thumbWidth: number; maxScrollLeft: number } | null>(null);
  const verticalScrollbarVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horizontalScrollbarVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Row lookup caches let callbacks report selected rows by stable row keys
  // even when row order changes between controlled updates.
  const rowByKeyRef = useRef(new Map<GridKey, Row>());
  const rowIndexByKeyRef = useRef(new Map<GridKey, number>());

  // DOM overlay refs for header icons and text. These layers mirror scroll
  // movement with transforms so selectable text stays aligned with canvas cells.
  const headerIconsRef = useRef<HTMLDivElement>(null);
  const scrollingHeaderIconsRef = useRef<HTMLDivElement>(null);
  const scrollingTextRef = useRef<HTMLDivElement>(null);

  // Floating controls and menus close on outside pointer events, so refs are
  // needed to tell whether a document-level pointer originated inside them.
  const filterRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // suppressClickRef prevents drag and resize gestures from also triggering the
  // normal click-selection path when the pointer is released.
  const suppressClickRef = useRef(false);
  const hasCompletedLoadRef = useRef(!loading);
  const columnDragPreviewRef = useRef<{ sourceIndex: number; targetIndex: number } | null>(null);
  const validColumnDropRef = useRef<ColumnDropState | null>(null);
  const hoveredHeaderActionRef = useRef<{ columnIndex: number; action: 'sort' | 'filter' | 'drag' | 'title' } | null>(null);
  const hoveredRowIndexRef = useRef<number | null>(null);

  // viewport and scrollPosition are React state because they affect rendered
  // overlay geometry. scrollRef is the immediate mutable copy used by canvas and
  // pointer handlers before React has committed the next render.
  const [viewport, setViewport] = useState({ width: 0, height: typeof height === 'number' ? height : FALLBACK_HEIGHT });
  const [horizontalScrollbarHeight, setHorizontalScrollbarHeight] = useState(0);
  const resolvedHeight = typeof height === 'number' ? height : viewport.height || FALLBACK_HEIGHT;
  const [scrollPosition, setScrollPosition] = useState<ScrollPosition>({ left: 0, top: 0 });
  const scrollRef = useRef<ScrollPosition>({ left: 0, top: 0 });

  // Axis selections are tracked by stable keys rather than indices so sorting,
  // filtering, and row insertion do not silently select a different record.
  const [rowKeys, setRowKeys] = useControllableKeys(selectedRowKeys, defaultSelectedRowKeys, (keys) => {
    if (!onSelectedRowChange) return;
    const missing = new Set(keys.filter((key) => !rowByKeyRef.current.has(key)));
    if (missing.size > 0) {
      for (let index = 0; index < rows.length && missing.size > 0; index += 1) {
        const row = rows[index];
        const key = getRowKey(row, index);
        if (missing.delete(key)) {
          rowByKeyRef.current.set(key, row);
          rowIndexByKeyRef.current.set(key, index);
        }
      }
    }
    const entries = keys.flatMap((key) => {
      const row = rowByKeyRef.current.get(key);
      const index = rowIndexByKeyRef.current.get(key);
      return row && index !== undefined ? [{ row, index }] : [];
    });
    onSelectedRowChange(keys, entries.map(({ row }) => row), entries.map(({ index }) => index));
  });
  const [columnKeys, setColumnKeys] = useControllableKeys(selectedColumnKeys, defaultSelectedColumnKeys, onSelectedColumnChange);

  // Cell editing is split into identity plus draft. The row data remains owned
  // by the consumer; Table only emits onCellChange when the draft commits.
  const [editing, setEditing] = useState<GridSelection | null>(null);
  const [draft, setDraft] = useState('');
  const [rowDragPreview, setRowDragPreview] = useState<{ sourceIndex: number; targetIndex: number } | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<{ startIndex: number; endIndex: number } | null>(null);

  useEffect(() => {
    if (!loading) hasCompletedLoadRef.current = true;
  }, [loading]);

  useEffect(() => {
    if (rangeSelection) return;
    rangeDragRef.current = null;
    setSelectionRange(null);
  }, [rangeSelection]);

  useEffect(() => {
    const previousSourceWidths = sourceColumnWidthsRef.current;
    const nextSourceWidths = new Map(leafSourceColumns.map((column) => [column.key, column.width] as const));
    sourceColumnWidthsRef.current = nextSourceWidths;
    setResizedColumnWidths((current) => {
      const sourceColumnByKey = new Map(leafSourceColumns.map((column) => [column.key, column] as const));
      let changed = false;
      const next: Record<string, number> = {};
      Object.entries(current).forEach(([key, value]) => {
        const sourceColumn = sourceColumnByKey.get(key);
        if (!sourceColumn) {
          changed = true;
          return;
        }
        const sourceWidthChanged = previousSourceWidths.get(key) !== sourceColumn.width;
        if (sourceWidthChanged && sourceColumn.width !== undefined && sourceColumn.width !== value) {
          changed = true;
          return;
        }
        next[key] = value;
      });
      return changed ? next : current;
    });
  }, [leafSourceColumns]);

  useEffect(() => () => {
    if (headerTooltipTimerRef.current !== null) clearTimeout(headerTooltipTimerRef.current);
    if (cellTooltipTimerRef.current !== null) clearTimeout(cellTooltipTimerRef.current);
  }, []);

  const measureCustomHeaderHeight = useCallback(() => {
    const nextHeights = Array.from({ length: headerDepth }, () => baseHeaderHeight);
    customHeaderContentRefs.current.forEach((node) => {
      const headerCell = node.closest<HTMLElement>('.rvg-header-title');
      const key = headerCell?.dataset.measureKey;
      const level = key ? activeCustomHeaderLevels.get(key) : undefined;
      if (!key || level === undefined || level < 0 || level >= nextHeights.length) return;
      customHeaderMeasurementsRef.current.set(key, { level, height: Math.ceil(node.scrollHeight) + 16 });
    });
    customHeaderMeasurementsRef.current.forEach((measurement, key) => {
      if (!activeCustomHeaderLevels.has(key)) return;
      nextHeights[measurement.level] = Math.max(nextHeights[measurement.level], measurement.height);
    });
    setMeasuredHeaderRowHeights((current) => {
      const changed = nextHeights.length !== current.length || nextHeights.some((height, index) => height !== current[index]);
      return changed ? nextHeights : current;
    });
  }, [activeCustomHeaderLevels, baseHeaderHeight, headerDepth]);

  useLayoutEffect(() => {
    customHeaderContentRefs.current.forEach((_, key) => {
      if (!activeCustomHeaderLevels.has(key)) customHeaderContentRefs.current.delete(key);
    });
    customHeaderMeasurementsRef.current.forEach((_, key) => {
      if (!activeCustomHeaderLevels.has(key)) customHeaderMeasurementsRef.current.delete(key);
    });
    if (activeCustomHeaderLevels.size === 0) {
      setMeasuredHeaderRowHeights([]);
      return;
    }
    measureCustomHeaderHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureCustomHeaderHeight);
    customHeaderContentRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [activeCustomHeaderLevels, measureCustomHeaderHeight, viewport.width]);

  const [filterEditor, setFilterEditor] = useState<{ columnIndex: number; left: number; top: number; draft: string } | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortState, setSortState] = useState<GridSortState | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { type: 'header'; columnIndex: number; left: number; top: number }
    | ({ type: 'cell'; left: number; top: number } & GridSelection)
    | null
  >(null);
  const [insertCounts, setInsertCounts] = useState({ before: 1, after: 1 });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction<Row> | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [insertBusy, setInsertBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [resizeGuideX, setResizeGuideX] = useState<number | null>(null);
  const [resizeGuideTop, setResizeGuideTop] = useState(0);
  const [hoveredHeaderAction, setHoveredHeaderAction] = useState<{ columnIndex: number; action: 'sort' | 'filter' | 'drag' | 'title' } | null>(null);
  const [visibleHeaderTooltip, setVisibleHeaderTooltip] = useState<HeaderTooltipState | null>(null);
  const [hoveredCellTooltip, setHoveredCellTooltip] = useState<{ rowIndex: number; columnIndex: number; left: number; top: number; label: string; color?: string; annotation?: boolean; placement?: 'left' | 'right' } | null>(null);

  const hideDragTooltips = useCallback(() => {
    if (headerTooltipTimerRef.current !== null) {
      clearTimeout(headerTooltipTimerRef.current);
      headerTooltipTimerRef.current = null;
    }
    if (cellTooltipTimerRef.current !== null) {
      clearTimeout(cellTooltipTimerRef.current);
      cellTooltipTimerRef.current = null;
    }
    pendingHeaderTooltipKeyRef.current = '';
    pendingCellTooltipKeyRef.current = '';
    setVisibleHeaderTooltip(null);
    setHoveredCellTooltip(null);
  }, []);

  // These local maps power optimistic visual feedback for edits and annotations.
  // They are intentionally visual-only; persistence still belongs to callbacks.
  const [editedCellKeys, setEditedCellKeys] = useState<Set<string>>(() => new Set());
  const [cellAnnotations, setCellAnnotations] = useState<Map<string, { type: 'background' | 'corner'; color: string; content: string }>>(() => new Map());
  const [annotationType, setAnnotationType] = useState<'background' | 'corner'>('corner');
  const [annotationColor, setAnnotationColor] = useState(ANNOTATION_COLORS[0]);
  const [annotationContent, setAnnotationContent] = useState('');
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationPlacement, setAnnotationPlacement] = useState<'right-down' | 'right-up' | 'left-down' | 'left-up'>('right-down');
  const originalCellValuesRef = useRef<Map<string, string>>(new Map());
  const [pendingDeletedRowKeys, setPendingDeletedRowKeys] = useState<Set<GridKey>>(() => new Set());
  const [pendingInserts, setPendingInserts] = useState<Array<PendingInsert<Row>>>(() => []);
  const [insertedRowKeys, setInsertedRowKeys] = useState<Set<GridKey>>(() => new Set());
  const [rowOrderKeys, setRowOrderKeys] = useState<GridKey[] | null>(null);
  const settledPendingInsertIdsRef = useRef<Set<string>>(new Set());

  const getDataRowKey = useCallback((row: Row, index: number): GridKey => {
    return typeof rowKey === 'function'
      ? rowKey(row, index)
      : rowKey
        ? (row[rowKey] as GridKey)
        : getDefaultRowKey(row, index);
  }, [rowKey]);

  const getSourceRowIndexByKey = useCallback((key: GridKey, preferredIndex: number) => {
    const preferredRow = sourceRows[preferredIndex];
    if (preferredRow && getDataRowKey(preferredRow, preferredIndex) === key) return preferredIndex;
    const start = Math.max(0, preferredIndex - 8);
    const end = Math.min(sourceRows.length, preferredIndex + 9);
    for (let index = start; index < end; index += 1) {
      if (getDataRowKey(sourceRows[index], index) === key) return index;
    }
    return sourceRows.findIndex((sourceRow, index) => getDataRowKey(sourceRow, index) === key);
  }, [getDataRowKey, sourceRows]);

  const orderedRows = useMemo(() => {
    let next = sourceRows;
    if (pendingInserts.length > 0) {
      const activeInserts = pendingInserts.filter((insert) => {
        if (settledPendingInsertIdsRef.current.has(insert.id)) return false;
        const isSettled = insert.keys.every((key, offset) => {
          return getSourceRowIndexByKey(key, insert.index + offset) >= 0;
        });
        if (!isSettled) return true;
        settledPendingInsertIdsRef.current.add(insert.id);
        return false;
      });
      if (activeInserts.length > 0) next = sourceRows.slice();
      let insertedOffset = 0;
      activeInserts
        .slice()
        .sort((left, right) => left.index - right.index)
        .forEach((insert) => {
          next.splice(Math.min(next.length, insert.index + insertedOffset), 0, ...insert.rows);
          insertedOffset += insert.rows.length;
        });
    }
    if (pendingDeletedRowKeys.size > 0) {
      next = next.filter((row, index) => !pendingDeletedRowKeys.has(getDataRowKey(row, index)));
    }
    if (!rowOrderKeys) return next;
    const rowsByKey = new Map(next.map((row, index) => [getDataRowKey(row, index), row] as const));
    const ordered = rowOrderKeys.flatMap((key) => {
      const row = rowsByKey.get(key);
      if (!row) return [];
      rowsByKey.delete(key);
      return [row];
    });
    next.forEach((row, index) => {
      const key = getDataRowKey(row, index);
      if (rowsByKey.has(key)) ordered.push(row);
    });
    return ordered;
  }, [getDataRowKey, pendingDeletedRowKeys, pendingInserts, rowOrderKeys, sourceRows]);

  const activeFilterValues = useMemo(() => Object.fromEntries(
    Object.entries(filterValues).filter(([, value]) => value.trim() !== ''),
  ), [filterValues]);
  const filteredRows = useMemo(() => {
    if (Object.keys(activeFilterValues).length === 0) return orderedRows;
    if (onFilterChange) return onFilterChange(orderedRows, activeFilterValues);
    return orderedRows.filter((row, rowIndex) => Object.entries(activeFilterValues).every(([columnKey, query]) => {
      const column = columns.find((candidate) => candidate.key === columnKey);
      if (!column) return true;
      return getDisplayLabel(column, row, rowIndex).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    }));
  }, [activeFilterValues, columns, onFilterChange, orderedRows]);
  const rows = useMemo(() => {
    if (!sortState) return filteredRows;
    if (onSortChange) return onSortChange(filteredRows, sortState);
    const column = columns.find((candidate) => candidate.key === sortState.columnKey);
    if (!column) return filteredRows;
    const direction = sortState.direction === 'asc' ? 1 : -1;
    return filteredRows.slice().sort((left, right) => {
      const leftValue = column.dataIndex === undefined ? undefined : left[column.dataIndex];
      const rightValue = column.dataIndex === undefined ? undefined : right[column.dataIndex];
      const result = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : getDisplayLabel(column, left, 0).localeCompare(getDisplayLabel(column, right, 0), language);
      return result * direction;
    });
  }, [columns, filteredRows, language, onSortChange, sortState]);

  const resolveSelectionTarget = useCallback((target: GridSelectionTarget | null | undefined): GridSelection | null | undefined => {
    if (target == null) return target;
    const columnIndex = columns.findIndex((column) => column.key === target.columnKey);
    const rowIndex = target.rowKey !== undefined
      ? rows.findIndex((row, index) => getDataRowKey(row, index) === target.rowKey)
      : target.rowIndex ?? -1;
    const row = rows[rowIndex];
    if (columnIndex < 0 || !row) return null;
    return {
      rowIndex,
      columnIndex,
      rowKey: getDataRowKey(row, rowIndex),
      columnKey: target.columnKey,
    };
  }, [columns, getDataRowKey, rows]);
  const resolvedSelectedCell = useMemo(() => resolveSelectionTarget(selectedCell), [resolveSelectionTarget, selectedCell]);
  const resolvedDefaultSelectedCell = useMemo(() => resolveSelectionTarget(defaultSelectedCell), [defaultSelectedCell, resolveSelectionTarget]);
  const handleSelectedCellChange = useCallback((next: GridSelection | null) => {
    if (!onSelectedCellChange) return;
    if (!next) {
      onSelectedCellChange(null);
      return;
    }
    const row = rows[next.rowIndex];
    const column = columns[next.columnIndex];
    const value = row && column?.dataIndex !== undefined ? row[column.dataIndex] : undefined;
    onSelectedCellChange({ ...next, value });
  }, [columns, onSelectedCellChange, rows]);

  // Selection inputs only need stable row/column identifiers. Internally the
  // grid keeps a fully resolved position for painting and keyboard navigation.
  const [selection, setSelection] = useControllableValue<GridSelection>(resolvedSelectedCell, resolvedDefaultSelectedCell, handleSelectedCellChange);
  const [selectionRange, setSelectionRange] = useState<{ anchor: GridSelection; focus: GridSelection } | null>(null);
  const rangeDragRef = useRef<{ anchor: GridSelection; moved: boolean } | null>(null);

  const applyRowOrder = useCallback((sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= rows.length || targetIndex >= rows.length) return;
    const nextEntries = rows.map((row, index) => ({ row, key: getDataRowKey(row, index) }));
    const [entry] = nextEntries.splice(sourceIndex, 1);
    nextEntries.splice(targetIndex, 0, entry);
    const nextRows = nextEntries.map(({ row }) => row);
    setRowOrderKeys(nextEntries.map(({ key }) => key));
    onRowsReorder?.(nextRows, { sourceIndex, targetIndex });
  }, [getDataRowKey, onRowsReorder, rows]);

  const applyColumnOrder = useCallback((
    sourceIndex: number,
    targetIndex: number,
    detail: { type: 'column' | 'group'; sourceKey: string; targetKey: string; parentKey?: string; placement: 'before' | 'after' },
  ) => {
    const nextColumns = reorderColumns(sourceColumns, detail);
    setSourceColumns(nextColumns);
    onColumnsReorder?.(nextColumns, { sourceIndex, targetIndex, ...detail });
  }, [onColumnsReorder, sourceColumns]);

  useEffect(() => {
    if (insertBusy || settledPendingInsertIdsRef.current.size === 0) return;
    setPendingInserts((current) => {
      const next = current.filter((insert) => !settledPendingInsertIdsRef.current.has(insert.id));
      if (next.length === current.length) return current;
      current.forEach((insert) => {
        if (!next.includes(insert)) settledPendingInsertIdsRef.current.delete(insert.id);
      });
      return next;
    });
  }, [insertBusy, pendingInserts]);

  useEffect(() => {
    if (pendingDeletedRowKeys.size === 0) return;
    setPendingDeletedRowKeys((current) => {
      if (current.size === 0) return current;
      const sourceKeys = new Set(sourceRows.map((row, index) => getDataRowKey(row, index)));
      let changed = false;
      const next = new Set<GridKey>();
      current.forEach((key) => {
        if (sourceKeys.has(key)) next.add(key);
        else changed = true;
      });
      return changed ? next : current;
    });
  }, [getDataRowKey, pendingDeletedRowKeys.size, sourceRows]);

  // Editing is tied to the active selection. If the consumer changes selection
  // from outside, close the editor so a stale floating input cannot keep writing
  // into a cell that is no longer active.
  useLayoutEffect(() => {
    if (!editing) return;
    if (selection?.rowKey === editing.rowKey && selection.columnKey === editing.columnKey) return;
    setEditing(null);
  }, [editing, selection]);

  const hasManualColumnWidths = Object.keys(resizedColumnWidths).length > 0;
  const metrics = useMemo(() => buildColumnMetrics(columns, {
    columnDraggable,
    viewportWidth: hasManualColumnWidths ? 0 : viewport.width,
  }), [columnDraggable, columns, hasManualColumnWidths, viewport.width]);
  const contentWidth = metrics.length > 0 ? metrics[metrics.length - 1].right : 0;
  const contentHeight = rows.length * rowHeight;
  const fixedWidth = useMemo(() => columns.reduce((width, column, index) => column.fixed === 'left' ? width + metrics[index].width : width, 0), [columns, metrics]);
  const leftFixedOffsets = useMemo(() => {
    const offsets = new Map<number, number>();
    let offset = 0;
    for (let index = 0; index < columns.length; index += 1) {
      if (columns[index].fixed !== 'left') continue;
      offsets.set(index, offset);
      offset += metrics[index].width;
    }
    return offsets;
  }, [columns, metrics]);
  const rightFixedWidth = useMemo(() => columns.reduce((width, column, index) => column.fixed === 'right' ? width + metrics[index].width : width, 0), [columns, metrics]);
  const rightFixedOffsets = useMemo(() => {
    const offsets = new Map<number, number>();
    let offset = 0;
    for (let index = columns.length - 1; index >= 0; index -= 1) {
      if (columns[index].fixed !== 'right') continue;
      offsets.set(index, offset);
      offset += metrics[index].width;
    }
    return offsets;
  }, [columns, metrics]);
  const scrollableColumnLefts = useMemo(() => {
    const lefts: number[] = [];
    let width = fixedWidth;
    for (let index = 0; index < columns.length; index += 1) {
      lefts[index] = width;
      if (columns[index].fixed === undefined) width += metrics[index].width;
    }
    return lefts;
  }, [columns, fixedWidth, metrics]);
  const getScrollableColumnLeft = useCallback((columnIndex: number) => (
    scrollableColumnLefts[columnIndex] ?? fixedWidth
  ), [fixedWidth, scrollableColumnLefts]);
  const hasRowSelectionColumn = useMemo(() => columns.some((column) => column.rowSelection), [columns]);
  const rowSelectionMode = typeof rowSelection === 'object' ? rowSelection.mode ?? 'multiple' : 'multiple';
  const summarySignature = useMemo(() => getSummarySignature(columns), [columns]);
  const hasSummaryRow = rows.length > 0 && summaryEnabled && summarySignature.length > 0;
  const topSummaryHeight = hasSummaryRow && summaryPosition === 'top' ? rowHeight : 0;
  const bottomSummaryHeight = hasSummaryRow && summaryPosition === 'bottom' ? rowHeight : 0;
  const bodyTop = headerHeight + topSummaryHeight;
  const bodyContentHeight = rows.length === 0 ? EMPTY_BODY_HEIGHT : contentHeight;
  const realContentHeight = bodyTop + bodyContentHeight + bottomSummaryHeight + (contentWidth > viewport.width ? horizontalScrollbarHeight : 0);
  const effectiveHeight = autoHeight ? Math.max(bodyTop + bottomSummaryHeight, Math.min(resolvedHeight, realContentHeight)) : resolvedHeight;
  const renderHeight = Math.max(0, effectiveHeight - bottomSummaryHeight);
  const bodyViewportHeight = Math.max(0, renderHeight - (fixedHeader ? headerHeight + topSummaryHeight : 0));
  const [summaryState, setSummaryState] = useState<{
    signature: string;
    rows: Row[] | null;
    values: Map<string, ReactNode>;
    pending: boolean;
  }>(() => ({ signature: '', rows: null, values: new Map(), pending: false }));
  const summaryPending = hasSummaryRow
    && (loading || summaryState.pending || summaryState.signature !== summarySignature || summaryState.rows !== rows);
  const summaryValues = hasSummaryRow && summaryState.signature === summarySignature && summaryState.rows === rows
    ? summaryState.values
    : new Map<string, ReactNode>();

  useEffect(() => {
    let cancelled = false;
    if (!hasSummaryRow) {
      setSummaryState((current) => current.signature === '' && current.rows === null && current.values.size === 0 && !current.pending
        ? current
        : { signature: '', rows: null, values: new Map(), pending: false });
      return () => {
        cancelled = true;
      };
    }

    setSummaryState((current) => ({
      signature: summarySignature,
      rows,
      values: current.signature === summarySignature && current.rows === rows ? current.values : new Map(),
      pending: true,
    }));

    if (loading) {
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      await waitForPaint();
      if (cancelled) return;
      const values = await calculateSummaryValues(columns, rows);
      if (cancelled) return;
      setSummaryState({ signature: summarySignature, rows, values, pending: false });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [hasSummaryRow, loading, rows, summarySignature]);

  // The canvas draws the grid chrome and cell backgrounds. Text is rendered in
  // a lightweight DOM overlay so users can select/copy visible text naturally.
  // Both layers use the same viewport calculation to stay aligned while only
  // mounting visible rows and columns.
  const domRange = useMemo<ViewportRange>(() => {
    if (!isVirtualized) return { rowStart: 0, rowEnd: rows.length, columnStart: 0, columnEnd: columns.length };
    const currentScroll = scrollRef.current;
    const rowScrollTop = fixedHeader ? currentScroll.top : Math.max(0, currentScroll.top - bodyTop);
    return getViewportRange(currentScroll.left, rowScrollTop, viewport.width, bodyViewportHeight, rows.length, rowHeight, metrics, virtualOverscan);
  }, [bodyTop, bodyViewportHeight, columns.length, fixedHeader, isVirtualized, metrics, rowHeight, rows.length, scrollPosition, viewport.width, virtualOverscan]);

  const getRowKey = useCallback((row: Row, index: number): GridKey => {
    // rowKey is optional for the common data shape where each record has `id`.
    // If a legacy dataset has no id, the row index keeps the grid interactive
    // instead of throwing during selection, drag, or annotation lookups.
    const key = getDataRowKey(row, index);
    rowByKeyRef.current.set(key, row);
    rowIndexByKeyRef.current.set(key, index);
    return key;
  }, [getDataRowKey]);
  const resolvedCellSpans = useMemo(() => {
    if (Array.isArray(cellSpans)) return cellSpans;
    const spans: TableCellSpan[] = [];
    rows.forEach((row, rowIndex) => {
      columns.forEach((column, columnIndex) => {
        const span = cellSpans({ row, rowIndex, column, columnIndex, rows, columns });
        if (!span) return;
        spans.push({
          rowIndex,
          columnKey: column.key,
          ...span,
        });
      });
    });
    return spans;
  }, [cellSpans, columns, rows]);
  const cellSpanLookup = useMemo<CellSpanLookup>(() => {
    if (resolvedCellSpans.length === 0) return createEmptyCellSpanLookup();
    const rowIndexByKey = new Map<GridKey, number>();
    rows.forEach((row, index) => rowIndexByKey.set(getRowKey(row, index), index));
    const columnIndexByKey = new Map(columns.map((column, index) => [column.key, index] as const));
    const lookup = createEmptyCellSpanLookup();
    const occupied = new Set<string>();

    for (const span of resolvedCellSpans) {
      const rowIndex = span.rowKey !== undefined ? rowIndexByKey.get(span.rowKey) : span.rowIndex;
      const columnIndex = columnIndexByKey.get(span.columnKey);
      if (rowIndex === undefined || columnIndex === undefined) continue;
      if (rowIndex < 0 || rowIndex >= rows.length) continue;
      const column = columns[columnIndex];
      if (column.rowSelection || column.rowDragHandle || column.rowNumber) continue;

      const fixedSide = column.fixed;
      let colSpan = Math.max(1, Math.floor(span.colSpan ?? 1));
      while (
        colSpan > 1
        && (
          columnIndex + colSpan > columns.length
          || columns[columnIndex + colSpan - 1]?.fixed !== fixedSide
          || columns[columnIndex + colSpan - 1]?.rowSelection
          || columns[columnIndex + colSpan - 1]?.rowDragHandle
          || columns[columnIndex + colSpan - 1]?.rowNumber
        )
      ) {
        colSpan -= 1;
      }
      const rowSpan = Math.min(rows.length - rowIndex, Math.max(1, Math.floor(span.rowSpan ?? 1)));
      if (rowSpan === 1 && colSpan === 1) continue;

      let overlaps = false;
      for (let rowOffset = 0; rowOffset < rowSpan && !overlaps; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          if (occupied.has(getCellCoordKey(rowIndex + rowOffset, columnIndex + columnOffset))) {
            overlaps = true;
            break;
          }
        }
      }
      if (overlaps) continue;

      const resolved = { rowIndex, columnIndex, rowSpan, colSpan };
      lookup.anchors.set(getCellCoordKey(rowIndex, columnIndex), resolved);
      lookup.maxRowSpan = Math.max(lookup.maxRowSpan, rowSpan);
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          const key = getCellCoordKey(rowIndex + rowOffset, columnIndex + columnOffset);
          occupied.add(key);
          lookup.covered.set(key, resolved);
        }
      }
    }
    return lookup;
  }, [columns, getRowKey, resolvedCellSpans, rows]);
  const selectedRowKeySet = useMemo(() => new Set(rowKeys), [rowKeys]);
  const selectedColumnKeySet = useMemo(() => new Set(columnKeys), [columnKeys]);
  const insertedRowKeySet = useMemo(() => insertedRowKeys, [insertedRowKeys]);

  // Header action visibility depends on measured title width. Canvas gives the
  // most accurate answer after mount; the fallback keeps SSR/tests deterministic.
  const measureHeaderTitleWidth = useCallback((columnIndex: number) => {
    const title = columns[columnIndex]?.title ?? '';
    const context = canvasRef.current?.getContext('2d');
    if (!context) return Array.from(title).reduce((width, character) => width + (/^[\x00-\x7F]$/.test(character) ? 7 : 13), 0);
    context.save();
    context.font = '13px Inter, ui-sans-serif, system-ui, sans-serif';
    const width = context.measureText(title).width;
    context.restore();
    return width;
  }, [columns]);

  const getCellLabel = useCallback((rowIndex: number, columnIndex: number): string => {
    const row = rows[rowIndex];
    const column = columns[columnIndex];
    if (!row || !column || column.rowSelection || column.rowDragHandle) return '';
    if (column.rowNumber) return String(rowIndex + 1);
    try {
      return getDisplayLabel(column, row, rowIndex);
    } catch {
      return 'Render error';
    }
  }, [columns, rows]);

  const getCellSpan = useCallback((rowIndex: number, columnIndex: number) => (
    cellSpanLookup.covered.get(getCellCoordKey(rowIndex, columnIndex))
  ), [cellSpanLookup]);

  const getCellDisplayWidth = useCallback((columnIndex: number, colSpan = 1) => {
    let width = 0;
    for (let index = columnIndex; index < Math.min(columns.length, columnIndex + colSpan); index += 1) {
      width += metrics[index]?.width ?? 0;
    }
    return width;
  }, [columns.length, metrics]);

  // Preserve selections by row key across row reordering or data refreshes.
  useEffect(() => {
    if (!selection) return;
    const nextRowIndex = rows.findIndex((row, index) => getRowKey(row, index) === selection.rowKey);
    const nextColumnIndex = columns.findIndex((column) => column.key === selection.columnKey);
    if (nextRowIndex < 0 || nextColumnIndex < 0) return;
    if (nextRowIndex === selection.rowIndex && nextColumnIndex === selection.columnIndex) return;
    setSelection({ ...selection, rowIndex: nextRowIndex, columnIndex: nextColumnIndex });
  }, [columns, getRowKey, rows, selection, setSelection]);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas || viewport.width <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const physicalWidth = Math.round(viewport.width * ratio);
    const physicalHeight = Math.round(renderHeight * ratio);
    if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
    if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    const themeStyles = getComputedStyle(canvas);
    const themeColors = {
      background: readThemeColor(themeStyles, '--rvg-color-bg', '#ffffff'),
      header: readThemeColor(themeStyles, '--rvg-color-header-bg', '#f5f6f7'),
      grid: readThemeColor(themeStyles, '--rvg-color-grid', '#e3e6e8'),
      text: readThemeColor(themeStyles, '--rvg-color-text', '#202124'),
      muted: readThemeColor(themeStyles, '--rvg-color-muted', '#5f6368'),
      icon: readThemeColor(themeStyles, '--rvg-color-icon', '#9aa0a6'),
      borderStrong: readThemeColor(themeStyles, '--rvg-color-border-strong', '#b8bec4'),
      selection: readThemeColor(themeStyles, '--rvg-color-primary', '#1677ff'),
      selectionFill: readThemeColor(themeStyles, '--rvg-color-selection-fill', '#edf4ff'),
      axisSelectionFill: readThemeColor(themeStyles, '--rvg-color-axis-selection-fill', '#e8f2ff'),
      rowHoverFill: readThemeColor(themeStyles, '--rvg-color-row-hover-fill', '#f6f9fc'),
      editedFill: editedCellHighlightColor ?? readThemeColor(themeStyles, '--rvg-color-edited-fill', '#fff1b8'),
      insertedFill: insertedRowHighlightColor ?? readThemeColor(themeStyles, '--rvg-color-inserted-fill', '#c8ead4'),
      columnDropTargetFill: readThemeColor(themeStyles, '--rvg-color-column-drop-target-fill', '#eeeeee'),
      stripe: stripedColor ?? readThemeColor(themeStyles, '--rvg-color-stripe', '#fafbfc'),
    };
    const scroll = scrollRef.current;
    const rowScrollTop = fixedHeader ? scroll.top : Math.max(0, scroll.top - bodyTop);
    const range = isVirtualized
      ? getViewportRange(scroll.left, rowScrollTop, viewport.width, bodyViewportHeight, rows.length, rowHeight, metrics, virtualOverscan)
      : { rowStart: 0, rowEnd: rows.length, columnStart: 0, columnEnd: columns.length };
    paintGrid({ context, width: viewport.width, height: renderHeight, pixelRatio: ratio, scrollLeft: scroll.left, scrollTop: scroll.top, rowHeight, headerHeight, headerLeafTop, headerLeafHeight, bodyTop, suppressLastRowBottomBorder: bottomSummaryHeight > 0, suppressFrameBottomBorder: bottomSummaryHeight > 0, fixedHeader, verticalBorderless: !hasVerticalBorders, striped: hasStripedRows, columnDraggable, sortState, filterValues, hoveredHeaderAction: hoveredHeaderActionRef.current, rows, columns, metrics, range, selection, editing, hoveredRowIndex: hoveredRowIndexRef.current, selectionRange, selectedRowKeys: selectedRowKeySet, rowSelectionMode, selectedColumnKeys: selectedColumnKeySet, cellSpans: cellSpanLookup.covered, maxRowSpan: cellSpanLookup.maxRowSpan, highlightEditedCells: highlightsEditedCells, highlightInsertedRows: highlightsInsertedRows, insertedRowKeys: insertedRowKeySet, editedCellKeys, cellAnnotations, getRowKey, rowDragPreview, columnDropTarget, colors: themeColors });
  }, [bodyTop, bodyViewportHeight, bottomSummaryHeight, cellAnnotations, cellSpanLookup, columnDraggable, columnDropTarget, columns, editedCellHighlightColor, editedCellKeys, editing, renderHeight, filterValues, fixedHeader, getRowKey, hasStripedRows, hasVerticalBorders, headerDepth, headerHeight, headerLeafHeight, headerLeafTop, highlightsEditedCells, highlightsInsertedRows, insertedRowHighlightColor, insertedRowKeySet, isVirtualized, metrics, rowDragPreview, rowHeight, rowSelectionMode, rows, selectedColumnKeySet, selectedRowKeySet, selection, selectionRange, sortState, stripedColor, viewport.width, virtualOverscan]);

  // Canvas work is scheduled with requestAnimationFrame so scroll and hover can
  // update quickly without forcing a synchronous repaint on every pointer event.
  const scheduleDraw = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const drawImmediately = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    draw();
  }, [draw]);

  const getSelectionHorizontalVisibility = useCallback((scrollLeft: number) => {
    if (!selection || selectionRange) return 'visible';
    const column = columns[selection.columnIndex];
    if (!column || column.fixed !== undefined) return 'visible';
    const span = getCellSpan(selection.rowIndex, selection.columnIndex);
    const left = getScrollableColumnLeft(selection.columnIndex) - scrollLeft;
    const right = left + getCellDisplayWidth(selection.columnIndex, span?.colSpan ?? 1);
    if (right <= fixedWidth) return 'hidden-left';
    if (left >= viewport.width - rightFixedWidth) return 'hidden-right';
    return 'visible';
  }, [columns, fixedWidth, getCellDisplayWidth, getCellSpan, getScrollableColumnLeft, rightFixedWidth, selection, selectionRange, viewport.width]);

  const getSelectionEdgeIndicator = useCallback((scrollLeft: number, scrollTop: number): SelectionEdgeIndicator | null => {
    if (!selection || selectionRange) return null;
    const row = rows[selection.rowIndex];
    const metric = metrics[selection.columnIndex];
    const column = columns[selection.columnIndex];
    if (!row || !metric || !column || getRowKey(row, selection.rowIndex) !== selection.rowKey) return null;
    const span = getCellSpan(selection.rowIndex, selection.columnIndex);
    const rawLeft = column.fixed === 'left'
      ? leftFixedOffsets.get(selection.columnIndex) ?? 0
      : column.fixed === 'right'
        ? viewport.width - (rightFixedOffsets.get(selection.columnIndex) ?? 0) - metric.width
        : getScrollableColumnLeft(selection.columnIndex) - scrollLeft;
    const rawRight = rawLeft + getCellDisplayWidth(selection.columnIndex, span?.colSpan ?? 1);
    const rawTop = bodyTop + selection.rowIndex * rowHeight - scrollTop;
    const rawBottom = rawTop + rowHeight * (span?.rowSpan ?? 1);
    const horizontalStart = column.fixed === undefined ? fixedWidth : 0;
    const horizontalEnd = column.fixed === undefined ? viewport.width - rightFixedWidth : viewport.width;
    const verticalStart = fixedHeader ? bodyTop : 0;
    const hiddenLeft = column.fixed === undefined && rawRight <= horizontalStart;
    const hiddenRight = column.fixed === undefined && rawLeft >= horizontalEnd;
    const hiddenTop = rawBottom <= verticalStart;
    const hiddenBottom = rawTop >= renderHeight;
    if (!hiddenLeft && !hiddenRight && !hiddenTop && !hiddenBottom) return null;

    const borderWidth = 2;
    const cornerLength = 10;
    const hitSlop = 6;
    const targetSize = borderWidth + hitSlop * 2;
    const rightBoundaryInset = rightFixedWidth > 0 && hasVerticalBorders ? 1 : 0;
    const markerX = hiddenLeft
      ? horizontalStart
      : horizontalEnd - borderWidth - rightBoundaryInset;
    const markerY = hiddenTop ? verticalStart : renderHeight - borderWidth;

    if (hiddenLeft || hiddenRight) {
      let markerTop = Math.max(rawTop - borderWidth, verticalStart);
      let markerBottom = Math.min(rawBottom + 1, renderHeight);
      const topClip = Math.max(0, verticalStart - (rawTop - borderWidth));
      const bottomClip = Math.max(0, rawBottom + 1 - renderHeight);
      if (topClip > 0 || bottomClip > 0) {
        const foldAtTop = topClip > 0;
        const fold = Math.min(cornerLength, foldAtTop ? topClip : bottomClip);
        if (fold > borderWidth) {
          const cornerWidth = fold;
          const cornerHeight = Math.max(cornerLength, markerBottom - markerTop);
          const cornerOnLeft = hiddenLeft;
          const shapeLeft = cornerOnLeft ? markerX : markerX + borderWidth - cornerWidth;
          const shapeTop = foldAtTop ? verticalStart : renderHeight - cornerHeight;
          return {
            side: `${foldAtTop ? 'top' : 'bottom'}-${cornerOnLeft ? 'left' : 'right'}`,
            orientation: 'corner',
            style: {
              left: shapeLeft - hitSlop,
              top: shapeTop - hitSlop,
              width: cornerWidth + hitSlop * 2,
              height: cornerHeight + hitSlop * 2,
            },
            corner: { width: cornerWidth, height: cornerHeight },
          };
        }
      }
      if (markerBottom <= markerTop) return null;
      return {
        side: hiddenLeft ? 'left' : 'right',
        orientation: 'vertical',
        viewportEdge: hiddenLeft && horizontalStart === 0
          ? 'left'
          : hiddenRight && horizontalEnd === viewport.width
            ? 'right'
            : undefined,
        style: {
          left: markerX - hitSlop,
          top: markerTop,
          width: targetSize,
          height: markerBottom - markerTop,
        },
      };
    }
    const horizontalMarkerEnd = horizontalEnd - rightBoundaryInset;
    let markerLeft = Math.max(rawLeft - borderWidth, horizontalStart);
    let markerRight = Math.min(rawRight + 1, horizontalMarkerEnd);
    const leftClip = Math.max(0, horizontalStart - (rawLeft - borderWidth));
    const rightClip = Math.max(0, rawRight + 1 - horizontalMarkerEnd);
    if (leftClip > 0 || rightClip > 0) {
      const foldAtLeft = leftClip > 0;
      const fold = Math.min(cornerLength, foldAtLeft ? leftClip : rightClip);
      if (fold > borderWidth) {
        const cornerWidth = Math.max(cornerLength, markerRight - markerLeft);
        const cornerHeight = fold;
        const shapeLeft = foldAtLeft ? horizontalStart : horizontalMarkerEnd - cornerWidth;
        const shapeTop = hiddenTop ? verticalStart : renderHeight - cornerHeight;
        return {
          side: `${hiddenTop ? 'top' : 'bottom'}-${foldAtLeft ? 'left' : 'right'}`,
          orientation: 'corner',
          style: {
            left: shapeLeft - hitSlop,
            top: shapeTop - hitSlop,
            width: cornerWidth + hitSlop * 2,
            height: cornerHeight + hitSlop * 2,
          },
          corner: { width: cornerWidth, height: cornerHeight },
        };
      }
    }
    if (markerRight <= markerLeft) return null;
    return {
      side: hiddenTop ? 'top' : 'bottom',
      orientation: 'horizontal',
      viewportEdge: hiddenTop && verticalStart === 0 ? 'top' : hiddenBottom ? 'bottom' : undefined,
      style: {
        left: markerLeft,
        top: markerY - hitSlop,
        width: markerRight - markerLeft,
        height: targetSize,
      },
    };
  }, [bodyTop, columns, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getRowKey, getScrollableColumnLeft, hasVerticalBorders, leftFixedOffsets, metrics, renderHeight, rightFixedOffsets, rightFixedWidth, rowHeight, rows, selection, selectionRange, viewport.width]);

  const syncSelectionEdgeTarget = useCallback((scrollLeft: number, scrollTop: number) => {
    const target = selectionEdgeTargetRef.current;
    if (!target) return;
    const indicator = getSelectionEdgeIndicator(scrollLeft, scrollTop);
    if (!indicator) {
      target.style.visibility = 'hidden';
      return;
    }
    const orientationChanged = !target.classList.contains(`is-${indicator.orientation}`);
    target.className = `rvg-selection-edge-target is-${indicator.orientation} is-${indicator.side}${indicator.viewportEdge ? ` is-viewport-${indicator.viewportEdge}` : ''}${orientationChanged ? ' is-shape-syncing' : ''}`;
    target.style.left = `${Number(indicator.style.left)}px`;
    target.style.top = `${Number(indicator.style.top)}px`;
    target.style.width = `${Number(indicator.style.width)}px`;
    target.style.height = `${Number(indicator.style.height)}px`;
    if (indicator.corner) {
      target.style.setProperty('--rvg-corner-width', `${indicator.corner.width}px`);
      target.style.setProperty('--rvg-corner-height', `${indicator.corner.height}px`);
      target.style.setProperty('--rvg-corner-hover-width-extension', '4px');
      target.style.setProperty('--rvg-corner-hover-height-extension', '4px');
    } else {
      target.style.removeProperty('--rvg-corner-width');
      target.style.removeProperty('--rvg-corner-height');
      target.style.removeProperty('--rvg-corner-hover-width-extension');
      target.style.removeProperty('--rvg-corner-hover-height-extension');
    }
    target.style.visibility = 'visible';
    if (orientationChanged) {
      void target.offsetWidth;
      target.classList.remove('is-shape-syncing');
    }
  }, [getSelectionEdgeIndicator]);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const update = () => {
      const measuredHeight = element.clientHeight || (typeof height === 'number' ? height : FALLBACK_HEIGHT);
      setViewport({ width: element.clientWidth, height: measuredHeight });
      setHorizontalScrollbarHeight(Math.max(0, element.offsetHeight - element.clientHeight));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  useEffect(() => {
    scheduleDraw();
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleDraw]);

  useEffect(() => () => {
    if (textFrameRef.current !== null) cancelAnimationFrame(textFrameRef.current);
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    if (verticalScrollbarVisibilityTimerRef.current !== null) clearTimeout(verticalScrollbarVisibilityTimerRef.current);
    if (horizontalScrollbarVisibilityTimerRef.current !== null) clearTimeout(horizontalScrollbarVisibilityTimerRef.current);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const containHorizontalOverscroll = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const atStart = scroller.scrollLeft <= 0 && event.deltaX < 0;
      const atEnd = scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1 && event.deltaX > 0;
      if (atStart || atEnd) event.preventDefault();
    };
    scroller.addEventListener('wheel', containHorizontalOverscroll, { passive: false });
    return () => scroller.removeEventListener('wheel', containHorizontalOverscroll);
  }, []);

  useEffect(() => {
    if (!filterEditor) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterEditor(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [filterEditor]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!confirmAction) setConfirmLoading(false);
  }, [confirmAction]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !insertBusy) return;
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    const lockScroll = () => {
      scroller.scrollLeft = left;
      scroller.scrollTop = top;
    };
    scroller.addEventListener('scroll', lockScroll);
    return () => scroller.removeEventListener('scroll', lockScroll);
  }, [insertBusy]);

  const showCustomScrollbar = useCallback((axis: 'vertical' | 'horizontal' | 'both', persist = false) => {
    const showVertical = axis === 'vertical' || axis === 'both';
    const showHorizontal = axis === 'horizontal' || axis === 'both';
    if (showVertical) {
      verticalScrollbarRef.current?.classList.add('is-active');
      if (verticalScrollbarVisibilityTimerRef.current !== null) clearTimeout(verticalScrollbarVisibilityTimerRef.current);
      if (!persist) {
        verticalScrollbarVisibilityTimerRef.current = setTimeout(() => {
          verticalScrollbarRef.current?.classList.remove('is-active');
          verticalScrollbarVisibilityTimerRef.current = null;
        }, 900);
      }
    }
    if (showHorizontal) {
      horizontalScrollbarRef.current?.classList.add('is-active');
      if (horizontalScrollbarVisibilityTimerRef.current !== null) clearTimeout(horizontalScrollbarVisibilityTimerRef.current);
      if (!persist) {
        horizontalScrollbarVisibilityTimerRef.current = setTimeout(() => {
          horizontalScrollbarRef.current?.classList.remove('is-active');
          horizontalScrollbarVisibilityTimerRef.current = null;
        }, 900);
      }
    }
  }, []);

  const keepCustomScrollbarVisible = useCallback((axis: 'vertical' | 'horizontal') => {
    showCustomScrollbar(axis, true);
  }, [showCustomScrollbar]);

  const releaseCustomScrollbarVisible = useCallback((axis: 'vertical' | 'horizontal') => {
    if (axis === 'vertical' && verticalScrollbarDragRef.current) return;
    if (axis === 'horizontal' && horizontalScrollbarDragRef.current) return;
    showCustomScrollbar(axis);
  }, [showCustomScrollbar]);

  const updateCustomScrollbars = useCallback(() => {
    const scroller = scrollerRef.current;
    const verticalTrack = verticalScrollbarRef.current;
    const verticalThumb = verticalScrollbarThumbRef.current;
    const horizontalTrack = horizontalScrollbarRef.current;
    const horizontalThumb = horizontalScrollbarThumbRef.current;
    if (!scroller || !verticalTrack || !verticalThumb || !horizontalTrack || !horizontalThumb) return;
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    const contentFitsAutoHeight = autoHeight && effectiveHeight >= realContentHeight - 1;
    if (contentFitsAutoHeight || maxScrollTop <= 1 || renderHeight <= 0) {
      verticalTrack.style.display = 'none';
    } else {
      const top = fixedHeader ? bodyTop : 0;
      const bottom = bottomSummaryHeight;
      const trackHeight = Math.max(0, effectiveHeight - top - bottom);
      if (trackHeight <= 0) {
        verticalTrack.style.display = 'none';
      } else {
        const thumbHeight = Math.max(28, Math.round(trackHeight * (scroller.clientHeight / scroller.scrollHeight)));
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        const thumbTop = maxScrollTop > 0 ? Math.round((scroller.scrollTop / maxScrollTop) * maxThumbTop) : 0;
        verticalTrack.style.display = 'block';
        verticalTrack.style.top = `${top}px`;
        verticalTrack.style.bottom = `${bottom}px`;
        verticalThumb.style.height = `${Math.min(trackHeight, thumbHeight)}px`;
        verticalThumb.style.transform = `translateY(${thumbTop}px)`;
      }
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    if (maxScrollLeft <= 1 || viewport.width <= 0) {
      horizontalTrack.style.display = 'none';
      return;
    }
    const trackLeft = fixedWidth;
    const trackRight = rightFixedWidth;
    const trackWidth = Math.max(0, viewport.width - trackLeft - trackRight);
    if (trackWidth <= 0) {
      horizontalTrack.style.display = 'none';
      return;
    }
    const thumbWidth = Math.max(36, Math.round(trackWidth * (scroller.clientWidth / scroller.scrollWidth)));
    const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
    const thumbLeft = maxScrollLeft > 0 ? Math.round((scroller.scrollLeft / maxScrollLeft) * maxThumbLeft) : 0;
    horizontalTrack.style.display = 'block';
    horizontalTrack.style.left = `${trackLeft}px`;
    horizontalTrack.style.right = `${trackRight}px`;
    horizontalTrack.style.bottom = `${bottomSummaryHeight + 2}px`;
    horizontalThumb.style.width = `${Math.min(trackWidth, thumbWidth)}px`;
    horizontalThumb.style.transform = `translateX(${thumbLeft}px)`;
  }, [autoHeight, bodyTop, bottomSummaryHeight, effectiveHeight, fixedHeader, fixedWidth, realContentHeight, renderHeight, rightFixedWidth, viewport.width]);

  useLayoutEffect(() => {
    updateCustomScrollbars();
  }, [contentHeight, contentWidth, updateCustomScrollbars, viewport.height, viewport.width]);

  const handleVerticalScrollbarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    const track = verticalScrollbarRef.current;
    const thumb = verticalScrollbarThumbRef.current;
    if (!scroller || !track || !thumb || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    const trackHeight = trackRect.height;
    const thumbHeight = thumbRect.height;
    showCustomScrollbar('vertical', true);
    if (event.target === thumb) {
      verticalScrollbarDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startTop: thumbRect.top - trackRect.top,
        trackHeight,
        thumbHeight,
        maxScrollTop,
      };
      return;
    }
    const nextThumbTop = Math.max(0, Math.min(trackHeight - thumbHeight, event.clientY - trackRect.top - thumbHeight / 2));
    const maxThumbTop = Math.max(1, trackHeight - thumbHeight);
    scroller.scrollTop = (nextThumbTop / maxThumbTop) * maxScrollTop;
    updateCustomScrollbars();
    verticalScrollbarDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: nextThumbTop,
      trackHeight,
      thumbHeight,
      maxScrollTop,
    };
  }, [showCustomScrollbar, updateCustomScrollbars]);

  const handleVerticalScrollbarPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = verticalScrollbarDragRef.current;
    const scroller = scrollerRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const maxThumbTop = Math.max(1, drag.trackHeight - drag.thumbHeight);
    const nextThumbTop = Math.max(0, Math.min(maxThumbTop, drag.startTop + event.clientY - drag.startY));
    scroller.scrollTop = (nextThumbTop / maxThumbTop) * drag.maxScrollTop;
    updateCustomScrollbars();
  }, [updateCustomScrollbars]);

  const handleVerticalScrollbarPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = verticalScrollbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    verticalScrollbarDragRef.current = null;
    showCustomScrollbar('vertical');
  }, [showCustomScrollbar]);

  const handleHorizontalScrollbarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    const track = horizontalScrollbarRef.current;
    const thumb = horizontalScrollbarThumbRef.current;
    if (!scroller || !track || !thumb || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    const trackWidth = trackRect.width;
    const thumbWidth = thumbRect.width;
    showCustomScrollbar('horizontal', true);
    if (event.target === thumb) {
      horizontalScrollbarDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: thumbRect.left - trackRect.left,
        trackWidth,
        thumbWidth,
        maxScrollLeft,
      };
      return;
    }
    const nextThumbLeft = Math.max(0, Math.min(trackWidth - thumbWidth, event.clientX - trackRect.left - thumbWidth / 2));
    const maxThumbLeft = Math.max(1, trackWidth - thumbWidth);
    const previousScrollLeft = scroller.scrollLeft;
    const nextScrollLeft = (nextThumbLeft / maxThumbLeft) * maxScrollLeft;
    const visibilityChanged = getSelectionHorizontalVisibility(previousScrollLeft) !== getSelectionHorizontalVisibility(nextScrollLeft);
    scroller.scrollLeft = nextScrollLeft;
    scrollRef.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
    syncSelectionEdgeTarget(scroller.scrollLeft, scroller.scrollTop);
    if (visibilityChanged) drawImmediately();
    updateCustomScrollbars();
    horizontalScrollbarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: nextThumbLeft,
      trackWidth,
      thumbWidth,
      maxScrollLeft,
    };
  }, [drawImmediately, getSelectionHorizontalVisibility, showCustomScrollbar, syncSelectionEdgeTarget, updateCustomScrollbars]);

  const handleHorizontalScrollbarPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = horizontalScrollbarDragRef.current;
    const scroller = scrollerRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const maxThumbLeft = Math.max(1, drag.trackWidth - drag.thumbWidth);
    const nextThumbLeft = Math.max(0, Math.min(maxThumbLeft, drag.startLeft + event.clientX - drag.startX));
    const previousScrollLeft = scroller.scrollLeft;
    const nextScrollLeft = (nextThumbLeft / maxThumbLeft) * drag.maxScrollLeft;
    const visibilityChanged = getSelectionHorizontalVisibility(previousScrollLeft) !== getSelectionHorizontalVisibility(nextScrollLeft);
    scroller.scrollLeft = nextScrollLeft;
    scrollRef.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
    syncSelectionEdgeTarget(scroller.scrollLeft, scroller.scrollTop);
    if (visibilityChanged) drawImmediately();
    updateCustomScrollbars();
  }, [drawImmediately, getSelectionHorizontalVisibility, syncSelectionEdgeTarget, updateCustomScrollbars]);

  const handleHorizontalScrollbarPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = horizontalScrollbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    horizontalScrollbarDragRef.current = null;
    showCustomScrollbar('horizontal');
  }, [showCustomScrollbar]);

  const handleScroll = useCallback(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const previousScroll = scrollRef.current;
    const scrollDeltaX = element.scrollLeft - previousScroll.left;
    const scrollDeltaY = element.scrollTop - previousScroll.top;
    scrollRef.current = { left: element.scrollLeft, top: element.scrollTop };
    syncSelectionEdgeTarget(element.scrollLeft, element.scrollTop);
    const focus = selectionFocusRef.current;
    if (focus && selection && !selectionRange) {
      const row = rows[selection.rowIndex];
      const metric = metrics[selection.columnIndex];
      const column = columns[selection.columnIndex];
      const validSelection = row && metric && column && getRowKey(row, selection.rowIndex) === selection.rowKey;
      if (!validSelection) {
        focus.style.display = 'none';
      } else {
        const rawLeft = column.fixed === 'left'
          ? leftFixedOffsets.get(selection.columnIndex) ?? 0
          : column.fixed === 'right'
            ? viewport.width - (rightFixedOffsets.get(selection.columnIndex) ?? 0) - metric.width
            : getScrollableColumnLeft(selection.columnIndex) - element.scrollLeft;
        const rawTop = bodyTop + selection.rowIndex * rowHeight - element.scrollTop;
        const span = getCellSpan(selection.rowIndex, selection.columnIndex);
        const rawRight = rawLeft + getCellDisplayWidth(selection.columnIndex, span?.colSpan ?? 1);
        const rawBottom = rawTop + rowHeight * (span?.rowSpan ?? 1);
        const horizontalStart = column.fixed === undefined ? fixedWidth : 0;
        const horizontalEnd = column.fixed === undefined ? viewport.width - rightFixedWidth : viewport.width;
        const verticalStart = fixedHeader ? bodyTop : 0;
        if (rawRight <= horizontalStart || rawLeft >= horizontalEnd || rawBottom <= verticalStart || rawTop >= renderHeight) {
          focus.style.display = 'none';
        } else {
          const borderWidth = 2;
          const left = Math.round(Math.max(rawLeft - borderWidth, horizontalStart));
          const right = Math.round(Math.min(rawRight + 1, horizontalEnd, viewport.width));
          const top = Math.round(Math.max(rawTop - borderWidth, verticalStart));
          const bottom = Math.round(Math.min(rawBottom + 1, renderHeight));
          focus.style.display = 'block';
          focus.style.left = `${left}px`;
          focus.style.top = `${top}px`;
          focus.style.width = `${Math.max(0, right - left)}px`;
          focus.style.height = `${Math.max(0, bottom - top)}px`;
        }
      }
    }
    if (textFrameRef.current === null) {
      textFrameRef.current = requestAnimationFrame(() => {
        textFrameRef.current = null;
        setScrollPosition({ ...scrollRef.current });
      });
    }
    if (scrollingTextRef.current) scrollingTextRef.current.style.transform = `translateX(${-element.scrollLeft}px)`;
    if (scrollingHeaderIconsRef.current) scrollingHeaderIconsRef.current.style.transform = `translateX(${-element.scrollLeft}px)`;
    if (headerIconsRef.current) headerIconsRef.current.style.transform = `translateY(${fixedHeader ? 0 : -element.scrollTop}px)`;
    updateCustomScrollbars();
    if (scrollDeltaX !== 0 || scrollDeltaY !== 0) {
      showCustomScrollbar(scrollDeltaX !== 0 && scrollDeltaY !== 0 ? 'both' : scrollDeltaX !== 0 ? 'horizontal' : 'vertical');
    }
    if (hoveredHeaderActionRef.current) {
      hoveredHeaderActionRef.current = null;
      setHoveredHeaderAction(null);
    }
    setHoveredCellTooltip(null);
    scheduleDraw();
    setEditing(null);
  }, [bodyTop, columns, renderHeight, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getRowKey, getScrollableColumnLeft, metrics, rightFixedOffsets, rightFixedWidth, rowHeight, rows, scheduleDraw, selection, selectionRange, showCustomScrollbar, syncSelectionEdgeTarget, updateCustomScrollbars, viewport.width]);

  const locateColumn = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    let columnIndex: number;
    if (localX < fixedWidth) {
      columnIndex = columns.findIndex((column, index) => {
        if (column.fixed !== 'left') return false;
        const left = leftFixedOffsets.get(index) ?? 0;
        return localX >= left && localX < left + metrics[index].width;
      });
    } else if (rightFixedWidth > 0 && localX >= viewport.width - rightFixedWidth) {
      columnIndex = columns.findIndex((column, index) => {
        if (column.fixed !== 'right') return false;
        const left = viewport.width - (rightFixedOffsets.get(index) ?? 0) - metrics[index].width;
        return localX >= left && localX < left + metrics[index].width;
      });
    } else {
      const scrollX = localX + scrollRef.current.left;
      columnIndex = columns.findIndex((column, index) => {
        if (column.fixed !== undefined) return false;
        const left = getScrollableColumnLeft(index);
        return scrollX >= left && scrollX < left + metrics[index].width;
      });
    }
    return columnIndex;
  }, [columns, fixedWidth, getScrollableColumnLeft, leftFixedOffsets, metrics, rightFixedOffsets, rightFixedWidth, viewport.width]);

  const getDisplayedColumnLeft = useCallback((columnIndex: number) => {
    const metric = metrics[columnIndex];
    if (columns[columnIndex].fixed === 'left') return leftFixedOffsets.get(columnIndex) ?? 0;
    if (columns[columnIndex].fixed === 'right') return viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metric.width;
    return getScrollableColumnLeft(columnIndex) - scrollRef.current.left;
  }, [columns, getScrollableColumnLeft, leftFixedOffsets, metrics, rightFixedOffsets, viewport.width]);

  const getHeaderLevelAtY = useCallback((localY: number, headerY: number) => {
    const y = localY - headerY;
    for (let level = 0; level < headerRowHeights.length; level += 1) {
      const top = headerRowOffsets[level] ?? 0;
      if (y >= top && y < top + headerRowHeights[level]) return level;
    }
    return headerDepth - 1;
  }, [headerDepth, headerRowHeights, headerRowOffsets]);

  const resizeColumn = useCallback((columnKey: string, width: number) => {
    setResizedColumnWidths((current) => (
      current[columnKey] === width ? current : { ...current, [columnKey]: width }
    ));
    onColumnResize?.(columnKey, width);
  }, [onColumnResize]);

  const locateHeaderAction = useCallback((clientX: number, columnIndex: number): 'sort' | 'filter' | null => {
    if (columnIndex < 0 || !canvasRef.current) return null;
    const column = columns[columnIndex];
    if (column.rowSelection || column.rowDragHandle || column.rowNumber) return null;
    const localX = clientX - canvasRef.current.getBoundingClientRect().left;
    const columnRight = getDisplayedColumnLeft(columnIndex) + metrics[columnIndex].width;
    const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
    let right = columnRight - (visibleActions.drag ? HEADER_ACTION_SLOT_WIDTH : 2);
    if (visibleActions.sort) {
      if (localX >= right - HEADER_ACTION_SLOT_WIDTH && localX < right) return 'sort';
      right -= HEADER_ACTION_SLOT_WIDTH;
    }
    if (visibleActions.filter && localX >= right - HEADER_ACTION_SLOT_WIDTH && localX < right) return 'filter';
    return null;
  }, [columnDraggable, columns, getDisplayedColumnLeft, measureHeaderTitleWidth, metrics]);

  const isHeaderTitleTruncated = useCallback((columnIndex: number): boolean => {
    const canvas = canvasRef.current;
    if (columnIndex < 0 || !canvas) return false;
    const column = columns[columnIndex];
    const metric = metrics[columnIndex];
    const titleWidth = measureHeaderTitleWidth(columnIndex);
    const visibleActions = getVisibleHeaderActions(column, metric.width, columnDraggable, titleWidth);
    const actionWidth = (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * HEADER_ACTION_SLOT_WIDTH;
    return getHeaderTitleRequiredWidth(column, titleWidth) > Math.max(0, metric.width - actionWidth);
  }, [columnDraggable, columns, measureHeaderTitleWidth, metrics]);

  const locateHeaderDragHandle = useCallback((clientX: number, columnIndex: number): boolean => {
    if (!columnDraggable || columnIndex < 0 || !canvasRef.current) return false;
    const column = columns[columnIndex];
    if (column.rowSelection || column.rowDragHandle || column.rowNumber) return false;
    if (!getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex)).drag) return false;
    const localX = clientX - canvasRef.current.getBoundingClientRect().left;
    const columnRight = getDisplayedColumnLeft(columnIndex) + metrics[columnIndex].width;
    return localX >= columnRight - 16 && localX < columnRight - 5;
  }, [columnDraggable, columns, getDisplayedColumnLeft, measureHeaderTitleWidth, metrics]);

  const getHeaderCellLeft = useCallback((cell: HeaderCell<Row>) => {
    const startMetric = metrics[cell.startIndex];
    const fixedSide = columns[cell.startIndex]?.fixed;
    if (!startMetric) return 0;
    return fixedSide === 'left'
      ? leftFixedOffsets.get(cell.startIndex) ?? 0
      : fixedSide === 'right'
        ? viewport.width - (rightFixedOffsets.get(cell.startIndex) ?? 0) - startMetric.width
        : getScrollableColumnLeft(cell.startIndex) - scrollRef.current.left;
  }, [columns, getScrollableColumnLeft, leftFixedOffsets, metrics, rightFixedOffsets, viewport.width]);

  const getHeaderCellWidth = useCallback((cell: HeaderCell<Row>) => (
    cell.leaf
      ? metrics[cell.startIndex]?.width ?? 0
      : getCellDisplayWidth(cell.startIndex, cell.endIndex - cell.startIndex + 1)
  ), [getCellDisplayWidth, metrics]);

  const getHeaderCellEdgeFromMetrics = useCallback((
    startIndex: number,
    endIndex: number,
    edge: 'left' | 'right',
    nextMetrics: typeof metrics,
  ) => {
    const fixedSide = columns[startIndex]?.fixed;
    const width = nextMetrics
      .slice(startIndex, endIndex + 1)
      .reduce((total, metric) => total + metric.width, 0);
    let left: number;
    if (fixedSide === 'left') {
      left = 0;
      for (let index = 0; index < startIndex; index += 1) {
        if (columns[index].fixed === 'left') left += nextMetrics[index]?.width ?? 0;
      }
    } else if (fixedSide === 'right') {
      let rightOffset = 0;
      for (let index = columns.length - 1; index > startIndex; index -= 1) {
        if (columns[index].fixed === 'right') rightOffset += nextMetrics[index]?.width ?? 0;
      }
      left = viewport.width - rightOffset - width;
    } else {
      left = 0;
      for (let index = 0; index < startIndex; index += 1) {
        if (columns[index].fixed === undefined) left += nextMetrics[index]?.width ?? 0;
      }
      left += fixedWidth - scrollRef.current.left;
    }
    return left + (edge === 'right' ? width : 0);
  }, [columns, fixedWidth, viewport.width]);

  const locateHeaderResizeHit = useCallback((clientX: number, clientY: number): HeaderResizeHit<Row> | null => {
    if (!columnResizable || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const headerY = fixedHeader ? 0 : -scrollRef.current.top;
    if (localY < headerY || localY >= headerY + headerHeight) return null;
    const level = getHeaderLevelAtY(localY, headerY);
    let closest: HeaderResizeHit<Row> | null = null;
    let distance = 6;
    let priority = -1;
    for (const cell of headerCells) {
      if (cell.level !== level) continue;
      if (columns[cell.startIndex]?.rowSelection || columns[cell.startIndex]?.rowDragHandle || columns[cell.startIndex]?.rowNumber) continue;
      const fixedSide = columns[cell.startIndex]?.fixed;
      const edge = fixedSide === 'right' && cell.leaf ? 'left' : 'right';
      const edgeX = getHeaderCellLeft(cell) + (edge === 'right' ? getHeaderCellWidth(cell) : 0);
      const nextDistance = Math.abs(localX - edgeX);
      const nextPriority = fixedSide === 'right' ? 2 : fixedSide === 'left' ? 1 : 0;
      if (nextDistance < distance || (nextDistance === distance && nextPriority > priority)) {
        distance = nextDistance;
        priority = nextPriority;
        closest = { cell, edge };
      }
    }
    return closest;
  }, [columnResizable, columns, fixedHeader, getHeaderCellLeft, getHeaderCellWidth, getHeaderLevelAtY, headerCells, headerHeight]);

  const locateHeaderResizeCell = useCallback((clientX: number, clientY: number): HeaderCell<Row> | null => (
    locateHeaderResizeHit(clientX, clientY)?.cell ?? null
  ), [locateHeaderResizeHit]);

  const locateHeaderCellDragHandle = useCallback((clientX: number, cell: HeaderCell<Row>): boolean => {
    if (!columnDraggable || !canvasRef.current) return false;
    if (cell.leaf) return locateHeaderDragHandle(clientX, cell.startIndex);
    const localX = clientX - canvasRef.current.getBoundingClientRect().left;
    const right = getHeaderCellLeft(cell) + getHeaderCellWidth(cell);
    return localX >= right - 16 && localX < right - 5;
  }, [columnDraggable, getHeaderCellLeft, getHeaderCellWidth, locateHeaderDragHandle]);

  const locateHeaderCell = useCallback((clientX: number, clientY: number): HeaderCell<Row> | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const headerY = fixedHeader ? 0 : -scrollRef.current.top;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localY < headerY || localY >= headerY + headerHeight) return null;
    const level = getHeaderLevelAtY(localY, headerY);
    for (const cell of headerCells) {
      if (cell.level !== level) continue;
      const left = getHeaderCellLeft(cell);
      const width = getHeaderCellWidth(cell);
      if (localX >= left && localX < left + width) return cell;
    }
    return null;
  }, [fixedHeader, getHeaderCellLeft, getHeaderCellWidth, getHeaderLevelAtY, headerCells, headerHeight]);

  const setDragGuide = useCallback((x: number | null, top = 0) => {
    const guide = dragGuideRef.current;
    if (!guide) return;
    guide.style.display = x === null ? 'none' : 'block';
    if (x !== null) {
      guide.style.top = `${top}px`;
      guide.style.transform = `translateX(${Math.round(x)}px)`;
    }
  }, []);

  const setRowDragGuide = useCallback((y: number | null) => {
    const guide = rowDragGuideRef.current;
    if (!guide) return;
    guide.style.display = y === null ? 'none' : 'block';
    if (y !== null) guide.style.transform = `translateY(${Math.round(y)}px)`;
  }, []);

  const locateRow = useCallback((clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const localY = clientY - canvas.getBoundingClientRect().top;
    const rowIndex = Math.floor((localY - bodyTop + scrollRef.current.top) / rowHeight);
    return rowIndex >= 0 && rowIndex < rows.length ? rowIndex : -1;
  }, [bodyTop, rowHeight, rows.length]);

  // Atlaskit pragmatic-drag-and-drop handles native drag gestures for both
  // columns and rows. The grid decides whether the pointer is on a valid drag
  // handle, then supplies lightweight DOM previews because the main UI is drawn
  // on canvas and cannot be used directly as a drag image.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (!columnDraggable && !rowDraggable)) return;
    const getColumnDropIndex = (sourceIndex: number, targetIndex: number, edge: unknown) => {
      if (edge === 'right') return targetIndex;
      const destinationIndex = targetIndex - (sourceIndex < targetIndex ? 1 : 0);
      return Math.max(0, Math.min(columns.length - 1, destinationIndex));
    };
    const getColumnDropPlacement = (sourceIndex: number, targetIndex: number, edge: unknown): 'before' | 'after' => {
      if (edge !== 'right') return 'before';
      return targetIndex < sourceIndex ? 'before' : 'after';
    };
    const getHeaderColumn = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const headerY = fixedHeader ? 0 : -scrollRef.current.top;
      const localY = clientY - rect.top;
      if (localY < headerY || localY >= headerY + headerHeight) return -1;
      return locateColumn(clientX);
    };
    const getHeaderDragCell = (clientX: number, clientY: number) => {
      const cell = locateHeaderCell(clientX, clientY);
      if (!cell) return null;
      return locateHeaderCellDragHandle(clientX, cell) && !locateHeaderResizeCell(clientX, clientY) ? cell : null;
    };
    const cleanupDrag = draggable({
      element: canvas,
      canDrag: ({ input }) => {
        // Header drags only start from the drag affordance, not from sort/filter
        // icons or resize handles. Row drags only start from a row drag column.
        const headerDragCell = columnDraggable ? getHeaderDragCell(input.clientX, input.clientY) : null;
        if (headerDragCell) return true;
        const columnIndex = locateColumn(input.clientX);
        return rowDraggable && columnIndex >= 0 && Boolean(columns[columnIndex].rowDragHandle) && locateRow(input.clientY) >= 0;
      },
      getInitialData: ({ input }) => {
        // The drag payload carries only indices. Drop validation later ensures
        // columns cannot move across fixed left/right/scrolling regions.
        const headerDragCell = columnDraggable ? getHeaderDragCell(input.clientX, input.clientY) : null;
        if (!headerDragCell) {
          return { type: 'table-row', sourceIndex: locateRow(input.clientY) };
        }
        const sourceIndex = headerDragCell.startIndex;
        columnDragPreviewRef.current = { sourceIndex, targetIndex: sourceIndex };
        validColumnDropRef.current = null;
        return {
          type: 'table-column',
          sourceIndex,
          sourceKey: headerDragCell.key,
          parentKey: headerDragCell.parentKey,
          headerLevel: headerDragCell.level,
          headerKind: headerDragCell.leaf ? 'column' : 'group',
          fixed: columns[headerDragCell.startIndex]?.fixed,
        };
      },
      onGenerateDragPreview: ({ nativeSetDragImage, source, location }) => {
        const sourceIndex = Number(source.data.sourceIndex);
        const canvasRect = canvas.getBoundingClientRect();
        const input = location.current.input;
        const previewOffset = source.data.type === 'table-row'
          ? {
              x: Math.max(0, Math.min(canvasRect.width, input.clientX - canvasRect.left)) + 2,
              y: Math.max(0, Math.min(rowHeight, input.clientY - canvasRect.top - bodyTop - sourceIndex * rowHeight + scrollRef.current.top)) + 2,
            }
          : {
              x: Math.max(0, Math.min(metrics[sourceIndex].width, input.clientX - canvasRect.left - getDisplayedColumnLeft(sourceIndex))),
              y: Math.max(0, Math.min(canvasRect.height, input.clientY - canvasRect.top)),
            };
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: () => previewOffset,
          render: ({ container }) => {
            if (source.data.type === 'table-row') {
              // Row previews show the full visible row width, including fixed
              // columns, so the dragged item resembles the row the user grabbed.
              const frame = document.createElement('div');
              frame.className = 'rvg-row-drag-preview-frame';
              frame.style.width = `${canvasRect.width + 4}px`;
              frame.style.height = `${rowHeight + 4}px`;
              const preview = document.createElement('div');
              preview.className = 'rvg-row-drag-preview';
              preview.style.width = `${canvasRect.width}px`;
              preview.style.height = `${rowHeight}px`;
              const row = rows[sourceIndex];
              const rowKey = getRowKey(row, sourceIndex);
              columns.forEach((column, columnIndex) => {
                const left = getDisplayedColumnLeft(columnIndex);
                const columnWidth = metrics[columnIndex].width;
                if (left + columnWidth <= 0 || left >= canvasRect.width) return;
                const cell = document.createElement('div');
                cell.className = 'rvg-row-drag-preview-cell';
                cell.style.left = `${left}px`;
                cell.style.width = `${columnWidth}px`;
                cell.style.justifyContent = column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start';
                if (column.rowDragHandle) {
                  cell.appendChild(createRowDragHandleSvg());
                } else if (column.rowSelection) {
                  const checkbox = document.createElement('span');
                  checkbox.className = selectedRowKeySet.has(rowKey) ? 'rvg-preview-checkbox is-checked' : 'rvg-preview-checkbox';
                  checkbox.textContent = selectedRowKeySet.has(rowKey) ? '✓' : '';
                  cell.appendChild(checkbox);
                } else {
                  cell.textContent = getCellLabel(sourceIndex, columnIndex);
                }
                if (selection?.rowKey === rowKey && selection.columnKey === column.key) {
                  cell.classList.add('is-selected');
                }
                preview.appendChild(cell);
              });
              frame.appendChild(preview);
              container.appendChild(frame);
              return () => frame.remove();
            }
            const preview = document.createElement('div');
            // Column previews show the dragged column from header through the
            // visible body rows, mirroring selection and edited-cell state.
            preview.className = 'rvg-column-drag-preview';
            const columnWidth = metrics[sourceIndex].width;
            preview.style.width = `${columnWidth}px`;
            preview.style.height = `${canvasRect.height}px`;
            const column = columns[sourceIndex];
            const header = document.createElement('div');
            header.className = 'rvg-column-drag-preview-header';
            header.style.top = `${fixedHeader ? 0 : -scrollRef.current.top}px`;
            header.style.height = `${headerHeight}px`;
            header.style.justifyContent = column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start';
            header.textContent = column.title;
            const visibleActions = getVisibleHeaderActions(column, columnWidth, columnDraggable, measureHeaderTitleWidth(sourceIndex));
            let actionRight = 2;
            if (visibleActions.drag) {
              const icon = createHeaderDragHandleSvg();
              icon.classList.add('rvg-preview-header-icon');
              icon.style.right = `${actionRight}px`;
              header.appendChild(icon);
              actionRight += HEADER_ACTION_SLOT_WIDTH;
            }
            if (visibleActions.sort) {
              const direction = sortState?.columnKey === column.key ? sortState.direction : null;
              const icon = createHeaderSortSvg(direction);
              icon.classList.add('rvg-preview-header-icon');
              icon.style.right = `${actionRight}px`;
              header.appendChild(icon);
              actionRight += HEADER_ACTION_SLOT_WIDTH;
            }
            if (visibleActions.filter) {
              const icon = createHeaderSearchSvg(Boolean(filterValues[column.key]));
              icon.classList.add('rvg-preview-header-icon', 'rvg-preview-header-search-icon');
              icon.style.right = `${actionRight}px`;
              header.appendChild(icon);
            }
            preview.appendChild(header);
            for (let rowIndex = domRange.rowStart; rowIndex < domRange.rowEnd; rowIndex += 1) {
              const row = rows[rowIndex];
              const rowKey = getRowKey(row, rowIndex);
              const cell = document.createElement('div');
              cell.className = 'rvg-column-drag-preview-cell';
              cell.style.top = `${bodyTop + rowIndex * rowHeight - scrollRef.current.top}px`;
              cell.style.height = `${rowHeight}px`;
              cell.style.justifyContent = column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start';
              const key = `${typeof rowKey}:${String(rowKey)}\u0000${column.key}`;
              if (selectedRowKeySet.has(rowKey) || selectedColumnKeySet.has(column.key)) {
                cell.classList.add('is-axis-selected');
              }
              if (!insertedRowKeys.has(rowKey) && editedCellKeys.has(key)) cell.classList.add('is-edited');
              if (selection?.rowKey === rowKey && selection.columnKey === column.key) {
                cell.classList.remove('is-edited');
                cell.classList.add('is-selected');
              }
              cell.textContent = getCellLabel(rowIndex, sourceIndex);
              preview.appendChild(cell);
            }
            container.appendChild(preview);
            return () => preview.remove();
          },
        });
      },
      onDragStart: ({ source }) => {
        suppressClickRef.current = true;
        hideDragTooltips();
        document.documentElement.classList.add('rvg-is-dragging');
        canvas.style.cursor = 'move';
        if (source.data.type === 'table-row') {
          const sourceIndex = Number(source.data.sourceIndex);
          setRowDragPreview({ sourceIndex, targetIndex: sourceIndex });
        }
      },
      onDrag: ({ source, location }) => {
        const target = location.current.dropTargets[0]?.data;
        const sourceIndex = Number(source.data.sourceIndex);
        if (source.data.type === 'table-row') {
          // Drop targets report the row plus top/bottom edge. Convert that into
          // the final insertion index, correcting for the source row disappearing
          // from its original location during the move.
          const rawTargetIndex = Number(target?.targetIndex);
          if (!Number.isInteger(rawTargetIndex)) {
            setRowDragPreview(null);
            return setRowDragGuide(null);
          }
          const edge = target?.rowEdge;
          let targetIndex = rawTargetIndex + (edge === 'bottom' ? 1 : 0);
          if (sourceIndex < targetIndex) targetIndex -= 1;
          targetIndex = Math.max(0, Math.min(rows.length - 1, targetIndex));
          setRowDragPreview((current) => current?.sourceIndex === sourceIndex && current.targetIndex === targetIndex ? current : { sourceIndex, targetIndex });
          setRowDragGuide(bodyTop + rawTargetIndex * rowHeight - scrollRef.current.top + (edge === 'bottom' ? rowHeight : 0));
          return;
        }
        const targetIndex = Number(target?.targetIndex);
        // Fixed columns are isolated groups. A left-fixed column can only move
        // within the left-fixed region, and the same rule applies to right-fixed
        // and normal scrolling columns.
        if (!Number.isInteger(targetIndex) || target?.headerKind !== source.data.headerKind || target?.parentKey !== source.data.parentKey || target?.fixed !== source.data.fixed) {
          validColumnDropRef.current = null;
          setColumnDropTarget(null);
          setDragGuide(null);
          return;
        }
        const edge = target?.columnEdge;
        const destinationIndex = getColumnDropIndex(sourceIndex, targetIndex, edge);
        columnDragPreviewRef.current = { sourceIndex, targetIndex: destinationIndex };
        if (destinationIndex === sourceIndex) {
          validColumnDropRef.current = null;
          setColumnDropTarget(null);
          setDragGuide(null);
          return;
        }
        validColumnDropRef.current = {
          sourceIndex,
          targetIndex: destinationIndex,
          rawTargetIndex: targetIndex,
          targetKey: String(target.targetKey),
          headerKind: source.data.headerKind === 'group' ? 'group' : 'column',
          parentKey: typeof source.data.parentKey === 'string' ? source.data.parentKey : undefined,
          fixed: source.data.fixed === 'left' || source.data.fixed === 'right' ? source.data.fixed : undefined,
          columnEdge: edge === 'right' ? 'right' : 'left',
        };
        const siblingCells = headerCells.filter((cell) => (
          cell.level === Number(source.data.headerLevel)
          && (cell.leaf ? 'column' : 'group') === source.data.headerKind
          && cell.parentKey === source.data.parentKey
          && columns[cell.startIndex]?.fixed === source.data.fixed
        ));
        const targetEndIndex = Number.isInteger(target?.targetEndIndex) ? Number(target.targetEndIndex) : targetIndex;
        const hoveredTargetCell = siblingCells.find((cell) => cell.startIndex === targetIndex && cell.endIndex === targetEndIndex);
        if (!hoveredTargetCell) {
          validColumnDropRef.current = null;
          setColumnDropTarget(null);
          setDragGuide(null);
          return;
        }
        const highlightedCell = edge === 'right'
          ? hoveredTargetCell
          : siblingCells
              .filter((cell) => cell.endIndex < hoveredTargetCell.startIndex)
              .sort((left, right) => right.endIndex - left.endIndex)[0] ?? hoveredTargetCell;
        setColumnDropTarget({ startIndex: highlightedCell.startIndex, endIndex: highlightedCell.endIndex });
        const targetLeft = Number(target?.targetLeft);
        const targetWidth = Number(target?.targetWidth);
        if (!Number.isFinite(targetLeft) || !Number.isFinite(targetWidth)) {
          validColumnDropRef.current = null;
          setColumnDropTarget(null);
          setDragGuide(null);
          return;
        }
        const guideTop = headerRowOffsets[Number(source.data.headerLevel)] ?? 0;
        setDragGuide(edge === 'right' ? targetLeft + targetWidth : targetLeft, guideTop);
      },
      onDrop: ({ source, location }) => {
        document.documentElement.classList.remove('rvg-is-dragging');
        const target = location.current.dropTargets[0]?.data;
        const sourceIndex = Number(source.data.sourceIndex);
        if (source.data.type === 'table-row') {
          // Keep the row text overlay from animating twice while the consumer
          // applies the row reorder. Two frames cover the native drop repaint and
          // the following React render.
          const rawTargetIndex = Number(target?.targetIndex);
          let targetIndex = rawTargetIndex + (target?.rowEdge === 'bottom' ? 1 : 0);
          if (sourceIndex < targetIndex) targetIndex -= 1;
          targetIndex = Math.max(0, Math.min(rows.length - 1, targetIndex));
          scrollerRef.current?.classList.add('rvg-row-drop-settling');
          setRowDragPreview(null);
          setRowDragGuide(null);
          canvas.style.cursor = 'default';
          if (Number.isInteger(rawTargetIndex) && sourceIndex !== targetIndex) applyRowOrder(sourceIndex, targetIndex);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollerRef.current?.classList.remove('rvg-row-drop-settling'));
          });
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
          return;
        }
        const validDrop = validColumnDropRef.current;
        canvas.style.cursor = 'default';
        setDragGuide(null);
        setColumnDropTarget(null);
        columnDragPreviewRef.current = null;
        validColumnDropRef.current = null;
        if (validDrop) {
          applyColumnOrder(
            validDrop.sourceIndex - utilityColumnCount,
            validDrop.targetIndex - utilityColumnCount,
            {
              type: validDrop.headerKind,
              sourceKey: String(source.data.sourceKey),
              targetKey: validDrop.targetKey,
              parentKey: validDrop.parentKey,
              placement: getColumnDropPlacement(validDrop.sourceIndex, validDrop.rawTargetIndex, validDrop.columnEdge),
            },
          );
        }
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      },
    });
    const cleanupDrop = dropTargetForElements({
      element: canvas,
      canDrop: ({ source }) => source.data.type === 'table-column' || source.data.type === 'table-row',
      getDropEffect: () => 'move',
      getData: ({ input, element, source }) => {
        if (source.data.type === 'table-row') {
          // Row drop hitboxes use vertical edges so dragging between two rows
          // gives a clear before/after insertion guide.
          const targetIndex = locateRow(input.clientY);
          if (targetIndex < 0) return { targetIndex: -1 };
          const rowTop = bodyTop + targetIndex * rowHeight - scrollRef.current.top;
          const rowEdge = input.clientY - canvas.getBoundingClientRect().top < rowTop + rowHeight / 2 ? 'top' : 'bottom';
          return attachClosestEdge({ targetIndex, rowEdge }, { element, input, allowedEdges: ['top', 'bottom'] });
        }
        const hoveredColumnIndex = locateColumn(input.clientX);
        const targetCell = locateHeaderCell(input.clientX, input.clientY) ?? headerCells.find((cell) => (
          hoveredColumnIndex >= cell.startIndex
          && hoveredColumnIndex <= cell.endIndex
          && cell.level === Number(source.data.headerLevel)
          && (cell.leaf ? 'column' : 'group') === source.data.headerKind
          && cell.parentKey === source.data.parentKey
        ));
        if (!targetCell) return { targetIndex: -1 };
        let targetIndex = targetCell.startIndex;
        const targetFixed = columns[targetCell.startIndex]?.fixed;
        const headerKind = targetCell.leaf ? 'column' : 'group';
        if (source.data.headerKind !== headerKind || source.data.parentKey !== targetCell.parentKey || source.data.fixed !== targetFixed) return { targetIndex: -1 };
        if (columns[targetIndex].rowSelection || columns[targetIndex].rowDragHandle || columns[targetIndex].rowNumber) {
          // Utility columns are not reorderable destinations. When dragging over
          // them, find the next real column in the same fixed region.
          const fixedSide = columns[Number(source.data.sourceIndex)]?.fixed;
          targetIndex = columns.findIndex((column, index) => (
            index > targetIndex
            && column.fixed === fixedSide
            && !column.rowSelection
            && !column.rowDragHandle
            && !column.rowNumber
          ));
          if (targetIndex < 0) return { targetIndex: -1 };
          return { targetIndex, columnEdge: 'left' };
        }
        const left = getHeaderCellLeft(targetCell);
        const targetWidth = targetCell.leaf ? metrics[targetIndex].width : getHeaderCellWidth(targetCell);
        const columnEdge = input.clientX - canvas.getBoundingClientRect().left < left + targetWidth / 2 ? 'left' : 'right';
        return attachClosestEdge({
          targetIndex,
          targetEndIndex: targetCell.endIndex,
          targetKey: targetCell.key,
          parentKey: targetCell.parentKey,
          headerKind,
          fixed: targetFixed,
          targetLeft: left,
          targetWidth,
          columnEdge,
        }, { element, input, allowedEdges: ['left', 'right'] });
      },
    });
    return () => {
      document.documentElement.classList.remove('rvg-is-dragging');
      cleanupDrag();
      cleanupDrop();
    };
  }, [applyColumnOrder, applyRowOrder, bodyTop, columnDraggable, columns, filterValues, fixedHeader, getCellLabel, getDisplayedColumnLeft, getHeaderCellWidth, getRowKey, headerCells, headerHeight, hideDragTooltips, locateColumn, locateHeaderCell, locateHeaderCellDragHandle, locateHeaderResizeCell, locateRow, measureHeaderTitleWidth, metrics, rowDraggable, rowHeight, rows, selectedRowKeySet, selection, setDragGuide, setRowDragGuide, sortState, utilityColumnCount]);

  // Convert a viewport pointer coordinate into a grid cell identity. This is
  // the shared hit-test path for hover tooltips, selection, range dragging,
  // double-click editing, and context menus.
  const locateCell = useCallback((clientX: number, clientY: number): GridSelection | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const localY = clientY - rect.top;
    const contentY = localY + (fixedHeader ? 0 : scrollRef.current.top);
    if (contentY < bodyTop) return null;
    const rowIndex = Math.floor((localY - bodyTop + scrollRef.current.top) / rowHeight);
    const columnIndex = locateColumn(clientX);
    if (rowIndex < 0 || rowIndex >= rows.length || columnIndex < 0) return null;
    const span = getCellSpan(rowIndex, columnIndex);
    const targetRowIndex = span?.rowIndex ?? rowIndex;
    const targetColumnIndex = span?.columnIndex ?? columnIndex;
    return {
      rowIndex: targetRowIndex,
      columnIndex: targetColumnIndex,
      rowKey: getRowKey(rows[targetRowIndex], targetRowIndex),
      columnKey: columns[targetColumnIndex].key,
    };
  }, [bodyTop, columns, fixedHeader, getCellSpan, getRowKey, locateColumn, rowHeight, rows]);

  // Start spreadsheet-style range selection from the cell under the pointer.
  // The first pointerdown only stores the anchor; the range appears after the
  // pointer moves to another editable body cell.
  const beginRangeDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!rangeSelection) return;
    if (event.button !== 0 || editing || event.target !== event.currentTarget) return;
    const cell = locateCell(event.clientX, event.clientY);
    if (!cell || columns[cell.columnIndex].rowSelection || columns[cell.columnIndex].rowDragHandle || columns[cell.columnIndex].rowNumber) return;
    rangeDragRef.current = { anchor: cell, moved: false };
    setSelectionRange(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [columns, editing, locateCell, rangeSelection]);

  // Extend the active range drag to the cell currently under the pointer. The
  // state update is skipped when the focus cell did not change, which avoids
  // forcing React work during tiny pointer movements inside the same cell.
  const updateRangeDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = rangeDragRef.current;
    if (!drag) return;
    const focus = locateCell(event.clientX, event.clientY);
    if (!focus || columns[focus.columnIndex].rowSelection || columns[focus.columnIndex].rowDragHandle || columns[focus.columnIndex].rowNumber) return;
    if (focus.rowIndex === drag.anchor.rowIndex && focus.columnIndex === drag.anchor.columnIndex) return;
    drag.moved = true;
    event.preventDefault();
    setSelectionRange((current) => current?.focus.rowIndex === focus.rowIndex && current.focus.columnIndex === focus.columnIndex ? current : { anchor: drag.anchor, focus });
  }, [columns, locateCell]);

  // Finish range selection. A drag that never moved falls through to normal
  // click selection, while a real range drag suppresses the following click.
  const endRangeDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = rangeDragRef.current;
    if (!drag) return;
    rangeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) return;
    suppressClickRef.current = true;
    setSelection(drag.anchor);
    scrollerRef.current?.focus({ preventScroll: true });
  }, [setSelection]);

  // Row selection supports single, toggle, and shift-range selection. The anchor
  // ref mirrors familiar spreadsheet behavior: shift-click extends from the
  // last explicitly selected row.
  const selectRow = useCallback((rowIndex: number, event: React.MouseEvent, forceToggle = false) => {
    if (!rowSelection) return;
    const mode = typeof rowSelection === 'object' ? rowSelection.mode ?? 'multiple' : 'multiple';
    const key = getRowKey(rows[rowIndex], rowIndex);
    let next: GridKey[];
    if (mode === 'multiple' && event.shiftKey && rowAnchorRef.current !== null) {
      const start = Math.min(rowAnchorRef.current, rowIndex);
      const end = Math.max(rowAnchorRef.current, rowIndex);
      next = rows.slice(start, end + 1).map(getRowKey);
    } else if (mode === 'multiple' && (forceToggle || event.ctrlKey || event.metaKey)) {
      next = selectedRowKeySet.has(key) ? rowKeys.filter((item) => item !== key) : [...rowKeys, key];
    } else {
      next = rowKeys.length === 1 && selectedRowKeySet.has(key) ? [] : [key];
    }
    rowAnchorRef.current = rowIndex;
    setRowKeys(next);
  }, [getRowKey, rowKeys, rowSelection, rows, selectedRowKeySet, setRowKeys]);

  // Column selection follows the same rules as row selection, but works with
  // stable column keys because columns may be reordered.
  const selectColumn = useCallback((columnIndex: number, event: React.MouseEvent) => {
    if (!columnSelection || columnIndex < 0) return;
    const mode = typeof columnSelection === 'object' ? columnSelection.mode ?? 'multiple' : 'multiple';
    const key = columns[columnIndex].key;
    let next: string[];
    if (mode === 'multiple' && event.shiftKey && columnAnchorRef.current !== null) {
      const start = Math.min(columnAnchorRef.current, columnIndex);
      const end = Math.max(columnAnchorRef.current, columnIndex);
      next = columns.slice(start, end + 1).map((column) => column.key);
    } else if (mode === 'multiple') {
      next = selectedColumnKeySet.has(key) ? columnKeys.filter((item) => item !== key) : [...columnKeys, key];
    } else {
      next = columnKeys.length === 1 && selectedColumnKeySet.has(key) ? [] : [key];
    }
    columnAnchorRef.current = columnIndex;
    setColumnKeys(next);
  }, [columnKeys, columnSelection, columns, selectedColumnKeySet, setColumnKeys]);

  const toggleColumnFromMenu = useCallback((columnIndex: number) => {
    if (!columnSelection || columnIndex < 0) return;
    const key = columns[columnIndex].key;
    const mode = typeof columnSelection === 'object' ? columnSelection.mode ?? 'multiple' : 'multiple';
    const selected = selectedColumnKeySet.has(key);
    const next = selected
      ? columnKeys.filter((value) => value !== key)
      : mode === 'multiple'
        ? [...columnKeys, key]
        : [key];
    columnAnchorRef.current = columnIndex;
    setColumnKeys(next);
  }, [columnKeys, columnSelection, columns, selectedColumnKeySet, setColumnKeys]);

  // Scroll a target cell into view before editing or keyboard navigation. Fixed
  // columns never need horizontal adjustment because they are already visible.
  const revealCell = useCallback((cell: GridSelection) => {
    const scroller = scrollerRef.current;
    const metric = metrics[cell.columnIndex];
    const column = columns[cell.columnIndex];
    if (!scroller || !metric || !column) return;
    let nextLeft = scroller.scrollLeft;
    let nextTop = scroller.scrollTop;
    const span = getCellSpan(cell.rowIndex, cell.columnIndex);
    const colSpan = span?.colSpan ?? 1;
    const rowSpan = span?.rowSpan ?? 1;
    const cellWidth = getCellDisplayWidth(cell.columnIndex, colSpan);
    const horizontalFocusGap = 0;
    const verticalFocusGap = 0;
    if (column.fixed === undefined) {
      const cellLeft = getScrollableColumnLeft(cell.columnIndex);
      if (cellLeft - nextLeft < fixedWidth) nextLeft = Math.max(0, cellLeft - fixedWidth - horizontalFocusGap);
      if (cellLeft + cellWidth - nextLeft > viewport.width - rightFixedWidth) nextLeft = cellLeft + cellWidth - viewport.width + rightFixedWidth + horizontalFocusGap;
    }
    const rowTop = (fixedHeader ? 0 : bodyTop) + cell.rowIndex * rowHeight;
    const rowBottom = rowTop + rowHeight * rowSpan;
    if (rowTop < nextTop + verticalFocusGap) nextTop = Math.max(0, rowTop - verticalFocusGap);
    const viewportHeight = scroller.clientHeight;
    const visibleRowHeight = fixedHeader ? viewportHeight - bodyTop : viewportHeight;
    if (rowBottom > nextTop + visibleRowHeight - verticalFocusGap) nextTop = rowBottom - visibleRowHeight + verticalFocusGap;
    if (nextLeft === scroller.scrollLeft && nextTop === scroller.scrollTop) return;
    scroller.scrollLeft = nextLeft;
    scroller.scrollTop = nextTop;
    scrollRef.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
    scheduleDraw();
  }, [bodyTop, columns, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getScrollableColumnLeft, metrics, rightFixedWidth, rowHeight, scheduleDraw, viewport.width]);

  const isCellEditable = useCallback((cell: GridSelection) => {
    const column = columns[cell.columnIndex];
    const row = rows[cell.rowIndex];
    if (!column || !row || column.dataIndex === undefined || column.rowNumber || column.rowSelection || column.rowDragHandle) return false;
    return typeof column.editable === 'function'
      ? column.editable(row[column.dataIndex], row, cell.rowIndex)
      : column.editable === true;
  }, [columns, rows]);

  // Prepare the floating editor for a cell. If the cell is partially offscreen,
  // scroll first and wait two animation frames so editorStyle is calculated from
  // the settled scroll position instead of the old coordinates.
  const beginEdit = useCallback((cell: GridSelection) => {
    const column = columns[cell.columnIndex];
    if (!isCellEditable(cell) || column.dataIndex === undefined) return;
    const value = rows[cell.rowIndex]?.[column.dataIndex];
    setDraft(value == null ? '' : String(value));
    const scroller = scrollerRef.current;
    const metric = metrics[cell.columnIndex];
    if (!scroller || !metric) {
      setEditing(cell);
      return;
    }

    let nextLeft = scroller.scrollLeft;
    let nextTop = scroller.scrollTop;
    const span = getCellSpan(cell.rowIndex, cell.columnIndex);
    const colSpan = span?.colSpan ?? 1;
    const rowSpan = span?.rowSpan ?? 1;
    const cellWidth = getCellDisplayWidth(cell.columnIndex, colSpan);
    const horizontalFocusGap = 0;
    const verticalFocusGap = 0;
    if (column.fixed === undefined) {
      const cellLeft = getScrollableColumnLeft(cell.columnIndex);
      if (cellLeft - nextLeft < fixedWidth) nextLeft = Math.max(0, cellLeft - fixedWidth - horizontalFocusGap);
      if (cellLeft + cellWidth - nextLeft > viewport.width - rightFixedWidth) nextLeft = cellLeft + cellWidth - viewport.width + rightFixedWidth + horizontalFocusGap;
    }
    const rowTop = (fixedHeader ? 0 : bodyTop) + cell.rowIndex * rowHeight;
    const rowBottom = rowTop + rowHeight * rowSpan;
    if (rowTop < nextTop + verticalFocusGap) nextTop = Math.max(0, rowTop - verticalFocusGap);
    const viewportHeight = scroller.clientHeight;
    const visibleRowHeight = fixedHeader ? viewportHeight - bodyTop : viewportHeight;
    if (rowBottom > nextTop + visibleRowHeight - verticalFocusGap) nextTop = rowBottom - visibleRowHeight + verticalFocusGap;

    const needsScroll = nextLeft !== scroller.scrollLeft || nextTop !== scroller.scrollTop;
    if (needsScroll) {
      scroller.scrollLeft = nextLeft;
      scroller.scrollTop = nextTop;
      scrollRef.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
      scheduleDraw();
      requestAnimationFrame(() => {
        // Read the settled native scroll position before mounting the DOM editor.
        scrollRef.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
        scheduleDraw();
        requestAnimationFrame(() => setEditing(cell));
      });
      return;
    }
    setEditing(cell);
  }, [columns, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getScrollableColumnLeft, isCellEditable, metrics, rightFixedWidth, rowHeight, rows, scheduleDraw, viewport.width]);

  const getCellEditKey = (cell: GridSelection) => `${typeof cell.rowKey}:${String(cell.rowKey)}\u0000${cell.columnKey}`;

  const markCellEdited = (cell: GridSelection, previousValue: unknown, nextValue: unknown) => {
    const key = getCellEditKey(cell);
    if (insertedRowKeys.has(cell.rowKey)) {
      originalCellValuesRef.current.delete(key);
      setEditedCellKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return;
    }
    if (!originalCellValuesRef.current.has(key)) {
      originalCellValuesRef.current.set(key, String(previousValue ?? ''));
    }
    const differsFromOriginal = String(nextValue) !== originalCellValuesRef.current.get(key);
    setEditedCellKeys((current) => {
      if (current.has(key) === differsFromOriginal) return current;
      const next = new Set(current);
      if (differsFromOriginal) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // Commit the editor draft through onCellChange. The component does not mutate
  // row data directly; it emits the new value and records local visual state so
  // edited cells can be highlighted until they match their original value again.
  const commitEdit = useCallback((nextDraft?: string, close = true) => {
    if (!editing) return;
    if (!isCellEditable(editing)) {
      setEditing(null);
      return;
    }
    const committedDraft = nextDraft ?? draft;
    const column = columns[editing.columnIndex];
    // Text is the default editor: either configure editor: { type: 'text' } for
    // readability, or omit editor entirely on an editable column.
    const row = rows[editing.rowIndex];
    if (column?.dataIndex !== undefined && row) {
      const previousValue = row[column.dataIndex];
      const committedValue = typeof previousValue === 'number' && committedDraft !== ''
        ? Number(committedDraft)
        : committedDraft;
      if (String(previousValue ?? '') === String(committedValue ?? '')) {
        if (close) setEditing(null);
        return;
      }
      markCellEdited(editing, previousValue, committedValue);
      onCellChange?.({ ...editing, row, value: committedValue, previousValue });
    }
    if (close) setEditing(null);
  }, [columns, draft, editing, isCellEditable, onCellChange, rows]);

  // Render the appropriate editor for the selected column. Actual editor
  // implementations live in components/editors; the grid only supplies geometry,
  // draft value, callbacks, locale, and labels.
  const renderEditor = () => {
    if (!editing || !editorStyle) return null;
    const column = columns[editing.columnIndex];

    if (column.editor?.type === 'select') {
      return (
        <ChoiceEditor
          value={draft}
          options={column.editor.options}
          style={editorStyle}
          labels={labels}
          onChange={setDraft}
          onCommit={(next) => commitEdit(next)}
          onCancel={() => setEditing(null)}
        />
      );
    }

    if (column.editor?.type === 'time' || column.editor?.type === 'time-range') {
      return (
        <CompactTimeEditor
          value={draft}
          range={column.editor.type === 'time-range'}
          showSeconds={timeFormatHasSeconds(column.editor.format, draft)}
          style={editorStyle}
          labels={labels}
          onChange={setDraft}
          onCommit={() => commitEdit()}
          onCancel={() => setEditing(null)}
        />
      );
    }

    if (column.editor && ['date', 'date-range', 'date-time', 'date-time-range', 'year', 'month'].includes(column.editor.type)) {
      return (
        <DateEditor
          editor={column.editor as DateEditorConfig}
          value={draft}
          style={editorStyle}
          locale={language}
          labels={labels}
          onChange={setDraft}
          onCommit={(next) => commitEdit(next)}
          onCancel={() => setEditing(null)}
        />
      );
    }

    const row = rows[editing.rowIndex];
    const cellValue = column.dataIndex === undefined ? undefined : row?.[column.dataIndex];
    return (
      <TextEditor
        value={draft}
        type={typeof cellValue === 'number' ? 'number' : 'text'}
        style={editorStyle}
        labels={labels}
        onChange={setDraft}
        onCommit={(next) => commitEdit(next)}
        onCancel={() => setEditing(null)}
      />
    );
  };

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (editing || !selection) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      beginEdit(selection);
      return;
    }
    const delta = event.key === 'ArrowUp' ? [-1, 0] : event.key === 'ArrowDown' ? [1, 0] : event.key === 'ArrowLeft' ? [0, -1] : event.key === 'ArrowRight' ? [0, 1] : null;
    if (!delta) return;
    event.preventDefault();
    const targetRowIndex = Math.max(0, Math.min(rows.length - 1, selection.rowIndex + delta[0]));
    const targetColumnIndex = Math.max(0, Math.min(columns.length - 1, selection.columnIndex + delta[1]));
    const span = getCellSpan(targetRowIndex, targetColumnIndex);
    const rowIndex = span?.rowIndex ?? targetRowIndex;
    const columnIndex = span?.columnIndex ?? targetColumnIndex;
    const next = { rowIndex, columnIndex, rowKey: getRowKey(rows[rowIndex], rowIndex), columnKey: columns[columnIndex].key };
    setSelection(next);
    const scroller = scrollerRef.current;
    const metric = metrics[columnIndex];
    if (scroller && metric) {
      const rowTop = (fixedHeader ? 0 : bodyTop) + rowIndex * rowHeight;
      const rowBottom = rowTop + rowHeight * (span?.rowSpan ?? 1);
      const cellWidth = getCellDisplayWidth(columnIndex, span?.colSpan ?? 1);
      const visibleRowHeight = fixedHeader ? renderHeight - bodyTop : renderHeight;
      if (rowTop < scroller.scrollTop) scroller.scrollTop = rowTop;
      if (rowBottom > scroller.scrollTop + visibleRowHeight) scroller.scrollTop = rowBottom - visibleRowHeight;
      if (columns[columnIndex].fixed === undefined) {
        const cellLeft = getScrollableColumnLeft(columnIndex);
        if (cellLeft < scroller.scrollLeft + fixedWidth) scroller.scrollLeft = Math.max(0, cellLeft - fixedWidth);
        if (cellLeft + cellWidth > scroller.scrollLeft + viewport.width - rightFixedWidth) scroller.scrollLeft = cellLeft + cellWidth - viewport.width + rightFixedWidth;
      }
    }
  }, [beginEdit, bodyTop, columns, editing, renderHeight, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getRowKey, getScrollableColumnLeft, metrics, rightFixedWidth, rowHeight, rows, selection, setSelection, viewport.width]);

  const editorStyle = useMemo(() => {
    if (!editing) return undefined;
    const metric = metrics[editing.columnIndex];
    const column = columns[editing.columnIndex];
    if (!metric || !column) return undefined;
    const fixedSide = column.fixed;
    const span = getCellSpan(editing.rowIndex, editing.columnIndex);
    const cellWidth = getCellDisplayWidth(editing.columnIndex, span?.colSpan ?? 1);
    const cellHeight = rowHeight * (span?.rowSpan ?? 1);
    const cellLeft = fixedSide === 'left'
      ? leftFixedOffsets.get(editing.columnIndex) ?? 0
      : fixedSide === 'right'
        ? viewport.width - (rightFixedOffsets.get(editing.columnIndex) ?? 0) - metric.width
        : getScrollableColumnLeft(editing.columnIndex) - scrollRef.current.left;
    const cellTop = bodyTop + editing.rowIndex * rowHeight - scrollRef.current.top;
    const horizontalStart = fixedSide === undefined ? fixedWidth : 0;
    const horizontalEnd = fixedSide === undefined ? viewport.width - rightFixedWidth : viewport.width;
    const verticalStart = fixedHeader ? bodyTop : 0;
    const visibleLeft = Math.max(cellLeft, horizontalStart);
    const visibleRight = Math.min(cellLeft + cellWidth, horizontalEnd, viewport.width);
    const visibleTop = Math.max(cellTop, verticalStart);
    const visibleBottom = Math.min(cellTop + cellHeight, renderHeight);
    return {
      left: visibleLeft,
      top: visibleTop,
      width: Math.max(0, visibleRight - visibleLeft),
      height: Math.max(0, visibleBottom - visibleTop),
    };
  }, [bodyTop, columns, editing, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getScrollableColumnLeft, leftFixedOffsets, metrics, renderHeight, rightFixedOffsets, rightFixedWidth, rowHeight, viewport.width]);

  const handleColumnPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const headerY = fixedHeader ? 0 : -scrollRef.current.top;
    if (localY < headerY || localY >= headerY + headerHeight) return;
    const resizeHit = locateHeaderResizeHit(event.clientX, event.clientY);
    if (resizeHit) {
      const { cell: resizeCell, edge: resizeEdge } = resizeHit;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizedColumnWidths((current) => {
        let changed = false;
        const next = { ...current };
        columns.forEach((column, index) => {
          if (column.rowSelection || column.rowDragHandle || column.rowNumber) return;
          const displayedWidth = metrics[index]?.width;
          if (displayedWidth === undefined || next[column.key] === displayedWidth) return;
          next[column.key] = displayedWidth;
          changed = true;
        });
        return changed ? next : current;
      });
      const resizeIndex = resizeCell.endIndex;
      const resizeIndices = resizeCell.leaf
        ? [resizeIndex]
        : Array.from({ length: resizeCell.endIndex - resizeCell.startIndex + 1 }, (_, index) => resizeCell.startIndex + index);
      const startWidths = resizeIndices.map((index) => metrics[index].width);
      const startGuideX = getHeaderCellLeft(resizeCell) + (resizeEdge === 'right' ? getHeaderCellWidth(resizeCell) : 0);
      columnDragRef.current = {
        type: 'resize',
        columnIndex: resizeIndex,
        startX: event.clientX,
        startWidth: startWidths.reduce((total, width) => total + width, 0),
        guideTop: headerRowOffsets[resizeCell.level] ?? 0,
        resizeEdge,
        resizeStartIndex: resizeCell.startIndex,
        resizeEndIndex: resizeCell.endIndex,
        resizeIndices,
        startWidths,
      };
      suppressClickRef.current = true;
      setResizeGuideTop(headerRowOffsets[resizeCell.level] ?? 0);
      setResizeGuideX(startGuideX);
      return;
    }
  }, [fixedHeader, getHeaderCellLeft, getHeaderCellWidth, headerHeight, headerRowOffsets, locateHeaderResizeHit, metrics]);

  const handleColumnPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = columnDragRef.current;
    if (!drag) return;
    const column = columns[drag.columnIndex];
    const minWidth = getMinimumColumnWidth(column, columnDraggable);
    const pointerDelta = Math.round(event.clientX - drag.startX);
    const delta = drag.resizeEdge === 'left' ? -pointerDelta : pointerDelta;
    const setGuideFromWidths = (nextWidths: number[]) => {
      const widthByIndex = new Map(drag.resizeIndices.map((columnIndex, index) => [columnIndex, nextWidths[index]]));
      const nextColumns = columns.map((column, index) => (
        widthByIndex.has(index) ? { ...column, width: widthByIndex.get(index) } : column
      ));
      const nextMetrics = buildColumnMetrics(nextColumns, { columnDraggable, viewportWidth: 0 });
      setResizeGuideX(getHeaderCellEdgeFromMetrics(drag.resizeStartIndex, drag.resizeEndIndex, drag.resizeEdge, nextMetrics));
    };
    if (drag.resizeIndices.length > 1) {
      const minWidths = drag.resizeIndices.map((index) => getMinimumColumnWidth(columns[index], columnDraggable));
      const minTotalWidth = minWidths.reduce((total, width) => total + width, 0);
      const targetTotalWidth = Math.max(minTotalWidth, drag.startWidth + delta);
      const ratio = drag.startWidth > 0 ? targetTotalWidth / drag.startWidth : 1;
      const nextWidths = drag.startWidths.map((width, index) => Math.max(minWidths[index], Math.round(width * ratio)));
      let remainder = targetTotalWidth - nextWidths.reduce((total, width) => total + width, 0);
      for (let index = nextWidths.length - 1; index >= 0 && remainder !== 0; index -= 1) {
        const next = nextWidths[index] + (remainder > 0 ? 1 : -1);
        if (next < minWidths[index]) continue;
        nextWidths[index] = next;
        remainder += remainder > 0 ? -1 : 1;
      }
      drag.resizeIndices.forEach((columnIndex, index) => {
        resizeColumn(columns[columnIndex].key, nextWidths[index]);
      });
      setGuideFromWidths(nextWidths);
      return;
    }
    const width = Math.max(minWidth, Math.round(drag.startWidth + delta));
    resizeColumn(column.key, width);
    setGuideFromWidths([width]);
  }, [columnDraggable, columns, getHeaderCellEdgeFromMetrics, resizeColumn, viewport.width]);

  const handleColumnPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = columnDragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    columnDragRef.current = null;
    setResizeGuideX(null);
    setResizeGuideTop(0);
  }, []);

  const queueSortStateChange = useCallback((next: GridSortState | null) => {
    setSortState(next);
  }, []);

  const renderHeaderIcons = (columnIndex: number, left: number) => {
    const column = columns[columnIndex];
    if (column.rowSelection || column.rowDragHandle || column.rowNumber) return null;
    const top = headerLeafTop + (headerLeafHeight - 14) / 2;
    const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
    let right = left + metrics[columnIndex].width - (visibleActions.drag ? HEADER_ACTION_SLOT_WIDTH : 2);
    const icons = [];
    if (visibleActions.drag) {
      const hovered = hoveredHeaderAction?.columnIndex === columnIndex && hoveredHeaderAction.action === 'drag';
      icons.push(
        <HeaderDragIcon key="drag" className={`rvg-header-icon rvg-header-drag-icon${hovered ? ' is-hovered' : ''}`} style={{ left: left + metrics[columnIndex].width - 16, top }} />,
      );
    }
    if (visibleActions.sort) {
      const hovered = hoveredHeaderAction?.columnIndex === columnIndex && hoveredHeaderAction.action === 'sort';
      const direction = sortState?.columnKey === column.key ? sortState.direction : null;
      icons.push(
        <HeaderSortIcon key="sort" className={`rvg-header-icon${hovered ? ' is-hovered' : ''}`} style={{ left: right - 16, top }} direction={direction} />,
      );
      right -= HEADER_ACTION_SLOT_WIDTH;
    }
    if (visibleActions.filter) {
      const hovered = hoveredHeaderAction?.columnIndex === columnIndex && hoveredHeaderAction.action === 'filter';
      icons.push(
        <HeaderSearchIcon key="filter" className={`rvg-header-icon rvg-header-search-icon${hovered ? ' is-hovered' : ''}${filterValues[column.key] ? ' is-active' : ''}`} style={{ left: right - 16, top: top + 1 }} />,
      );
    }
    return icons;
  };

  const createHeaderTooltip = useCallback((action: HeaderTooltipState['action'], columnIndex: number, cell?: HeaderCell<Row>): HeaderTooltipState | null => {
    const column = cell?.column ?? columns[columnIndex];
    if (!column) return null;
    const cellLeft = cell ? getHeaderCellLeft(cell) : getDisplayedColumnLeft(columnIndex);
    const cellWidth = cell ? getHeaderCellWidth(cell) : metrics[columnIndex]?.width ?? 0;
    const level = cell?.level ?? headerDepth - 1;
    const rowTop = (fixedHeader ? 0 : -scrollPosition.top) + (headerRowOffsets[level] ?? 0);
    const rowHeight = headerRowHeights[level] ?? baseHeaderHeight;
    let anchorX = cellLeft + cellWidth / 2;
    let anchorLeft = cellLeft;
    let label = column.title;
    if (action === 'title') {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (context) context.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
      const titleWidth = context?.measureText(column.title).width ?? column.title.length * 13;
      const visibleActions = cell?.leaf || !cell
        ? getVisibleHeaderActions(column, cellWidth, columnDraggable, titleWidth)
        : null;
      const actionWidth = visibleActions
        ? (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * HEADER_ACTION_SLOT_WIDTH
        : columnDraggable ? HEADER_ACTION_SLOT_WIDTH : 0;
      const contentWidth = Math.max(0, cellWidth - actionWidth);
      const maxTextWidth = Math.max(0, contentWidth - 20);
      const textWidth = Math.min(titleWidth, maxTextWidth);
      if (column.align === 'right') {
        anchorX = cellLeft + contentWidth - 10;
        anchorLeft = anchorX - textWidth;
      } else if (column.align === 'center') {
        anchorX = cellLeft + contentWidth / 2 + textWidth / 2;
        anchorLeft = cellLeft + contentWidth / 2 - textWidth / 2;
      } else {
        anchorLeft = cellLeft + 10;
        anchorX = anchorLeft + textWidth;
      }
    } else if (action === 'drag') {
      anchorX = cellLeft + cellWidth;
      anchorLeft = anchorX;
      label = labels.dragColumn;
    } else if (action === 'sort') {
      const direction = sortState?.columnKey === column.key ? sortState.direction : null;
      label = direction === 'asc' ? labels.sortAsc : direction === 'desc' ? labels.sortDesc : labels.sortBoth;
      anchorX = cellLeft + cellWidth - 22;
      anchorLeft = anchorX;
    } else if (action === 'filter') {
      const value = filterValues[column.key];
      label = value ? labels.filterWithValue(value) : labels.filter;
      anchorX = cellLeft + cellWidth - 40;
      anchorLeft = anchorX;
    }
    const placement: 'left' | 'right' = anchorX + 328 > viewport.width ? 'left' : 'right';
    return {
      key: `${action}:${cell ? `cell:${cell.key}:${cell.level}` : `column:${column.key}`}:${Math.round(anchorX)}:${Math.round(rowTop)}`,
      columnIndex,
      action,
      left: placement === 'right' ? anchorX + 8 : Math.max(8, anchorLeft - 8),
      top: rowTop + rowHeight / 2,
      label,
      placement,
    };
  }, [baseHeaderHeight, columnDraggable, columns, filterValues, fixedHeader, getDisplayedColumnLeft, getHeaderCellLeft, getHeaderCellWidth, headerDepth, headerRowHeights, headerRowOffsets, labels, metrics, scrollPosition.top, sortState, viewport.width]);

  const isPointerOnHeaderTitle = useCallback((clientX: number, clientY: number, cell: HeaderCell<Row>) => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const column = cell.column;
    const cellLeft = getHeaderCellLeft(cell);
    const cellWidth = getHeaderCellWidth(cell);
    const rowTop = (fixedHeader ? 0 : -scrollRef.current.top) + (headerRowOffsets[cell.level] ?? 0);
    const context = canvas.getContext('2d');
    if (context) context.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
    const titleWidth = context?.measureText(column.title).width ?? column.title.length * 13;
    const visibleActions = cell.leaf
      ? getVisibleHeaderActions(column, cellWidth, columnDraggable, titleWidth)
      : null;
    const actionWidth = visibleActions
      ? (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * HEADER_ACTION_SLOT_WIDTH
      : columnDraggable ? HEADER_ACTION_SLOT_WIDTH : 0;
    const contentWidth = Math.max(0, cellWidth - actionWidth);
    const textWidth = Math.min(titleWidth, Math.max(0, contentWidth - 20));
    const textLeft = column.align === 'right'
      ? cellLeft + contentWidth - 10 - textWidth
      : column.align === 'center'
        ? cellLeft + contentWidth / 2 - textWidth / 2
        : cellLeft + 10;
    const textTop = rowTop + 8;
    return localX >= textLeft - 4 && localX <= textLeft + textWidth + 4 && localY >= textTop - 2 && localY <= textTop + 18;
  }, [columnDraggable, fixedHeader, getHeaderCellLeft, getHeaderCellWidth, headerRowOffsets]);

  const headerTooltip = (() => {
    if (!visibleHeaderTooltip) return null;
    return visibleHeaderTooltip;
  })();

  const getRangeBounds = () => selectionRange ? {
    rowStart: Math.min(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex),
    rowEnd: Math.max(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex),
    columnStart: Math.min(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex),
    columnEnd: Math.max(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex),
  } : null;

  const getRangeCells = () => {
    const bounds = getRangeBounds();
    if (!bounds) return [];
    const cells: GridSelection[] = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      for (let columnIndex = bounds.columnStart; columnIndex <= bounds.columnEnd; columnIndex += 1) {
        const column = columns[columnIndex];
        if (column.rowSelection || column.rowDragHandle || column.rowNumber) continue;
        cells.push({ rowIndex, columnIndex, rowKey: getRowKey(rows[rowIndex], rowIndex), columnKey: column.key });
      }
    }
    return cells;
  };

  const getRangeText = () => {
    const bounds = getRangeBounds();
    if (!bounds) return '';
    const columnIndices = columns.map((column, index) => ({ column, index })).slice(bounds.columnStart, bounds.columnEnd + 1).filter(({ column }) => !column.rowSelection && !column.rowDragHandle && !column.rowNumber).map(({ index }) => index);
    return rows.slice(bounds.rowStart, bounds.rowEnd + 1).map((_, rowOffset) => columnIndices.map((columnIndex) => getCellLabel(bounds.rowStart + rowOffset, columnIndex)).join('\t')).join('\n');
  };

  const isCellInRange = (cell: GridSelection) => {
    const bounds = getRangeBounds();
    return Boolean(bounds && cell.rowIndex >= bounds.rowStart && cell.rowIndex <= bounds.rowEnd && cell.columnIndex >= bounds.columnStart && cell.columnIndex <= bounds.columnEnd);
  };

  const handleCopy = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const nativeSelection = window.getSelection();
    if (nativeSelection && !nativeSelection.isCollapsed && nativeSelection.toString()) return;
    if (selectionRange) {
      event.clipboardData.setData('text/plain', getRangeText());
      event.preventDefault();
      return;
    }
    if (!selection) return;
    const row = rows[selection.rowIndex];
    const column = columns[selection.columnIndex];
    if (!row || !column || getRowKey(row, selection.rowIndex) !== selection.rowKey || column.key !== selection.columnKey) return;
    event.clipboardData.setData('text/plain', getCellLabel(selection.rowIndex, selection.columnIndex));
    event.preventDefault();
  };

  const selectionIsCollapsed = () => {
    const nativeSelection = window.getSelection();
    return !nativeSelection || nativeSelection.isCollapsed;
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 1800);
  };

  const showHeaderTooltipAfterDelay = (next: typeof visibleHeaderTooltip) => {
    const nextKey = next ? next.key : '';
    if (nextKey && pendingHeaderTooltipKeyRef.current === nextKey) return;
    pendingHeaderTooltipKeyRef.current = nextKey;
    if (headerTooltipTimerRef.current !== null) clearTimeout(headerTooltipTimerRef.current);
    if (!next) {
      setVisibleHeaderTooltip(null);
      return;
    }
    setVisibleHeaderTooltip(null);
    headerTooltipTimerRef.current = setTimeout(() => {
      headerTooltipTimerRef.current = null;
      setVisibleHeaderTooltip(next);
    }, TOOLTIP_DELAY);
  };

  const showCellTooltip = (next: typeof hoveredCellTooltip) => {
    const nextKey = next ? `${next.rowIndex}:${next.columnIndex}:${next.label}:${next.color ?? ''}:${Number(next.annotation)}` : '';
    if (nextKey && pendingCellTooltipKeyRef.current === nextKey) return;
    pendingCellTooltipKeyRef.current = nextKey;
    if (cellTooltipTimerRef.current !== null) clearTimeout(cellTooltipTimerRef.current);
    setHoveredCellTooltip(next);
  };

  const showCellTooltipAfterDelay = (next: typeof hoveredCellTooltip) => {
    const nextKey = next ? `${next.rowIndex}:${next.columnIndex}:${next.label}:${next.color ?? ''}:${Number(next.annotation)}` : '';
    if (nextKey && pendingCellTooltipKeyRef.current === nextKey) return;
    pendingCellTooltipKeyRef.current = nextKey;
    if (cellTooltipTimerRef.current !== null) clearTimeout(cellTooltipTimerRef.current);
    if (!next) {
      setHoveredCellTooltip(null);
      return;
    }
    setHoveredCellTooltip(null);
    cellTooltipTimerRef.current = setTimeout(() => {
      cellTooltipTimerRef.current = null;
      setHoveredCellTooltip(next);
    }, TOOLTIP_DELAY);
  };

  const openCellContextMenu = (cell: GridSelection, clientX: number, clientY: number) => {
    const root = canvasRef.current?.getBoundingClientRect();
    if (!root) return;
    setInsertCounts({ before: 1, after: 1 });
    setAnnotationOpen(false);
    setSelection(cell);
    setContextMenu({
      type: 'cell',
      ...cell,
      left: Math.min(Math.max(0, clientX - root.left), Math.max(0, viewport.width - 190)),
      top: Math.min(Math.max(0, clientY - root.top), Math.max(0, renderHeight - 350)),
    });
    onCellContextMenu?.({ ...cell, row: rows[cell.rowIndex], clientX, clientY });
  };

  const openHeaderContextMenu = (columnIndex: number, clientX: number, clientY: number) => {
    const root = canvasRef.current?.getBoundingClientRect();
    if (!root || columnIndex < 0) return;
    setContextMenu({
      type: 'header',
      columnIndex,
      left: Math.min(Math.max(0, clientX - root.left), Math.max(0, viewport.width - 180)),
      top: Math.min(Math.max(0, clientY - root.top), Math.max(0, renderHeight - 68)),
    });
  };

  const getRowDragOffset = (rowIndex: number) => {
    if (!rowDragPreview || rowIndex === rowDragPreview.sourceIndex) return 0;
    if (rowDragPreview.sourceIndex < rowDragPreview.targetIndex) {
      return rowIndex > rowDragPreview.sourceIndex && rowIndex <= rowDragPreview.targetIndex ? -rowHeight : 0;
    }
    return rowIndex >= rowDragPreview.targetIndex && rowIndex < rowDragPreview.sourceIndex ? rowHeight : 0;
  };

  const renderAnnotationControls = (targetCells: GridSelection[]) => {
    const getKey = (cell: GridSelection) => `${typeof cell.rowKey}:${String(cell.rowKey)}\u0000${cell.columnKey}`;
    const hasAnnotation = targetCells.some((cell) => cellAnnotations.has(getKey(cell)));
    const openAnnotation = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!annotationOpen) {
        const existing = targetCells.map((cell) => cellAnnotations.get(getKey(cell))).find(Boolean);
        setAnnotationType(existing?.type ?? 'corner');
        setAnnotationColor(existing?.color ?? ANNOTATION_COLORS[0]);
        setAnnotationContent(existing?.content ?? '');
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const horizontal = rect.right + 216 > viewportWidth - 8 ? 'left' : 'right';
      const vertical = rect.top + 280 > viewportHeight - 8 ? 'up' : 'down';
      setAnnotationPlacement(`${horizontal}-${vertical}`);
      setAnnotationOpen(true);
    };
    const saveAnnotation = () => {
      setCellAnnotations((current) => {
        const next = new Map(current);
        targetCells.forEach((cell) => next.set(getKey(cell), { type: annotationType, color: annotationColor, content: annotationContent }));
        return next;
      });
      setAnnotationOpen(false);
      setContextMenu(null);
    };
    return <>
      <div className={`rvg-annotation-submenu is-${annotationPlacement}`} onMouseEnter={openAnnotation} onMouseLeave={() => setAnnotationOpen(false)}>
        <button type="button" role="menuitem" className="rvg-context-annotation-trigger" aria-expanded={annotationOpen}>
          <span className="rvg-context-menu-icon"><ContextMenuIcon type="annotation" /></span>
          <span className="rvg-context-menu-label">{labels.annotation}</span>
          <SubmenuArrowIcon />
        </button>
        {annotationOpen && (
          <div className={`rvg-annotation-panel is-${annotationPlacement}`} role="menu">
            <div className={`rvg-annotation-types${annotationType === 'corner' ? ' is-corner' : ''}`} role="group" aria-label={labels.annotationMode}>
              <button type="button" className={annotationType === 'background' ? 'is-active' : ''} onClick={() => setAnnotationType('background')}>{labels.annotationBackground}</button>
              <button type="button" className={annotationType === 'corner' ? 'is-active' : ''} onClick={() => setAnnotationType('corner')}>{labels.annotationCorner}</button>
            </div>
            <div className="rvg-annotation-colors">
              {ANNOTATION_COLORS.map((color, index) => (
                <button key={color} type="button" className={annotationColor === color ? 'is-active' : ''} aria-label={labels.annotationColor(index + 1)} title={labels.annotationColor(index + 1)} style={{ backgroundColor: color, '--annotation-color': color } as React.CSSProperties} onClick={() => setAnnotationColor(color)} />
              ))}
            </div>
            <textarea
              className="rvg-annotation-content"
              aria-label={labels.annotationContent}
              placeholder={labels.annotationPlaceholder}
              rows={3}
              maxLength={100}
              value={annotationContent}
              onChange={(event) => setAnnotationContent(event.target.value)}
            />
            <div className="rvg-annotation-actions">
              <span>{annotationContent.length}/100</span>
              <button type="button" onClick={saveAnnotation}>{labels.confirm}</button>
            </div>
          </div>
        )}
      </div>
      {hasAnnotation && <button type="button" role="menuitem" onClick={() => {
        setCellAnnotations((current) => {
          const next = new Map(current);
          targetCells.forEach((cell) => next.delete(getKey(cell)));
          return next;
        });
        setContextMenu(null);
      }}>
        <span className="rvg-context-menu-icon"><ContextMenuIcon type="remove-annotation" /></span>
        <span className="rvg-context-menu-label">{labels.removeAnnotation}</span>
      </button>}
    </>;
  };

  const createEmptyRows = (count: number) => {
    return Array.from({ length: count }, () => {
      const record: Record<string, unknown> = { id: createPendingInsertId() };
      if (typeof rowKey === 'string') record[rowKey] = record.id;
      columns.forEach((column) => {
        if (column.dataIndex !== undefined) record[String(column.dataIndex)] = '';
      });
      return record as Row;
    });
  };

  const insertRowsOptimistically = async (cell: GridSelection, position: 'before' | 'after', count: number) => {
    const row = rows[cell.rowIndex];
    if (!row || !onInsertRows) return;
    const sourceRowIndex = getSourceRowIndexByKey(cell.rowKey, cell.rowIndex);
    const insertIndex = (sourceRowIndex >= 0 ? sourceRowIndex : cell.rowIndex) + (position === 'after' ? 1 : 0);
    const insertedRows = createEmptyRows(count);
    const pending: PendingInsert<Row> = {
      id: createPendingInsertId(),
      index: insertIndex,
      rows: insertedRows,
      keys: insertedRows.map((insertedRow, offset) => getDataRowKey(insertedRow, insertIndex + offset)),
    };
    setContextMenu(null);
    setInsertBusy(true);
    setInsertedRowKeys((current) => {
      const next = new Set(current);
      pending.keys.forEach((key) => next.add(key));
      return next;
    });
    setPendingInserts((current) => [...current, pending]);
    try {
      const nextRows = sourceRows.slice();
      nextRows.splice(insertIndex, 0, ...insertedRows);
      await Promise.resolve(onInsertRows(nextRows, insertedRows));
      await waitForPaint();
      setInsertBusy(false);
    } catch (error) {
      setPendingInserts((current) => current.filter((insert) => insert.id !== pending.id));
      setInsertedRowKeys((current) => {
        const next = new Set(current);
        pending.keys.forEach((key) => next.delete(key));
        return next;
      });
      setInsertBusy(false);
      throw error;
    }
  };

  const renderCellText = (rowIndex: number, columnIndex: number, left: number) => {
    const column = columns[columnIndex];
    const span = getCellSpan(rowIndex, columnIndex);
    if (span && (span.rowIndex !== rowIndex || span.columnIndex !== columnIndex)) return null;
    const colSpan = span?.colSpan ?? 1;
    const rowSpan = span?.rowSpan ?? 1;
    const cellWidth = getCellDisplayWidth(columnIndex, colSpan);
    const cellHeight = rowHeight * rowSpan;
    const dragOffset = getRowDragOffset(rowIndex);
    const isDraggedSource = rowDragPreview?.sourceIndex === rowIndex;
    const currentScrollTop = scrollRef.current.top;
    const top = (fixedHeader ? 0 : bodyTop) + rowIndex * rowHeight - currentScrollTop;
    if (column.rowSelection) {
      return null;
    }
    if (column.rowDragHandle) {
      return null;
    }
    if (column.renderCell && !(editing?.rowIndex === rowIndex && editing.columnIndex === columnIndex)) {
      const row = rows[rowIndex];
      const value = column.dataIndex === undefined ? undefined : row[column.dataIndex];
      return (
        <div
          key={`render:${String(getRowKey(row, rowIndex))}:${column.key}`}
          className="rvg-cell-render"
          style={{
            left,
            top,
            width: cellWidth,
            height: cellHeight,
            justifyContent: column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
            opacity: isDraggedSource ? 0 : 1,
            transform: `translateY(${dragOffset}px)`,
          }}
        >
          {column.renderCell(value, row, rowIndex)}
        </div>
      );
    }
    return null;
  };

  const renderHeaderTitle = (columnIndex: number, left: number) => {
    const column = columns[columnIndex];
    const isDropTarget = Boolean(columnDropTarget && columnIndex >= columnDropTarget.startIndex && columnIndex <= columnDropTarget.endIndex);
    const currentScrollTop = scrollRef.current.top;
    const headerTop = fixedHeader ? 0 : -currentScrollTop;
    const leafTop = headerTop + headerLeafTop;
    if (column.rowNumber) {
      return (
        <div
          key={column.key}
          className={`rvg-header-title${isDropTarget ? ' is-drop-target' : ''}`}
          style={{ left, top: headerTop, width: metrics[columnIndex].width, height: headerHeight, justifyContent: 'center', padding: 0, textAlign: 'center' }}
        >
          <span>{column.title}</span>
        </div>
      );
    }
    if (column.rowSelection) {
      if (rowSelectionMode === 'single') return null;
      const allSelected = rows.length > 0 && selectedRowKeySet.size === rows.length;
      const indeterminate = selectedRowKeySet.size > 0 && !allSelected;
      return (
        <div
          key={column.key}
          className="rvg-header-selection-icon"
          style={{ left, top: headerTop, width: metrics[columnIndex].width, height: headerHeight }}
        >
          <SelectionIcon checked={allSelected} indeterminate={indeterminate} />
        </div>
      );
    }
    if (column.renderHeader) {
      const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
      const actionWidth = (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * HEADER_ACTION_SLOT_WIDTH;
      return (
        <div
          key={column.key}
          className={`rvg-header-title is-custom${isDropTarget ? ' is-drop-target' : ''}`}
          data-level={headerDepth - 1}
          data-measure-key={column.key}
          style={{
            left,
            top: leafTop,
            width: Math.max(0, metrics[columnIndex].width - actionWidth),
            height: headerLeafHeight,
            justifyContent: column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
            textAlign: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
          }}
        >
          <span
            ref={(node) => {
              if (node) {
                customHeaderContentRefs.current.set(column.key, node);
                requestAnimationFrame(measureCustomHeaderHeight);
              } else customHeaderContentRefs.current.delete(column.key);
            }}
          >
            {column.renderHeader(column)}
          </span>
        </div>
      );
    }
    return null;
  };

  const renderGroupedHeaderCell = (cell: HeaderCell<Row>) => {
    const startMetric = metrics[cell.startIndex];
    const endMetric = metrics[cell.endIndex];
    if (!startMetric || !endMetric) return null;
    const column = cell.column;
    const fixedSide = columns[cell.startIndex]?.fixed;
    const currentScrollTop = scrollRef.current.top;
    const rowHeightForLevel = headerRowHeights[cell.level] ?? baseHeaderHeight;
    const headerTop = (fixedHeader ? 0 : -currentScrollTop) + (headerRowOffsets[cell.level] ?? 0);
    const left = fixedSide === 'left'
      ? leftFixedOffsets.get(cell.startIndex) ?? 0
      : fixedSide === 'right'
        ? viewport.width - (rightFixedOffsets.get(cell.startIndex) ?? 0) - startMetric.width
        : getScrollableColumnLeft(cell.startIndex);
    const width = cell.leaf
      ? startMetric.width
      : getCellDisplayWidth(cell.startIndex, cell.endIndex - cell.startIndex + 1);
    const visibleActions = cell.leaf
      ? getVisibleHeaderActions(column, startMetric.width, columnDraggable, measureHeaderTitleWidth(cell.startIndex))
      : null;
    const actionWidth = visibleActions
      ? (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * HEADER_ACTION_SLOT_WIDTH
      : columnDraggable && !cell.leaf ? HEADER_ACTION_SLOT_WIDTH : 0;
    const isDropTarget = Boolean(columnDropTarget
      && cell.endIndex >= columnDropTarget.startIndex
      && cell.startIndex <= columnDropTarget.endIndex);
    return (
      <div
        key={`group:${cell.key}:${cell.level}`}
        className={`rvg-header-title rvg-header-group${column.renderHeader ? ' is-custom' : ''}${cell.leaf ? ' is-leaf' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
        data-level={cell.level}
        data-measure-key={`group:${cell.key}:${cell.level}`}
        style={{
          left,
          top: headerTop,
          width,
          height: rowHeightForLevel,
          paddingRight: cell.leaf ? actionWidth + 10 : 10,
          justifyContent: column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
          textAlign: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
        }}
      >
        <span
          ref={(node) => {
            if (!column.renderHeader) return;
            const key = `group:${cell.key}:${cell.level}`;
            if (node) {
              customHeaderContentRefs.current.set(key, node);
              requestAnimationFrame(measureCustomHeaderHeight);
            } else customHeaderContentRefs.current.delete(key);
          }}
        >
          {column.renderHeader ? column.renderHeader(column) : column.title}
        </span>
        {!cell.leaf && columnDraggable && (
          <HeaderDragIcon
            className={`rvg-header-icon rvg-header-drag-icon${hoveredHeaderAction?.columnIndex === cell.startIndex && hoveredHeaderAction.action === 'drag' ? ' is-hovered' : ''}`}
            style={{ left: width - 16, top: (rowHeightForLevel - 14) / 2 }}
          />
        )}
      </div>
    );
  };

  const rangeHandlePosition = (() => {
    if (!rangeSelection) return null;
    const bounds = getRangeBounds();
    if (!bounds) return null;
    const metric = metrics[bounds.columnEnd];
    if (!metric) return null;
    const rawLeft = getDisplayedColumnLeft(bounds.columnEnd) + metric.width;
    const rawTop = bodyTop + (bounds.rowEnd + 1) * rowHeight - scrollPosition.top;
    const column = columns[bounds.columnEnd];
    const horizontalStart = column.fixed === undefined ? fixedWidth : 0;
    const horizontalEnd = column.fixed === undefined ? viewport.width - rightFixedWidth : viewport.width;
    const verticalStart = fixedHeader ? bodyTop : 0;
    if (
      rawLeft <= horizontalStart
      || rawLeft > horizontalEnd
      || rawTop <= verticalStart
      || rawTop > renderHeight
    ) return null;
    return { left: rawLeft, top: rawTop, bounds };
  })();

  const selectionOutlineStyle = (() => {
    if (!selection || selectionRange) return null;
    if (rowDragPreview?.sourceIndex === selection.rowIndex) return null;
    const row = rows[selection.rowIndex];
    const metric = metrics[selection.columnIndex];
    const column = columns[selection.columnIndex];
    if (!row || !metric || !column || getRowKey(row, selection.rowIndex) !== selection.rowKey) return null;
    const span = getCellSpan(selection.rowIndex, selection.columnIndex);
    const rawLeft = getDisplayedColumnLeft(selection.columnIndex);
    const rawRight = rawLeft + getCellDisplayWidth(selection.columnIndex, span?.colSpan ?? 1);
    const rawTop = bodyTop + selection.rowIndex * rowHeight - scrollPosition.top;
    const rawBottom = rawTop + rowHeight * (span?.rowSpan ?? 1);
    const dragOffset = getRowDragOffset(selection.rowIndex);
    const horizontalStart = column.fixed === undefined ? fixedWidth : 0;
    const horizontalEnd = column.fixed === undefined ? viewport.width - rightFixedWidth : viewport.width;
    const verticalStart = fixedHeader ? bodyTop : 0;
    if (
      rawRight <= horizontalStart
      || rawLeft >= horizontalEnd
      || rawBottom + dragOffset <= verticalStart
      || rawTop + dragOffset >= renderHeight
    ) return null;
    const borderWidth = 2;
    const left = Math.round(Math.max(rawLeft - borderWidth, horizontalStart));
    const right = Math.round(Math.min(rawRight + 1, horizontalEnd, viewport.width));
    const top = Math.round(Math.max(rawTop - borderWidth, verticalStart));
    const bottom = Math.round(Math.min(rawBottom + 1, renderHeight));
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
      transform: `translateY(${dragOffset}px)`,
    } as CSSProperties;
  })();

  const selectionEdgeIndicator = getSelectionEdgeIndicator(scrollPosition.left, scrollPosition.top);
  const selectionEdgeStyle = selectionEdgeIndicator ? {
    ...selectionEdgeIndicator.style,
    ...(selectionEdgeIndicator.corner ? {
      '--rvg-corner-width': `${selectionEdgeIndicator.corner.width}px`,
      '--rvg-corner-height': `${selectionEdgeIndicator.corner.height}px`,
      '--rvg-corner-hover-width-extension': '4px',
      '--rvg-corner-hover-height-extension': '4px',
    } : null),
  } as CSSProperties : undefined;

  useLayoutEffect(() => {
    syncSelectionEdgeTarget(scrollPosition.left, scrollPosition.top);
  }, [scrollPosition.left, scrollPosition.top, syncSelectionEdgeTarget]);

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!contextMenuEnabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const headerY = fixedHeader ? 0 : -scrollRef.current.top;
    if (localY >= headerY && localY < headerY + headerHeight) {
      const columnIndex = locateColumn(event.clientX);
      if (columnIndex < 0) return;
      if (columns[columnIndex].rowSelection || columns[columnIndex].rowDragHandle || columns[columnIndex].rowNumber) return;
      openHeaderContextMenu(columnIndex, event.clientX, event.clientY);
      return;
    }
    const cell = locateCell(event.clientX, event.clientY);
    if (!cell) return;
    if (columns[cell.columnIndex].rowSelection || columns[cell.columnIndex].rowDragHandle || columns[cell.columnIndex].rowNumber) return;
    openCellContextMenu(cell, event.clientX, event.clientY);
  };

  const getMenuState = <Context,>(item: CustomContextMenuItem<Context> | undefined, context: Context) => ({
    hidden: typeof item?.hidden === 'function' ? item.hidden(context) : item?.hidden,
    disabled: typeof item?.disabled === 'function' ? item.disabled(context) : item?.disabled,
  });

  const renderContextMenuButton = <Context,>(
    key: string,
    context: Context,
    label: ReactNode,
    onClick: () => void,
    override?: CustomContextMenuItem<Context>,
    options?: { disabled?: boolean; danger?: boolean; icon?: ReactNode },
  ) => {
    const state = getMenuState(override, context);
    if (state.hidden) return null;
    const disabled = state.disabled ?? options?.disabled;
    const danger = override?.danger ?? options?.danger;
    const icon = override?.icon ?? options?.icon;
    if (override?.render !== undefined || override?.childrens !== undefined) {
      return renderContextMenuSubmenu(key, context, override?.label ?? label, override, icon, disabled, danger);
    }
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        className={danger ? 'rvg-context-danger' : undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (override?.onClick) override.onClick(context);
          else onClick();
          setContextMenu(null);
        }}
      >
        {icon && <span className="rvg-context-menu-icon">{icon}</span>}
        <span className="rvg-context-menu-label">{override?.label ?? label}</span>
        {override?.shortcut && <span className="rvg-context-menu-shortcut">{override.shortcut}</span>}
      </button>
    );
  };

  const renderCustomContextMenuItem = <Context,>(item: CustomContextMenuItem<Context>, context: Context) => {
    if (!item.label || (!item.onClick && item.childrens === undefined && item.render === undefined)) return null;
    return renderContextMenuButton(item.key, context, item.label, () => item.onClick?.(context), item);
  };

  const renderContextMenuSubmenu = <Context,>(
    key: string,
    context: Context,
    label: ReactNode,
    item: CustomContextMenuItem<Context>,
    icon?: ReactNode,
    disabled?: boolean,
    danger?: boolean,
  ) => {
    let separatorPending = false;
    const content = item.render !== undefined
      ? typeof item.render === 'function'
        ? item.render(context)
        : item.render
      : item.childrens?.map((child, index) => {
        if (child === '|') {
          separatorPending = true;
          return null;
        }
        const node = renderCustomContextMenuItem(child, context);
        if (!node) return null;
        const wrapped = (
          <Fragment key={child.key}>
            {separatorPending && <div className="rvg-context-separator" />}
            {node}
          </Fragment>
        );
        separatorPending = false;
        return wrapped;
      });
    return (
      <div key={key} className="rvg-context-submenu">
        <button type="button" role="menuitem" className={danger ? 'rvg-context-danger' : undefined} disabled={disabled} aria-haspopup="menu">
          {icon && <span className="rvg-context-menu-icon">{icon}</span>}
          <span className="rvg-context-menu-label">{label}</span>
          <SubmenuArrowIcon />
        </button>
        <div className="rvg-context-submenu-panel" role="menu">
          {content}
        </div>
      </div>
    );
  };

  const renderConfiguredContextMenu = <Builtin extends string, Context,>(
    items: Array<ContextMenuItem<Row, Builtin, Context>>,
    context: Context,
    renderBuiltin: (item: Builtin, override?: CustomContextMenuItem<Context>) => ReactNode,
  ) => {
    const nodes: ReactNode[] = [];
    let separatorPending = false;
    items.forEach((item, index) => {
      if (item === '|') {
        if (nodes.length > 0) separatorPending = true;
        return;
      }
      const override = typeof item === 'string' ? undefined : item;
      const key = typeof item === 'string' ? item : item.key;
      if (override && getMenuState(override, context).hidden) return;
      const node = renderBuiltin(key as Builtin, override)
        ?? (override ? renderCustomContextMenuItem(override, context) : null);
      if (!node) return;
      if (separatorPending) {
        nodes.push(<div className="rvg-context-separator" key={`separator:${index}`} />);
        separatorPending = false;
      }
      nodes.push(<Fragment key={typeof item === 'string' ? `${item}:${index}` : item.key}>{node}</Fragment>);
    });
    return nodes;
  };

  const renderSummaryCell = (columnIndex: number, left: number) => {
    const column = columns[columnIndex];
    const isUtility = column.rowSelection || column.rowDragHandle || column.rowNumber;
    const hasSummaryValue = summaryValues.has(column.key);
    const summaryContent = hasSummaryValue ? summaryValues.get(column.key) : summaryEmptyValue;
    const showSummarySkeleton = Boolean(column.summary) && summaryPending;
    const content = columnIndex === 0
      ? language === 'zh-CN' ? '合计' : 'Total'
      : showSummarySkeleton
        ? <span className="rvg-summary-skeleton" />
        : summaryContent;
    return (
      <div
        key={`summary:${column.key}`}
        className={`rvg-summary-cell${isUtility ? ' is-utility' : ''}${column.summary ? ' is-summary' : ''}${summaryVerticalBordered ? '' : ' is-borderless'}`}
        style={{
          left,
          width: metrics[columnIndex].width,
          justifyContent: column.align === 'right' ? 'flex-end' : column.align === 'center' || isUtility ? 'center' : 'flex-start',
        }}
      >
        {content}
      </div>
    );
  };

  useImperativeHandle(ref, () => {
    const resolveDataCell = (target: GridSelectionTarget) => {
      const cell = resolveSelectionTarget(target);
      if (!cell) return null;
      const column = columns[cell.columnIndex];
      if (column.rowNumber || column.rowSelection || column.rowDragHandle) return null;
      const span = getCellSpan(cell.rowIndex, cell.columnIndex);
      if (!span) return cell;
      return {
        rowIndex: span.rowIndex,
        columnIndex: span.columnIndex,
        rowKey: getRowKey(rows[span.rowIndex], span.rowIndex),
        columnKey: columns[span.columnIndex].key,
      };
    };
    return {
      focus: () => scrollerRef.current?.focus({ preventScroll: true }),
      scrollToCell: (target) => {
        const cell = resolveDataCell(target);
        if (!cell) return false;
        revealCell(cell);
        return true;
      },
      getSelectedCell: () => {
        if (!selection) return null;
        const cell = resolveDataCell(selection);
        if (!cell) return null;
        const column = columns[cell.columnIndex];
        const row = rows[cell.rowIndex];
        return { ...cell, row, column, value: column.dataIndex === undefined ? undefined : row[column.dataIndex] };
      },
      setSelectedCell: (target) => {
        const cell = target === null ? null : resolveDataCell(target);
        if (target !== null && !cell) return false;
        setSelectionRange(null);
        setSelection(cell);
        return true;
      },
      getSelectedRowKeys: () => [...rowKeys],
      getSelectedRows: () => rows.filter((row, index) => selectedRowKeySet.has(getRowKey(row, index))),
      setSelectedRowKeys: (keys) => {
        if (!rowSelection) return;
        const next = [...new Set(keys)];
        setRowKeys(rowSelectionMode === 'single' ? next.slice(0, 1) : next);
      },
      getSelectedColumnKeys: () => [...columnKeys],
      setSelectedColumnKeys: (keys) => {
        if (!columnSelection) return;
        const next = [...new Set(keys)].filter((key) => columns.some((column) => column.key === key && !column.rowNumber && !column.rowSelection && !column.rowDragHandle));
        setColumnKeys(typeof columnSelection === 'object' && columnSelection.mode === 'single' ? next.slice(0, 1) : next);
      },
      clearSelection: () => {
        setSelectionRange(null);
        setSelection(null);
        setRowKeys([]);
        setColumnKeys([]);
        rowAnchorRef.current = null;
        setEditing(null);
      },
      startEdit: (target) => {
        const cell = target ? resolveDataCell(target) : selection ? resolveDataCell(selection) : null;
        if (!cell || !isCellEditable(cell)) return false;
        setSelectionRange(null);
        setSelection(cell);
        beginEdit(cell);
        return true;
      },
      commitEdit: () => commitEdit(),
      cancelEdit: () => setEditing(null),
    };
  });

  const rootStyle = {
    width,
    height: autoHeight ? effectiveHeight : height,
    minHeight: autoHeight || typeof height === 'number' ? undefined : FALLBACK_HEIGHT,
    ...(stripedColor ? { '--rvg-color-stripe': stripedColor } : null),
    ...style,
  } as CSSProperties;
  const currentScroll = scrollRef.current;
  const scrollerBottom = Math.max(0, bottomSummaryHeight - horizontalScrollbarHeight);

  return (
    <div className={`rvg-root${!hasVerticalBorders ? ' is-vertical-borderless' : ''}${hasStripedRows ? ' is-striped' : ''}${insertBusy ? ' is-inserting' : ''}${deleteBusy ? ' is-deleting' : ''} ${loading && !hasCompletedLoadRef.current && !hasCustomLoading ? 'is-initial-loading' : ''} ${className}`} style={rootStyle}>
      <div ref={scrollerRef} className={`rvg-scroller${contextMenu ? ' is-context-menu-open' : ''}`} style={{ bottom: scrollerBottom }} onScroll={handleScroll} onCopy={handleCopy} onContextMenu={handleContextMenu} tabIndex={0} role="grid" aria-label={ariaLabel} aria-rowcount={rows.length} aria-colcount={columns.length} onKeyDown={handleKeyDown}>
        <canvas
          ref={canvasRef}
          className="rvg-canvas"
          style={{ width: viewport.width, height: renderHeight }}
          onMouseMove={(event) => {
            if (document.documentElement.classList.contains('rvg-is-dragging')) {
              hideDragTooltips();
              return;
            }
            if (columnDragRef.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const localY = event.clientY - rect.top;
            const headerY = fixedHeader ? 0 : -scrollRef.current.top;
            const columnIndex = locateColumn(event.clientX);
            const inHeader = localY >= headerY && localY < headerY + headerHeight;
            const inLeafHeader = inHeader && localY >= headerY + headerLeafTop;
            const hoveredHeaderCell = inHeader ? locateHeaderCell(event.clientX, event.clientY) : null;
            const hoveredAction = inLeafHeader ? locateHeaderAction(event.clientX, columnIndex) : null;
            const hoveredDragHandle = Boolean(hoveredHeaderCell && locateHeaderCellDragHandle(event.clientX, hoveredHeaderCell));
            const hoveredDragColumnIndex = hoveredHeaderCell?.startIndex ?? columnIndex;
            const hoveredTitle = inHeader
              && !hoveredAction
              && !hoveredDragHandle
              && hoveredHeaderCell
              && Boolean(hoveredHeaderCell.column.title)
              && isPointerOnHeaderTitle(event.clientX, event.clientY, hoveredHeaderCell)
              && (tooltipConfig.header || (hoveredHeaderCell.leaf && isHeaderTitleTruncated(hoveredHeaderCell.startIndex)));
            const nextHover = hoveredAction
              ? { columnIndex, action: hoveredAction }
              : hoveredDragHandle
                ? { columnIndex: hoveredDragColumnIndex, action: 'drag' as const }
                : hoveredTitle
                  ? { columnIndex: hoveredHeaderCell.startIndex, action: 'title' as const }
                : null;
            const nextTooltip = hoveredAction && hoveredHeaderCell
              ? createHeaderTooltip(hoveredAction, columnIndex, hoveredHeaderCell)
              : hoveredDragHandle && hoveredHeaderCell
                ? createHeaderTooltip('drag', hoveredDragColumnIndex, hoveredHeaderCell)
                : hoveredTitle && hoveredHeaderCell
                  ? createHeaderTooltip('title', hoveredHeaderCell.startIndex, hoveredHeaderCell)
                  : null;
            const previousHover = hoveredHeaderActionRef.current;
            if (previousHover?.columnIndex !== nextHover?.columnIndex || previousHover?.action !== nextHover?.action) {
              hoveredHeaderActionRef.current = nextHover;
              setHoveredHeaderAction(nextHover);
              showHeaderTooltipAfterDelay(nextTooltip);
              scheduleDraw();
            }
            if (inHeader) {
              if (hoveredRowIndexRef.current !== null) {
                hoveredRowIndexRef.current = null;
                scheduleDraw();
              }
              showCellTooltip(null);
            } else {
              showHeaderTooltipAfterDelay(null);
              const cell = locateCell(event.clientX, event.clientY);
              const nextHoveredRowIndex = cell?.rowIndex ?? null;
              if (hoveredRowIndexRef.current !== nextHoveredRowIndex) {
                hoveredRowIndexRef.current = nextHoveredRowIndex;
                scheduleDraw();
              }
              if (!cell) {
                showCellTooltipAfterDelay(null);
              } else {
                const annotation = cellAnnotations.get(`${typeof cell.rowKey}:${String(cell.rowKey)}\u0000${cell.columnKey}`);
                if (annotation?.content.trim()) {
                  const cellLeft = getDisplayedColumnLeft(cell.columnIndex);
                  const cellTop = bodyTop + cell.rowIndex * rowHeight - scrollRef.current.top;
                  const nextTooltip = { rowIndex: cell.rowIndex, columnIndex: cell.columnIndex, left: cellLeft + metrics[cell.columnIndex].width + 6, top: cellTop + rowHeight / 2, label: annotation.content, color: annotation.color, annotation: true };
                  showCellTooltip(nextTooltip);
                } else {
                  const label = getCellLabel(cell.rowIndex, cell.columnIndex);
                  const context = event.currentTarget.getContext('2d');
                  if (context) context.font = '13px Inter, ui-sans-serif, system-ui, sans-serif';
                  const truncated = Boolean(label && context && context.measureText(label).width + 20 > metrics[cell.columnIndex].width);
                  if (!label || (!tooltipConfig.cell && !truncated)) {
                    showCellTooltipAfterDelay(null);
                  } else {
                    const cellLeft = getDisplayedColumnLeft(cell.columnIndex);
                    const cellTop = bodyTop + cell.rowIndex * rowHeight - scrollRef.current.top;
                    const column = columns[cell.columnIndex];
                    const labelWidth = context?.measureText(label).width ?? 0;
                    const textWidth = Math.min(labelWidth, Math.max(0, metrics[cell.columnIndex].width - 20));
                    const textRight = column.align === 'right'
                      ? cellLeft + metrics[cell.columnIndex].width - 10
                      : column.align === 'center'
                        ? cellLeft + metrics[cell.columnIndex].width / 2 + textWidth / 2
                        : cellLeft + 10 + textWidth;
                    const textLeft = column.align === 'right'
                      ? textRight - textWidth
                      : column.align === 'center'
                        ? cellLeft + metrics[cell.columnIndex].width / 2 - textWidth / 2
                        : cellLeft + 10;
                    const localX = event.clientX - rect.left;
                    const localY = event.clientY - rect.top;
                    const textHeight = 22;
                    const textTop = cellTop + (rowHeight - textHeight) / 2;
                    const textBottom = textTop + textHeight;
                    const hitPadding = column.renderCell ? 8 : 0;
                    const isInsideText =
                      localX >= textLeft - hitPadding
                      && localX <= textRight + hitPadding
                      && localY >= textTop
                      && localY <= textBottom;
                    if (!isInsideText) {
                      showCellTooltipAfterDelay(null);
                    } else {
                      const placement: 'left' | 'right' = textRight + 330 > viewport.width ? 'left' : 'right';
                      const nextTooltip = {
                        rowIndex: cell.rowIndex,
                        columnIndex: cell.columnIndex,
                        left: placement === 'right' ? textRight + 16 : Math.max(8, textLeft - 16),
                        top: cellTop + rowHeight / 2,
                        label,
                        placement,
                      };
                      showCellTooltipAfterDelay(nextTooltip);
                    }
                  }
                }
              }
            }
            const cursor = inHeader && locateHeaderResizeCell(event.clientX, event.clientY)
              ? 'col-resize'
              : hoveredAction
                ? 'pointer'
              : hoveredDragHandle
                ? 'move'
              : columnIndex >= 0 && (columns[columnIndex].rowSelection)
                ? 'pointer'
                : !inHeader && rowDraggable && columnIndex >= 0 && columns[columnIndex].rowDragHandle
                  ? 'move'
                : 'default';
            if (event.currentTarget.style.cursor !== cursor) event.currentTarget.style.cursor = cursor;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.cursor = 'default';
            showCellTooltip(null);
            showHeaderTooltipAfterDelay(null);
            if (hoveredHeaderActionRef.current) {
              hoveredHeaderActionRef.current = null;
              setHoveredHeaderAction(null);
              scheduleDraw();
            }
            if (hoveredRowIndexRef.current !== null) {
              hoveredRowIndexRef.current = null;
              scheduleDraw();
            }
          }}
          onPointerDown={(event) => {
            const headerDragCell = columnDraggable ? locateHeaderCell(event.clientX, event.clientY) : null;
            const columnIndex = locateColumn(event.clientX);
            const rowDragHandle = rowDraggable
              && columnIndex >= 0
              && Boolean(columns[columnIndex].rowDragHandle)
              && locateRow(event.clientY) >= 0;
            if ((headerDragCell && locateHeaderCellDragHandle(event.clientX, headerDragCell)) || rowDragHandle) {
              hideDragTooltips();
              document.documentElement.classList.add('rvg-is-dragging');
              event.currentTarget.style.cursor = 'move';
            }
            handleColumnPointerDown(event);
            beginRangeDrag(event);
          }}
          onPointerMove={(event) => { handleColumnPointerMove(event); updateRangeDrag(event); }}
          onPointerUp={(event) => { document.documentElement.classList.remove('rvg-is-dragging'); handleColumnPointerUp(event); endRangeDrag(event); }}
          onPointerCancel={(event) => { document.documentElement.classList.remove('rvg-is-dragging'); handleColumnPointerUp(event); endRangeDrag(event); }}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const localY = event.clientY - rect.top;
            const headerY = fixedHeader ? 0 : -scrollRef.current.top;
            if (localY >= headerY && localY < headerY + headerHeight) {
              clickedCellRef.current = null;
              if (localY < headerY + headerLeafTop) return;
              const columnIndex = locateColumn(event.clientX);
              const action = locateHeaderAction(event.clientX, columnIndex);
              if (action === 'sort') {
                const columnKey = columns[columnIndex].key;
                const next = sortState?.columnKey !== columnKey
                  ? { columnKey, direction: 'asc' as const }
                  : sortState.direction === 'asc'
                    ? { columnKey, direction: 'desc' as const }
                    : null;
                queueSortStateChange(next);
                return;
              }
              if (action === 'filter') {
                const left = Math.min(Math.max(0, getDisplayedColumnLeft(columnIndex)), Math.max(0, viewport.width - 220));
                setFilterEditor({ columnIndex, left, top: Math.max(0, headerY + headerHeight), draft: filterValues[columns[columnIndex].key] ?? '' });
                return;
              }
              if (locateHeaderDragHandle(event.clientX, columnIndex)) return;
              if (columnIndex >= 0 && columns[columnIndex].rowSelection && rowSelection) {
                setRowKeys(rowKeys.length === rows.length ? [] : rows.map(getRowKey));
              } else if (columnIndex >= 0 && (columns[columnIndex].rowDragHandle || columns[columnIndex].rowNumber)) {
                return;
              } else {
                if (event.detail > 1) return;
                selectColumn(columnIndex, event);
              }
              return;
            }
            const cell = locateCell(event.clientX, event.clientY);
            if (!cell) return;
            if (columns[cell.columnIndex].rowDragHandle || columns[cell.columnIndex].rowNumber) {
              clickedCellRef.current = null;
              return;
            }
            const clickedRowSelector = Boolean(columns[cell.columnIndex].rowSelection);
            if (clickedRowSelector) {
              clickedCellRef.current = null;
              selectRow(cell.rowIndex, event, true);
              return;
            }
            if (event.detail > 1) return;
            clickedCellRef.current = cell;
            const column = columns[cell.columnIndex];
            const row = rows[cell.rowIndex];
            onCellClick?.({ ...cell, row, column, value: column.dataIndex === undefined ? undefined : row[column.dataIndex] }, event);
            if (event.defaultPrevented) return;
            setSelectionRange(null);
            scrollerRef.current?.focus({ preventScroll: true });
            setSelection(cell);
            if (!hasRowSelectionColumn) {
              selectRow(cell.rowIndex, event);
            }
            revealCell(cell);
          }}
          onDoubleClick={(event) => {
            const cell = clickedCellRef.current ?? locateCell(event.clientX, event.clientY);
            if (!cell) return;
            const column = columns[cell.columnIndex];
            if (column.rowNumber || column.rowSelection || column.rowDragHandle) return;
            const row = rows[cell.rowIndex];
            onCellDoubleClick?.({ ...cell, row, column, value: column.dataIndex === undefined ? undefined : row[column.dataIndex] }, event);
            if (!event.defaultPrevented) beginEdit(cell);
          }}
          onContextMenu={handleContextMenu}
        />
        <div className="rvg-text-layer" style={{ width: viewport.width, height: renderHeight, marginTop: -renderHeight }} onContextMenu={handleContextMenu}>
          <div className="rvg-text-scroll-clip" style={{ left: fixedWidth, right: rightFixedWidth }}>
            <div
              ref={scrollingTextRef}
              className="rvg-text-scroll-content"
              style={{ left: -fixedWidth, width: contentWidth, transform: `translateX(${-currentScroll.left}px)` }}
            >
              {columns.map((column, columnIndex) => (
                column.fixed || (columnIndex >= utilityColumnCount && headerDepth > 1) ? null : (
                  columnIndex >= domRange.columnStart && columnIndex < domRange.columnEnd
                    ? <span key={column.key}>{renderHeaderTitle(columnIndex, getScrollableColumnLeft(columnIndex))}</span>
                    : null
                )
              ))}
              {headerCells.map((cell) => {
                if (columns[cell.startIndex]?.fixed) return null;
                if (cell.endIndex < domRange.columnStart || cell.startIndex >= domRange.columnEnd) return null;
                return renderGroupedHeaderCell(cell);
              })}
              <div className="rvg-body-text-clip" style={{ top: fixedHeader ? bodyTop : 0, bottom: 0 }}>
                {Array.from({ length: domRange.rowEnd - domRange.rowStart }, (_, offset) => domRange.rowStart + offset).flatMap((rowIndex) => columns.map((column, columnIndex) => {
                  if (column.fixed || columnIndex < domRange.columnStart || columnIndex >= domRange.columnEnd) return null;
                  return renderCellText(rowIndex, columnIndex, getScrollableColumnLeft(columnIndex));
                }))}
              </div>
            </div>
          </div>
          <div className="rvg-body-text-clip" style={{ top: fixedHeader ? bodyTop : 0, bottom: 0 }}>
            {Array.from({ length: domRange.rowEnd - domRange.rowStart }, (_, offset) => domRange.rowStart + offset).flatMap((rowIndex) => columns.map((column, columnIndex) => {
              if (!column.fixed) return null;
              const left = column.fixed === 'left'
                ? leftFixedOffsets.get(columnIndex) ?? 0
                : viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metrics[columnIndex].width;
              return renderCellText(rowIndex, columnIndex, left);
            }))}
          </div>
          {columns.map((column, columnIndex) => (
            column.fixed && (columnIndex < utilityColumnCount || headerDepth === 1)
              ? renderHeaderTitle(columnIndex, column.fixed === 'right' ? viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metrics[columnIndex].width : column.fixed === 'left' ? leftFixedOffsets.get(columnIndex) ?? 0 : getScrollableColumnLeft(columnIndex))
              : null
          ))}
          {headerCells.map((cell) => columns[cell.startIndex]?.fixed ? renderGroupedHeaderCell(cell) : null)}
          {fixedWidth > 0 && currentScroll.left > 0 && <div className="rvg-text-fixed-shadow is-left" style={{ left: fixedWidth }} />}
          {rightFixedWidth > 0 && currentScroll.left < contentWidth - viewport.width && <div className="rvg-text-fixed-shadow is-right" style={{ right: rightFixedWidth }} />}
          {hasVerticalBorders && fixedWidth > 0 && <div className="rvg-text-fixed-border is-left" style={{ left: fixedWidth - 1 }} />}
          {hasVerticalBorders && rightFixedWidth > 0 && <div className="rvg-text-fixed-border is-right" style={{ right: rightFixedWidth }} />}
        </div>
        <div className="rvg-spacer" style={{ width: contentWidth, height: contentHeight + bodyTop, marginTop: -renderHeight }} />
      </div>
      {hasSummaryRow && (
        <div
          className={`rvg-summary-row is-${summaryPosition}${hasVerticalBorders ? '' : ' is-vertical-borderless'}`}
          style={{ height: rowHeight, top: summaryPosition === 'top' ? (fixedHeader ? headerHeight : headerHeight - currentScroll.top) : undefined }}
        >
          <div className="rvg-summary-scroll-clip" style={{ left: fixedWidth, right: rightFixedWidth }}>
            <div
              className="rvg-summary-scroll-content"
              style={{ left: -fixedWidth, width: contentWidth, transform: `translateX(${-currentScroll.left}px)` }}
            >
              {columns.map((column, columnIndex) => column.fixed ? null : renderSummaryCell(columnIndex, getScrollableColumnLeft(columnIndex)))}
            </div>
          </div>
          <div className="rvg-summary-fixed-layer">
            {columns.map((column, columnIndex) => column.fixed === 'left' ? renderSummaryCell(columnIndex, leftFixedOffsets.get(columnIndex) ?? 0) : null)}
            {columns.map((column, columnIndex) => column.fixed === 'right' ? renderSummaryCell(columnIndex, viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metrics[columnIndex].width) : null)}
          </div>
          {fixedWidth > 0 && currentScroll.left > 0 && <div className="rvg-summary-fixed-shadow is-left" style={{ left: fixedWidth }} />}
          {rightFixedWidth > 0 && currentScroll.left < contentWidth - viewport.width && <div className="rvg-summary-fixed-shadow is-right" style={{ right: rightFixedWidth }} />}
          {summaryVerticalBordered && fixedWidth > 0 && <div className="rvg-summary-fixed-border is-left" style={{ left: fixedWidth - 1 }} />}
          {summaryVerticalBordered && rightFixedWidth > 0 && <div className="rvg-summary-fixed-border is-right" style={{ right: rightFixedWidth }} />}
        </div>
      )}
      <div ref={headerIconsRef} className="rvg-header-icons" style={{ height: headerHeight, transform: `translateY(${fixedHeader ? 0 : -scrollRef.current.top}px)` }}>
        <div className="rvg-header-scroll-clip" style={{ left: fixedWidth, right: rightFixedWidth }}>
          <div
            ref={scrollingHeaderIconsRef}
            className="rvg-header-icon-layer rvg-header-icon-layer-scroll"
            style={{ left: -fixedWidth, width: contentWidth, transform: `translateX(${-scrollRef.current.left}px)` }}
          >
            {columns.map((column, index) => column.fixed ? null : <span key={column.key}>{renderHeaderIcons(index, getScrollableColumnLeft(index))}</span>)}
          </div>
        </div>
        <div className="rvg-header-icon-layer">
          {columns.map((column, index) => column.fixed === 'left' ? <span key={column.key}>{renderHeaderIcons(index, leftFixedOffsets.get(index) ?? 0)}</span> : null)}
          {columns.map((column, index) => column.fixed === 'right' ? <span key={column.key}>{renderHeaderIcons(index, viewport.width - (rightFixedOffsets.get(index) ?? 0) - metrics[index].width)}</span> : null)}
        </div>
      </div>
      {headerTooltip && (
        <div className={`rvg-header-tooltip is-${headerTooltip.placement}`} role="tooltip" style={{ left: headerTooltip.left, top: headerTooltip.top }}>
          {headerTooltip.label}
        </div>
      )}
      {hoveredCellTooltip && (
        <div
          className={`rvg-cell-tooltip${hoveredCellTooltip.annotation ? ' is-annotation' : ` is-${hoveredCellTooltip.placement ?? 'right'}`}`}
          role="tooltip"
          style={{
            left: hoveredCellTooltip.left,
            top: hoveredCellTooltip.top,
            ...(hoveredCellTooltip.color ? {
              backgroundColor: hoveredCellTooltip.color,
              color: (() => {
                const hex = hoveredCellTooltip.color!.slice(1);
                const red = Number.parseInt(hex.slice(0, 2), 16);
                const green = Number.parseInt(hex.slice(2, 4), 16);
                const blue = Number.parseInt(hex.slice(4, 6), 16);
                return red * 0.299 + green * 0.587 + blue * 0.114 > 165 ? '#202124' : '#ffffff';
              })(),
            } : {}),
          }}
        >
          {hoveredCellTooltip.label}
        </div>
      )}
      {rangeHandlePosition && (
        <div
          className="rvg-range-handle"
          style={{ left: rangeHandlePosition.left, top: rangeHandlePosition.top }}
          role="presentation"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const { rowStart, rowEnd, columnStart, columnEnd } = rangeHandlePosition.bounds;
            const anchor = { rowIndex: rowStart, columnIndex: columnStart, rowKey: getRowKey(rows[rowStart], rowStart), columnKey: columns[columnStart].key };
            const focus = { rowIndex: rowEnd, columnIndex: columnEnd, rowKey: getRowKey(rows[rowEnd], rowEnd), columnKey: columns[columnEnd].key };
            rangeDragRef.current = { anchor, moved: true };
            setSelectionRange({ anchor, focus });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={updateRangeDrag}
          onPointerUp={endRangeDrag}
          onPointerCancel={endRangeDrag}
          onClick={() => { suppressClickRef.current = false; }}
        />
      )}
      {selectionOutlineStyle && <div ref={selectionFocusRef} className="rvg-selection-focus" style={selectionOutlineStyle} aria-hidden="true" />}
      {selectionEdgeIndicator && selection && (
        <button
          ref={selectionEdgeTargetRef}
          type="button"
          className={`rvg-selection-edge-target is-${selectionEdgeIndicator.orientation} is-${selectionEdgeIndicator.side}${selectionEdgeIndicator.viewportEdge ? ` is-viewport-${selectionEdgeIndicator.viewportEdge}` : ''}`}
          style={selectionEdgeStyle}
          aria-label={labels.revealSelectedCell}
          title={labels.revealSelectedCell}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            scrollerRef.current?.focus({ preventScroll: true });
            revealCell(selection);
          }}
        >
          <span className="rvg-selection-edge-halo" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M 0 100 L 0 0 L 100 0" />
            </svg>
          </span>
        </button>
      )}
      {contextMenu && (
        <div ref={contextMenuRef} className="rvg-context-menu" role="menu" style={{ left: contextMenu.left, top: contextMenu.top }}>
          {contextMenu.type === 'header' ? (() => {
            const column = columns[contextMenu.columnIndex];
            const headerContext: HeaderContextMenuContext<Row> = { column, columnIndex: contextMenu.columnIndex };
            return renderConfiguredContextMenu(resolveContextMenuSection(customContextMenuConfig?.header, DEFAULT_HEADER_CONTEXT_MENU), headerContext, (item, override) => {
              if (item === 'copy') return renderContextMenuButton('header-copy', headerContext, labels.copyContent, async () => {
                try {
                  await navigator.clipboard.writeText(rows.map((_, rowIndex) => getCellLabel(rowIndex, contextMenu.columnIndex)).join('\n'));
                  showToast('success', labels.copySuccess);
                } catch {
                  showToast('error', labels.copyError);
                }
              }, override, { icon: <ContextMenuIcon type="copy" /> });
              if (item === 'select-column') {
                if (!columnSelection) return null;
                return renderContextMenuButton('header-select-column', headerContext, selectedColumnKeySet.has(column.key) ? labels.deselectColumn : labels.selectColumn, () => {
                  toggleColumnFromMenu(contextMenu.columnIndex);
                }, override, { icon: <ContextMenuIcon type="select-column" /> });
              }
              return null;
            });
          })() : selectionRange && isCellInRange(contextMenu) ? (() => {
            const rangeCells = getRangeCells();
            const rangeContext: RangeContextMenuContext<Row> = {
              cells: rangeCells.map((cell) => {
                const column = columns[cell.columnIndex];
                const row = rows[cell.rowIndex];
                return { ...cell, row, column, value: column.dataIndex === undefined ? undefined : row[column.dataIndex] };
              }),
            };
            return renderConfiguredContextMenu(resolveContextMenuSection(customContextMenuConfig?.range, DEFAULT_RANGE_CONTEXT_MENU), rangeContext, (item, override) => {
              if (item === 'copy') return renderContextMenuButton('range-copy', rangeContext, labels.copyContent, async () => {
                try {
                  await navigator.clipboard.writeText(getRangeText());
                  showToast('success', labels.copySuccess);
                } catch {
                  showToast('error', labels.copyError);
                }
              }, override, { icon: <ContextMenuIcon type="copy" /> });
              if (item === 'annotation') return renderAnnotationControls(rangeCells);
              if (item === 'undo') {
                const changedCells = rangeCells.flatMap((cell) => {
                  const column = columns[cell.columnIndex];
                  const row = rows[cell.rowIndex];
                  if (column.dataIndex === undefined) return [];
                  const originalValue = originalCellValuesRef.current.get(getCellEditKey(cell));
                  if (originalValue === undefined) return [];
                  return [{ cell, row, column, originalValue }];
                });
                if (changedCells.length === 0) return null;
                return renderContextMenuButton('range-undo', rangeContext, labels.undoChange, () => {
                  changedCells.forEach(({ cell, row, column, originalValue }) => {
                    if (column.dataIndex === undefined) return;
                    const editKey = getCellEditKey(cell);
                    const previousValue = row[column.dataIndex];
                    const value = typeof previousValue === 'number' && originalValue !== '' ? Number(originalValue) : originalValue;
                    originalCellValuesRef.current.delete(editKey);
                    setEditedCellKeys((current) => {
                      if (!current.has(editKey)) return current;
                      const next = new Set(current);
                      next.delete(editKey);
                      return next;
                    });
                    onCellChange?.({ ...cell, row, previousValue, value });
                  });
                }, override, { disabled: !onCellChange, icon: <ContextMenuIcon type="undo" /> });
              }
              if (item === 'clear') {
                const hasClearableCell = rangeCells.some((cell) => {
                  const column = columns[cell.columnIndex];
                  const row = rows[cell.rowIndex];
                  return column.dataIndex !== undefined && !isEmptyCellValue(row[column.dataIndex]);
                });
                if (!hasClearableCell) return null;
                return renderContextMenuButton('range-clear', rangeContext, labels.clearContent, () => {
                rangeCells.forEach((cell) => {
                  const column = columns[cell.columnIndex];
                  const row = rows[cell.rowIndex];
                  if (column.dataIndex === undefined || isEmptyCellValue(row[column.dataIndex])) return;
                  markCellEdited(cell, row[column.dataIndex], '');
                  onCellChange?.({ ...cell, row, previousValue: row[column.dataIndex], value: '' });
                });
                }, override, { disabled: !onCellChange, icon: <ContextMenuIcon type="clear" /> });
              }
              return null;
            });
          })() : (() => {
            const cell = contextMenu;
            const column = columns[cell.columnIndex];
            const row = rows[cell.rowIndex];
            const dataIndex = column.dataIndex;
            const editKey = getCellEditKey(cell);
            const originalValue = originalCellValuesRef.current.get(editKey);
            const selectedIndices = rows.reduce<number[]>((indices, item, index) => {
              if (selectedRowKeySet.has(getRowKey(item, index))) indices.push(index);
              return indices;
            }, []);
            const affectedRows = selectedIndices.includes(cell.rowIndex) ? selectedIndices : [cell.rowIndex];
            const cellContext: CellContextMenuContext<Row> = { ...cell, row, column, value: dataIndex === undefined ? undefined : row[dataIndex] };
            return renderConfiguredContextMenu(resolveContextMenuSection(customContextMenuConfig?.cell, DEFAULT_CELL_CONTEXT_MENU), cellContext, (item, override) => {
              if (item === 'edit') return renderContextMenuButton('cell-edit', cellContext, labels.edit, () => beginEdit(cell), override, { disabled: !isCellEditable(cell), icon: <ContextMenuIcon type="edit" /> });
              if (item === 'copy') return renderContextMenuButton('cell-copy', cellContext, labels.copyContent, async () => {
                try {
                  await navigator.clipboard.writeText(getCellLabel(cell.rowIndex, cell.columnIndex));
                  showToast('success', labels.copySuccess);
                } catch {
                  showToast('error', labels.copyError);
                }
              }, override, { icon: <ContextMenuIcon type="copy" /> });
              if (item === 'undo') return renderContextMenuButton('cell-undo', cellContext, labels.undoChange, () => {
                if (dataIndex === undefined || originalValue === undefined) return;
                const previousValue = row[dataIndex];
                const value = typeof previousValue === 'number' && originalValue !== '' ? Number(originalValue) : originalValue;
                setConfirmAction({ type: 'undo', cell, row, dataIndex, previousValue, value });
              }, override, { disabled: !onCellChange || dataIndex === undefined || originalValue === undefined, icon: <ContextMenuIcon type="undo" /> });
              if (item === 'clear') {
                if (dataIndex === undefined || isEmptyCellValue(row[dataIndex])) return null;
                return renderContextMenuButton('cell-clear', cellContext, labels.clearContent, () => {
                if (dataIndex === undefined) return;
                const previousValue = row[dataIndex];
                setConfirmAction({ type: 'clear', cell, row, dataIndex, previousValue });
                }, override, { disabled: !onCellChange || dataIndex === undefined, danger: true, icon: <ContextMenuIcon type="clear" /> });
              }
              if (item === 'annotation') return renderAnnotationControls([cell]);
              if (item === 'select-row') {
                if (!rowSelection) return null;
                return renderContextMenuButton('cell-select-row', cellContext, selectedRowKeySet.has(cell.rowKey) ? labels.deselectRow : labels.selectRow, () => {
                  if (selectedRowKeySet.has(cell.rowKey)) setRowKeys(rowKeys.filter((key) => key !== cell.rowKey));
                  else setRowKeys(rowSelectionMode === 'single' ? [cell.rowKey] : [...rowKeys, cell.rowKey]);
                }, override, { icon: <ContextMenuIcon type="select-row" /> });
              }
              if (item === 'select-column') {
                if (!columnSelection) return null;
                return renderContextMenuButton('cell-select-column', cellContext, selectedColumnKeySet.has(cell.columnKey) ? labels.deselectColumn : labels.selectColumn, () => {
                  toggleColumnFromMenu(cell.columnIndex);
                }, override, { icon: <ContextMenuIcon type="select-column" /> });
              }
              if (item === 'insert-above') return <div className="rvg-context-insert">
                <button type="button" role="menuitem" disabled={!onInsertRows} onClick={() => { void insertRowsOptimistically(cell, 'before', insertCounts.before); }}><span className="rvg-context-menu-icon"><ContextMenuIcon type="insert-above" /></span><span className="rvg-context-menu-label">{labels.insertAbove}</span></button>
                <input aria-label={labels.insertAboveCount} type="number" min={1} max={5} step={1} value={insertCounts.before} onChange={(event) => setInsertCounts((current) => ({ ...current, before: Math.max(1, Math.min(5, Math.floor(Number(event.target.value) || 1))) }))} />
                <span>{labels.rowUnit}</span>
              </div>;
              if (item === 'insert-below') return <div className="rvg-context-insert">
                <button type="button" role="menuitem" disabled={!onInsertRows} onClick={() => { void insertRowsOptimistically(cell, 'after', insertCounts.after); }}><span className="rvg-context-menu-icon"><ContextMenuIcon type="insert-below" /></span><span className="rvg-context-menu-label">{labels.insertBelow}</span></button>
                <input aria-label={labels.insertBelowCount} type="number" min={1} max={5} step={1} value={insertCounts.after} onChange={(event) => setInsertCounts((current) => ({ ...current, after: Math.max(1, Math.min(5, Math.floor(Number(event.target.value) || 1))) }))} />
                <span>{labels.rowUnit}</span>
              </div>;
              if (item === 'move-up') {
                if (!rowDraggable) return null;
                return renderContextMenuButton('cell-move-up', cellContext, labels.moveUp, () => applyRowOrder(cell.rowIndex, cell.rowIndex - 1), override, { disabled: cell.rowIndex === 0, icon: <ContextMenuIcon type="move-up" /> });
              }
              if (item === 'move-down') {
                if (!rowDraggable) return null;
                return renderContextMenuButton('cell-move-down', cellContext, labels.moveDown, () => applyRowOrder(cell.rowIndex, cell.rowIndex + 1), override, { disabled: cell.rowIndex === rows.length - 1, icon: <ContextMenuIcon type="move-down" /> });
              }
              if (item === 'delete-row') return renderContextMenuButton('cell-delete-row', cellContext, labels.deleteRow, () => setConfirmAction({ type: 'delete-row', rows: affectedRows.map((rowIndex) => ({ rowIndex, row: rows[rowIndex] })) }), override, { disabled: !onDeleteRows, danger: true, icon: <ContextMenuIcon type="delete" /> });
              return null;
            });
          })()}
        </div>
      )}
      {confirmAction && (
        <div className="rvg-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!confirmLoading && event.target === event.currentTarget) setConfirmAction(null); }}>
          <div className="rvg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rvg-delete-title">
            <strong id="rvg-delete-title">{
              confirmAction.type === 'undo'
                ? labels.undoConfirmTitle
                : confirmAction.type === 'clear'
                  ? labels.clearConfirmTitle
                  : labels.deleteConfirmTitle
            }</strong>
            <p>{
              confirmAction.type === 'undo'
                ? labels.undoConfirmDescription
                : confirmAction.type === 'clear'
                  ? labels.clearConfirmDescription
                  : labels.deleteConfirmDescription(confirmAction.rows.length)
            }</p>
            <div className="rvg-confirm-actions">
              <button type="button" disabled={confirmLoading} onClick={() => setConfirmAction(null)}>{labels.cancel}</button>
              <button type="button" className="rvg-confirm-danger" disabled={confirmLoading} autoFocus onClick={() => {
                if (confirmLoading) return;
                flushSync(() => setConfirmLoading(true));
                window.requestAnimationFrame(async () => {
                  try {
                    if (confirmAction.type === 'undo') {
                      const editKey = getCellEditKey(confirmAction.cell);
                      setEditedCellKeys((current) => {
                        if (!current.has(editKey)) return current;
                        const next = new Set(current);
                        next.delete(editKey);
                        return next;
                      });
                      await Promise.resolve(onCellChange?.({ ...confirmAction.cell, row: confirmAction.row, previousValue: confirmAction.previousValue, value: confirmAction.value }));
                    } else if (confirmAction.type === 'clear') {
                      markCellEdited(confirmAction.cell, confirmAction.previousValue, '');
                      await Promise.resolve(onCellChange?.({ ...confirmAction.cell, row: confirmAction.row, previousValue: confirmAction.previousValue, value: '' }));
                    } else {
                      const deletingKeys = confirmAction.rows.map(({ row, rowIndex }) => getDataRowKey(row, rowIndex));
                      const deletedRows = confirmAction.rows.map(({ row }) => row);
                      const deletingKeySet = new Set(deletingKeys);
                      const nextRows = sourceRows.filter((row, rowIndex) => !deletingKeySet.has(getDataRowKey(row, rowIndex)));
                      setConfirmAction(null);
                      setConfirmLoading(false);
                      setPendingDeletedRowKeys((current) => {
                        const next = new Set(current);
                        deletingKeys.forEach((key) => next.add(key));
                        return next;
                      });
                      if (onDeleteRows) {
                        setDeleteBusy(true);
                        try {
                          await Promise.resolve(onDeleteRows(nextRows, deletedRows));
                        } catch (error) {
                          setPendingDeletedRowKeys((current) => {
                            const next = new Set(current);
                            deletingKeys.forEach((key) => next.delete(key));
                            return next;
                          });
                          throw error;
                        } finally {
                          setDeleteBusy(false);
                        }
                      }
                      return;
                    }
                    setConfirmAction(null);
                  } catch (error) {
                    setConfirmLoading(false);
                    throw error;
                  }
                });
              }}>{confirmLoading && <LoadingSpinnerIcon />}{
                confirmAction.type === 'undo'
                  ? labels.undoChange
                  : confirmAction.type === 'clear'
                    ? labels.clear
                    : labels.delete
              }</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`rvg-toast is-${toast.type}`} role="status">{toast.message}</div>}
      <div
        ref={verticalScrollbarRef}
        className="rvg-vertical-scrollbar"
        onPointerEnter={() => keepCustomScrollbarVisible('vertical')}
        onPointerLeave={() => releaseCustomScrollbarVisible('vertical')}
        onPointerDown={handleVerticalScrollbarPointerDown}
        onPointerMove={handleVerticalScrollbarPointerMove}
        onPointerUp={handleVerticalScrollbarPointerUp}
        onPointerCancel={handleVerticalScrollbarPointerUp}
      >
        <div ref={verticalScrollbarThumbRef} className="rvg-vertical-scrollbar-thumb" />
      </div>
      <div
        ref={horizontalScrollbarRef}
        className="rvg-horizontal-scrollbar"
        onPointerEnter={() => keepCustomScrollbarVisible('horizontal')}
        onPointerLeave={() => releaseCustomScrollbarVisible('horizontal')}
        onPointerDown={handleHorizontalScrollbarPointerDown}
        onPointerMove={handleHorizontalScrollbarPointerMove}
        onPointerUp={handleHorizontalScrollbarPointerUp}
        onPointerCancel={handleHorizontalScrollbarPointerUp}
      >
        <div ref={horizontalScrollbarThumbRef} className="rvg-horizontal-scrollbar-thumb" />
      </div>
      <div ref={dragGuideRef} className="rvg-column-guide" />
      {resizeGuideX !== null && (
        <div
          className="rvg-column-guide is-resizing"
          style={{ display: 'block', top: resizeGuideTop, transform: `translateX(${Math.round(resizeGuideX)}px)` }}
        />
      )}
      <div ref={rowDragGuideRef} className="rvg-row-guide" />
      {filterEditor && (
        <div ref={filterRef} className="rvg-filter" style={{ left: filterEditor.left, top: filterEditor.top }}>
          <input
            autoFocus
            aria-label={labels.filterColumn(columns[filterEditor.columnIndex].title)}
            placeholder={labels.search}
            value={filterEditor.draft}
            onChange={(event) => {
              const value = event.target.value;
              setFilterEditor((current) => current ? { ...current, draft: value } : current);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFilterEditor(null);
              if (event.key === 'Enter') {
                const key = columns[filterEditor.columnIndex].key;
                const next = { ...filterValues };
                if (filterEditor.draft) next[key] = filterEditor.draft;
                else delete next[key];
                setFilterValues(next);
                setFilterEditor(null);
              }
            }}
          />
          <div className="rvg-filter-actions">
            <button type="button" onClick={() => {
              const key = columns[filterEditor.columnIndex].key;
              const next = { ...filterValues };
              delete next[key];
              setFilterValues(next);
              setFilterEditor(null);
            }}>{labels.reset}</button>
            <button type="button" className="rvg-filter-confirm" onClick={() => {
              const key = columns[filterEditor.columnIndex].key;
              const next = { ...filterValues };
              if (filterEditor.draft) next[key] = filterEditor.draft;
              else delete next[key];
              setFilterValues(next);
              setFilterEditor(null);
            }}>{labels.confirm}</button>
          </div>
        </div>
      )}
      {renderEditor()}
      {rows.length === 0 && !loading && <div className="rvg-empty" style={{ top: bodyTop }}>{emptyContent ?? <DefaultEmptyState label={labels.empty} />}</div>}
      {loading && hasCustomLoading && (
        <div className="rvg-custom-loading" aria-label={labels.refreshing}>
          {loadingContent}
        </div>
      )}
      {loading && !hasCustomLoading && !hasCompletedLoadRef.current && (
        <div className="rvg-initial-loading" style={{ top: headerHeight }} aria-label={labels.initialLoading}>
          {Array.from({ length: Math.ceil((renderHeight - headerHeight) / rowHeight) }, (_, rowIndex) => (
            <div className="rvg-loading-row" style={{ height: rowHeight }} key={rowIndex}>
              {columns.map((column, columnIndex) => {
                const left = getDisplayedColumnLeft(columnIndex);
                const columnWidth = metrics[columnIndex].width;
                if (left + columnWidth <= 0 || left >= viewport.width) return null;
                const isUtility = column.rowSelection || column.rowDragHandle || column.rowNumber;
                return (
                  <span
                    className={column.rowDragHandle ? 'is-utility is-drag' : column.rowSelection ? 'is-utility is-selection' : undefined}
                    key={column.key}
                    style={{ left, width: columnWidth, zIndex: column.fixed ? 1 : 0, background: column.fixed ? '#fff' : undefined, justifyContent: column.align === 'right' ? 'flex-end' : column.align === 'center' || isUtility ? 'center' : 'flex-start' }}
                  >
                    <i style={{ width: isUtility ? 14 : `${38 + ((rowIndex * 17 + columnIndex * 13) % 43)}%`, animationDelay: `${(rowIndex * columns.length + columnIndex) * 24}ms` }} />
                  </span>
                );
              })}
            </div>
          ))}
          {fixedWidth > 0 && currentScroll.left > 0 && <div className="rvg-loading-fixed-shadow is-left" style={{ left: fixedWidth }} />}
          {rightFixedWidth > 0 && currentScroll.left < contentWidth - viewport.width && <div className="rvg-loading-fixed-shadow is-right" style={{ right: rightFixedWidth }} />}
        </div>
      )}
      {loading && !hasCustomLoading && hasCompletedLoadRef.current && (
        <div className="rvg-refresh-loading" aria-label={labels.refreshing}>
          <LoadingSpinnerIcon />
        </div>
      )}
    </div>
  );
}

// Preserve row inference for generic JSX while supporting refs in React 18+.
export const Table = forwardRef(TableInner) as <Row extends object>(
  props: TableProps<Row> & RefAttributes<TableRef<Row>>,
) => ReactElement;
