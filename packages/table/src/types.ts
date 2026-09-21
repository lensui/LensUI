import type { CSSProperties, MouseEvent, ReactNode } from 'react';

export type GridKey = string | number;
export type SelectionMode = 'single' | 'multiple';
export type SortDirection = 'asc' | 'desc';

/** Controlled sort state. Null means the grid should render without a sort mark. */
export interface GridSortState { columnKey: string; direction: SortDirection }

/**
 * All built-in copy exposed by Table.
 *
 * Pass Table.locale as an object to replace only the strings you need. Function
 * entries receive runtime values, such as the filtered text or delete row count.
 */
export interface TableLabels {
  choose: string;
  selectDate: string;
  collapseTimePicker: string;
  expandTimePicker: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  hour: string;
  minute: string;
  second: string;
  confirm: string;
  reset: string;
  search: string;
  filter: string;
  filterWithValue: (value: string) => string;
  sortAsc: string;
  sortDesc: string;
  sortBoth: string;
  dragColumn: string;
  revealSelectedCell: string;
  previousYear: string;
  nextYear: string;
  previousMonth: string;
  nextMonth: string;
  previousPage: string;
  nextPage: string;
  empty: string;
  annotation: string;
  annotationMode: string;
  annotationBackground: string;
  annotationCorner: string;
  annotationColor: (index: number) => string;
  annotationContent: string;
  annotationPlaceholder: string;
  removeAnnotation: string;
  selectRow: string;
  deselectRow: string;
  selectColumn: string;
  deselectColumn: string;
  copy: string;
  copyContent: string;
  copySuccess: string;
  copyError: string;
  clear: string;
  clearContent: string;
  undoChange: string;
  undoConfirmTitle: string;
  undoConfirmDescription: string;
  clearConfirmTitle: string;
  clearConfirmDescription: string;
  edit: string;
  insertAbove: string;
  insertBelow: string;
  insertAboveCount: string;
  insertBelowCount: string;
  rowUnit: string;
  moveUp: string;
  moveDown: string;
  deleteRow: string;
  deleteConfirmTitle: string;
  deleteConfirmDescription: (count: number) => string;
  cancel: string;
  delete: string;
  filterColumn: (title: string) => string;
  initialLoading: string;
  refreshing: string;
}

export type TableLocaleCode = 'zh-CN' | 'en-US';
export type TableLocaleConfig =
  | TableLocaleCode
  | {
    /** Base language used by built-in labels and date picker locale. */
    language?: TableLocaleCode;
    /** Project-level i18n overrides for grid copy. */
    labels?: Partial<TableLabels>;
  };

export type TableVirtualizedConfig =
  | boolean
  | {
    /** Enable virtual rendering. */
    enabled?: boolean;
    /** Extra rows and columns rendered around the visible range. Defaults to 4. */
    overscan?: number;
  };

export type TableTooltipConfig =
  | boolean
  | {
    /** Show header text tooltips. */
    header?: boolean;
    /** Show cell text tooltips. */
    cell?: boolean;
  };

export type TableSummaryConfig =
  | boolean
  | {
    /** Where the summary row is displayed. */
    position?: 'top' | 'bottom';
    /** Whether to show internal vertical borders between summary cells and fixed column edges. Disabled when verticalBorderless is true. */
    verticalBordered?: boolean;
    /** Content displayed in summary cells without a value. Defaults to an empty string. */
    emptyValue?: ReactNode;
  };

export interface TableHighlightConfig {
  /** Highlight cells changed through the built-in editor. Pass a color string to customize the fill. Defaults to false. */
  editedCells?: boolean | string;
  /** Highlight rows inserted optimistically through the built-in insert action. Pass a color string to customize the fill. Defaults to false. */
  insertedRows?: boolean | string;
}

export interface TableLayoutConfig {
  /** Fixed body row height in pixels. Defaults to 36. */
  rowHeight?: number;
  /** Header height in pixels. Defaults to 40. */
  headerHeight?: number;
  /** Header action icon size in pixels. Defaults to 14. */
  headerActionSize?: number;
}

export interface TableCellSpan {
  /** Row index in the current rows array. Prefer rowKey when row order can change. */
  rowIndex?: number;
  /** Stable row key. Takes precedence over rowIndex when provided. */
  rowKey?: GridKey;
  /** Anchor column key for the merged cell. */
  columnKey: string;
  /** Number of rows covered by the merged cell. Defaults to 1. */
  rowSpan?: number;
  /** Number of columns covered by the merged cell. Defaults to 1. */
  colSpan?: number;
}

