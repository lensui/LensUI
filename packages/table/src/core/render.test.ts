import { describe, expect, it } from 'vitest';
import { ellipsizeText, paintGrid } from './render';

describe('ellipsizeText', () => {
  const context = {
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as CanvasRenderingContext2D;

  it('adds an ellipsis when body text exceeds the available width', () => {
    expect(ellipsizeText(context, 'abcdef', 45)).toBe('a...');
    expect(ellipsizeText(context, 'abc', 45)).toBe('abc');
  });
});

describe('paintGrid trailing decoration', () => {
  it('extends focused and selected row backgrounds beyond the final real column', () => {
    const fills: Array<{ color: string; x: number; y: number; width: number; height: number }> = [];
    const context = {
      fillStyle: '',
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect(this: { fillStyle: string }, x: number, y: number, width: number, height: number) {
        fills.push({ color: this.fillStyle, x, y, width, height });
      },
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      closePath: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      arc: () => undefined,
      roundRect: () => undefined,
      fillText: () => undefined,
      measureText: () => ({ width: 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    } as unknown as CanvasRenderingContext2D;

    const rows = [{ id: 1, name: 'Focused' }, { id: 2, name: 'Selected' }];
    paintGrid({
      context,
      width: 400,
      height: 160,
      pixelRatio: 1,
      scrollLeft: 0,
      scrollTop: 0,
      rowHeight: 20,
      bodyFontSize: 12,
      headerActionSlotWidth: 16,
      headerHeight: 40,
      bodyTop: 40,
      fixedHeader: true,
      verticalBorderless: false,
      horizontalBorderless: true,
      frameBorderless: true,
      extendVerticalGridLines: true,
      striped: true,
      columnDraggable: false,
      sortState: null,
      filterValues: {},
      hoveredHeaderAction: null,
      rows,
      rowStyle: (_row, rowIndex) => rowIndex === 0 ? { backgroundColor: '#focus-row' } : {},
      columns: [{ key: 'name', title: 'Name', dataIndex: 'name', width: 200 }],
      metrics: [{ left: 0, width: 200, right: 200 }],
      range: { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 1 },
      selection: null,
      editing: null,
      hoveredRowIndex: null,
      selectionRange: null,
      selectedRowKeys: new Set([2]),
      rowSelectionMode: 'single',
      selectedColumnKeys: new Set(),
      cellSpans: new Map(),
      maxRowSpan: 1,
      highlightEditedCells: false,
      highlightInsertedRows: false,
      insertedRowKeys: new Set(),
      editedCellKeys: new Set(),
      cellAnnotations: new Map(),
      getRowKey: (row) => row.id,
      rowDragPreview: null,
      columnDropTarget: null,
      colors: {
        axisSelectionFill: '#selected-row',
        stripe: '#stripe-row',
      },
    });

    expect(fills).toContainEqual({ color: '#focus-row', x: 200, y: 40, width: 200, height: 20 });
    expect(fills).toContainEqual({ color: '#selected-row', x: 200, y: 60, width: 200, height: 20 });
  });
});
