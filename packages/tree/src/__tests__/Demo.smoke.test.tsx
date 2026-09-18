// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../demo/src/App';

describe('Tree demo', () => {
  it('renders the interactive workbench and updates selection settings', () => {
    const view = render(<App />);

    expect(screen.getByRole('tree', { name: 'Project files' })).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Drag node').length).toBeGreaterThan(0);
    expect(view.container.querySelector('.rc-tree__node-icon')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '单选' }));
    expect(screen.getByRole('button', { name: '单选' }).className).toContain('is-active');

    const linesToggle = screen.getByText('显示辅助线').closest('label')?.querySelector('input');
    expect(linesToggle?.checked).toBe(true);
    fireEvent.click(linesToggle!);
    expect(linesToggle?.checked).toBe(false);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Tree.tsx' } });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Tree.tsx');
  });
});