export interface TableCellSpanRuleContext<Row extends object> {
  row: Row;
  rowIndex: number;
  column: GridColumn<Row>;
  columnIndex: number;
  rows: Row[];
  columns: GridColumn<Row>[];
}

export type TableCellSpanRule<Row extends object> = (
  context: TableCellSpanRuleContext<Row>,
) => TableCellSpan | Omit<TableCellSpan, 'rowIndex' | 'rowKey' | 'columnKey'> | false | null | undefined;

export type TableCellSpans<Row extends object> = TableCellSpan[] | TableCellSpanRule<Row>;

export interface TableResolvedCellSpan {
  rowIndex: number;
  columnIndex: number;
  rowSpan: number;
  colSpan: number;
}

export interface AxisSelectionConfig {
  /** single uses radio-style selection, multiple uses checkbox-style selection. */
  mode?: SelectionMode;
}

export interface RowSelectionConfig extends AxisSelectionConfig {
  /** Show the selection column. Defaults to true; when false, click body cells to select rows. */
  showCheckbox?: boolean;
  /** Selection marker style. Arrow stays blank until selected. Defaults to checkbox. */
  indicator?: 'checkbox' | 'arrow' | 'none';
  /** Width of the generated selection column. Defaults to 44. */
  columnWidth?: number;
}

export interface TableRowNumberConfig {
  /** Fix the row number column to the left. Defaults to true. */
  fixed?: boolean;
}

/**
 * Column definition consumed by both the canvas renderer and DOM editor layer.
 *
 * The grid is data-agnostic: dataIndex points at a field on Row, while formatter
 * and editor describe how that value is displayed and edited.
 */
export interface GridColumn<Row> {
  /** Stable column id used for selection, sorting, filtering, and callbacks. */
  key: string;
  /** Header label painted in the text layer. */
  title: string;
  /** Custom React content rendered in the header DOM overlay. */
  renderHeader?: (column: GridColumn<Row>) => ReactNode;
  /** Child columns used to build grouped / multi-level headers. Only leaf columns render body cells. */
  children?: GridColumn<Row>[];
  /** Row field used as this column's cell value. Omit for utility columns. */
  dataIndex?: keyof Row;
  /** Preferred column width in pixels. Layout helpers enforce minimums. */
  width?: number;
  /** Pins the column to the left or right side while horizontal scrolling. */
  fixed?: 'left' | 'right';
  /** Text alignment for body cells and drag previews. */
  align?: 'left' | 'center' | 'right';
  /** Enables double-click / Enter editing when an editor or fallback input exists. */
  editable?: boolean | ((value: unknown, row: Row, rowIndex: number) => boolean);
  /** Built-in editor configuration for text, selectable, date, time, and range cells. */
  editor?:
    | { type: 'text' }
    | { type: 'select'; options: Array<{ label: string; value: string }> }
    | { type: 'date' | 'time' | 'date-time' | 'year' | 'month' | 'date-range' | 'time-range' | 'date-time-range'; format?: string };
  /** Shows sort affordances and allows header click sorting. Defaults to true for data columns. */
  sortable?: boolean;
  /** Shows the header filter/search affordance. Defaults to true for data columns. */
  filterable?: boolean;
  /** Custom display text. Receives the raw row value and overrides defaults. */
  formatter?: (value: unknown, row: Row, rowIndex: number) => string;
  /** Custom React content rendered in the cell DOM overlay. */
  renderCell?: (value: unknown, row: Row, rowIndex: number) => ReactNode;
  /** Show this column in the summary row. true sums numeric values; a function can return custom content. */
  summary?: boolean | ((rows: Row[], column: GridColumn<Row>) => ReactNode);
  /** Custom cell paint style. Supports text color and background color in canvas rendering. */
  cellStyle?: (value: unknown, row: Row, rowIndex: number) => { color?: string; backgroundColor?: string };
}

/** Zero-based row/column coordinates inside the current row and column arrays. */
export interface GridCellPosition {
  rowIndex: number;
  columnIndex: number;
}

/** Full cell identity, combining current coordinates with stable row/column keys. */
export interface GridSelection extends GridCellPosition {
  rowKey: GridKey;
  columnKey: string;
}

/** Cell locator accepted by controlled and default selection props. */
export type GridSelectionTarget =
  | { columnKey: string; rowKey: GridKey; rowIndex?: number; columnIndex?: number }
  | { columnKey: string; rowIndex: number; rowKey?: GridKey; columnIndex?: number };

/** Fully resolved selected cell returned by onSelectedCellChange. */
export interface SelectedCellChange extends GridSelection {
  value: unknown;
}

