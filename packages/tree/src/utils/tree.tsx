import type { ReactNode } from 'react';
import type { FlatTreeNode, ResolvedTreeNodeData, TreeFieldNames, TreeKey, TreeNodeData } from '../types.js';

export const keyId = (key: TreeKey) => `${typeof key}:${String(key)}`;

const isRecord = (value: unknown): value is TreeNodeData =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNodeField = (node: TreeNodeData, configured: string | undefined, fallbacks: string[]) => {
  const fields = configured ? [configured, ...fallbacks] : fallbacks;
  for (const field of new Set(fields)) {
    if (node[field] !== undefined) return node[field];
  }
  return undefined;
};

/**
 * 将任意业务节点记录转换为 Tree 内部稳定结构。
 *
 * 默认优先使用 `id`，并继续兼容旧数据的 `key`。归一化只创建浅拷贝，
 * 不会给业务传入对象补字段或修改原始 children 数组。
 */
export function normalizeTreeData(data: TreeNodeData[], fieldNames: TreeFieldNames = {}): ResolvedTreeNodeData[] {
  const hasCustomFieldNames = Object.values(fieldNames).some(Boolean);
  const visit = (node: TreeNodeData, path: number[]): ResolvedTreeNodeData => {
    const rawKey = readNodeField(node, fieldNames.key, ['id', 'key']);
    const key: TreeKey = typeof rawKey === 'string' || typeof rawKey === 'number'
      ? rawKey
      : `__lensui_auto_${path.join('_')}`;
    const rawTitle = readNodeField(node, fieldNames.title, ['title', 'name', 'label']);
    const title = rawTitle === undefined ? String(key) : rawTitle as ReactNode;
    const rawChildren = readNodeField(node, fieldNames.children, ['children']);
    const children = Array.isArray(rawChildren)
      ? rawChildren.filter(isRecord).map((child, index) => visit(child, [...path, index]))
      : undefined;
    const searchText = readNodeField(node, fieldNames.searchText, ['searchText']);
    const disabled = readNodeField(node, fieldNames.disabled, ['disabled']);
    const isLeaf = readNodeField(node, fieldNames.isLeaf, ['isLeaf']);
    const icon = readNodeField(node, fieldNames.icon, ['icon']);
    const className = readNodeField(node, fieldNames.className, ['className']);
    const style = readNodeField(node, fieldNames.style, ['style']);

    // 已使用旧版标准 key/title/children 的数据继续保留原对象引用，避免破坏
    // 渲染器、事件回调和 memo 依赖的向后兼容语义。
    if (!hasCustomFieldNames
      && node.id === undefined
      && (typeof node.key === 'string' || typeof node.key === 'number')
      && node.title !== undefined
      && (rawChildren === undefined || (Array.isArray(rawChildren)
        && children?.length === rawChildren.length
        && children.every((child, index) => child === rawChildren[index])))) {
      return node as ResolvedTreeNodeData;
    }

    return {
      ...node,
      key,
      title,
      ...(rawChildren === undefined ? {} : { children: children ?? [] }),
      ...(typeof searchText === 'string' ? { searchText } : {}),
      ...(typeof disabled === 'boolean' ? { disabled } : {}),
      ...(typeof isLeaf === 'boolean' ? { isLeaf } : {}),
      ...(icon === undefined ? {} : { icon: icon as NonNullable<ResolvedTreeNodeData['icon']> }),
      ...(typeof className === 'string' ? { className } : {}),
      ...(typeof style === 'object' && style !== null ? { style: style as NonNullable<ResolvedTreeNodeData['style']> } : {}),
    } as ResolvedTreeNodeData;
  };

  return data.filter(isRecord).map((node, index) => visit(node, [index]));
}

export interface TreeIndex {
  allKeys: TreeKey[];
  /** 具有已加载子节点的 key；展开全部时无需把叶子节点写入受控状态。 */
  expandableKeys: TreeKey[];
  nodes: Map<string, ResolvedTreeNodeData>;
  parentKeys: Map<string, TreeKey | undefined>;
  rootKeys: TreeKey[];
  /** 重复 key 会使索引和 React 行身份产生歧义，Tree 在开发环境中据此给出警告。 */
  duplicateKeys: TreeKey[];
}

