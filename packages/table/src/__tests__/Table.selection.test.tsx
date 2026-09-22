// @vitest-environment jsdom
import { createRef, type CSSProperties } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveColumnDropIndex, resolveColumnDropPlacement, Table } from '../Table';
import type { GridColumn, TableRef } from '../types';

const rows = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }, { id: 3, name: 'Three' }];
const columns: GridColumn<(typeof rows)[number]>[] = [{ key: 'name', title: 'Name', dataIndex: 'name', width: 800 }];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Table column reorder placement', () => {
  it('resolves insertion indices consistently in both drag directions', () => {
    expect(resolveColumnDropIndex(0, 2, 'left', 4)).toBe(1);
    expect(resolveColumnDropIndex(0, 2, 'right', 4)).toBe(2);
    expect(resolveColumnDropIndex(3, 1, 'left', 4)).toBe(1);
    expect(resolveColumnDropIndex(3, 1, 'right', 4)).toBe(2);
  });

  it('keeps the reported placement aligned with the hovered edge', () => {
    expect(resolveColumnDropPlacement('left')).toBe('before');
    expect(resolveColumnDropPlacement('right')).toBe('after');
  });


  it('reorders columns through the canvas pointer gesture', () => {
    const dragColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const onColumnsReorder = vi.fn();
    const view = render(
      <Table
        columns={dragColumns}
        rows={rows}
        rowNumber={false}
        columnDraggable
        onColumnsReorder={onColumnsReorder}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(canvas, pointerEvent('pointerdown', 50));
    fireEvent(canvas, pointerEvent('pointermove', 350));
    fireEvent(canvas, pointerEvent('pointerup', 350));

    expect(onColumnsReorder).toHaveBeenCalledTimes(1);
    expect(onColumnsReorder.mock.lastCall?.[0].map((column: GridColumn<(typeof rows)[number]>) => column.key)).toEqual(['name', 'id']);
    expect(onColumnsReorder.mock.lastCall?.[1]).toMatchObject({
      sourceIndex: 0,
      targetIndex: 1,
      sourceKey: 'id',
      targetKey: 'name',
      placement: 'after',
    });
  });
});