/** Fired after a cell editor commits a value. */
export interface CellChange<Row> extends GridSelection {
  value: unknown;
  previousValue: unknown;
  row: Row;
}

/** Data cell identity and content passed to mouse callbacks. */
export interface TableCellContext<Row> extends GridSelection {
  row: Row;
  column: GridColumn<Row>;
  value: unknown;
}

/** Imperative Table API. Selection getters reflect the latest committed render. */
export interface TableRef<Row extends object> {
  focus: () => void;
  /** Reveal a data cell without changing selection; false if the target is unavailable. */
  scrollToCell: (target: GridSelectionTarget) => boolean;
  getSelectedCell: () => TableCellContext<Row> | null;
  setSelectedCell: (target: GridSelectionTarget | null) => boolean;
  getSelectedRowKeys: () => GridKey[];
  getSelectedRows: () => Row[];
  setSelectedRowKeys: (keys: GridKey[]) => void;
  getSelectedColumnKeys: () => string[];
  setSelectedColumnKeys: (keys: string[]) => void;
  /** Clear cell, range, row, and column selections. */
  clearSelection: () => void;
  /** Select and edit a cell, or edit the current selection. Returns false for invalid or read-only cells. */
  startEdit: (target?: GridSelectionTarget) => boolean;
  commitEdit: () => void;
  cancelEdit: () => void;
}

/** Fired when the consumer wants to observe or extend a cell context menu. */
export interface ContextMenuEvent<Row> extends GridSelection {
  row: Row;
  clientX: number;
  clientY: number;
}

export type HeaderContextMenuBuiltin = 'copy' | 'select-column';
export type CellContextMenuBuiltin =
  | 'edit'
  | 'copy'
  | 'undo'
  | 'clear'
  | 'annotation'
  | 'select-row'
  | 'select-column'
  | 'insert-above'
  | 'insert-below'
  | 'move-up'
  | 'move-down'
  | 'delete-row';
export type RangeContextMenuBuiltin = 'copy' | 'annotation' | 'undo' | 'clear';
export type ContextMenuSeparator = '|';

export interface CustomContextMenuItem<Context> {
  key: string;
  label?: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  disabled?: boolean | ((context: Context) => boolean);
  danger?: boolean;
  hidden?: boolean | ((context: Context) => boolean);
  onClick?: (context: Context) => void;
  childrens?: Array<CustomContextMenuItem<Context> | ContextMenuSeparator>;
  render?: ReactNode | ((context: Context) => ReactNode);
}

export type ContextMenuItem<Row, Builtin extends string, Context> =
  | Builtin
  | ContextMenuSeparator
  | CustomContextMenuItem<Context>;

export interface ContextMenuExcludeConfig<Builtin extends string> {
  /** Start from the default menu for this area, then hide these built-in items. */
  exclude?: Builtin[];
}

export interface HeaderContextMenuContext<Row> {
  column: GridColumn<Row>;
  columnIndex: number;
}

export interface CellContextMenuContext<Row> extends GridSelection {
  row: Row;
  column: GridColumn<Row>;
  value: unknown;
}

export interface RangeContextMenuContext<Row> {
  cells: Array<CellContextMenuContext<Row>>;
}

export type ContextMenuSection<Row, Builtin extends string, Context> =
  | boolean
  | Array<ContextMenuItem<Row, Builtin, Context>>
  | ContextMenuExcludeConfig<Builtin>;

export interface TableContextMenuConfig<Row> {
  header?: ContextMenuSection<Row, HeaderContextMenuBuiltin, HeaderContextMenuContext<Row>>;
  cell?: ContextMenuSection<Row, CellContextMenuBuiltin, CellContextMenuContext<Row>>;
  range?: ContextMenuSection<Row, RangeContextMenuBuiltin, RangeContextMenuContext<Row>>;
}

export type TableContextMenu<Row> = boolean | TableContextMenuConfig<Row>;

/**
 * Public props for Table.
 *
 * Rendering is canvas-first for performance, with DOM overlays for selectable
 * text, editors, tooltips, menus, and controls that need native interaction.
 */