/** 单次遍历建立节点和父级索引，供展开、选择及手风琴逻辑复用。 */
export function createTreeIndex(data: ResolvedTreeNodeData[]): TreeIndex {
  const allKeys: TreeKey[] = [];
  const expandableKeys: TreeKey[] = [];
  const nodes = new Map<string, ResolvedTreeNodeData>();
  const parentKeys = new Map<string, TreeKey | undefined>();
  const duplicateKeys: TreeKey[] = [];
  const stack = [...data].reverse().map((node) => ({ node, parentKey: undefined as TreeKey | undefined }));

  while (stack.length) {
    const { node, parentKey } = stack.pop()!;
    const id = keyId(node.key);
    if (nodes.has(id)) duplicateKeys.push(node.key);
    allKeys.push(node.key);
    if (node.children?.length) expandableKeys.push(node.key);
    nodes.set(id, node);
    parentKeys.set(id, parentKey);
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children![index]!, parentKey: node.key });
    }
  }

  return { allKeys, expandableKeys, nodes, parentKeys, rootKeys: data.map((node) => node.key), duplicateKeys };
}

/** 搜索启用时单独构建文本索引，未开启搜索的 Tree 不承担这部分初始化成本。 */
export function createTreeSearchTextIndex(data: ResolvedTreeNodeData[]): Map<string, string> {
  const searchTexts = new Map<string, string>();
  const stack = [...data].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    const text = node.searchText ?? (typeof node.title === 'string' || typeof node.title === 'number' ? String(node.title) : '');
    searchTexts.set(keyId(node.key), text.toLocaleLowerCase());
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index -= 1) stack.push(node.children![index]!);
  }
  return searchTexts;
}

export interface TreeSearchResult {
  /** 标题命中节点、命中父节点的后代，以及为了保留路径而加入的祖先节点。 */
  visibleIds: Set<string>;
  /** 至少存在一个可见后代的节点，搜索期间应临时展开。 */
  expandedIds: Set<string>;
}

/**
 * 搜索只生成可见性集合，不克隆或裁剪 TreeNodeData。
 * 因此搜索状态下所有渲染函数和事件回调仍收到 data 中的完整原始节点。
 */
