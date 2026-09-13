// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tree } from '../components/Tree';
import type { ResolvedTreeNodeData as TreeNodeData, TreeKey, TreeNodeData as DynamicTreeNodeData } from '../types';

const data: TreeNodeData[] = [
  { key: 'first', title: 'First' },
  { key: 'second', title: 'Second' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function DraggableTree() {
  const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>([]);
  return <Tree data={data} expandedKeys={expandedKeys} onExpandedKeysChange={setExpandedKeys} draggable />;
}

describe('Tree Pragmatic Drag and Drop integration', () => {
  it('uses id by default and maps arbitrary business node fields', () => {
    const onChange = vi.fn();
    const idData: DynamicTreeNodeData[] = [{ id: 'from-id', name: 'Default id node' }];
    const dynamicData: DynamicTreeNodeData[] = [{
      uuid: 'org',
      name: 'Dynamic organization',
      nodes: [{ uuid: 'member', name: 'Dynamic member', leaf: true, employeeCode: 'E-001' }],
    }];

    const idView = render(<Tree data={idData} />);
    expect(idView.getByText('Default id node').closest('[role="treeitem"]')?.getAttribute('aria-level')).toBe('1');
    expect('key' in idData[0]!).toBe(false);
    idView.unmount();

    const view = render(<Tree
      data={dynamicData}
      fieldNames={{ key: 'uuid', title: 'name', children: 'nodes', isLeaf: 'leaf' }}
      expansion={{ defaultKeys: ['org'] }}
      selection={{ mode: 'multiple', onChange }}
    />);
    const member = view.getByText('Dynamic member').closest('[role="treeitem"]')!;
    fireEvent.click(member);

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining(['member']),
      expect.objectContaining({ key: 'member', title: 'Dynamic member', employeeCode: 'E-001' }),
      true,
    );
    expect('key' in dynamicData[0]!).toBe(false);
  });

  it('registers draggable rows and keeps the accessible drag handle', () => {
    render(<DraggableTree />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
    expect(screen.getAllByLabelText('Drag node')).toHaveLength(2);
    expect(screen.getAllByRole('treeitem')[0]?.getAttribute('draggable')).toBe('true');
  });

  it('can hide drag handles while keeping the whole node draggable', () => {
    render(<Tree data={data} drag={{ showHandle: false }} />);

    expect(screen.queryByLabelText('Drag node')).toBeNull();
    expect(screen.getAllByRole('treeitem')[0]?.getAttribute('draggable')).toBe('true');
  });

  it('uses margin rather than padding for hierarchy indentation', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];
    const view = render(<Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} />);
    const child = view.container.querySelectorAll<HTMLElement>('[role="treeitem"]')[1];
    // level 1 提供 24px 层级距离；叶子没有 switcher，再补偿一个固定 24px 图标位。
    expect(child?.style.marginInlineStart).toBe('48px');
    expect(child?.style.paddingInlineStart).toBe('4px');
  });

  it('keeps connector lines aligned when indentation changes', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];
    const view = render(<Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} indent={32} />);
    const rows = view.container.querySelectorAll<HTMLElement>('[role="treeitem"]');
    const parentStem = rows[0]?.querySelector<HTMLElement>('.rc-tree__guide--children-stem');
    const childGuide = rows[1]?.querySelector<HTMLElement>('.rc-tree__guide--current');

    expect(parentStem?.style.left).toBe('16px');
    expect(childGuide?.style.left).toBe('-40px');
  });

  it('stops connector branches at the node background boundary', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];
    const view = render(<Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} />);
    const child = view.container.querySelectorAll<HTMLElement>('[role="treeitem"]')[1];
    const branch = child?.querySelector<HTMLElement>('.rc-tree__guide-branch');

    expect(branch?.style.left).toBe('-32px');
    expect(branch?.style.width).toBe('32px');
  });

  it('keeps parent and leaf title spacing consistent with large indentation', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];
    const view = render(<Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} indent={60} />);
    const rows = view.container.querySelectorAll<HTMLElement>('[role="treeitem"]');

    expect(rows[0]?.style.marginInlineStart).toBe('0');
    expect(rows[1]?.style.marginInlineStart).toBe('84px');
  });

  it('does not reserve a node icon slot by default', () => {
    const view = render(<Tree data={[{ key: 'plain', title: 'Plain leaf', isLeaf: true }]} expandedKeys={[]} onExpandedKeysChange={() => undefined} />);
    expect(view.container.querySelector('.rc-tree__node-icon')).toBeNull();
  });

  it('renders the default file icon when node icons are enabled', () => {
    const view = render(<Tree data={[{ key: 'plain', title: 'Plain leaf', isLeaf: true }]} expandedKeys={[]} onExpandedKeysChange={() => undefined} showNodeIcon />);
    expect(view.container.querySelector('[data-tree-icon="file"]')).toBeTruthy();
  });

  it('switches the default folder icon when a parent expands', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child', isLeaf: true }] }];
    const view = render(<Tree data={nestedData} expandedKeys={[]} onExpandedKeysChange={() => undefined} showNodeIcon />);
    expect(view.container.querySelector('[data-tree-icon="folder"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tree-icon="folder-open"]')).toBeNull();

    view.rerender(<Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} showNodeIcon />);
    expect(view.container.querySelector('[data-tree-icon="folder-open"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tree-icon="file"]')).toBeTruthy();
  });

  it('automatically shows an explicitly configured node icon', () => {
    const view = render(<Tree data={[{ key: 'custom', title: 'Custom', icon: <span data-testid="custom-node-icon">!</span> }]} expandedKeys={[]} onExpandedKeysChange={() => undefined} />);
    expect(view.container.querySelector('[data-testid="custom-node-icon"]')).toBeTruthy();
  });

  it('renders the designed icon only for the built-in empty state', () => {
    const view = render(<Tree data={[]} />);

    expect(view.container.querySelector('[data-tree-icon="empty-inbox"]')).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();

    view.rerender(<Tree data={[]} renderers={{ emptyContent: <span>Nothing here</span> }} />);
    expect(view.container.querySelector('[data-tree-icon^="empty-"]')).toBeNull();
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('applies iconColor to the complete interaction theme', () => {
    const view = render(<Tree data={[{ key: 'themed', title: 'Themed' }]} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectedKeys={['themed']} iconColor="#16a34a" />);
    const root = view.container.querySelector<HTMLElement>('.rc-tree');

    expect(root?.style.getPropertyValue('--tree-icon-color')).toBe('#16a34a');
    expect(root?.style.getPropertyValue('--tree-primary')).toBe('#16a34a');
    expect(root?.style.getPropertyValue('--tree-selected')).toContain('#16a34a');
  });

  it('selects a node by clicking its row when selection icons are hidden', () => {
    function SelectionWithoutIcons() {
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="single" showSelectionIcon={false} selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys} />;
    }

    const view = render(<SelectionWithoutIcons />);
    expect(view.container.querySelector('.rc-tree__selection-icon')).toBeNull();
    fireEvent.click(view.getByText('Second').closest('[role="treeitem"]')!);
    expect(view.getByText('Second').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('defaults to row-based single selection without a selection icon', () => {
    const view = render(<Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} />);

    expect(view.container.querySelector('.rc-tree__selection-icon')).toBeNull();
    fireEvent.click(view.getByText('First').closest('[role="treeitem"]')!);
    expect(view.getByText('First').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(view.getByText('Second').closest('[role="treeitem"]')!);
    expect(view.getAllByRole('treeitem').map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('uses radio icons for single selection and checkboxes for multiple selection', () => {
    const view = render(<Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="single" selectedKeys={['first']} />);

    expect(view.container.querySelector('[data-tree-selection="radio-checked"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tree-selection="radio-unchecked"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tree-selection="checked"]')).toBeNull();

    view.rerender(<Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectedKeys={['first']} />);
    expect(view.container.querySelector('[data-tree-selection="checked"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tree-selection="unchecked"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tree-selection^="radio-"]')).toBeNull();
  });

  it('supports default selection in uncontrolled mode', () => {
    const view = render(<Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="single" defaultSelectedKeys={['second']} />);
    const rows = view.getAllByRole('treeitem');

    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    fireEvent.click(rows[0]!);
    expect(view.getAllByRole('treeitem').map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('keeps the current node selected when it is clicked again in single mode', () => {
    const onChange = vi.fn();
    const view = render(<Tree
      data={data}
      expandedKeys={[]}
      onExpandedKeysChange={() => undefined}
      selectionMode="single"
      selectedKeys={['first']}
      onSelectedKeysChange={onChange}
    />);

    fireEvent.click(view.getByText('First').closest('[role="treeitem"]')!);

    expect(view.getByText('First').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: 'Selected node' })).toBeTruthy();
  });

  it('renames through a controlled entry and blocks disabled nodes', () => {
    const onChange = vi.fn();
    const onEditingKeyChange = vi.fn();
    const renameData: TreeNodeData[] = [{ key: 'file', title: 'file.ts' }];
    const view = render(<Tree data={renameData} rename={{ editingKey: 'file', onEditingKeyChange, onChange }} />);
    const input = view.getByRole('textbox', { name: 'Rename file.ts' });
    fireEvent.change(input, { target: { value: 'renamed.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEditingKeyChange).toHaveBeenCalledWith(null);
    expect(onChange).toHaveBeenCalledWith(renameData[0], 'renamed.ts');

    view.rerender(<Tree data={[{ key: 'file', title: 'file.ts', disabled: true }]} rename={{ editingKey: 'file', onEditingKeyChange, onChange }} />);
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('does not use double click as a rename entry', () => {
    const onChange = vi.fn();
    const onEditingKeyChange = vi.fn();
    const view = render(<Tree data={[{ key: 'file', title: 'file.ts' }]} rename={{ editingKey: null, onEditingKeyChange, onChange }} />);

    fireEvent.doubleClick(view.getByText('file.ts'));
    expect(view.queryByRole('textbox')).toBeNull();
    expect(onEditingKeyChange).not.toHaveBeenCalled();
  });

  it('keeps parent nodes interactive but not selectable when parent selection is disabled', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];

    function LeafOnlySelectionTree() {
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectableParents={false} selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys} draggable />;
    }

    const view = render(<LeafOnlySelectionTree />);
    const [parent, child] = view.getAllByRole('treeitem');
    expect(parent?.querySelector('.rc-tree__selection-icon')).toBeNull();
    expect(child?.querySelector('.rc-tree__selection-icon')).toBeTruthy();
    expect(parent?.querySelector('[aria-label="Drag node"]')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Collapse' })).toBeTruthy();

    fireEvent.click(parent!);
    expect(parent?.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(child!);
    expect(view.getAllByRole('treeitem').map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('selects only from the selection control when selectionTrigger is icon', () => {
    function IconOnlySelectionTree() {
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="single" selectionTrigger="icon" showSelectionIcon={false} selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys} />;
    }

    const view = render(<IconOnlySelectionTree />);
    const secondRow = view.getByText('Second').closest('[role="treeitem"]')!;
    fireEvent.click(secondRow);
    expect(secondRow.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(secondRow.querySelector('[aria-label="Select node"]')!);
    expect(view.getByText('Second').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('prioritizes parent selection and expands from the row only when parents are not selectable', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];

    function SelectableParentTree() {
      const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>(['parent']);
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree data={nestedData} expandedKeys={expandedKeys} onExpandedKeysChange={setExpandedKeys} selectionMode="multiple" selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys} expandOnParentClick draggable />;
    }

    const view = render(<SelectableParentTree />);
    const parent = view.getByText('Parent').closest('[role="treeitem"]')!;
    fireEvent.click(view.getByText('Parent'));
    expect(parent.getAttribute('aria-selected')).toBe('true');
    expect(view.getByRole('button', { name: 'Collapse' })).toBeTruthy();
    view.unmount();

    function ExpandableParentTree() {
      const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>(['parent']);
      return <Tree data={nestedData} expandedKeys={expandedKeys} onExpandedKeysChange={setExpandedKeys} selectionMode="multiple" selectableParents={false} expandOnParentClick draggable />;
    }

    const expandableView = render(<ExpandableParentTree />);
    const expandableParent = expandableView.getByText('Parent').closest('[role="treeitem"]')!;
    expect(expandableParent.querySelector('.rc-tree__selection-icon')).toBeNull();
    fireEvent.click(expandableParent.querySelector('[aria-label="Drag node"]')!);
    expect(expandableView.getByRole('button', { name: 'Collapse' })).toBeTruthy();
    fireEvent.click(expandableView.getByText('Parent'));
    expect(expandableView.getByRole('button', { name: 'Expand' })).toBeTruthy();
    expect(expandableView.queryByText('Child')).toBeNull();
  });

  it('places selection and drag handles on the configured side', () => {
    const view = render(<Tree
      data={[{ key: 'row', title: 'Row', isLeaf: true }]}
      selection={{ mode: 'multiple', keys: [], iconPosition: 'right' }}
      drag={{ iconPosition: 'right' }}
    />);
    const row = view.getByRole('treeitem');
    const title = row.querySelector('.rc-tree__title')!;
    const selection = row.querySelector('.rc-tree__selection-icon')!;
    const drag = row.querySelector('.rc-tree__drag')!;

    expect(title.compareDocumentPosition(selection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(drag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands configured default nodes together with their ancestor path', () => {
    const deepData: TreeNodeData[] = [{
      key: 'root',
      title: 'Root',
      children: [{ key: 'parent', title: 'Parent', children: [{ key: 'leaf', title: 'Leaf' }] }],
    }];

    function DefaultExpandedTree() {
      const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>([]);
      return <Tree data={deepData} expandedKeys={expandedKeys} onExpandedKeysChange={setExpandedKeys} defaultExpandedKeys={['parent']} />;
    }

    const view = render(<DefaultExpandedTree />);
    expect(view.getByText('Parent')).toBeTruthy();
    expect(view.getByText('Leaf')).toBeTruthy();
    expect(view.getAllByRole('button', { name: 'Collapse' })).toHaveLength(2);
  });

  it('keeps leaf keys out of the default expand-all state', () => {
    const onChange = vi.fn();
    render(<Tree
      data={[{ key: 'root', title: 'Root', children: [{ key: 'leaf', title: 'Leaf', isLeaf: true }] }]}
      expansion={{ defaultAll: true, onChange }}
    />);
    expect(onChange).toHaveBeenCalledWith(['root'], expect.objectContaining({ key: 'root' }), true);
  });

  it('limits accordion collapsing to siblings under the same parent', () => {
    const accordionData: TreeNodeData[] = [
      {
        key: 'root-a',
        title: 'Root A',
        children: [
          { key: 'branch-a1', title: 'Branch A1', children: [{ key: 'deep-a1', title: 'Deep A1', children: [{ key: 'leaf-a1', title: 'Leaf A1', isLeaf: true }] }] },
          { key: 'branch-a2', title: 'Branch A2', children: [{ key: 'leaf-a2', title: 'Leaf A2', isLeaf: true }] },
        ],
      },
      { key: 'root-b', title: 'Root B', children: [{ key: 'leaf-b', title: 'Leaf B', isLeaf: true }] },
    ];
    const onChange = vi.fn();
    const expanded = ['root-a', 'branch-a1', 'deep-a1', 'root-b'];
    const view = render(<Tree data={accordionData} expansion={{ keys: expanded, accordion: true, onChange }} />);

    fireEvent.click(view.getByText('Branch A2').closest('[role="treeitem"]')!.querySelector('[aria-label="Expand"]')!);

    expect(onChange).toHaveBeenCalledWith(['root-a', 'root-b', 'branch-a2'], accordionData[0]!.children![1], true);
  });

  it('treats root nodes as siblings without affecting deeper accordion rules', () => {
    const accordionData: TreeNodeData[] = [
      { key: 'root-a', title: 'Root A', children: [{ key: 'branch-a', title: 'Branch A', children: [{ key: 'leaf-a', title: 'Leaf A', isLeaf: true }] }] },
      { key: 'root-b', title: 'Root B', children: [{ key: 'leaf-b', title: 'Leaf B', isLeaf: true }] },
    ];
    const onChange = vi.fn();
    const view = render(<Tree data={accordionData} expansion={{ keys: ['root-a', 'branch-a'], accordion: true, onChange }} />);

    fireEvent.click(view.getByText('Root B').closest('[role="treeitem"]')!.querySelector('[aria-label="Expand"]')!);

    expect(onChange).toHaveBeenCalledWith(['root-b'], accordionData[1], true);
  });

  it('adds node spacing outside the node height', () => {
    const view = render(<Tree data={[{ key: 'row', title: 'Row' }]} expandedKeys={[]} onExpandedKeysChange={() => undefined} itemHeight={32} nodeGap={4} />);
    const row = view.container.querySelector<HTMLElement>('[role="treeitem"]');
    expect(row?.style.height).toBe('32px');
    expect(row?.style.marginBlockEnd).toBe('4px');
  });

  it('includes node spacing in the virtual row stride', () => {
    const view = render(<Tree
      data={[{ key: 'first', title: 'First' }, { key: 'second', title: 'Second' }]}
      expandedKeys={[]}
      onExpandedKeysChange={() => undefined}
      virtual
      height={100}
      itemHeight={32}
      nodeGap={8}
    />);
    const rows = view.container.querySelectorAll<HTMLElement>('[role="treeitem"]');
    const spacer = view.container.querySelector<HTMLElement>('[role="tree"] > div');

    expect(rows[0]?.style.top).toBe('0px');
    expect(rows[1]?.style.top).toBe('40px');
    expect(spacer?.style.height).toBe('80px');
  });

  it('renders the template search and clear icons in the default search box', () => {
    const view = render(<Tree data={data} expandedKeys={[]} onExpandedKeysChange={() => undefined} searchable />);
    const input = view.getByRole('searchbox');

    expect(view.container.querySelector('[data-tree-icon="search"]')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'first' } });
    expect(view.container.querySelector('[data-tree-icon="close"]')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveProperty('value', '');
  });

  it('returns the original complete node from search results', () => {
    const onClick = vi.fn();
    const searchData: TreeNodeData[] = [{
      key: 'root',
      title: 'Root',
      children: [
        { key: 'match', title: 'Match' },
        { key: 'hidden', title: 'Hidden' },
      ],
    }];
    const view = render(<Tree data={searchData} search={{ value: 'match' }} events={{ onClick }} />);

    expect(view.queryByText('Hidden')).toBeNull();
    fireEvent.click(view.getByText('Root').closest('[role="treeitem"]')!);
    expect(onClick.mock.calls[0]?.[0]).toBe(searchData[0]);
    expect(onClick.mock.calls[0]?.[0].children).toHaveLength(2);
  });

  it('allows matched parent subtrees to be collapsed and reopened during search', () => {
    const searchData: TreeNodeData[] = [{
      key: 'parent',
      title: 'Matching parent',
      children: [{ key: 'child', title: 'Child' }],
    }];
    const view = render(<Tree data={searchData} search={{ value: 'matching' }} expansion={{ keys: [], onChange: () => undefined }} />);

    expect(view.getByText('Child')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Collapse' }));
    expect(view.queryByText('Child')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Expand' }));
    expect(view.getByText('Child')).toBeTruthy();
  });

  it('opens the same node menu from an action button', () => {
    const onRename = vi.fn();
    const menuData: TreeNodeData[] = [{ key: 'file', title: 'file.ts' }];
    const view = render(<Tree
      data={menuData}
      renderActions={(_node, openMenu) => <button type="button" onClick={openMenu}>Open menu</button>}
      menuItems={() => [{ key: 'rename', label: 'Rename', onClick: onRename }]}
    />);

    fireEvent.click(view.getByRole('button', { name: 'Open menu' }));
    expect(view.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    fireEvent.click(view.getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledWith(menuData[0]);
  });

  it('supports roving keyboard navigation, expansion and selection', () => {
    const keyboardData: TreeNodeData[] = [
      { key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child', isLeaf: true }] },
      { key: 'last', title: 'Last', isLeaf: true },
    ];
    const view = render(<Tree data={keyboardData} expansion={{ defaultKeys: ['parent'] }} />);
    const parent = view.getByText('Parent').closest<HTMLElement>('[role="treeitem"]')!;
    const child = view.getByText('Child').closest<HTMLElement>('[role="treeitem"]')!;

    expect(parent.tabIndex).toBe(0);
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    parent.focus();
    fireEvent.keyDown(parent, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(child);
    fireEvent.keyDown(child, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: 'ArrowLeft' });
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(parent, { key: 'End' });
    const last = view.getByText('Last').closest<HTMLElement>('[role="treeitem"]')!;
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: ' ' });
    expect(last.getAttribute('aria-selected')).toBe('true');
  });

  it('opens and navigates the node menu from the keyboard', () => {
    const menuData: TreeNodeData[] = [{ key: 'file', title: 'file.ts', isLeaf: true }];
    const view = render(<Tree data={menuData} menuItems={() => [
      { key: 'open', label: 'Open' },
      { key: 'disabled', label: 'Disabled', disabled: true },
      { key: 'delete', label: 'Delete' },
    ]} />);
    const row = view.getByRole('treeitem');

    row.focus();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    expect(document.activeElement).toBe(view.getByRole('menuitem', { name: 'Open' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(view.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('auto-scrolls a virtual viewport while dragging near its edge', () => {
    const virtualData = Array.from({ length: 100 }, (_, index) => ({ key: index, title: `Row ${index}`, isLeaf: true }));
    const view = render(<Tree data={virtualData} drag virtual={{ height: 100, itemHeight: 32, overscan: 2 }} />);
    const viewport = view.getByRole('tree');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, right: 300, bottom: 100, left: 0, width: 300, height: 100, toJSON: () => undefined });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 100 });

    const dragOver = createEvent.dragOver(viewport);
    Object.defineProperty(dragOver, 'clientY', { value: 98 });
    fireEvent(viewport, dragOver);
    expect(viewport.scrollTop).toBeGreaterThan(0);
  });

  it('does not rerender virtual rows while scrolling inside the same calculated window', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const renders = new Map<TreeKey, number>();
    const virtualData = Array.from({ length: 100 }, (_, index) => ({ key: index, title: `Row ${index}`, isLeaf: true }));
    const view = render(<Tree
      data={virtualData}
      virtual={{ height: 100, itemHeight: 32, overscan: 2 }}
      renderers={{ title: (node) => {
        renders.set(node.key, (renders.get(node.key) ?? 0) + 1);
        return node.title;
      } }}
    />);
    const viewport = view.getByRole('tree');
    const renderedCount = () => [...renders.values()].reduce((total, count) => total + count, 0);
    const initial = renderedCount();

    fireEvent.scroll(viewport, { target: { scrollTop: 1 } });
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    expect(renderedCount()).toBe(initial);

    fireEvent.scroll(viewport, { target: { scrollTop: 64 } });
    act(() => frames.splice(0).forEach((callback) => callback(16)));
    expect(renderedCount()).toBeGreaterThan(initial);
  });

  it('recovers from a render error when recovery inputs change', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderBrokenTitle = () => { throw new Error('Broken title'); };
    const view = render(<Tree data={data} renderTitle={renderBrokenTitle} errorFallback={<div>Fallback</div>} />);
    expect(view.getByText('Fallback')).toBeTruthy();

    view.rerender(<Tree data={data} renderTitle={(node) => node.title} errorFallback={<div>Fallback</div>} />);
    expect(view.getByText('First')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('keeps unaffected rows memoized during selection updates', () => {
    const renders = new Map<TreeKey, number>();
    const renderTitle = (node: TreeNodeData) => {
      renders.set(node.key, (renders.get(node.key) ?? 0) + 1);
      return node.title;
    };

    function MemoizedRowsTree() {
      const [keys, setKeys] = useState<TreeKey[]>([]);
      return <Tree data={data} selection={{ keys, onChange: setKeys }} renderers={{ title: renderTitle }} />;
    }

    const view = render(<MemoizedRowsTree />);
    fireEvent.click(view.getByText('First').closest('[role="treeitem"]')!);
    expect(renders.get('first')).toBe(2);
    expect(renders.get('second')).toBe(1);
  });

  it('keeps rows memoized when equivalent style and class objects are recreated', () => {
    const renderTitle = vi.fn((node: TreeNodeData) => node.title);
    const view = render(<Tree
      data={data}
      renderers={{ title: renderTitle }}
      styles={{ node: { color: 'rgb(1, 2, 3)' } }}
      classNames={{ node: 'same-node' }}
    />);

    expect(renderTitle).toHaveBeenCalledTimes(2);
    view.rerender(<Tree
      data={data}
      renderers={{ title: renderTitle }}
      styles={{ node: { color: 'rgb(1, 2, 3)' } }}
      classNames={{ node: 'same-node' }}
    />);
    expect(renderTitle).toHaveBeenCalledTimes(2);
  });

  it('normalizes invalid layout and virtual scrolling parameters', () => {
    const virtualData = Array.from({ length: 20 }, (_, index) => ({ key: index, title: `Row ${index}` }));
    const view = render(<Tree
      data={virtualData}
      appearance={{ indent: -20, nodeGap: Number.POSITIVE_INFINITY }}
      virtual={{ height: 0, itemHeight: -10, overscan: -5 }}
    />);
    const viewport = view.getByRole('tree');
    const first = view.getAllByRole('treeitem')[0] as HTMLElement;

    expect(viewport.style.height).toBe('1px');
    expect(first.style.height).toBe('1px');
    expect(first.style.marginBlockEnd).toBe('2px');
    expect(view.getAllByRole('treeitem')).toHaveLength(1);
  });

  it('warns once for duplicate node keys in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Tree data={[{ key: 'duplicate', title: 'One' }, { key: 'duplicate', title: 'Two' }]} />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('string:duplicate'));
  });

  it('does not auto-expand selected ancestors when disabled', () => {
    const onChange = vi.fn();
    render(<Tree
      data={[{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }]}
      expansion={{ keys: [], autoExpandSelected: false, onChange }}
      selection={{ keys: ['child'] }}
    />);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Child')).toBeNull();
  });

  it('does not auto-expand descendant paths in multiple selection mode', () => {
    const onChange = vi.fn();
    render(<Tree
      data={[{ key: 'parent', title: 'Parent', children: [{ key: 'branch', title: 'Branch', children: [{ key: 'child', title: 'Child' }] }] }]}
      expansion={{ keys: [], onChange }}
      selection={{ mode: 'multiple', keys: ['parent', 'branch', 'child'] }}
    />);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Branch')).toBeNull();
    expect(screen.queryByText('Child')).toBeNull();
  });

  it('times out async loading even when the loader ignores AbortSignal', async () => {
    vi.useFakeTimers();
    let resolveLoad: ((children: TreeNodeData[]) => void) | undefined;
    const load = vi.fn(() => new Promise<TreeNodeData[]>((resolve) => { resolveLoad = resolve; }));
    const onLoad = vi.fn();
    const onError = vi.fn();
    const view = render(<Tree
      data={[{ key: 'remote', title: 'Remote', children: [], isLeaf: false }]}
      asyncLoad={{ load, timeout: 10, onLoad, onError }}
    />);

    fireEvent.click(view.getByRole('button', { name: 'Expand' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onLoad).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad?.([{ key: 'late', title: 'Late' }]);
      await Promise.resolve();
    });
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('uses row-only single selection while keeping editing controls hidden in read-only mode', () => {
    function ReadOnlyTree() {
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree
        data={[{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }]}
        expandedKeys={['parent']}
        onExpandedKeysChange={() => undefined}
        selectionMode="multiple"
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        draggable
        readOnly
        renderActions={() => <button type="button">Action</button>}
        menuItems={() => [{ key: 'action', label: 'Menu action' }]}
      />;
    }

    const view = render(<ReadOnlyTree />);

    expect(view.queryByLabelText('Drag node')).toBeNull();
    expect(view.container.querySelector('.rc-tree__selection-icon')).toBeNull();
    expect(view.queryByRole('button', { name: 'Action' })).toBeNull();
    expect(view.getByRole('button', { name: 'Collapse' })).toBeTruthy();
    fireEvent.click(view.getByText('Child').closest('[role="treeitem"]')!);
    expect(view.getByText('Child').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(view.getByText('Parent').closest('[role="treeitem"]')!);
    expect(view.getByText('Parent').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
    expect(view.getByText('Child').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('false');
    fireEvent.contextMenu(view.getByText('Parent').closest('[role="treeitem"]')!);
    expect(view.queryByText('Menu action')).toBeNull();
  });

  it('uses one disabled state while keeping expansion available', () => {
    const onSelectedKeysChange = vi.fn();
    const view = render(<Tree data={[{ key: 'disabled', title: 'Disabled', disabled: true, children: [{ key: 'child', title: 'Child' }] }]} expandedKeys={['disabled']} onExpandedKeysChange={() => undefined} selectionMode="multiple" draggable onSelectedKeysChange={onSelectedKeysChange} />);
    const [parent, child] = view.getAllByRole('treeitem');

    expect(parent?.classList.contains('rc-tree__node--disabled')).toBe(true);
    expect(child?.classList.contains('rc-tree__node--disabled')).toBe(true);
    expect(view.getByRole('button', { name: 'Collapse' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(child!);
    expect(onSelectedKeysChange).not.toHaveBeenCalled();
  });

  it('keeps a selected child collapsed when its parent is explicitly collapsed', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child' }] }];

    function SelectedChildTree() {
      const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>(['parent']);
      return <Tree data={nestedData} expandedKeys={expandedKeys} onExpandedKeysChange={setExpandedKeys} selectionMode="multiple" selectedKeys={['child']} />;
    }

    const view = render(<SelectedChildTree />);
    fireEvent.click(view.getByRole('button', { name: 'Collapse' }));

    expect(view.getByRole('button', { name: 'Expand' }).getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByText('Child')).toBeNull();
  });

  it('allows collapsing an async node while its children are loading', () => {
    const asyncData: TreeNodeData[] = [{ key: 'remote', title: 'Remote', children: [], isLeaf: false }];
    const loadData = vi.fn(() => new Promise<TreeNodeData[] | void>(() => undefined));

    function LoadingTree() {
      const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>([]);
      return <Tree data={asyncData} expandedKeys={expandedKeys} onExpandedKeysChange={setExpandedKeys} loadData={loadData} />;
    }

    const view = render(<LoadingTree />);
    fireEvent.click(view.getByRole('button', { name: 'Expand' }));
    const collapse = view.getByRole('button', { name: 'Collapse' });

    expect(collapse.hasAttribute('disabled')).toBe(false);
    fireEvent.click(collapse);
    expect(view.getByRole('button', { name: 'Expand' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(view.getByRole('button', { name: 'Expand' }));
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('selects and deselects a parent subtree in multiple mode', () => {
    const nestedData: TreeNodeData[] = [{
      key: 'parent',
      title: 'Parent',
      children: [
        { key: 'child', title: 'Child' },
        { key: 'disabled', title: 'Disabled', disabled: true },
      ],
    }];
    const onSelectedKeysChange = vi.fn();
    const view = render(<Tree data={nestedData} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectedKeys={[]} onSelectedKeysChange={onSelectedKeysChange} />);

    fireEvent.click(view.container.querySelector('[role="treeitem"]')!);
    expect(onSelectedKeysChange).toHaveBeenLastCalledWith(['parent', 'child'], nestedData[0], true);

    view.rerender(<Tree data={nestedData} expandedKeys={[]} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectedKeys={['parent', 'child']} onSelectedKeysChange={onSelectedKeysChange} />);
    fireEvent.click(view.container.querySelector('[role="treeitem"]')!);
    expect(onSelectedKeysChange).toHaveBeenLastCalledWith([], nestedData[0], false);
  });

  it('renders every child as selected after selecting its parent', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child-a', title: 'Child A' }, { key: 'child-b', title: 'Child B' }] }];

    function MultipleTree() {
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys} />;
    }

    const view = render(<MultipleTree />);
    fireEvent.click(view.getByText('Parent').closest('[role="treeitem"]')!);

    expect(view.getAllByRole('treeitem').map((item) => item.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);

    fireEvent.click(view.getByText('Child A').closest('[role="treeitem"]')!);
    expect(view.getAllByRole('treeitem').map((item) => item.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(view.getByText('Parent').closest('[role="treeitem"]')?.querySelector('[data-tree-selection]')?.getAttribute('data-tree-selection')).toBe('indeterminate');
  });

  it('selects the parent after all of its children are selected individually', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child-a', title: 'Child A' }, { key: 'child-b', title: 'Child B' }] }];

    function MultipleTree() {
      const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);
      return <Tree data={nestedData} expandedKeys={['parent']} onExpandedKeysChange={() => undefined} selectionMode="multiple" selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys} />;
    }

    const view = render(<MultipleTree />);
    fireEvent.click(view.getByText('Child A').closest('[role="treeitem"]')!);
    fireEvent.click(view.getByText('Child B').closest('[role="treeitem"]')!);

    expect(view.getAllByRole('treeitem').map((item) => item.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);
  });

  it('supports grouped configuration with internally managed expansion', () => {
    const nestedData: TreeNodeData[] = [{ key: 'parent', title: 'Parent', children: [{ key: 'child', title: 'Child', isLeaf: true }] }];
    const view = render(<Tree
      data={nestedData}
      expansion={{ onParentClick: true }}
      selection={false}
      search={{ placeholder: 'Find nodes' }}
      drag={{ trigger: 'handle' }}
      appearance={{ indent: 36, nodeGap: 5, icons: { showNode: true, color: '#8b5cf6' } }}
    />);

    expect(view.getByPlaceholderText('Find nodes')).toBeTruthy();
    expect(view.getByLabelText('Drag node')).toBeTruthy();
    fireEvent.click(view.getByText('Parent').closest('[role="treeitem"]')!);
    expect(view.getByText('Child')).toBeTruthy();
    expect(view.getByText('Child').closest<HTMLElement>('[role="treeitem"]')?.style.marginInlineStart).toBe('60px');
    expect(view.container.querySelector<HTMLElement>('.rc-tree')?.style.getPropertyValue('--tree-primary')).toBe('#8b5cf6');
  });

  it('gives grouped selection configuration precedence over legacy props', () => {
    const onChange = vi.fn();
    const view = render(<Tree
      data={data}
      expandedKeys={[]}
      onExpandedKeysChange={() => undefined}
      selectionMode="none"
      selection={{ mode: 'single', showIcon: false, onChange }}
    />);

    expect(view.container.querySelector('.rc-tree__selection-icon')).toBeNull();
    fireEvent.click(view.getByText('First').closest('[role="treeitem"]')!);
    expect(onChange).toHaveBeenCalledWith(['first'], data[0], true);
  });
});