export interface TableProps<Row extends object> {
  columns: GridColumn<Row>[];
  rows: Row[];
  /** Stable row id. Defaults to the row's `id` field when omitted. */
  rowKey?: keyof Row | ((row: Row, index: number) => GridKey);
  width?: number | string;
  /** Grid height. Defaults to 100%; falls back to 480px when the parent has no height. */
  height?: number | string;
  /** Shrink the grid to its real content height when there are fewer rows than the configured max height can display. Defaults to true. */
  autoHeight?: boolean;
  /** Layout and sizing configuration. Prefer this over rowHeight/headerHeight for new code. */
  layout?: TableLayoutConfig;
  /** @deprecated Use layout.rowHeight instead. */
  rowHeight?: number;
  /** @deprecated Use layout.headerHeight instead. */
  headerHeight?: number;
  fixedHeader?: boolean;
  locale?: TableLocaleConfig;
  /** Hide vertical grid lines while keeping horizontal row separators. Prefer borderless for new code. */
  borderless?: boolean;
  /** @deprecated Use borderless instead. */
  verticalBorderless?: boolean;
  /** Hide horizontal row and frame separators while keeping vertical grid lines. */
  horizontalBorderless?: boolean;
  /** Hide the outer table frame while keeping internal row and column separators. */
  frameBorderless?: boolean;
  /** Paint alternating row backgrounds. Pass a color string to customize the stripe color. */
  striped?: boolean | string;
  /** Visual highlight feedback configuration. All entries default to false. */
  highlight?: TableHighlightConfig;
  /** Merged body cell configuration. Utility columns are ignored and horizontal spans are limited to the same fixed column region. */
  cellSpans?: TableCellSpans<Row>;
  loading?: boolean;
  /** Custom loading content. When provided, it is used for both initial loading and refresh loading. */
  loadingContent?: ReactNode;
  /** Enable virtual rendering, or configure it with an object. */
  virtualized?: TableVirtualizedConfig;
  /** Show text tooltips for headers and cells. Pass an object to control them separately. */
  tooltip?: TableTooltipConfig;
  /** Show and position the summary row for columns with summary configured. */
  summary?: TableSummaryConfig;
  /** Show an automatically generated row number column on the left. */
  rowNumber?: boolean | TableRowNumberConfig;
  selectedCell?: GridSelectionTarget | null;
  defaultSelectedCell?: GridSelectionTarget | null;
  onSelectedCellChange?: (selection: SelectedCellChange | null) => void;
  /** Enable spreadsheet-style mouse drag selection across multiple body cells. Defaults to false. */
  rangeSelection?: boolean;
  rowSelection?: boolean | RowSelectionConfig;
  selectedRowKeys?: GridKey[];
  defaultSelectedRowKeys?: GridKey[];
  onSelectedRowChange?: (keys: GridKey[], rows: Row[], indices: number[]) => void;
  columnSelection?: boolean | AxisSelectionConfig;
  selectedColumnKeys?: string[];
  defaultSelectedColumnKeys?: string[];
  onSelectedColumnChange?: (keys: string[]) => void;
  columnDraggable?: boolean;
  columnResizable?: boolean;
  onColumnsReorder?: (
    columns: GridColumn<Row>[],
    detail: { sourceIndex: number; targetIndex: number; type: 'column' | 'group'; sourceKey: string; targetKey: string; parentKey?: string; placement: 'before' | 'after' },
  ) => void;
  onColumnResize?: (columnKey: string, width: number) => void;
  rowDraggable?: boolean;
  onRowsReorder?: (rows: Row[], detail: { sourceIndex: number; targetIndex: number }) => void;
  /** Receives the complete rows array and the rows added by the built-in insert operation. */
  onInsertRows?: (rows: Row[], insertedRows: Row[]) => void | Promise<void>;
  /** Receives the complete rows array and the rows removed by the built-in delete operation. */
  onDeleteRows?: (rows: Row[], deletedRows: Row[]) => void | Promise<void>;
  /** Overrides the built-in value sorting. Return rows ordered for the internally managed sort state. */
  onSortChange?: (rows: Row[], state: GridSortState) => Row[];
  /** Overrides the built-in text filtering. Return the rows that match the internally managed filter values. */
  onFilterChange?: (rows: Row[], values: Readonly<Record<string, string>>) => Row[];
  onCellChange?: (change: CellChange<Row>) => void | Promise<void>;
  /** Starts editing from a single or double click. Defaults to double-click. */
  editTrigger?: 'single-click' | 'double-click';
  /** Fires on a data cell click, before the default selection behavior. */
  onCellClick?: (cell: TableCellContext<Row>, event: MouseEvent<HTMLElement>) => void;
  /** Fires before double-click editing. preventDefault() cancels editing. */
  onCellDoubleClick?: (cell: TableCellContext<Row>, event: MouseEvent<HTMLElement>) => void;
  onCellContextMenu?: (event: ContextMenuEvent<Row>) => void;
  /** true uses the built-in menu, false disables custom menus, object customizes menu content and order. */
  contextMenu?: TableContextMenu<Row>;
  emptyContent?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export interface ViewportRange {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}