export function getTreeSearchResult(
  data: ResolvedTreeNodeData[],
  query: string,
  searchTexts?: ReadonlyMap<string, string>,
): TreeSearchResult {
  const normalized = query.trim().toLocaleLowerCase();
  const visibleIds = new Set<string>();
  const expandedIds = new Set<string>();
  if (!normalized) return { visibleIds, expandedIds };

  const parents = new Map<string, string | undefined>();
  const stack = [...data].reverse().map((node) => ({ node, parentId: undefined as string | undefined, matchedAncestor: false }));
  while (stack.length) {
    const entry = stack.pop()!;
    const id = keyId(entry.node.key);
    parents.set(id, entry.parentId);
    const text = searchTexts?.get(id)
      ?? (entry.node.searchText ?? (typeof entry.node.title === 'string' || typeof entry.node.title === 'number' ? String(entry.node.title) : '')).toLocaleLowerCase();
    const matches = text.includes(normalized);
    const insideMatchedParent = entry.matchedAncestor || matches;
    if (insideMatchedParent) {
      visibleIds.add(id);
      if (entry.node.children?.length) expandedIds.add(id);
    }
    if (matches) {
      let parentId = entry.parentId;
      while (parentId !== undefined) {
        const alreadyVisible = visibleIds.has(parentId);
        visibleIds.add(parentId);
        expandedIds.add(parentId);
        if (alreadyVisible) break;
        parentId = parents.get(parentId);
      }
    }
    for (let index = (entry.node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push({ node: entry.node.children![index]!, parentId: id, matchedAncestor: insideMatchedParent });
    }
  }
  return { visibleIds, expandedIds };
}

/** 使用父级索引获取祖先路径，复杂度只与节点深度相关。 */
export function getIndexedAncestors(index: TreeIndex, target: TreeKey): TreeKey[] | undefined {
  if (!index.nodes.has(keyId(target))) return undefined;
  const ancestors: TreeKey[] = [];
  let parent = index.parentKeys.get(keyId(target));
  while (parent !== undefined) {
    ancestors.push(parent);
    parent = index.parentKeys.get(keyId(parent));
  }
  return ancestors.reverse();
}

const isParentNode = (node: ResolvedTreeNodeData, hasLoadData: boolean) =>
  node.isLeaf !== true && (Array.isArray(node.children) || hasLoadData);

export interface TreeSelectionState {
  selected: boolean;
  indeterminate: boolean;
}

export interface NormalizedTreeSelection {
  keys: TreeKey[];
  states: Map<string, TreeSelectionState>;
}

interface SelectionStats {
  selectable: number;
  selected: number;
}

/** 一次后序遍历计算全部节点的选中和中间态，避免渲染每个父节点时重复扫描子树。 */
export function computeSelectionStates(
  data: ResolvedTreeNodeData[],
  selectedIds: ReadonlySet<string>,
  selectableParents = true,
  hasLoadData = false,
): Map<string, TreeSelectionState> {
  const states = new Map<string, TreeSelectionState>();
  const stats = new Map<ResolvedTreeNodeData, SelectionStats>();
  const stack = [...data].reverse().map((node) => ({ node, ancestorDisabled: false, visited: false }));

  while (stack.length) {
    const entry = stack.pop()!;
    const disabled = entry.ancestorDisabled || Boolean(entry.node.disabled);
    if (!entry.visited) {
      stack.push({ ...entry, visited: true });
      for (let index = (entry.node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
        stack.push({ node: entry.node.children![index]!, ancestorDisabled: disabled, visited: false });
      }
      continue;
    }

    let childSelectable = 0;
    let childSelected = 0;
    for (const child of entry.node.children ?? []) {
      const childState = stats.get(child);
      if (!childState) continue;
      childSelectable += childState.selectable;
      childSelected += childState.selected;
    }
    const selfSelectable = !disabled && (selectableParents || !isParentNode(entry.node, hasLoadData));
    const selfSelected = selfSelectable && selectedIds.has(keyId(entry.node.key));
    states.set(keyId(entry.node.key), {
      selected: selfSelected,
      indeterminate: !selfSelected && childSelected > 0,
    });
    stats.set(entry.node, {
      selectable: childSelectable + (selfSelectable ? 1 : 0),
      selected: childSelected + (selfSelected ? 1 : 0),
    });
  }

  return states;
}

/** 收集一个子树内可选择的 key；禁用状态会向后代继承。 */
export function collectSelectableKeys(
  nodes: ResolvedTreeNodeData[],
  selectableParents = true,
  hasLoadData = false,
  ancestorDisabled = false,
): TreeKey[] {
  const result: TreeKey[] = [];
  const stack = [...nodes].reverse().map((node) => ({ node, ancestorDisabled }));
  while (stack.length) {
    const { node, ancestorDisabled: inheritedDisabled } = stack.pop()!;
    const disabled = inheritedDisabled || Boolean(node.disabled);
    if (!disabled && (selectableParents || !isParentNode(node, hasLoadData))) result.push(node.key);
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children![index]!, ancestorDisabled: disabled });
    }
  }
  return result;
}

/**
 * 将多选集合按父子关系归一化：全部可选后代选中时补齐父节点，否则移除父节点。
 * 整棵树只做一次后序遍历，保留尚未加载或暂时不在 data 中的外部 key。
 */
