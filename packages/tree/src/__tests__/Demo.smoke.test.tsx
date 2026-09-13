// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DemoApp from '../../../../demo/src/App';

describe('Tree demo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('configures virtual scrolling on the current tree', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const view = render(<StrictMode><DemoApp /></StrictMode>);

    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: '操作日志' })).toBeNull();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getAllByLabelText('Drag node').length).toBeGreaterThan(0);
    expect(view.container.querySelector('.rc-tree__node-icon')).toBeTruthy();
    expect(view.container.querySelector('.organization-tag--company')?.textContent).toBe('公司');
    expect(view.container.querySelector('.organization-tag--center')?.textContent).toBe('中心');
    expect(view.container.querySelector('.organization-tag--department')?.textContent).toBe('部门');
    expect(view.container.querySelector('.organization-tag--team')?.textContent).toBe('小组');
    expect(view.container.querySelector('.organization-tag--person')?.textContent).toBe('人员');
    expect(view.container.querySelector('details')).toBeNull();
    expect(view.container.querySelector('.inspector-anchor-nav a[href="#config-selection"]')?.textContent).toBe('选择');
    expect(view.container.querySelector('.api-type-link[href="#api-treeexpansionconfig"]')?.textContent).toBe('TreeExpansionConfig');
    expect(view.container.querySelector('#api-treeexpansionconfig')).toBeTruthy();
    const expandAllToggle = screen.getByText('默认展开全部').closest('label')?.querySelector('input');
    const defaultExpandedDropdown = screen.getByRole('button', { name: '默认展开节点' });
    expect(defaultExpandedDropdown.hasAttribute('disabled')).toBe(false);
    fireEvent.click(defaultExpandedDropdown);
    fireEvent.click(screen.getByLabelText('默认展开节点：技术部'));
    fireEvent.click(screen.getByLabelText('默认展开节点：前端架构组'));
    expect(screen.getAllByRole('treeitem').some((row) => row.textContent?.includes('前端架构组'))).toBe(true);
    fireEvent.click(defaultExpandedDropdown);
    expect(expandAllToggle?.checked).toBe(false);
    const selectionBoxToggle = screen.getByText('开启选择框').closest('label')?.querySelector('input');
    expect(selectionBoxToggle).toBeTruthy();
    expect(selectionBoxToggle?.checked).toBe(true);
    expect(view.container.querySelector('.rc-tree__selection-icon')).toBeTruthy();
    expect(screen.getByText('选择模式')).toBeTruthy();
    expect(screen.getByText('多选').closest('label')?.querySelector('input')?.checked).toBe(true);
    expect(screen.getByText('多选').closest('label')?.querySelector('input')?.disabled).toBe(false);
    expect(screen.getByRole('button', { name: '默认选中节点' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '禁用节点（禁止选中/拖拽）' }).hasAttribute('disabled')).toBe(false);
    const defaultSelectionRow = screen.getAllByRole('treeitem').find((row) => row.textContent?.includes('赵灵儿（高级前端）'))!;
    fireEvent.click(defaultSelectionRow);
    expect(defaultSelectionRow.getAttribute('aria-selected')).toBe('true');
    expect(consoleLog).toHaveBeenCalledWith(
      '[Tree] 选中节点',
      expect.objectContaining({ key: '1-2-2-1-2', title: '赵灵儿（高级前端）' }),
      expect.objectContaining({ keys: ['1-2-2-1-2'], selected: true }),
    );
    const employeeRow = screen.getAllByRole('treeitem').find((row) => row.textContent?.includes('赵灵儿（高级前端）'))!;
    fireEvent.click(employeeRow.querySelector('[aria-label="打开 赵灵儿（高级前端） 菜单"]')!);
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    const renameInput = screen.getByRole('textbox', { name: 'Rename 赵灵儿（高级前端）' });
    fireEvent.change(renameInput, { target: { value: '赵灵儿（前端负责人）' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(screen.getByText('赵灵儿（前端负责人）')).toBeTruthy();
    const selectableParentsToggle = screen.getByText('父节点可选').closest('label')?.querySelector('input');
    const expandOnParentClickToggle = screen.getByText('父节点展开/收起（仅在父节点关闭选择时生效）').closest('label')?.querySelector('input');
    expect(selectableParentsToggle).toBeTruthy();
    expect(expandOnParentClickToggle?.disabled).toBe(true);
    fireEvent.click(selectableParentsToggle!);
    expect(expandOnParentClickToggle?.disabled).toBe(false);
    const selectionRows = screen.getAllByRole('treeitem');
    expect(selectionRows.find((row) => row.textContent?.includes('星辰科技有限公司'))?.querySelector('.rc-tree__selection-icon')).toBeNull();
    expect(selectionRows.find((row) => row.textContent?.includes('赵灵儿（前端负责人）'))?.querySelector('.rc-tree__selection-icon')).toBeTruthy();
    fireEvent.click(selectableParentsToggle!);
    expect(expandOnParentClickToggle?.disabled).toBe(true);
    const iconOnlySelection = screen.getByText('只有选择框可选').closest('label')?.querySelector('input');
    const nodeSelection = screen.getByText('节点可选').closest('label')?.querySelector('input');
    fireEvent.click(iconOnlySelection!);
    const selectedEmployeeRow = screen.getAllByRole('treeitem').find((row) => row.textContent?.includes('赵灵儿（前端负责人）'))!;
    fireEvent.click(selectedEmployeeRow);
    expect(selectedEmployeeRow.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(selectedEmployeeRow.querySelector('[aria-label="Select node"]')!);
    expect(selectedEmployeeRow.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(nodeSelection!);
    const defaultSelectionDropdown = screen.getByRole('button', { name: '默认选中节点' });
    fireEvent.click(defaultSelectionDropdown);
    const companyDefaultSelection = screen.getByLabelText('默认选中节点：星辰科技有限公司');
    const backendDefaultSelection = screen.getByLabelText('默认选中节点：段誉（后端工程师）');
    fireEvent.click(companyDefaultSelection);
    fireEvent.click(backendDefaultSelection);
    const selectedRows = screen.getAllByRole('treeitem');
    expect(selectedRows.find((row) => row.textContent?.includes('星辰科技有限公司'))?.getAttribute('aria-selected')).toBe('true');
    expect(selectedRows.find((row) => row.textContent?.includes('赵灵儿（前端负责人）'))?.getAttribute('aria-selected')).toBe('true');
    expect(selectedRows.find((row) => row.textContent?.includes('段誉（后端工程师）'))).toBeUndefined();
    fireEvent.click(defaultSelectionDropdown);
    expect(defaultSelectionDropdown.getAttribute('aria-expanded')).toBe('false');
    const disabledSelectionDropdown = screen.getByRole('button', { name: '禁用节点（禁止选中/拖拽）' });
    fireEvent.click(disabledSelectionDropdown);
    const disableTechnology = screen.getByLabelText('禁用节点（禁止选中/拖拽）：技术部');
    fireEvent.click(disableTechnology);
    expect(screen.getAllByRole('treeitem').find((row) => row.textContent?.includes('技术部'))?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByRole('treeitem').find((row) => row.textContent?.includes('赵灵儿（前端负责人）'))?.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disableTechnology);
    fireEvent.pointerDown(document.body);
    expect(disabledSelectionDropdown.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(defaultSelectionDropdown);
    fireEvent.click(screen.getByLabelText('默认选中节点：星辰科技有限公司'));
    fireEvent.click(screen.getByLabelText('默认选中节点：段誉（后端工程师）'));
    fireEvent.click(defaultSelectionDropdown);

    const virtualToggle = screen.getByText('开启虚拟滚动').closest('label')?.querySelector('input');
    const viewport = screen.getByRole('tree');
    expect(virtualToggle).toBeTruthy();
    expect(virtualToggle?.checked).toBe(false);
    fireEvent.click(virtualToggle!);
    expect(screen.getByRole('tree')).toBe(viewport);
    expect(view.container.querySelector('.tree-frame--virtual-parent')).toBeTruthy();
    expect(view.container.querySelectorAll('[role="tree"]').length).toBe(1);
    view.unmount();
  });
});
