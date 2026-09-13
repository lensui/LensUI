import { describe, expect, it } from 'vitest';
import { collectExpandableKeys, collectKeys, computeSelectionStates, createTreeIndex, createTreeSearchTextIndex, filterTree, findAncestors, flattenTree, flattenTreeCompact, getIndexedAncestors, getTreeSearchResult, keyId, materializeFlatTreeNode, normalizeMultipleSelection, normalizeMultipleSelectionWithStates } from '../utils/tree';
import type { ResolvedTreeNodeData as TreeNodeData } from '../types';

const data: TreeNodeData[] = [{ key: 'root', title: 'Root', children: [{ key: 1, title: 'Apple' }, { key: 2, title: 'Banana' }] }];

describe('tree data utilities', () => {
  it('flattens only expanded branches', () => {
    expect(flattenTree(data, new Set()).map((x) => x.node.key)).toEqual(['root']);
    expect(flattenTree(data, new Set([keyId('root')])).map((x) => x.node.key)).toEqual(['root', 1, 2]);
  });
  it('keeps matching descendants and their ancestors', () => {
    const result = filterTree(data, 'banana');
    expect(result).toHaveLength(1);
    expect(result[0]?.children?.map((node) => node.key)).toEqual([2]);
  });
  it('filters visibility without cloning or trimming original nodes', () => {
    const searchResult = getTreeSearchResult(data, 'banana', createTreeSearchTextIndex(data));
    const compact = flattenTreeCompact(data, searchResult.expandedIds, searchResult.visibleIds);

    expect(compact.map((item) => item.node.key)).toEqual(['root', 2]);
    expect(compact[0]?.node).toBe(data[0]);
    expect(compact[0]?.node.children).toHaveLength(2);
  });
  it('shows and expands the complete subtree when a parent matches', () => {
    const nested: TreeNodeData[] = [{ key: 'root', title: 'Matching parent', children: [
      { key: 'branch', title: 'Branch', children: [{ key: 'leaf', title: 'Leaf' }] },
      { key: 'sibling', title: 'Sibling' },
    ] }];
    const searchResult = getTreeSearchResult(nested, 'matching');
    const compact = flattenTreeCompact(nested, searchResult.expandedIds, searchResult.visibleIds);

    expect(compact.map((item) => item.node.key)).toEqual(['root', 'branch', 'leaf', 'sibling']);
    expect(searchResult.expandedIds).toEqual(new Set([keyId('root'), keyId('branch')]));
  });
  it('finds ancestors and collects all keys', () => {
    expect(findAncestors(data, 2)).toEqual(['root']);
    expect(collectKeys(data)).toEqual(['root', 1, 2]);
  });

  it('builds reusable indexes and selection states in a single traversal', () => {
    const index = createTreeIndex(data);
    expect(index.nodes.get(keyId(2))?.title).toBe('Banana');
    expect(getIndexedAncestors(index, 2)).toEqual(['root']);
    expect(index.expandableKeys).toEqual(['root']);
    expect(index.duplicateKeys).toEqual([]);
    expect(createTreeSearchTextIndex(data).get(keyId(1))).toBe('apple');
    expect(collectExpandableKeys(data)).toEqual(['root']);

    const partial = computeSelectionStates(data, new Set([keyId(1)]));
    expect(partial.get(keyId('root'))).toEqual({ selected: false, indeterminate: true });
    expect(normalizeMultipleSelection(data, [1, 2])).toEqual(['root', 1, 2]);
    const normalized = normalizeMultipleSelectionWithStates(data, [1, 2]);
    expect(normalized.keys).toEqual(['root', 1, 2]);
    expect(normalized.states.get(keyId('root'))).toEqual({ selected: true, indeterminate: false });
  });

  it('reports duplicate typed keys while preserving number and string distinctions', () => {
    const index = createTreeIndex([
      { key: 'same', title: 'First' },
      { key: 'same', title: 'Second' },
      { key: 1, title: 'Number' },
      { key: '1', title: 'String' },
    ]);

    expect(index.duplicateKeys).toEqual(['same']);
    expect(index.nodes.get(keyId(1))?.title).toBe('Number');
    expect(index.nodes.get(keyId('1'))?.title).toBe('String');
  });

  it('handles deeply nested data without recursive flattening', () => {
    let deep: TreeNodeData = { key: 'leaf', title: 'Leaf', isLeaf: true };
    const expanded = new Set<string>();
    for (let index = 0; index < 2000; index += 1) {
      const key = `level-${index}`;
      expanded.add(keyId(key));
      deep = { key, title: key, children: [deep] };
    }

    expect(flattenTree([deep], expanded)).toHaveLength(2001);
    expect(collectKeys([deep])).toHaveLength(2001);

    const compact = flattenTreeCompact([deep], expanded);
    expect(compact).toHaveLength(2001);
    expect(materializeFlatTreeNode(compact[2000]!).parentKeys).toHaveLength(2000);
  });
});