export function normalizeMultipleSelectionWithStates(
  data: ResolvedTreeNodeData[],
  selectedKeys: TreeKey[],
  selectableParents = true,
  hasLoadData = false,
): NormalizedTreeSelection {
  const selectedIds = new Set(selectedKeys.map(keyId));
  const knownIds = new Set<string>();
  const orderedKeys: TreeKey[] = [];
  const states = new Map<string, TreeSelectionState>();
  const stats = new Map<ResolvedTreeNodeData, SelectionStats>();
  const stack = [...data].reverse().map((node) => ({ node, ancestorDisabled: false, visited: false }));

  while (stack.length) {
    const entry = stack.pop()!;
    const id = keyId(entry.node.key);
    const disabled = entry.ancestorDisabled || Boolean(entry.node.disabled);
    knownIds.add(id);
    if (!entry.visited) {
      orderedKeys.push(entry.node.key);
      stack.push({ ...entry, visited: true });
      for (let index = (entry.node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
        stack.push({ node: entry.node.children![index]!, ancestorDisabled: disabled, visited: false });
      }
      continue;
    }

    let childSelectable = 0;
    let childSelected = 0;
    for (const child of entry.node.children ?? []) {
      const childState = stats.get(child);
      if (!childState) continue;
      childSelectable += childState.selectable;
      childSelected += childState.selected;
    }
    const selfSelectable = !disabled && (selectableParents || !isParentNode(entry.node, hasLoadData));
    if (!selfSelectable) selectedIds.delete(id);
    else if (childSelectable > 0) {
      if (childSelected === childSelectable) selectedIds.add(id);
      else selectedIds.delete(id);
    }
    const selfSelected = selfSelectable && selectedIds.has(id);
    states.set(id, {
      selected: selfSelected,
      indeterminate: !selfSelected && childSelected > 0,
    });
    stats.set(entry.node, {
      selectable: childSelectable + (selfSelectable ? 1 : 0),
      selected: childSelected + (selfSelected ? 1 : 0),
    });
  }

  const orderedKnown = orderedKeys.filter((key) => selectedIds.has(keyId(key)));
  const unknown = selectedKeys.filter((key) => !knownIds.has(keyId(key)) && selectedIds.has(keyId(key)));
  return { keys: [...orderedKnown, ...unknown], states };
}

export function normalizeMultipleSelection(
  data: ResolvedTreeNodeData[],
  selectedKeys: TreeKey[],
  selectableParents = true,
  hasLoadData = false,
): TreeKey[] {
  return normalizeMultipleSelectionWithStates(data, selectedKeys, selectableParents, hasLoadData).keys;
}

/**
 * Tree 内部使用的紧凑行模型。父路径通过结构共享保存，展开 5000 级链式数据时
 * 不会为每一行复制完整 parentKeys / ancestorIsLast 数组。
 */
export interface CompactFlatTreeNode {
  node: ResolvedTreeNodeData;
  level: number;
  parent: CompactFlatTreeNode | undefined;
  disabled: boolean;
  isLast: boolean;
}

export function flattenTreeCompact(
  data: ResolvedTreeNodeData[],
  expanded: ReadonlySet<string>,
  visibleIds?: ReadonlySet<string>,
): CompactFlatTreeNode[] {
  const result: CompactFlatTreeNode[] = [];
  const visibleRoots = visibleIds ? data.filter((node) => visibleIds.has(keyId(node.key))) : data;
  const stack = [...visibleRoots].reverse().map((node, reverseIndex) => ({
    node,
    level: 0,
    parent: undefined as CompactFlatTreeNode | undefined,
    ancestorDisabled: false,
    isLast: visibleRoots.length - 1 - reverseIndex === visibleRoots.length - 1,
  }));

  while (stack.length) {
    const entry = stack.pop()!;
    const disabled = entry.ancestorDisabled || Boolean(entry.node.disabled);
    const compact: CompactFlatTreeNode = {
      node: entry.node,
      level: entry.level,
      parent: entry.parent,
      disabled,
      isLast: entry.isLast,
    };
    result.push(compact);
    if (!entry.node.children?.length || !expanded.has(keyId(entry.node.key))) continue;
    const children = visibleIds
      ? entry.node.children.filter((node) => visibleIds.has(keyId(node.key)))
      : entry.node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: children[index]!,
        level: entry.level + 1,
        parent: compact,
        ancestorDisabled: disabled,
        isLast: index === children.length - 1,
      });
    }
  }
  return result;
}

/** 只在节点真正进入渲染窗口时生成兼容的完整路径数组。 */
export function materializeFlatTreeNode(item: CompactFlatTreeNode): FlatTreeNode {
  const parentKeys: TreeKey[] = [];
  const ancestorIsLast: boolean[] = [];
  let parent = item.parent;
  while (parent) {
    parentKeys.push(parent.node.key);
    ancestorIsLast.push(parent.isLast);
    parent = parent.parent;
  }
  parentKeys.reverse();
  ancestorIsLast.reverse();
  return {
    node: item.node,
    level: item.level,
    parentKeys,
    disabled: item.disabled,
    isLast: item.isLast,
    ancestorIsLast,
  };
}

/** 沿结构共享的父指针判断是否属于任一收起分支。 */
export function compactNodeHasAncestor(item: CompactFlatTreeNode, ancestorIds: ReadonlySet<string>): boolean {
  let parent = item.parent;
  while (parent) {
    if (ancestorIds.has(keyId(parent.node.key))) return true;
    parent = parent.parent;
  }
  return false;
}