describe('Table utility column options', () => {
  it('configures header action size through layout', () => {
    const view = render(<Table columns={columns} rows={rows} layout={{ headerActionSize: 18 }} />);
    const root = view.container.querySelector<HTMLElement>('.rvg-root')!;

    expect(root.style.getPropertyValue('--rvg-header-action-size')).toBe('18px');
  });

  it('configures body text size through the theme variable without changing the header', () => {
    const view = render(<Table columns={columns} rows={rows} style={{ '--rvg-font-size-body': '12px' } as CSSProperties} />);
    const root = view.container.querySelector<HTMLElement>('.rvg-root')!;
    const headerText = view.getByText('Name');

    expect(root.style.getPropertyValue('--rvg-font-size-body')).toBe('12px');
    expect(headerText.closest('.rvg-header-title')?.getAttribute('style')).not.toContain('font-size');
  });

  it('controls horizontal separators independently from vertical borders and stripes', () => {
    const view = render(<Table columns={columns} rows={rows} horizontalBorderless frameBorderless striped />);
    const root = view.container.querySelector('.rvg-root')!;
    expect(root.classList.contains('is-horizontal-borderless')).toBe(true);
    expect(root.classList.contains('is-frame-borderless')).toBe(true);
    expect(root.classList.contains('is-vertical-borderless')).toBe(false);
    expect(root.classList.contains('is-striped')).toBe(true);
  });

  it('moves the row number header into the scrolling layer and can fix or hide it again', () => {
    const view = render(<Table columns={columns} rows={rows} rowSelection />);
    expect(view.getByRole('grid').getAttribute('aria-colcount')).toBe('3');
    expect(view.getByText('#').closest('.rvg-text-scroll-content')).toBeNull();
    view.rerender(<Table columns={columns} rows={rows} rowSelection rowNumber={{ fixed: false }} />);
    expect(view.getAllByText('#')).toHaveLength(1);
    expect(view.getByText('#').closest('.rvg-text-scroll-content')).toBeTruthy();
    const scroller = view.getByRole('grid');
    fireEvent.scroll(scroller, { target: { scrollLeft: 30 } });
    expect(view.getByText('#').closest<HTMLElement>('.rvg-text-scroll-content')?.style.transform).toBe('translateX(-30px)');
    view.rerender(<Table columns={columns} rows={rows} rowNumber={{ fixed: true }} />);
    expect(view.getByText('#').closest('.rvg-text-scroll-content')).toBeNull();
    view.rerender(<Table columns={columns} rows={rows} rowNumber={false} />);
    expect(view.queryByText('#')).toBeNull();
  });

  it.each(['single', 'multiple'] as const)('selects rows without checkboxes in %s mode', (mode) => {
    const onChange = vi.fn();
    const view = render(<Table columns={columns} rows={rows} rowSelection={{ mode, showCheckbox: false }} onSelectedRowChange={onChange} />);
    expect(view.getByRole('grid').getAttribute('aria-colcount')).toBe('2');
    expect(view.container.querySelector('.rvg-header-selection-icon')).toBeNull();
    const canvas = view.container.querySelector('canvas')!;
    fireEvent.click(canvas, { clientX: 80, clientY: 55 });
    expect(onChange).toHaveBeenLastCalledWith([1], [rows[0]], [0]);
    fireEvent.click(canvas, { clientX: 80, clientY: 90, ctrlKey: true });
    expect(onChange.mock.lastCall?.[0]).toEqual(mode === 'single' ? [2] : [1, 2]);
    fireEvent.click(canvas, { clientX: 80, clientY: 125, shiftKey: true });
    expect(onChange.mock.lastCall?.[0]).toEqual(mode === 'single' ? [3] : [2, 3]);
    view.rerender(<Table columns={columns} rows={rows} rowSelection onSelectedRowChange={onChange} />);
    expect(view.getByRole('grid').getAttribute('aria-colcount')).toBe('3');
    expect(view.container.querySelector('.rvg-header-selection-icon')).toBeTruthy();
  });

  it.each(['arrow', 'none'] as const)('renders a narrow blank %s selector and keeps modifier-based multi-selection', (indicator) => {
    const onChange = vi.fn();
    const view = render(
      <Table
        columns={columns}
        rows={rows}
        rowNumber={false}
        rowSelection={{ mode: 'multiple', indicator, columnWidth: 28 }}
        onSelectedRowChange={onChange}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;
    const spacer = view.container.querySelector<HTMLElement>('.rvg-spacer')!;

    expect(view.getByRole('grid').getAttribute('aria-colcount')).toBe('2');
    expect(view.container.querySelector('.rvg-header-selection-icon')).toBeNull();
    expect(spacer.style.width).toBe('828px');

    fireEvent.click(canvas, { clientX: 14, clientY: 55 });
    expect(onChange).toHaveBeenLastCalledWith([1], [rows[0]], [0]);
    fireEvent.click(canvas, { clientX: 14, clientY: 90 });
    expect(onChange.mock.lastCall?.[0]).toEqual([2]);
    fireEvent.click(canvas, { clientX: 14, clientY: 125, metaKey: true });
    expect(onChange.mock.lastCall?.[0]).toEqual([2, 3]);

    const callsBeforeHeaderClick = onChange.mock.calls.length;
    fireEvent.click(canvas, { clientX: 14, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(callsBeforeHeaderClick);
  });

  it('marks custom cell content with the axis selection text color', () => {
    const customColumns: GridColumn<(typeof rows)[number]>[] = [{
      key: 'name',
      title: 'Name',
      dataIndex: 'name',
      width: 200,
      renderCell: (value) => <span>{String(value)}</span>,
    }];
    const view = render(
      <Table
        columns={customColumns}
        rows={rows}
        rowSelection
        selectedRowKeys={[1]}
        style={{ '--rvg-color-axis-selection-text': '#fff' } as CSSProperties}
      />,
    );

    expect(view.getByText('One').closest('.rvg-cell-render')?.classList.contains('is-axis-selected')).toBe(true);
    expect(view.getByText('Two').closest('.rvg-cell-render')?.classList.contains('is-axis-selected')).toBe(false);
  });

  it('selects one column by default and multiple columns with modifiers', () => {
    const selectableColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 200 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 200 },
    ];
    const onChange = vi.fn();
    const onSelectedCellChange = vi.fn();
    const view = render(
      <Table
        columns={selectableColumns}
        rows={rows}
        rowNumber={false}
        columnSelection={{ mode: 'multiple' }}
        defaultSelectedCell={{ rowKey: 1, columnKey: 'name' }}
        onSelectedCellChange={onSelectedCellChange}
        onSelectedColumnChange={onChange}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;

    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    expect(onChange).toHaveBeenLastCalledWith(['id']);
    expect(onSelectedCellChange).toHaveBeenLastCalledWith(null);
    expect(view.getByText('ID').closest('.rvg-header-title')?.classList.contains('is-axis-selected')).toBe(true);
    fireEvent.click(canvas, { clientX: 250, clientY: 10 });
    expect(onChange.mock.lastCall?.[0]).toEqual(['name']);
    expect(view.getByText('ID').closest('.rvg-header-title')?.classList.contains('is-axis-selected')).toBe(false);
    expect(view.getByText('Name').closest('.rvg-header-title')?.classList.contains('is-axis-selected')).toBe(true);
    fireEvent.click(canvas, { clientX: 50, clientY: 10, metaKey: true });
    expect(onChange.mock.lastCall?.[0]).toEqual(['name', 'id']);
    fireEvent.click(canvas, { clientX: 250, clientY: 10, shiftKey: true });
    expect(onChange.mock.lastCall?.[0]).toEqual(['id', 'name']);
  });

  it('clears cell focus when clicking blank table space or outside the table', () => {
    const onSelectedCellChange = vi.fn();
    const view = render(
      <Table
        columns={columns}
        rows={rows}
        rowNumber={false}
        autoHeight={false}
        height={200}
        onSelectedCellChange={onSelectedCellChange}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;

    fireEvent.click(canvas, { clientX: 80, clientY: 55 });
    expect(onSelectedCellChange.mock.lastCall?.[0]).toMatchObject({ rowKey: 1, columnKey: 'name' });
    fireEvent.click(canvas, { clientX: 80, clientY: 180 });
    expect(onSelectedCellChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(canvas, { clientX: 80, clientY: 55 });
    fireEvent.pointerDown(document.body);
    expect(onSelectedCellChange).toHaveBeenLastCalledWith(null);
  });

  it('extends the focus outline equally above and below the selected cell', () => {
    const view = render(
      <Table
        columns={columns}
        rows={rows}
        rowNumber={false}
        selectedCell={{ rowKey: 2, columnKey: 'name' }}
      />,
    );
    const focus = view.container.querySelector<HTMLElement>('.rvg-selection-focus')!;

    expect(focus.style.top).toBe('74px');
    expect(focus.style.height).toBe('40px');
  });

  it('reveals header actions only while their column header is hovered', () => {
    const actionColumns: GridColumn<(typeof rows)[number]>[] = [{
      key: 'name',
      title: 'Name',
      dataIndex: 'name',
      width: 400,
      sortable: true,
      filterable: true,
    }];
    const view = render(<Table columns={actionColumns} rows={rows} rowNumber={false} columnDraggable />);
    const canvas = view.container.querySelector('canvas')!;
    const icons = () => [...view.container.querySelectorAll('.rvg-header-icon')];

    expect(icons().every((icon) => !icon.classList.contains('is-header-hovered'))).toBe(true);
    fireEvent.mouseMove(canvas, { clientX: 80, clientY: 10 });
    expect(icons().every((icon) => icon.classList.contains('is-header-hovered'))).toBe(true);
    fireEvent.mouseMove(canvas, { clientX: 80, clientY: 55 });
    expect(icons().every((icon) => !icon.classList.contains('is-header-hovered'))).toBe(true);
  });

  it('keeps custom multi-line header actions aligned with the first header row', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(64);
    const actionColumns: GridColumn<(typeof rows)[number]>[] = [{
      key: 'name',
      title: 'Name',
      dataIndex: 'name',
      width: 400,
      sortable: true,
      filterable: true,
      renderHeader: () => <div>Name<br />varchar<br />--</div>,
    }];
    const view = render(<Table columns={actionColumns} rows={rows} rowNumber={false} columnDraggable />);
    const icons = [...view.container.querySelectorAll<HTMLElement>('.rvg-header-icon')];
    const header = view.container.querySelector<HTMLElement>('.rvg-header-title.is-custom')!;

    expect(icons.length).toBe(3);
    expect(header.style.getPropertyValue('--rvg-header-action-width')).toBe('48px');
    expect(header.style.width).toBe('400px');
    expect(header.classList.contains('is-header-hovered')).toBe(false);
    fireEvent.mouseMove(view.container.querySelector('canvas')!, { clientX: 80, clientY: 10 });
    expect(header.classList.contains('is-header-hovered')).toBe(true);
    expect(icons[0].style.top).toBe('9px');
    expect(icons[1].style.top).toBe('9px');
    expect(icons[2].style.top).toBe('10px');
  });

  it('aligns custom header metadata tooltips with their text and keeps them above grid lines', () => {
    vi.useFakeTimers();
    try {
      const tooltipColumns: GridColumn<(typeof rows)[number]>[] = [{
        key: 'name',
        title: 'Name',
        dataIndex: 'name',
        width: 400,
        renderHeader: () => <div><div data-rvg-tooltip="varchar(180)">varchar</div><div data-rvg-tooltip="customer name">comment</div></div>,
      }];
      const view = render(<Table columns={tooltipColumns} rows={rows} rowNumber={false} />);
      const canvas = view.container.querySelector('canvas')!;
      const [typeTarget, commentTarget] = [...view.container.querySelectorAll<HTMLElement>('[data-rvg-tooltip]')];
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, x: 0, y: 0, toJSON: () => ({}) });
      typeTarget.getBoundingClientRect = () => ({ left: 10, top: 6, right: 100, bottom: 22, width: 90, height: 16, x: 10, y: 6, toJSON: () => ({}) });
      commentTarget.getBoundingClientRect = () => ({ left: 10, top: 22, right: 100, bottom: 38, width: 90, height: 16, x: 10, y: 22, toJSON: () => ({}) });

      fireEvent.mouseMove(canvas, { clientX: 20, clientY: 12 });
      act(() => vi.advanceTimersByTime(1000));

      const tooltip = view.getByRole('tooltip');
      expect(tooltip.textContent).toBe('varchar(180)');
      expect(tooltip.classList.contains('is-below')).toBe(true);
      expect(tooltip.style.left).toBe('10px');
      expect(tooltip.style.top).toBe('26px');

      fireEvent.mouseMove(canvas, { clientX: 20, clientY: 28 });
      act(() => vi.advanceTimersByTime(1000));
      expect(view.getByRole('tooltip').textContent).toBe('customer name');
      expect(view.getByRole('tooltip').style.top).toBe('42px');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Table column resize', () => {
  it('keeps sibling widths unchanged after columns were stretched to fill the viewport', () => {
    const resizeColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const onColumnResize = vi.fn();
    const view = render(
      <Table
        columns={resizeColumns}
        rows={rows}
        rowNumber={false}
        onColumnResize={onColumnResize}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    const spacer = view.container.querySelector<HTMLElement>('.rvg-spacer')!;

    expect(spacer.style.width).toBe('400px');
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };
    fireEvent(canvas, pointerEvent('pointerdown', 200));
    fireEvent(canvas, pointerEvent('pointermove', 240));

    expect(onColumnResize).toHaveBeenLastCalledWith('id', 240);
    expect(spacer.style.width).toBe('440px');
  });

  it('restores the cursor after resizing inside the overlapping drag-handle edge', () => {
    const resizeColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const view = render(<Table columns={resizeColumns} rows={rows} rowNumber={false} columnDraggable />);
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(canvas, pointerEvent('pointerdown', 196));
    fireEvent(canvas, pointerEvent('pointermove', 176));
    fireEvent(canvas, pointerEvent('pointerup', 176));

    expect(document.documentElement.classList.contains('rvg-is-dragging')).toBe(false);
    expect(canvas.style.cursor).toBe('default');
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('keeps sibling widths unchanged and leaves trailing space when a column is narrowed', () => {
    const resizeColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const onColumnResize = vi.fn();
    const view = render(
      <Table
        columns={resizeColumns}
        rows={rows}
        rowNumber={false}
        onColumnResize={onColumnResize}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    const spacer = view.container.querySelector<HTMLElement>('.rvg-spacer')!;
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(canvas, pointerEvent('pointerdown', 200));
    fireEvent(canvas, pointerEvent('pointermove', 100));

    expect(onColumnResize).toHaveBeenLastCalledWith('id', 100);
    expect(spacer.style.width).toBe('300px');
    expect(view.getByText('ID').closest<HTMLElement>('.rvg-header-title')?.style.width).toBe('100px');
    expect(view.getByText('Name').closest<HTMLElement>('.rvg-header-title')?.style.width).toBe('200px');
    const trailingBorder = view.container.querySelector<HTMLElement>('.rvg-trailing-column-border')!;
    expect(trailingBorder.style.left).toBe('299px');
    expect(trailingBorder.style.top).toBe('');
    expect(trailingBorder.style.height).toBe(canvas.style.height);
  });

  it('keeps trailing decoration outside cell hit testing after resize', () => {
    const resizeColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const onSelectedCellChange = vi.fn();
    const view = render(
      <Table
        columns={resizeColumns}
        rows={rows}
        rowNumber={false}
        selectedCell={{ rowKey: 1, columnKey: 'name' }}
        onSelectedCellChange={onSelectedCellChange}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(canvas, pointerEvent('pointerdown', 200));
    fireEvent(canvas, pointerEvent('pointermove', 160));
    fireEvent(canvas, pointerEvent('pointerup', 160));
    fireEvent.click(canvas, { clientX: 160, clientY: 20 });
    fireEvent.click(canvas, { clientX: 380, clientY: 55 });
    expect(onSelectedCellChange).toHaveBeenLastCalledWith(null);
  });

  it('selects the corresponding row when trailing decoration is clicked', () => {
    const resizeColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const onSelectedRowChange = vi.fn();
    const view = render(
      <Table
        columns={resizeColumns}
        rows={rows}
        rowNumber={false}
        rowSelection={{ mode: 'multiple', indicator: 'none', columnWidth: 24 }}
        onSelectedRowChange={onSelectedRowChange}
      />,
    );
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(canvas, pointerEvent('pointerdown', 400));
    fireEvent(canvas, pointerEvent('pointermove', 280));
    fireEvent(canvas, pointerEvent('pointerup', 280));
    // Column resizing suppresses the immediately following click so releasing
    // the pointer cannot accidentally activate content under the resize handle.
    fireEvent.click(canvas, { clientX: 380, clientY: 180 });
    fireEvent.click(canvas, { clientX: 380, clientY: 55 });
    expect(onSelectedRowChange).toHaveBeenLastCalledWith([1], [rows[0]], [0]);

    fireEvent.click(canvas, { clientX: 380, clientY: 95, ctrlKey: true });
    expect(onSelectedRowChange).toHaveBeenLastCalledWith([1, 2], [rows[0], rows[1]], [0, 1]);
  });

  it('allows the final column to shrink to its minimum width', () => {
    const resizeColumns: GridColumn<(typeof rows)[number]>[] = [
      { key: 'id', title: 'ID', dataIndex: 'id', width: 100 },
      { key: 'name', title: 'Name', dataIndex: 'name', width: 100 },
    ];
    const onColumnResize = vi.fn();
    const view = render(<Table columns={resizeColumns} rows={rows} rowNumber={false} onColumnResize={onColumnResize} />);
    const canvas = view.container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 20 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(canvas, pointerEvent('pointerdown', 400));
    fireEvent(canvas, pointerEvent('pointermove', 260));

    expect(onColumnResize).toHaveBeenLastCalledWith('name', 60);
    expect(view.container.querySelector<HTMLElement>('.rvg-spacer')?.style.width).toBe('260px');
    expect(view.getByText('Name').closest<HTMLElement>('.rvg-header-title')?.style.width).toBe('60px');
  });
});

describe('Table cell events and editing permissions', () => {
  const editableColumns: GridColumn<(typeof rows)[number]>[] = [
    { ...columns[0], width: 180, editable: (_value, row) => row.id === 1 },
  ];

  it('reports click and double click context for read-only data cells, excluding utility columns', () => {
    const onClick = vi.fn();
    const onDoubleClick = vi.fn();
    const view = render(<Table columns={columns} rows={rows} onCellClick={onClick} onCellDoubleClick={onDoubleClick} />);
    const canvas = view.container.querySelector('canvas')!;
    fireEvent.click(canvas, { clientX: 80, clientY: 55, detail: 1 });
    expect(onClick.mock.lastCall?.[0]).toMatchObject({ rowKey: 1, columnKey: 'name', rowIndex: 0, columnIndex: 1, row: rows[0], value: 'One' });
    fireEvent.click(canvas, { clientX: 80, clientY: 55, detail: 2 });
    fireEvent.doubleClick(canvas, { clientX: 80, clientY: 55 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDoubleClick.mock.lastCall?.[0]).toMatchObject({ row: rows[0], value: 'One' });
    fireEvent.click(canvas, { clientX: 20, clientY: 55 });
    fireEvent.doubleClick(canvas, { clientX: 20, clientY: 55 });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('checks per-row permissions for double click, keyboard, and the context menu', () => {
    const view = render(<Table columns={editableColumns} rows={rows} />);
    const canvas = view.container.querySelector('canvas')!;
    fireEvent.doubleClick(canvas, { clientX: 80, clientY: 90 });
    expect(view.queryByRole('textbox')).toBeNull();
    fireEvent.click(canvas, { clientX: 80, clientY: 90 });
    fireEvent.keyDown(view.getByRole('grid'), { key: 'Enter' });
    expect(view.queryByRole('textbox')).toBeNull();
    fireEvent.contextMenu(canvas, { clientX: 80, clientY: 90 });
    expect((view.getByRole('menuitem', { name: '编辑' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(canvas, { clientX: 80, clientY: 55 });
    fireEvent.keyDown(view.getByRole('grid'), { key: 'Enter' });
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('One');
  });

  it('can enter editing on a single click', () => {
    const view = render(<Table columns={editableColumns} rows={rows} editTrigger="single-click" />);
    const canvas = view.container.querySelector('canvas')!;

    fireEvent.click(canvas, { clientX: 80, clientY: 55 });

    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('One');
  });

  it('allows preventing double-click editing and rechecks permission before commit', () => {
    let allowed = true;
    const dynamicColumns = [{ ...editableColumns[0], editable: () => allowed }];
    const onChange = vi.fn();
    const view = render(<Table columns={dynamicColumns} rows={rows} onCellDoubleClick={(_cell, event) => event.preventDefault()} onCellChange={onChange} />);
    const canvas = view.container.querySelector('canvas')!;
    fireEvent.click(canvas, { clientX: 80, clientY: 55 });
    fireEvent.doubleClick(canvas, { clientX: 80, clientY: 55 });
    expect(view.queryByRole('textbox')).toBeNull();
    view.rerender(<Table columns={dynamicColumns} rows={rows} onCellChange={onChange} />);
    fireEvent.doubleClick(canvas, { clientX: 80, clientY: 55 });
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Changed' } });
    allowed = false;
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(view.queryByRole('textbox')).toBeNull();
    allowed = true;
    fireEvent.doubleClick(canvas, { clientX: 80, clientY: 55 });
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Changed' } });
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ rowKey: 1, previousValue: 'One', value: 'Changed' });
  });
});


describe('Table ref', () => {
  it('focuses, selects, reads and clears state, and releases the ref on unmount', () => {
    const ref = createRef<TableRef<(typeof rows)[number]>>();
    const view = render(<Table ref={ref} columns={columns} rows={rows} rowSelection columnSelection />);
    act(() => {
      ref.current!.focus();
      expect(ref.current!.setSelectedCell({ rowKey: 2, columnKey: 'name' })).toBe(true);
    });
    expect(ref.current!.getSelectedCell()).toMatchObject({ rowKey: 2, columnKey: 'name', value: 'Two' });
    act(() => {
      ref.current!.setSelectedRowKeys([1, 2, 2]);
    });
    expect(ref.current!.getSelectedCell()).toBeNull();
    act(() => {
      expect(ref.current!.setSelectedCell({ rowKey: 2, columnKey: 'name' })).toBe(true);
      ref.current!.setSelectedColumnKeys(['name', 'missing']);
    });
    expect(document.activeElement).toBe(view.getByRole('grid'));
    expect(ref.current!.getSelectedCell()).toBeNull();
    expect(ref.current!.getSelectedRows()).toEqual([rows[0], rows[1]]);
    const keys = ref.current!.getSelectedRowKeys();
    keys.push(3);
    expect(ref.current!.getSelectedRowKeys()).toEqual([1, 2]);
    expect(ref.current!.getSelectedColumnKeys()).toEqual(['name']);
    act(() => {
      expect(ref.current!.setSelectedCell({ rowKey: 999, columnKey: 'name' })).toBe(false);
      expect(ref.current!.scrollToCell({ rowKey: 1, columnKey: 'missing' })).toBe(false);
    });
    expect(ref.current!.getSelectedCell()).toBeNull();
    act(() => ref.current!.clearSelection());
    expect(ref.current!.getSelectedCell()).toBeNull();
    expect(ref.current!.getSelectedRowKeys()).toEqual([]);
    expect(ref.current!.getSelectedColumnKeys()).toEqual([]);
    view.unmount();
    expect(ref.current).toBeNull();
  });

  it.each(['left', 'center', 'right'] as const)('preserves %s alignment when row height changes during editing', (align) => {
    const ref = createRef<TableRef<(typeof rows)[number]>>();
    const editableColumns = [{ ...columns[0], width: 180, editable: true, align }];
    const view = render(<Table ref={ref} columns={editableColumns} rows={rows} rowHeight={36} />);
    act(() => ref.current!.startEdit({ rowKey: 1, columnKey: 'name' }));
    const input = view.getByRole('textbox') as HTMLInputElement;
    const editor = input.parentElement!;
    const left = editor.style.left;
    const width = editor.style.width;
    expect(input.style.textAlign).toBe(align);
    expect(editor.style.height).toBe('36px');
    view.rerender(<Table ref={ref} columns={editableColumns} rows={rows} rowHeight={57} />);
    expect(editor.style.height).toBe('57px');
    expect(editor.style.left).toBe(left);
    expect(editor.style.width).toBe(width);
    expect(input.style.textAlign).toBe(align);
  });

  it('supports editing and uses updated row data and permissions', () => {
    const ref = createRef<TableRef<(typeof rows)[number]>>();
    const onChange = vi.fn();
    const editableColumns = [{ ...columns[0], width: 180, editable: (_value: unknown, row: (typeof rows)[number]) => row.id === 1 }];
    const view = render(<Table ref={ref} columns={editableColumns} rows={rows} onCellChange={onChange} />);
    act(() => expect(ref.current!.startEdit({ rowKey: 2, columnKey: 'name' })).toBe(false));
    act(() => expect(ref.current!.startEdit({ rowKey: 1, columnKey: 'name' })).toBe(true));
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Updated' } });
    act(() => ref.current!.commitEdit());
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ rowKey: 1, value: 'Updated' });
    const updatedRows = [{ id: 1, name: 'Fresh' }, ...rows.slice(1)];
    view.rerender(<Table ref={ref} columns={editableColumns} rows={updatedRows} onCellChange={onChange} />);
    act(() => expect(ref.current!.startEdit()).toBe(true));
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('Fresh');
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Discard' } });
    act(() => ref.current!.cancelEdit());
    expect(view.queryByRole('textbox')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    view.rerender(<Table ref={ref} columns={[{ ...editableColumns[0], editable: false }]} rows={updatedRows} />);
    act(() => expect(ref.current!.startEdit()).toBe(false));
  });

  it('respects controlled selection and single-selection mode', () => {
    const ref = createRef<TableRef<(typeof rows)[number]>>();
    const onRows = vi.fn();
    const onCell = vi.fn();
    const view = render(<Table ref={ref} columns={columns} rows={rows} selectedCell={null} selectedRowKeys={[1]} rowSelection={{ mode: 'single' }} onSelectedRowChange={onRows} onSelectedCellChange={onCell} />);
    act(() => {
      ref.current!.setSelectedRowKeys([2, 3]);
      ref.current!.setSelectedCell({ rowKey: 2, columnKey: 'name' });
    });
    expect(onRows.mock.lastCall?.[0]).toEqual([2]);
    expect(onCell.mock.lastCall?.[0]).toMatchObject({ rowKey: 2, columnKey: 'name' });
    expect(ref.current!.getSelectedRowKeys()).toEqual([1]);
    expect(ref.current!.getSelectedCell()).toBeNull();
    view.rerender(<Table ref={ref} columns={columns} rows={rows} selectedRowKeys={[2]} />);
    expect(ref.current!.getSelectedRowKeys()).toEqual([2]);
  });

  it('scrolls to a row without changing selection', () => {
    const ref = createRef<TableRef<(typeof rows)[number]>>();
    const manyRows = Array.from({ length: 30 }, (_, id) => ({ id, name: String(id) }));
    const view = render(<Table ref={ref} columns={[{ ...columns[0], width: 180 }]} rows={manyRows} height={200} />);
    act(() => expect(ref.current!.scrollToCell({ rowKey: 29, columnKey: 'name' })).toBe(true));
    expect(view.getByRole('grid').scrollTop).toBeGreaterThan(0);
    expect(ref.current!.getSelectedCell()).toBeNull();
  });
});

describe('Table auto height CSS limits', () => {
  it('keeps the configured limit after headers and rows grow', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      // A 500px parent resolves percentage height; the scroller sees the
      // current (possibly already shrunken) root height instead.
      if (this.classList.contains('rvg-root')) return this.style.height === '100%' ? 500 : parseFloat(this.style.height) || 0;
      if (this.classList.contains('rvg-scroller')) return parseFloat(this.parentElement!.style.height) || 0;
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(48);
    const initialColumns = [{ ...columns[0], width: 200 }];
    const view = render(<Table height="100%" columns={initialColumns} rows={rows} layout={{ headerHeight: 56, rowHeight: 30 }} />);
    const root = view.container.querySelector<HTMLElement>('.rvg-root')!;
    expect(root.style.height).toBe('146px');
    const customColumns = [{ ...initialColumns[0], renderHeader: () => <div>Name<br />Type<br />Comment</div> }];
    view.rerender(<Table height="100%" columns={customColumns} rows={rows} layout={{ headerHeight: 56, rowHeight: 30 }} />);
    expect(root.style.height).toBe('154px');
    const manyRows = Array.from({ length: 1000 }, (_, id) => ({ id, name: String(id) }));
    view.rerender(<Table height="100%" columns={customColumns} rows={manyRows} layout={{ headerHeight: 56, rowHeight: 30 }} />);
    expect(root.style.height).toBe('500px');
    view.rerender(<Table height="100%" columns={customColumns} rows={rows} layout={{ headerHeight: 56, rowHeight: 30 }} />);
    expect(root.style.height).toBe('154px');
  });

  it('remeasures a resized parent and disconnects its observer on unmount', () => {
    let available = 500;
    const observers: { callback: ResizeObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    });
    try {
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('rvg-root')) return this.style.height === '100%' ? available : parseFloat(this.style.height) || 0;
        return parseFloat(this.parentElement?.style.height ?? '') || 0;
      });
      const view = render(<div><Table height="100%" columns={columns} rows={rows} layout={{ headerHeight: 56, rowHeight: 30 }} /></div>);
      const root = view.container.querySelector<HTMLElement>('.rvg-root')!;
      const observer = observers.find((item) => item.observe.mock.calls.some(([element]) => element === root.parentElement))!;
      expect(observer).toBeDefined();
      expect(root.style.height).toBe('146px');
      available = 100;
      act(() => observer.callback([], observer as unknown as ResizeObserver));
      expect(root.style.height).toBe('100px');
      available = 600;
      act(() => observer.callback([], observer as unknown as ResizeObserver));
      expect(root.style.height).toBe('146px');
      view.unmount();
      expect(observer.disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
