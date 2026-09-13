import { describe, expect, it } from 'vitest';
import { containsTreeNode, createTreeDragData, getDropOperations, getTreeDragData, instructionToDropPosition, isDropAllowedByMode, isSameParentPath, pathContainsTreeKey } from '../utils/dragAndDrop';
import type { ResolvedTreeNodeData as TreeNodeData } from '../types';

const node: TreeNodeData = { key: 'one', title: 'One' };

describe('tree drag and drop data', () => {
  it('accepts data only from the same Tree scope', () => {
    const data = createTreeDragData(node, 'tree-a', ['parent']);
    expect(getTreeDragData(data, 'tree-a')?.node).toBe(node);
    expect(getTreeDragData(data, 'tree-a')?.parentKeys).toEqual(['parent']);
    expect(getTreeDragData(data, 'tree-b')).toBeUndefined();
  });

  it('rejects malformed third-party drag data', () => {
    expect(getTreeDragData({ type: '@react-components/tree-node', scope: 'tree-a', node: null }, 'tree-a')).toBeUndefined();
    expect(getTreeDragData({ type: 'other', scope: 'tree-a', node }, 'tree-a')).toBeUndefined();
  });

  it('maps official hitbox operations to the public Tree API', () => {
    expect(instructionToDropPosition('reorder-before')).toBe('before');
    expect(instructionToDropPosition('combine')).toBe('inside');
    expect(instructionToDropPosition('reorder-after')).toBe('after');
  });

  it('compares complete typed parent paths for same-level sorting', () => {
    expect(isSameParentPath(['root', 1], ['root', 1])).toBe(true);
    expect(isSameParentPath(['root', 1], ['root', '1'])).toBe(false);
    expect(isSameParentPath(['root'], ['other'])).toBe(false);
  });

  it('allows cross-level targets only in nested mode', () => {
    expect(isDropAllowedByMode('nested', ['source-parent'], ['target-parent'])).toBe(true);
    expect(isDropAllowedByMode('same-level', ['parent'], ['parent'])).toBe(true);
    expect(isDropAllowedByMode('same-level', ['source-parent'], ['target-parent'])).toBe(false);
  });

  it('removes the inside hitbox in same-level mode', () => {
    expect(getDropOperations('nested').combine).toBe('available');
    expect(getDropOperations('same-level').combine).toBe('not-available');
    expect(getDropOperations('same-level')['reorder-before']).toBe('available');
    expect(getDropOperations('same-level')['reorder-after']).toBe('available');
  });

  it('detects direct and deeply nested descendants to prevent tree cycles', () => {
    const parent: TreeNodeData = {
      key: 'parent',
      title: 'Parent',
      children: [{ key: 'child', title: 'Child', children: [{ key: 1, title: 'Grandchild' }] }],
    };
    expect(containsTreeNode(parent, 'child')).toBe(true);
    expect(containsTreeNode(parent, 1)).toBe(true);
    expect(containsTreeNode(parent, '1')).toBe(false);
    expect(containsTreeNode(parent, 'outside')).toBe(false);
    expect(pathContainsTreeKey(['root', 'parent'], 'parent')).toBe(true);
    expect(pathContainsTreeKey(['root', 1], '1')).toBe(false);
  });

  it('checks very deep descendants without recursive stack growth', () => {
    let deep: TreeNodeData = { key: 'leaf', title: 'Leaf' };
    for (let index = 0; index < 5000; index += 1) deep = { key: `level-${index}`, title: 'Level', children: [deep] };
    expect(containsTreeNode(deep, 'leaf')).toBe(true);
  });
});