/**
 * 将嵌套 data 转为当前可见的扁平行。
 *
 * `ancestorIsLast` 与 parent 路径同步向下传递。它不仅描述当前节点深度，还记录
 * 每一级祖先分支是否已经结束，使 TreeRow 能跨越孙节点绘制连续的祖先辅助线。
 */
export function flattenTree(
  data: ResolvedTreeNodeData[],
  expanded: Set<string>,
  parents: TreeKey[] = [],
  level = 0,
  ancestorIsLast: boolean[] = [],
  ancestorDisabled = false,
): FlatTreeNode[] {
  const result: FlatTreeNode[] = [];
  const stack = [...data].reverse().map((node, reverseIndex) => ({
    node,
    level,
    parents,
    ancestorIsLast,
    ancestorDisabled,
    isLast: data.length - 1 - reverseIndex === data.length - 1,
  }));
  while (stack.length) {
    const entry = stack.pop()!;
    const disabled = entry.ancestorDisabled || Boolean(entry.node.disabled);
    result.push({ node: entry.node, level: entry.level, parentKeys: entry.parents, isLast: entry.isLast, ancestorIsLast: entry.ancestorIsLast, disabled });
    if (!entry.node.children?.length || !expanded.has(keyId(entry.node.key))) continue;
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: entry.node.children[index]!,
        level: entry.level + 1,
        parents: [...entry.parents, entry.node.key],
        ancestorIsLast: [...entry.ancestorIsLast, entry.isLast],
        ancestorDisabled: disabled,
        isLast: index === entry.node.children.length - 1,
      });
    }
  }
  return result;
}

export function filterTree(data: ResolvedTreeNodeData[], query: string, searchTexts?: ReadonlyMap<string, string>): ResolvedTreeNodeData[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return data;
  const matches = new Map<ResolvedTreeNodeData, ResolvedTreeNodeData | undefined>();
  const stack = [...data].reverse().map((node) => ({ node, visited: false }));
  while (stack.length) {
    const entry = stack.pop()!;
    if (!entry.visited) {
      stack.push({ node: entry.node, visited: true });
      for (let index = (entry.node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
        stack.push({ node: entry.node.children![index]!, visited: false });
      }
      continue;
    }
    const text = searchTexts?.get(keyId(entry.node.key))
      ?? (entry.node.searchText ?? (typeof entry.node.title === 'string' || typeof entry.node.title === 'number' ? String(entry.node.title) : '')).toLocaleLowerCase();
    const children = (entry.node.children ?? []).flatMap((child) => {
      const match = matches.get(child);
      return match ? [match] : [];
    });
    matches.set(entry.node, text.includes(normalized) || children.length ? { ...entry.node, children } : undefined);
  }
  return data.flatMap((node) => {
    const match = matches.get(node);
    return match ? [match] : [];
  });
}

export function collectKeys(data: ResolvedTreeNodeData[]): TreeKey[] {
  return createTreeIndex(data).allKeys;
}

/** 只收集真正拥有已加载子节点的分支 key。 */
export function collectExpandableKeys(data: ResolvedTreeNodeData[]): TreeKey[] {
  const keys: TreeKey[] = [];
  const stack = [...data].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children?.length) {
      keys.push(node.key);
      for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]!);
    }
  }
  return keys;
}

export function findAncestors(data: ResolvedTreeNodeData[], target: TreeKey, parents: TreeKey[] = []): TreeKey[] | undefined {
  const ancestors = getIndexedAncestors(createTreeIndex(data), target);
  return ancestors ? [...parents, ...ancestors] : undefined;
}

export function highlightTitle(node: ResolvedTreeNodeData, query: string): ReactNode {
  const text = node.searchText ?? (typeof node.title === 'string' || typeof node.title === 'number' ? String(node.title) : '');
  const q = query.trim();
  if (!q || !text) return node.title;
  const index = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (index < 0) return node.title;
  // 包成单个行内容器，避免 renderTitle 使用 flex gap 时把高亮前后文本拉开。
  return <span className="rc-tree__highlight-title">{text.slice(0, index)}<mark className="rc-tree__highlight">{text.slice(index, index + q.length)}</mark>{text.slice(index + q.length)}</span>;
}
