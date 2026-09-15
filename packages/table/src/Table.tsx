import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { DefaultEmptyState } from './components/EmptyState';
import { ChoiceEditor } from './components/editors/ChoiceEditor';
import { DateEditor, type DateEditorConfig } from './components/editors/DateEditor';
import { CompactTimeEditor } from './components/editors/TimeEditors';
import { TextEditor } from './components/editors/TextEditor';
import { timeFormatHasSeconds } from './core/dateTime';
import { resolveGridLocale } from './core/i18n';
import { createRowDragHandleSvg } from './icons/domIcons';
import { ContextMenuIcon, HeaderDragIcon, HeaderSearchIcon, HeaderSortIcon, LoadingSpinnerIcon, RowDragHandleIcon, SelectionIcon, SubmenuArrowIcon } from './icons/gridIcons';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getDisplayLabel } from './core/format';
import { buildColumnMetrics, getHeaderTitleRequiredWidth, getMinimumColumnWidth, getViewportRange, getVisibleHeaderActions, hitTestColumn } from './core/layout';
import { paintGrid } from './core/render';
import { useControllableKeys, useControllableValue } from './hooks/useControllable';
import type { CellContextMenuBuiltin, CellContextMenuContext, ContextMenuItem, ContextMenuSection, CustomContextMenuItem, GridColumn, GridKey, GridSelection, HeaderContextMenuBuiltin, HeaderContextMenuContext, RangeContextMenuBuiltin, RangeContextMenuContext, TableCellSpan, TableProps, TableResolvedCellSpan, ViewportRange } from './types';

