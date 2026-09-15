import { describe, expect, it } from 'vitest';
import { buildColumnMetrics, getViewportRange, hitTestColumn } from './layout';

describe('virtual layout', () => {
  const metrics = buildColumnMetrics([{ key: 'a', title: 'A', width: 100 }, { key: 'b', title: 'B', width: 200 }, { key: 'c', title: 'C', width: 80 }]);

  it('builds cumulative column metrics', () => {
    expect(metrics).toEqual([{ left: 0, right: 100, width: 100 }, { left: 100, right: 300, width: 200 }, { left: 300, right: 380, width: 80 }]);
  });

  it('stretches non-fixed data columns when the viewport is wider than the content', () => {
    const stretched = buildColumnMetrics([
      { key: 'name', title: 'Name', width: 100, fixed: 'left' },
      { key: 'department', title: 'Department' },
      { key: 'amount', title: 'Amount', width: 100, fixed: 'right' },
    ], { viewportWidth: 600 });

    expect(stretched).toEqual([
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 500, width: 400 },
      { left: 500, right: 600, width: 100 },
    ]);
  });

  it('keeps left fixed columns out of automatic stretch targets', () => {
    const stretched = buildColumnMetrics([
      { key: 'name', title: 'Name', fixed: 'left' },
      { key: 'department', title: 'Department', width: 120 },
      { key: 'role', title: 'Role', width: 120 },
      { key: 'amount', title: 'Amount', width: 100, fixed: 'right' },
    ], { viewportWidth: 600 });

    expect(stretched).toEqual([
      { left: 0, right: 140, width: 140 },
      { left: 140, right: 320, width: 180 },
      { left: 320, right: 500, width: 180 },
      { left: 500, right: 600, width: 100 },
    ]);
  });

  it('keeps manually sized data columns stable when stretching the remaining space', () => {
    const stretched = buildColumnMetrics([
      { key: 'name', title: 'Name', width: 180 },
      { key: 'department', title: 'Department' },
      { key: 'role', title: 'Role', width: 160 },
      { key: 'amount', title: 'Amount', width: 100, fixed: 'right' },
    ], { viewportWidth: 700 });

    expect(stretched).toEqual([
      { left: 0, right: 180, width: 180 },
      { left: 180, right: 440, width: 260 },
      { left: 440, right: 600, width: 160 },
      { left: 600, right: 700, width: 100 },
    ]);
  });

  it('returns only visible rows and columns with overscan', () => {
    expect(getViewportRange(110, 1000, 150, 300, 100_000, 25, metrics, 1)).toEqual({ rowStart: 39, rowEnd: 53, columnStart: 0, columnEnd: 3 });
  });

  it('locates a column in logarithmic lookup', () => {
    expect(hitTestColumn(metrics, 299)).toBe(1);
    expect(hitTestColumn(metrics, 300)).toBe(2);
    expect(hitTestColumn(metrics, 500)).toBe(-1);
  });
});
