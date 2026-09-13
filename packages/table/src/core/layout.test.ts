import { describe, expect, it } from 'vitest';
import { buildColumnMetrics, getViewportRange, hitTestColumn } from './layout';

describe('virtual layout', () => {
  const metrics = buildColumnMetrics([{ key: 'a', title: 'A', width: 100 }, { key: 'b', title: 'B', width: 200 }, { key: 'c', title: 'C', width: 80 }]);

  it('builds cumulative column metrics', () => {
    expect(metrics).toEqual([{ left: 0, right: 100, width: 100 }, { left: 100, right: 300, width: 200 }, { left: 300, right: 380, width: 80 }]);
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