interface ScrollPosition { left: number; top: number }
type ColumnDrag =
  {
    type: 'resize';
    columnIndex: number;
    startX: number;
    startWidth: number;
    startGuideX: number;
    neighborIndex: number;
    startNeighborWidth: number;
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

type InternalGridColumn<Row> = GridColumn<Row> & {
  rowSelection?: boolean;
  rowDragHandle?: boolean;
  rowNumber?: boolean;
};

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

export function Table<Row extends object>({
  columns: sourceColumns,
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
  onSelectedRowKeysChange,
  columnSelection,
  selectedColumnKeys,
  defaultSelectedColumnKeys,
  onSelectedColumnKeysChange,
  columnDraggable = true,
  columnResizable = false,
  onColumnOrderChange,
  onColumnResize,
  rowDraggable = false,
  onRowOrderChange,
  onInsertRows,
  onDeleteRows,
  sortState = null,
  onSortStateChange,
  filterValues = {},
  onFilterValuesChange,
  onCellChange,
  onCellContextMenu,
  contextMenu: contextMenuConfig = true,
  emptyContent,
  className = '',
  style,
  ariaLabel = 'Data grid',
}: TableProps<Row>) {
  const rowHeight = layout?.rowHeight ?? rowHeightProp ?? 36;
  const baseHeaderHeight = layout?.headerHeight ?? headerHeightProp ?? 40;
  const { language, labels } = useMemo(() => resolveGridLocale(locale), [locale]);
  const customHeaderContentRefs = useRef(new Map<string, HTMLElement>());
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(0);
  const headerHeight = Math.max(baseHeaderHeight, measuredHeaderHeight);
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
  const columns = useMemo<InternalGridColumn<Row>[]>(() => {
    const utilityColumns: InternalGridColumn<Row>[] = [];
    if (rowDraggable) {
      utilityColumns.push({ key: '__rvg_row_drag__', title: '', width: 36, align: 'center', fixed: 'left', rowDragHandle: true });
    }
    if (rowSelection) {
      utilityColumns.push({ key: '__rvg_row_selection__', title: '', width: 44, align: 'center', fixed: 'left', rowSelection: true });
    }
    if (rowNumber) {
      utilityColumns.push({ key: '__rvg_row_number__', title: '#', width: getRowNumberColumnWidth(sourceRows.length), align: 'center', fixed: 'left', rowNumber: true });
    }
    return [...utilityColumns, ...sourceColumns];
  }, [rowDraggable, rowNumber, rowSelection, sourceColumns, sourceRows.length]);
  const utilityColumnCount = (rowDraggable ? 1 : 0) + (rowSelection ? 1 : 0) + (rowNumber ? 1 : 0);

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
  const sortDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Selection can be either controlled by the consumer or owned internally.
  // selectionRange represents spreadsheet-style multi-cell drag selection.
  const [selection, setSelection] = useControllableValue(selectedCell, defaultSelectedCell, onSelectedCellChange);
  const [selectionRange, setSelectionRange] = useState<{ anchor: GridSelection; focus: GridSelection } | null>(null);
  const rangeDragRef = useRef<{ anchor: GridSelection; moved: boolean } | null>(null);

  // Axis selections are tracked by stable keys rather than indices so sorting,
  // filtering, and row insertion do not silently select a different record.
  const [rowKeys, setRowKeys] = useControllableKeys(selectedRowKeys, defaultSelectedRowKeys, (keys) => {
    if (!onSelectedRowKeysChange) return;
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
    onSelectedRowKeysChange(keys, entries.map(({ row }) => row), entries.map(({ index }) => index));
  });
  const [columnKeys, setColumnKeys] = useControllableKeys(selectedColumnKeys, defaultSelectedColumnKeys, onSelectedColumnKeysChange);

  // Cell editing is split into identity plus draft. The row data remains owned
  // by the consumer; Table only emits onCellChange when the draft commits.
  const [editing, setEditing] = useState<GridSelection | null>(null);
  const [draft, setDraft] = useState('');
  const [rowDragPreview, setRowDragPreview] = useState<{ sourceIndex: number; targetIndex: number } | null>(null);

  useEffect(() => {
    if (!loading) hasCompletedLoadRef.current = true;
  }, [loading]);

  useEffect(() => {
    if (rangeSelection) return;
    rangeDragRef.current = null;
    setSelectionRange(null);
  }, [rangeSelection]);

  useEffect(() => () => {
    if (headerTooltipTimerRef.current !== null) clearTimeout(headerTooltipTimerRef.current);
    if (cellTooltipTimerRef.current !== null) clearTimeout(cellTooltipTimerRef.current);
  }, []);

  const measureCustomHeaderHeight = useCallback(() => {
    let nextHeight = 0;
    customHeaderContentRefs.current.forEach((node) => {
      nextHeight = Math.max(nextHeight, Math.ceil(node.scrollHeight) + 16);
    });
    setMeasuredHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  useLayoutEffect(() => {
    const activeCustomHeaderKeys = new Set(columns.filter((column) => column.renderHeader).map((column) => column.key));
    customHeaderContentRefs.current.forEach((_, key) => {
      if (!activeCustomHeaderKeys.has(key)) customHeaderContentRefs.current.delete(key);
    });
    if (customHeaderContentRefs.current.size === 0) {
      setMeasuredHeaderHeight(0);
      return;
    }
    measureCustomHeaderHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureCustomHeaderHeight);
    customHeaderContentRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [columns, measureCustomHeaderHeight, viewport.width]);

  const [filterEditor, setFilterEditor] = useState<{ columnIndex: number; left: number; top: number; draft: string } | null>(null);
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
  const [hoveredHeaderAction, setHoveredHeaderAction] = useState<{ columnIndex: number; action: 'sort' | 'filter' | 'drag' | 'title' } | null>(null);
  const [visibleHeaderTooltip, setVisibleHeaderTooltip] = useState<{ columnIndex: number; action: 'sort' | 'filter' | 'drag' | 'title' } | null>(null);
  const [hoveredCellTooltip, setHoveredCellTooltip] = useState<{ rowIndex: number; columnIndex: number; left: number; top: number; label: string; color?: string; annotation?: boolean; placement?: 'left' | 'right' } | null>(null);
  const [displaySortState, setDisplaySortState] = useState(sortState);

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

  const rows = useMemo(() => {
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
    if (pendingDeletedRowKeys.size === 0) return next;
    return next.filter((row, index) => !pendingDeletedRowKeys.has(getDataRowKey(row, index)));
  }, [getDataRowKey, pendingDeletedRowKeys, pendingInserts, sourceRows]);

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

  const metrics = useMemo(() => buildColumnMetrics(columns, { columnDraggable, viewportWidth: viewport.width }), [columnDraggable, columns, viewport.width]);
  const contentWidth = metrics.length > 0 ? metrics[metrics.length - 1].right : 0;
  const contentHeight = rows.length * rowHeight;
  const fixedWidth = useMemo(() => columns.reduce((width, column, index) => column.fixed === 'left' ? Math.max(width, metrics[index].right) : width, 0), [columns, metrics]);
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
  const hasRowSelectionColumn = useMemo(() => columns.some((column) => column.rowSelection), [columns]);
  const rowSelectionMode = typeof rowSelection === 'object' ? rowSelection.mode ?? 'multiple' : 'multiple';
  const hasSummaryRow = useMemo(() => rows.length > 0 && summaryEnabled && columns.some((column) => Boolean(column.summary)), [columns, rows.length, summaryEnabled]);
  const topSummaryHeight = hasSummaryRow && summaryPosition === 'top' ? rowHeight : 0;
  const bottomSummaryHeight = hasSummaryRow && summaryPosition === 'bottom' ? rowHeight : 0;
  const bodyTop = headerHeight + topSummaryHeight;
  const bodyContentHeight = rows.length === 0 ? EMPTY_BODY_HEIGHT : contentHeight;
  const realContentHeight = bodyTop + bodyContentHeight + bottomSummaryHeight + (contentWidth > viewport.width ? horizontalScrollbarHeight : 0);
  const effectiveHeight = autoHeight ? Math.max(bodyTop + bottomSummaryHeight, Math.min(resolvedHeight, realContentHeight)) : resolvedHeight;
  const renderHeight = Math.max(0, effectiveHeight - bottomSummaryHeight);
  const bodyViewportHeight = Math.max(0, renderHeight - (fixedHeader ? headerHeight : 0) - topSummaryHeight);
  const [summaryState, setSummaryState] = useState<{
    columns: InternalGridColumn<Row>[] | null;
    rows: Row[] | null;
    values: Map<string, ReactNode>;
    pending: boolean;
  }>(() => ({ columns: null, rows: null, values: new Map(), pending: false }));
  const summaryPending = hasSummaryRow
    && (loading || summaryState.pending || summaryState.columns !== columns || summaryState.rows !== rows);
  const summaryValues = hasSummaryRow && summaryState.columns === columns && summaryState.rows === rows
    ? summaryState.values
    : new Map<string, ReactNode>();

  useEffect(() => {
    let cancelled = false;
    if (!hasSummaryRow) {
      setSummaryState((current) => current.columns === null && current.rows === null && current.values.size === 0 && !current.pending
        ? current
        : { columns: null, rows: null, values: new Map(), pending: false });
      return () => {
        cancelled = true;
      };
    }

    setSummaryState((current) => ({
      columns,
      rows,
      values: current.columns === columns && current.rows === rows ? current.values : new Map(),
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
      setSummaryState({ columns, rows, values, pending: false });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [columns, hasSummaryRow, loading, rows]);

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
      selection: readThemeColor(themeStyles, '--rvg-color-primary', '#1677ff'),
      selectionFill: readThemeColor(themeStyles, '--rvg-color-selection-fill', '#edf4ff'),
      axisSelectionFill: readThemeColor(themeStyles, '--rvg-color-axis-selection-fill', '#e8f2ff'),
      rowHoverFill: readThemeColor(themeStyles, '--rvg-color-row-hover-fill', '#f6f9fc'),
      editedFill: editedCellHighlightColor ?? readThemeColor(themeStyles, '--rvg-color-edited-fill', '#fff1b8'),
      insertedFill: insertedRowHighlightColor ?? readThemeColor(themeStyles, '--rvg-color-inserted-fill', '#c8ead4'),
      stripe: stripedColor ?? readThemeColor(themeStyles, '--rvg-color-stripe', '#fafbfc'),
    };
    const scroll = scrollRef.current;
    const rowScrollTop = fixedHeader ? scroll.top : Math.max(0, scroll.top - bodyTop);
    const range = isVirtualized
      ? getViewportRange(scroll.left, rowScrollTop, viewport.width, bodyViewportHeight, rows.length, rowHeight, metrics, virtualOverscan)
      : { rowStart: 0, rowEnd: rows.length, columnStart: 0, columnEnd: columns.length };
    paintGrid({ context, width: viewport.width, height: renderHeight, pixelRatio: ratio, scrollLeft: scroll.left, scrollTop: scroll.top, rowHeight, headerHeight, bodyTop, suppressLastRowBottomBorder: bottomSummaryHeight > 0, suppressFrameBottomBorder: bottomSummaryHeight > 0, fixedHeader, verticalBorderless: !hasVerticalBorders, striped: hasStripedRows, columnDraggable, sortState, filterValues, hoveredHeaderAction: hoveredHeaderActionRef.current, rows, columns, metrics, range, selection, editing, hoveredRowIndex: hoveredRowIndexRef.current, selectionRange, selectedRowKeys: selectedRowKeySet, selectedColumnKeys: selectedColumnKeySet, cellSpans: cellSpanLookup.covered, maxRowSpan: cellSpanLookup.maxRowSpan, highlightEditedCells: highlightsEditedCells, highlightInsertedRows: highlightsInsertedRows, insertedRowKeys: insertedRowKeySet, editedCellKeys, cellAnnotations, getRowKey, rowDragPreview, colors: themeColors });
  }, [bodyTop, bodyViewportHeight, bottomSummaryHeight, cellAnnotations, cellSpanLookup, columnDraggable, columns, editedCellHighlightColor, editedCellKeys, editing, renderHeight, filterValues, fixedHeader, getRowKey, hasStripedRows, hasVerticalBorders, headerHeight, highlightsEditedCells, highlightsInsertedRows, insertedRowHighlightColor, insertedRowKeySet, isVirtualized, metrics, rowDragPreview, rowHeight, rows, selectedColumnKeySet, selectedRowKeySet, selection, selectionRange, sortState, stripedColor, viewport.width, virtualOverscan]);

  // Canvas work is scheduled with requestAnimationFrame so scroll and hover can
  // update quickly without forcing a synchronous repaint on every pointer event.
  const scheduleDraw = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

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

  useEffect(() => {
    setDisplaySortState(sortState);
  }, [sortState]);

  useEffect(() => () => {
    if (sortDebounceRef.current !== null) clearTimeout(sortDebounceRef.current);
    if (textFrameRef.current !== null) cancelAnimationFrame(textFrameRef.current);
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
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

  const handleScroll = useCallback(() => {
    const element = scrollerRef.current;
    if (!element) return;
    scrollRef.current = { left: element.scrollLeft, top: element.scrollTop };
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
          ? metric.left
          : column.fixed === 'right'
            ? viewport.width - (rightFixedOffsets.get(selection.columnIndex) ?? 0) - metric.width
            : metric.left - element.scrollLeft;
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
          const left = Math.round(Math.max(rawLeft - borderWidth, horizontalStart - 1));
          const right = Math.round(Math.min(rawRight + 1, horizontalEnd, viewport.width));
          const top = Math.round(Math.max(rawTop - borderWidth, verticalStart - 1));
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
    if (hoveredHeaderActionRef.current) {
      hoveredHeaderActionRef.current = null;
      setHoveredHeaderAction(null);
    }
    setHoveredCellTooltip(null);
    scheduleDraw();
    setEditing(null);
  }, [bodyTop, columns, renderHeight, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getRowKey, metrics, rightFixedOffsets, rightFixedWidth, rowHeight, rows, scheduleDraw, selection, selectionRange, viewport.width]);

  const locateColumn = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    let columnIndex: number;
    if (localX < fixedWidth) {
      columnIndex = hitTestColumn(metrics, localX);
    } else if (rightFixedWidth > 0 && localX >= viewport.width - rightFixedWidth) {
      columnIndex = columns.findIndex((column, index) => {
        if (column.fixed !== 'right') return false;
        const left = viewport.width - (rightFixedOffsets.get(index) ?? 0) - metrics[index].width;
        return localX >= left && localX < left + metrics[index].width;
      });
    } else {
      columnIndex = hitTestColumn(metrics, localX + scrollRef.current.left);
    }
    return columnIndex;
  }, [columns, fixedWidth, metrics, rightFixedOffsets, rightFixedWidth, viewport.width]);

  const getDisplayedColumnLeft = useCallback((columnIndex: number) => {
    const metric = metrics[columnIndex];
    if (columns[columnIndex].fixed === 'left') return metric.left;
    if (columns[columnIndex].fixed === 'right') return viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metric.width;
    return metric.left - scrollRef.current.left;
  }, [columns, metrics, rightFixedOffsets, viewport.width]);

  const locateResizeHandle = useCallback((clientX: number): number => {
    if (!columnResizable || !canvasRef.current) return -1;
    const localX = clientX - canvasRef.current.getBoundingClientRect().left;
    let closest = -1;
    let distance = 6;
    for (let index = 0; index < columns.length; index += 1) {
      if (columns[index].rowSelection || columns[index].rowDragHandle || columns[index].rowNumber) continue;
      const nextDistance = Math.abs(localX - (getDisplayedColumnLeft(index) + metrics[index].width));
      if (nextDistance < distance) {
        distance = nextDistance;
        closest = index;
      }
    }
    return closest;
  }, [columnResizable, columns, getDisplayedColumnLeft, metrics]);

  const findResizeNeighbor = useCallback((columnIndex: number): number => {
    const resizedColumn = columns[columnIndex];
    for (let index = columnIndex + 1; index < columns.length; index += 1) {
      const column = columns[index];
      if (column.rowSelection || column.rowDragHandle || column.rowNumber) continue;
      if (resizedColumn?.fixed && column.fixed !== resizedColumn.fixed) return -1;
      return index;
    }
    return -1;
  }, [columns]);

  const locateHeaderAction = useCallback((clientX: number, columnIndex: number): 'sort' | 'filter' | null => {
    if (columnIndex < 0 || !canvasRef.current) return null;
    const column = columns[columnIndex];
    if (column.rowSelection || column.rowDragHandle || column.rowNumber) return null;
    const localX = clientX - canvasRef.current.getBoundingClientRect().left;
    const columnRight = getDisplayedColumnLeft(columnIndex) + metrics[columnIndex].width;
    const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
    let right = columnRight - (visibleActions.drag ? 18 : 4);
    if (visibleActions.sort) {
      if (localX >= right - 18 && localX < right) return 'sort';
      right -= 18;
    }
    if (visibleActions.filter && localX >= right - 18 && localX < right) return 'filter';
    return null;
  }, [columnDraggable, columns, getDisplayedColumnLeft, measureHeaderTitleWidth, metrics]);

  const isHeaderTitleTruncated = useCallback((columnIndex: number): boolean => {
    const canvas = canvasRef.current;
    if (columnIndex < 0 || !canvas) return false;
    const column = columns[columnIndex];
    const metric = metrics[columnIndex];
    const titleWidth = measureHeaderTitleWidth(columnIndex);
    const visibleActions = getVisibleHeaderActions(column, metric.width, columnDraggable, titleWidth);
    const actionWidth = (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * 18;
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

  const setDragGuide = useCallback((x: number | null) => {
    const guide = dragGuideRef.current;
    if (!guide) return;
    guide.style.display = x === null ? 'none' : 'block';
    if (x !== null) guide.style.transform = `translateX(${Math.round(x)}px)`;
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
    const getHeaderColumn = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const headerY = fixedHeader ? 0 : -scrollRef.current.top;
      const localY = clientY - rect.top;
      if (localY < headerY || localY >= headerY + headerHeight) return -1;
      return locateColumn(clientX);
    };
    const cleanupDrag = draggable({
      element: canvas,
      canDrag: ({ input }) => {
        // Header drags only start from the drag affordance, not from sort/filter
        // icons or resize handles. Row drags only start from a row drag column.
        const index = getHeaderColumn(input.clientX, input.clientY);
        if (columnDraggable && index >= 0) return locateHeaderDragHandle(input.clientX, index) && locateResizeHandle(input.clientX) < 0;
        const columnIndex = locateColumn(input.clientX);
        return rowDraggable && columnIndex >= 0 && Boolean(columns[columnIndex].rowDragHandle) && locateRow(input.clientY) >= 0;
      },
      getInitialData: ({ input }) => {
        // The drag payload carries only indices. Drop validation later ensures
        // columns cannot move across fixed left/right/scrolling regions.
        const headerColumn = getHeaderColumn(input.clientX, input.clientY);
        if (headerColumn < 0) {
          return { type: 'table-row', sourceIndex: locateRow(input.clientY) };
        }
        const sourceIndex = headerColumn;
        columnDragPreviewRef.current = { sourceIndex, targetIndex: sourceIndex };
        return { type: 'table-column', sourceIndex };
      },
      onGenerateDragPreview: ({ nativeSetDragImage, source }) => {
        const sourceIndex = Number(source.data.sourceIndex);
        setCustomNativeDragPreview({
          nativeSetDragImage,
          render: ({ container }) => {
            const canvasRect = canvas.getBoundingClientRect();
            if (source.data.type === 'table-row') {
              // Row previews show the full visible row width, including fixed
              // columns, so the dragged item resembles the row the user grabbed.
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
                preview.appendChild(cell);
              });
              container.appendChild(preview);
              return () => preview.remove();
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
        if (!Number.isInteger(targetIndex) || columns[targetIndex]?.fixed !== columns[sourceIndex]?.fixed) {
          setDragGuide(null);
          return;
        }
        const edge = target?.columnEdge;
        let destinationIndex = targetIndex + (edge === 'right' ? 1 : 0);
        if (sourceIndex < destinationIndex) destinationIndex -= 1;
        destinationIndex = Math.max(0, Math.min(columns.length - 1, destinationIndex));
        columnDragPreviewRef.current = { sourceIndex, targetIndex: destinationIndex };
        const targetLeft = getDisplayedColumnLeft(targetIndex);
        setDragGuide(edge === 'right' ? targetLeft + metrics[targetIndex].width : targetLeft);
      },
      onDrop: ({ source, location }) => {
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
          if (Number.isInteger(rawTargetIndex) && sourceIndex !== targetIndex) onRowOrderChange?.(sourceIndex, targetIndex);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollerRef.current?.classList.remove('rvg-row-drop-settling'));
          });
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
          return;
        }
        const targetIndex = columnDragPreviewRef.current?.targetIndex ?? Number(target?.targetIndex);
        canvas.style.cursor = 'default';
        setDragGuide(null);
        columnDragPreviewRef.current = null;
        if (Number.isInteger(targetIndex) && sourceIndex !== targetIndex && columns[targetIndex]?.fixed === columns[sourceIndex]?.fixed) {
          onColumnOrderChange?.(sourceIndex - utilityColumnCount, targetIndex - utilityColumnCount);
        }
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      },
    });
    const cleanupDrop = dropTargetForElements({
      element: canvas,
      canDrop: ({ source }) => source.data.type === 'table-column' || source.data.type === 'table-row',
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
        let targetIndex = getHeaderColumn(input.clientX, input.clientY);
        if (targetIndex < 0) return { targetIndex: -1 };
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
        const left = getDisplayedColumnLeft(targetIndex);
        const columnEdge = input.clientX - canvas.getBoundingClientRect().left < left + metrics[targetIndex].width / 2 ? 'left' : 'right';
        return attachClosestEdge({ targetIndex, columnEdge }, { element, input, allowedEdges: ['left', 'right'] });
      },
    });
    return () => {
      cleanupDrag();
      cleanupDrop();
    };
  }, [bodyTop, columnDraggable, columns, fixedHeader, getCellLabel, getDisplayedColumnLeft, getRowKey, headerHeight, locateColumn, locateHeaderDragHandle, locateResizeHandle, locateRow, metrics, onColumnOrderChange, onRowOrderChange, rowDraggable, rowHeight, rows, selectedRowKeySet, setDragGuide, setRowDragGuide, utilityColumnCount]);

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
      if (metric.left - nextLeft < fixedWidth) nextLeft = Math.max(0, metric.left - fixedWidth - horizontalFocusGap);
      if (metric.left + cellWidth - nextLeft > viewport.width - rightFixedWidth) nextLeft = metric.left + cellWidth - viewport.width + rightFixedWidth + horizontalFocusGap;
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
  }, [bodyTop, columns, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, metrics, rightFixedWidth, rowHeight, scheduleDraw, viewport.width]);

  // Prepare the floating editor for a cell. If the cell is partially offscreen,
  // scroll first and wait two animation frames so editorStyle is calculated from
  // the settled scroll position instead of the old coordinates.
  const beginEdit = useCallback((cell: GridSelection) => {
    const column = columns[cell.columnIndex];
    if (!column?.editable || column.dataIndex === undefined) return;
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
      if (metric.left - nextLeft < fixedWidth) nextLeft = Math.max(0, metric.left - fixedWidth - horizontalFocusGap);
      if (metric.left + cellWidth - nextLeft > viewport.width - rightFixedWidth) nextLeft = metric.left + cellWidth - viewport.width + rightFixedWidth + horizontalFocusGap;
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
  }, [columns, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, metrics, rightFixedWidth, rowHeight, rows, scheduleDraw, viewport.width]);

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
  }, [columns, draft, editing, onCellChange, rows]);

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
      if (columns[columnIndex].fixed === undefined && metric.left < scroller.scrollLeft + fixedWidth) scroller.scrollLeft = Math.max(0, metric.left - fixedWidth);
      if (columns[columnIndex].fixed === undefined && metric.left + cellWidth > scroller.scrollLeft + viewport.width - rightFixedWidth) scroller.scrollLeft = metric.left + cellWidth - viewport.width + rightFixedWidth;
    }
  }, [beginEdit, bodyTop, columns, editing, renderHeight, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, getRowKey, metrics, rightFixedWidth, rowHeight, rows, selection, setSelection, viewport.width]);

  const editorStyle = useMemo(() => {
    if (!editing) return undefined;
    const metric = metrics[editing.columnIndex];
    const fixedSide = columns[editing.columnIndex].fixed;
    const span = getCellSpan(editing.rowIndex, editing.columnIndex);
    const cellWidth = getCellDisplayWidth(editing.columnIndex, span?.colSpan ?? 1);
    const cellHeight = rowHeight * (span?.rowSpan ?? 1);
    const cellLeft = fixedSide === 'left'
      ? metric.left
      : fixedSide === 'right'
        ? viewport.width - (rightFixedOffsets.get(editing.columnIndex) ?? 0) - metric.width
        : metric.left - scrollRef.current.left;
    return {
      left: (fixedSide ? cellLeft : Math.max(cellLeft, fixedWidth)) + 1,
      top: Math.max(fixedHeader ? bodyTop : 0, bodyTop + editing.rowIndex * rowHeight - scrollRef.current.top) + 1,
      width: cellWidth - 2,
      height: cellHeight - 2,
    };
  }, [bodyTop, columns, editing, fixedHeader, fixedWidth, getCellDisplayWidth, getCellSpan, metrics, rightFixedOffsets, rowHeight, viewport.width]);

  const handleColumnPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const headerY = fixedHeader ? 0 : -scrollRef.current.top;
    if (localY < headerY || localY >= headerY + headerHeight) return;
    const resizeIndex = locateResizeHandle(event.clientX);
    if (resizeIndex >= 0) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const neighborIndex = findResizeNeighbor(resizeIndex);
      const startGuideX = getDisplayedColumnLeft(resizeIndex) + metrics[resizeIndex].width;
      columnDragRef.current = {
        type: 'resize',
        columnIndex: resizeIndex,
        startX: event.clientX,
        startWidth: metrics[resizeIndex].width,
        startGuideX,
        neighborIndex,
        startNeighborWidth: neighborIndex >= 0 ? metrics[neighborIndex].width : 0,
      };
      suppressClickRef.current = true;
      setResizeGuideX(startGuideX);
      return;
    }
  }, [findResizeNeighbor, fixedHeader, getDisplayedColumnLeft, headerHeight, locateResizeHandle, metrics]);

  const handleColumnPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = columnDragRef.current;
    if (!drag) return;
    const column = columns[drag.columnIndex];
    const minWidth = getMinimumColumnWidth(column, columnDraggable);
    let delta = Math.round(event.clientX - drag.startX);
    if (drag.neighborIndex >= 0) {
      const neighbor = columns[drag.neighborIndex];
      const minNeighborWidth = getMinimumColumnWidth(neighbor, columnDraggable);
      delta = Math.max(minWidth - drag.startWidth, Math.min(drag.startNeighborWidth - minNeighborWidth, delta));
      onColumnResize?.(column.key, drag.startWidth + delta);
      onColumnResize?.(neighbor.key, drag.startNeighborWidth - delta);
      setResizeGuideX(drag.startGuideX + delta);
      return;
    }
    const width = Math.max(minWidth, Math.round(drag.startWidth + delta));
    onColumnResize?.(column.key, width);
    setResizeGuideX(drag.startGuideX + width - drag.startWidth);
  }, [columnDraggable, columns, onColumnResize]);

  const handleColumnPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = columnDragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    columnDragRef.current = null;
    setResizeGuideX(null);
  }, []);

  const queueSortStateChange = useCallback((next: typeof displaySortState) => {
    setDisplaySortState(next);
    if (sortDebounceRef.current !== null) clearTimeout(sortDebounceRef.current);
    sortDebounceRef.current = setTimeout(() => {
      sortDebounceRef.current = null;
      onSortStateChange?.(next);
    }, 200);
  }, [onSortStateChange]);

  const renderHeaderIcons = (columnIndex: number, left: number) => {
    const column = columns[columnIndex];
    if (column.rowSelection || column.rowDragHandle || column.rowNumber) return null;
    const top = (headerHeight - 14) / 2;
    const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
    let right = left + metrics[columnIndex].width - (visibleActions.drag ? 18 : 4);
    const icons = [];
    if (visibleActions.drag) {
      const hovered = hoveredHeaderAction?.columnIndex === columnIndex && hoveredHeaderAction.action === 'drag';
      icons.push(
        <HeaderDragIcon key="drag" className={`rvg-header-icon rvg-header-drag-icon${hovered ? ' is-hovered' : ''}`} style={{ left: left + metrics[columnIndex].width - 16, top }} />,
      );
    }
    if (visibleActions.sort) {
      const hovered = hoveredHeaderAction?.columnIndex === columnIndex && hoveredHeaderAction.action === 'sort';
      const direction = displaySortState?.columnKey === column.key ? displaySortState.direction : null;
      icons.push(
        <HeaderSortIcon key="sort" className={`rvg-header-icon${hovered ? ' is-hovered' : ''}`} style={{ left: right - 16, top }} direction={direction} />,
      );
      right -= 18;
    }
    if (visibleActions.filter) {
      const hovered = hoveredHeaderAction?.columnIndex === columnIndex && hoveredHeaderAction.action === 'filter';
      icons.push(
        <HeaderSearchIcon key="filter" className={`rvg-header-icon rvg-header-search-icon${hovered ? ' is-hovered' : ''}${filterValues[column.key] ? ' is-active' : ''}`} style={{ left: right - 16, top: top + 1 }} />,
      );
    }
    return icons;
  };

  const headerTooltip = (() => {
    if (!visibleHeaderTooltip) return null;
    const { columnIndex, action } = visibleHeaderTooltip;
    const column = columns[columnIndex];
    if (!column) return null;
    const columnRight = getDisplayedColumnLeft(columnIndex) + metrics[columnIndex].width;
    const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
    let anchorX = columnRight - (visibleActions.drag ? 18 : 4);
    let anchorLeft = anchorX;
    let label: string;
    if (action === 'title') {
      const titleWidth = measureHeaderTitleWidth(columnIndex);
      const actionWidth = (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * 18;
      const contentWidth = Math.max(0, metrics[columnIndex].width - actionWidth);
      const textWidth = Math.min(titleWidth, Math.max(0, contentWidth - 20));
      const columnLeft = getDisplayedColumnLeft(columnIndex);
      anchorX = column.align === 'right'
        ? columnLeft + contentWidth - 10
        : column.align === 'center'
          ? columnLeft + metrics[columnIndex].width / 2 + textWidth / 2
          : columnLeft + 10 + textWidth;
      anchorLeft = column.align === 'right'
        ? anchorX - textWidth
        : column.align === 'center'
          ? columnLeft + metrics[columnIndex].width / 2 - textWidth / 2
          : columnLeft + 10;
      label = column.title;
    } else if (action === 'drag') {
      anchorX = columnRight;
      anchorLeft = anchorX;
      label = labels.dragColumn;
    } else if (action === 'sort') {
      const direction = displaySortState?.columnKey === column.key ? displaySortState.direction : null;
      label = direction === 'asc' ? labels.sortAsc : direction === 'desc' ? labels.sortDesc : labels.sortBoth;
    } else {
      if (visibleActions.sort) anchorX -= 18;
      const value = filterValues[column.key];
      label = value ? labels.filterWithValue(value) : labels.filter;
    }
    const placement: 'left' | 'right' = anchorX + 328 > viewport.width ? 'left' : 'right';
    return {
      left: placement === 'right' ? anchorX + 8 : Math.max(8, anchorLeft - 8),
      top: (fixedHeader ? 0 : -scrollPosition.top) + headerHeight / 2,
      label,
      placement,
    };
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
    const nextKey = next ? `${next.columnIndex}:${next.action}` : '';
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
      await Promise.resolve(onInsertRows({ rowIndex: sourceRowIndex >= 0 ? sourceRowIndex : cell.rowIndex, row, position, count, insertedRows }));
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
      const rowKey = getRowKey(rows[rowIndex], rowIndex);
      return (
        <div
          key={`selection:${String(rowKey)}`}
          className="rvg-row-selection-icon"
          style={{ left, top, width: cellWidth, height: cellHeight, opacity: isDraggedSource ? 0 : 1, transform: `translateY(${dragOffset}px)` }}
        >
          <SelectionIcon checked={selectedRowKeySet.has(rowKey)} radio={rowSelectionMode === 'single'} />
        </div>
      );
    }
    if (column.rowDragHandle) {
      return (
        <div
          key={`drag:${String(getRowKey(rows[rowIndex], rowIndex))}`}
          className="rvg-row-drag-icon"
          style={{ left, top, width: cellWidth, height: cellHeight, opacity: isDraggedSource ? 0 : 1, transform: `translateY(${dragOffset}px)` }}
          aria-hidden="true"
        >
          <RowDragHandleIcon />
        </div>
      );
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
    const currentScrollTop = scrollRef.current.top;
    if (column.rowNumber) {
      return (
        <div
          key={column.key}
          className="rvg-header-title"
          style={{ left, top: fixedHeader ? 0 : -currentScrollTop, width: metrics[columnIndex].width, height: headerHeight, justifyContent: 'center', padding: 0, textAlign: 'center' }}
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
          style={{ left, top: fixedHeader ? 0 : -currentScrollTop, width: metrics[columnIndex].width, height: headerHeight }}
        >
          <SelectionIcon checked={allSelected} indeterminate={indeterminate} />
        </div>
      );
    }
    if (column.renderHeader) {
      const visibleActions = getVisibleHeaderActions(column, metrics[columnIndex].width, columnDraggable, measureHeaderTitleWidth(columnIndex));
      const actionWidth = (Number(visibleActions.drag) + Number(visibleActions.filter) + Number(visibleActions.sort)) * 18;
      return (
        <div
          key={column.key}
          className="rvg-header-title is-custom"
          style={{
            left,
            top: fixedHeader ? 0 : -currentScrollTop,
            width: Math.max(0, metrics[columnIndex].width - actionWidth),
            height: headerHeight,
            justifyContent: column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
            textAlign: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
          }}
        >
          <span
            ref={(node) => {
              if (node) customHeaderContentRefs.current.set(column.key, node);
              else customHeaderContentRefs.current.delete(column.key);
            }}
          >
            {column.renderHeader(column)}
          </span>
        </div>
      );
    }
    return null;
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
    const row = rows[selection.rowIndex];
    const metric = metrics[selection.columnIndex];
    const column = columns[selection.columnIndex];
    if (!row || !metric || !column || getRowKey(row, selection.rowIndex) !== selection.rowKey) return null;
    const span = getCellSpan(selection.rowIndex, selection.columnIndex);
    const rawLeft = getDisplayedColumnLeft(selection.columnIndex);
    const rawRight = rawLeft + getCellDisplayWidth(selection.columnIndex, span?.colSpan ?? 1);
    const rawTop = bodyTop + selection.rowIndex * rowHeight - scrollPosition.top;
    const rawBottom = rawTop + rowHeight * (span?.rowSpan ?? 1);
    const horizontalStart = column.fixed === undefined ? fixedWidth : 0;
    const horizontalEnd = column.fixed === undefined ? viewport.width - rightFixedWidth : viewport.width;
    const verticalStart = fixedHeader ? bodyTop : 0;
    if (
      rawRight <= horizontalStart
      || rawLeft >= horizontalEnd
      || rawBottom <= verticalStart
      || rawTop >= renderHeight
    ) return null;
    const borderWidth = 2;
    const left = Math.round(Math.max(rawLeft - borderWidth, horizontalStart - 1));
    const right = Math.round(Math.min(rawRight + 1, horizontalEnd, viewport.width));
    const top = Math.round(Math.max(rawTop - borderWidth, verticalStart - 1));
    const bottom = Math.round(Math.min(rawBottom + 1, renderHeight));
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    } as CSSProperties;
  })();

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
            if (columnDragRef.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const localY = event.clientY - rect.top;
            const headerY = fixedHeader ? 0 : -scrollRef.current.top;
            const columnIndex = locateColumn(event.clientX);
            const inHeader = localY >= headerY && localY < headerY + headerHeight;
            const hoveredAction = inHeader ? locateHeaderAction(event.clientX, columnIndex) : null;
            const hoveredDragHandle = inHeader && locateHeaderDragHandle(event.clientX, columnIndex);
            const hoveredTitle = inHeader
              && !hoveredAction
              && !hoveredDragHandle
              && columnIndex >= 0
              && Boolean(columns[columnIndex]?.title)
              && (tooltipConfig.header || isHeaderTitleTruncated(columnIndex));
            const nextHover = hoveredAction
              ? { columnIndex, action: hoveredAction }
              : hoveredDragHandle
                ? { columnIndex, action: 'drag' as const }
                : hoveredTitle
                  ? { columnIndex, action: 'title' as const }
                : null;
            const previousHover = hoveredHeaderActionRef.current;
            if (previousHover?.columnIndex !== nextHover?.columnIndex || previousHover?.action !== nextHover?.action) {
              hoveredHeaderActionRef.current = nextHover;
              setHoveredHeaderAction(nextHover);
              showHeaderTooltipAfterDelay(nextHover);
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
            const cursor = inHeader && locateResizeHandle(event.clientX) >= 0
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
          onPointerDown={(event) => { handleColumnPointerDown(event); beginRangeDrag(event); }}
          onPointerMove={(event) => { handleColumnPointerMove(event); updateRangeDrag(event); }}
          onPointerUp={(event) => { handleColumnPointerUp(event); endRangeDrag(event); }}
          onPointerCancel={(event) => { handleColumnPointerUp(event); endRangeDrag(event); }}
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
              const columnIndex = locateColumn(event.clientX);
              const action = locateHeaderAction(event.clientX, columnIndex);
              if (action === 'sort') {
                const columnKey = columns[columnIndex].key;
                const next = displaySortState?.columnKey !== columnKey
                  ? { columnKey, direction: 'asc' as const }
                  : displaySortState.direction === 'asc'
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
            if (cell) beginEdit(cell);
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
              {columns.map((column, columnIndex) => column.fixed ? null : (
                columnIndex >= domRange.columnStart && columnIndex < domRange.columnEnd
                  ? <span key={column.key}>{renderHeaderTitle(columnIndex, metrics[columnIndex].left)}</span>
                  : null
              ))}
              <div className="rvg-body-text-clip" style={{ top: fixedHeader ? bodyTop : 0, bottom: 0 }}>
                {Array.from({ length: domRange.rowEnd - domRange.rowStart }, (_, offset) => domRange.rowStart + offset).flatMap((rowIndex) => columns.map((column, columnIndex) => {
                  if (column.fixed || columnIndex < domRange.columnStart || columnIndex >= domRange.columnEnd) return null;
                  return renderCellText(rowIndex, columnIndex, metrics[columnIndex].left);
                }))}
              </div>
            </div>
          </div>
          <div className="rvg-body-text-clip" style={{ top: fixedHeader ? bodyTop : 0, bottom: 0 }}>
            {Array.from({ length: domRange.rowEnd - domRange.rowStart }, (_, offset) => domRange.rowStart + offset).flatMap((rowIndex) => columns.map((column, columnIndex) => {
              if (!column.fixed) return null;
              const left = column.fixed === 'left'
                ? metrics[columnIndex].left
                : viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metrics[columnIndex].width;
              return renderCellText(rowIndex, columnIndex, left);
            }))}
          </div>
          {columns.map((column, columnIndex) => column.fixed === 'left' ? renderHeaderTitle(columnIndex, metrics[columnIndex].left) : null)}
          {columns.map((column, columnIndex) => column.fixed === 'right' ? renderHeaderTitle(columnIndex, viewport.width - (rightFixedOffsets.get(columnIndex) ?? 0) - metrics[columnIndex].width) : null)}
        </div>
        <div className="rvg-spacer" style={{ width: contentWidth, height: contentHeight + bodyTop, marginTop: -renderHeight }} />
      </div>
      {hasSummaryRow && (
        <div
          className={`rvg-summary-row is-${summaryPosition}${hasVerticalBorders ? '' : ' is-vertical-borderless'}`}
          style={{ height: rowHeight, top: summaryPosition === 'top' ? headerHeight : undefined }}
        >
          <div className="rvg-summary-scroll-clip" style={{ left: fixedWidth, right: rightFixedWidth }}>
            <div
              className="rvg-summary-scroll-content"
              style={{ left: -fixedWidth, width: contentWidth, transform: `translateX(${-currentScroll.left}px)` }}
            >
              {columns.map((column, columnIndex) => column.fixed ? null : renderSummaryCell(columnIndex, metrics[columnIndex].left))}
            </div>
          </div>
          <div className="rvg-summary-fixed-layer">
            {columns.map((column, columnIndex) => column.fixed === 'left' ? renderSummaryCell(columnIndex, metrics[columnIndex].left) : null)}
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
            {columns.map((column, index) => column.fixed ? null : <span key={column.key}>{renderHeaderIcons(index, metrics[index].left)}</span>)}
          </div>
        </div>
        <div className="rvg-header-icon-layer">
          {columns.map((column, index) => column.fixed === 'left' ? <span key={column.key}>{renderHeaderIcons(index, metrics[index].left)}</span> : null)}
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
              if (item === 'edit') return renderContextMenuButton('cell-edit', cellContext, labels.edit, () => beginEdit(cell), override, { disabled: !column.editable, icon: <ContextMenuIcon type="edit" /> });
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
                if (!rowDraggable || !onRowOrderChange) return null;
                return renderContextMenuButton('cell-move-up', cellContext, labels.moveUp, () => onRowOrderChange(cell.rowIndex, cell.rowIndex - 1), override, { disabled: cell.rowIndex === 0, icon: <ContextMenuIcon type="move-up" /> });
              }
              if (item === 'move-down') {
                if (!rowDraggable || !onRowOrderChange) return null;
                return renderContextMenuButton('cell-move-down', cellContext, labels.moveDown, () => onRowOrderChange(cell.rowIndex, cell.rowIndex + 1), override, { disabled: cell.rowIndex === rows.length - 1, icon: <ContextMenuIcon type="move-down" /> });
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
                      setConfirmAction(null);
                      setConfirmLoading(false);
                      if (onDeleteRows) {
                        setDeleteBusy(true);
                        try {
                          await Promise.resolve(onDeleteRows({ rows: confirmAction.rows, viewportRange: domRange }));
                        } finally {
                          setDeleteBusy(false);
                        }
                      } else {
                        setPendingDeletedRowKeys((current) => {
                          const next = new Set(current);
                          deletingKeys.forEach((key) => next.add(key));
                          return next;
                        });
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
      <div ref={dragGuideRef} className="rvg-column-guide" />
      {resizeGuideX !== null && (
        <div
          className="rvg-column-guide is-resizing"
          style={{ display: 'block', transform: `translateX(${Math.round(resizeGuideX)}px)` }}
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
                onFilterValuesChange?.(next);
                setFilterEditor(null);
              }
            }}
          />
          <div className="rvg-filter-actions">
            <button type="button" onClick={() => {
              const key = columns[filterEditor.columnIndex].key;
              const next = { ...filterValues };
              delete next[key];
              onFilterValuesChange?.(next);
              setFilterEditor(null);
            }}>{labels.reset}</button>
            <button type="button" className="rvg-filter-confirm" onClick={() => {
              const key = columns[filterEditor.columnIndex].key;
              const next = { ...filterValues };
              if (filterEditor.draft) next[key] = filterEditor.draft;
              else delete next[key];
              onFilterValuesChange?.(next);
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
          {fixedWidth > 0 && <div className="rvg-loading-fixed-shadow is-left" style={{ left: fixedWidth }} />}
          {rightFixedWidth > 0 && <div className="rvg-loading-fixed-shadow is-right" style={{ right: rightFixedWidth }} />}
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
