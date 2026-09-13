import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ResolvedTreeNodeData as TreeNodeData, TreeKey, TreeProps } from '../types.js';
import { collectKeys, collectSelectableKeys, computeSelectionStates, createTreeIndex, createTreeSearchTextIndex, flattenTreeCompact, getIndexedAncestors, getTreeSearchResult, keyId, materializeFlatTreeNode, normalizeMultipleSelectionWithStates, normalizeTreeData } from '../utils/tree.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useTreeAsyncLoad } from '../hooks/useTreeAsyncLoad.js';
import { useTreeKeyboardNavigation } from '../hooks/useTreeKeyboardNavigation.js';
import { TreeContextMenu } from './TreeContextMenu.js';
import { TreeErrorBoundary } from './TreeErrorBoundary.js';
import { TreeRow } from './TreeRow.js';
import { getVirtualRange, isParentNode, resolveTreeProps, sameStringSets, type ResolvedTreeProps, type VirtualRange } from './treeConfig.js';
import { Close, Empty, Search } from './icons.js';
import '../style.css';

const useSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const runtimeProcess = (globalThis as typeof globalThis & { process?: { env?: { NODE_ENV?: string } } }).process;
const isDevelopment =
  typeof globalThis === 'undefined'
  || runtimeProcess?.env?.NODE_ENV !== 'production';

/**
 * Tree 的运行流程概览：
 *
 * 1. 公开的领域配置先归一化，`TreeInner` 只接收统一的 data、expandedKeys 和 selectedKeys。
 * 2. 搜索值经过防抖后过滤嵌套数据，并在搜索期间临时展开所有匹配路径。
 * 3. `flattenTree` 只展开当前可见分支，产出统一的扁平行模型。
 * 4. 虚拟模式再从扁平列表中截取可视窗口；普通模式直接使用完整列表。
 * 5. 每个 `TreeRow` 独立注册交互和 Pragmatic DnD，因此状态变化只影响必要的行。
 * 6. 所有业务变化通过回调交给父组件，Tree 本身不修改 data 或受控 key 数组。
 */

function TreeInner(props: ResolvedTreeProps) {
  const { data, expandedKeys, selectionMode = 'none', searchable = false, virtual = false, height: configuredHeight = 320, itemHeight = 32, overscan = 4 } = props;
  const nodeGap = props.nodeGap ?? 2;
  const rowStride = itemHeight + nodeGap;
  const [internalSearch, setInternalSearch] = useState('');
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<TreeKey[]>(() => props.defaultSelectedKeys ?? []);
  const [parentHeight, setParentHeight] = useState(configuredHeight);
  const height = virtual && props.virtualHeightMode === 'parent' ? parentHeight : configuredHeight;
  const [virtualRange, setVirtualRange] = useState<VirtualRange>(() => getVirtualRange(0, Number.POSITIVE_INFINITY, height, rowStride, overscan));
  const virtualAnimationFrameRef = useRef<number | undefined>(undefined);
  const pendingVirtualScrollTopRef = useRef(0);
  const virtualMetricsRef = useRef({ total: 0, height, rowStride, overscan });
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNodeData; returnFocus: HTMLElement }>();
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const viewportRef = useRef<HTMLDivElement>(null);
  const dndScope = useId();
  const requestedInitialExpansion = useRef(false);
  const lastAutoExpandedSelection = useRef<{ ids: Set<string>; data: TreeNodeData[] } | undefined>(undefined);
  const selectedKeys = props.selectedKeys ?? internalSelectedKeys;
  const searchValue = props.searchValue ?? internalSearch;
  const query = useDebouncedValue(searchValue, 300);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hasSearchQuery = normalizedQuery.length > 0;
  const [searchCollapse, setSearchCollapse] = useState<{ query: string; ids: Set<string> }>({ query: '', ids: new Set() });
  const expandedSet = useMemo(() => new Set(expandedKeys.map(keyId)), [expandedKeys]);
  const selectedSet = useMemo(() => new Set(selectedKeys.map(keyId)), [selectedKeys]);
  const treeIndex = useMemo(() => createTreeIndex(data), [data]);
  const searchTexts = useMemo(() => searchable && hasSearchQuery ? createTreeSearchTextIndex(data) : undefined, [data, hasSearchQuery, searchable]);
  const pendingSelectionStatesRef = useRef<{
    data: TreeNodeData[];
    selectableParents: boolean;
    hasLoadData: boolean;
    selectedIds: Set<string>;
    states: Map<string, { selected: boolean; indeterminate: boolean }>;
  } | undefined>(undefined);
  const selectionStates = useMemo(
    () => {
      if (selectionMode !== 'multiple' || selectedSet.size === 0) return undefined;
      const selectableParents = props.selectableParents ?? true;
      const hasLoadData = Boolean(props.loadData);
      const pending = pendingSelectionStatesRef.current;
      if (pending
        && pending.data === data
        && pending.selectableParents === selectableParents
        && pending.hasLoadData === hasLoadData
        && sameStringSets(pending.selectedIds, selectedSet)) return pending.states;
      return computeSelectionStates(data, selectedSet, selectableParents, hasLoadData);
    },
    [data, props.loadData, props.selectableParents, selectedSet, selectionMode],
  );
  const searchResult = useMemo(() => hasSearchQuery ? getTreeSearchResult(data, query, searchTexts) : undefined, [data, hasSearchQuery, query, searchTexts]);
  const searchExpanded = useMemo(() => {
    if (!searchResult) return expandedSet;
    const collapsedIds = searchCollapse.query === normalizedQuery ? searchCollapse.ids : undefined;
    return collapsedIds?.size
      ? new Set([...searchResult.expandedIds].filter((id) => !collapsedIds.has(id)))
      : searchResult.expandedIds;
  }, [expandedSet, normalizedQuery, searchCollapse, searchResult]);
  const flat = useMemo(() => flattenTreeCompact(data, searchExpanded, searchResult?.visibleIds), [data, searchExpanded, searchResult]);
  const latestStateRef = useRef({ data, expandedKeys, expandedSet, effectiveExpandedSet: searchExpanded, searchQuery: hasSearchQuery ? normalizedQuery : undefined, selectedKeys, selectedSet, selectionMode, treeIndex, props });
  latestStateRef.current = { data, expandedKeys, expandedSet, effectiveExpandedSet: searchExpanded, searchQuery: hasSearchQuery ? normalizedQuery : undefined, selectedKeys, selectedSet, selectionMode, treeIndex, props };
  const getLatestProps = useCallback(() => latestStateRef.current.props, []);
  const { load, loadingKeys } = useTreeAsyncLoad(getLatestProps);

  useEffect(() => {
    if (!isDevelopment || treeIndex.duplicateKeys.length === 0) return;
    const duplicates = [...new Set(treeIndex.duplicateKeys.map(keyId))];
    console.warn(`[Tree] Duplicate node keys detected: ${duplicates.join(', ')}. Every node key must be unique within a Tree.`);
  }, [treeIndex]);

  useEffect(() => {
    return () => {
      if (virtualAnimationFrameRef.current !== undefined && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(virtualAnimationFrameRef.current);
      }
    };
  }, []);

  useSafeLayoutEffect(() => {
    if (!virtual || props.virtualHeightMode !== 'parent') {
      setParentHeight(configuredHeight);
      return;
    }
    const viewport = viewportRef.current;
    const parent = viewport?.parentElement?.parentElement;
    if (!viewport || !parent) return;
    const measure = () => {
      const parentRect = parent.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const paddingBottom = Number.parseFloat(getComputedStyle(parent).paddingBottom) || 0;
      const next = Math.max(1, Math.floor(parentRect.bottom - paddingBottom - viewportRect.top));
      setParentHeight((current) => current === next ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(parent);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [configuredHeight, props.renderSearch, props.virtualHeightMode, searchable, virtual]);

  const renderedFlat = flat;

  useEffect(() => {
    if (requestedInitialExpansion.current || !data.length) return;
    if (!props.defaultExpandAll && props.defaultExpandedKeys === undefined) return;
    requestedInitialExpansion.current = true;
    const validIds = new Set(treeIndex.allKeys.map(keyId));
    const configured = props.defaultExpandAll ? treeIndex.expandableKeys : props.defaultExpandedKeys ?? [];
    const seen = new Set<string>();
    const initial = (props.defaultExpandAll ? configured : configured.flatMap((key) => [...(getIndexedAncestors(treeIndex, key) ?? []), key]))
      .filter((key) => {
        const id = keyId(key);
        if (!validIds.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    if (initial.length) props.onExpandedKeysChange(initial, data[0]!, true);
  }, [data, props.defaultExpandAll, props.defaultExpandedKeys, props.onExpandedKeysChange, treeIndex]);

  // 单选模式下外部指定新的深层选中节点时，自动把祖先加入受控展开状态。
  // 多选父节点会联动选中整棵子树，但不应因此改变任何分支的展开状态。
  // 必须按选中集合去重；否则用户主动收起父节点后，expandedKeys 的变化会立即触发这里重新展开，
  // 表现为点击收起按钮偶尔没有效果。
  useEffect(() => {
    const previousSelection = lastAutoExpandedSelection.current;
    if (selectionMode !== 'single' || !props.autoExpandSelected || (previousSelection?.data === data && sameStringSets(previousSelection.ids, selectedSet))) return;
    lastAutoExpandedSelection.current = { ids: new Set(selectedSet), data };
    const processed = new Set<string>();
    const additions: TreeKey[] = [];
    for (const key of selectedKeys) {
      let parent = treeIndex.parentKeys.get(keyId(key));
      while (parent !== undefined) {
        const id = keyId(parent);
        if (processed.has(id)) break;
        processed.add(id);
        if (!expandedSet.has(id)) additions.push(parent);
        parent = treeIndex.parentKeys.get(id);
      }
    }
    if (additions.length && data[0]) props.onExpandedKeysChange([...expandedKeys, ...additions], data[0], true);
  }, [data, selectedKeys, selectedSet, expandedKeys, expandedSet, selectionMode, props.autoExpandSelected, props.onExpandedKeysChange, treeIndex]);

  const toggle = useCallback((node: TreeNodeData) => {
    const current = latestStateRef.current;
    const id = keyId(node.key); const opening = !current.effectiveExpandedSet.has(id);
    if (current.searchQuery) {
      setSearchCollapse((previous) => {
        const ids = previous.query === current.searchQuery ? new Set(previous.ids) : new Set<string>();
        if (opening) ids.delete(id); else ids.add(id);
        return { query: current.searchQuery!, ids };
      });
    }
    const parentKey = current.treeIndex.parentKeys.get(id);
    const siblings = parentKey === undefined
      ? current.treeIndex.rootKeys
      : current.treeIndex.nodes.get(keyId(parentKey))?.children?.map((child) => child.key) ?? [];
    const siblingBranchIds = opening && current.props.accordion ? new Set(siblings
      .filter((key) => keyId(key) !== id)
      .flatMap((key) => collectKeys([current.treeIndex.nodes.get(keyId(key))!]))
      .map(keyId)) : undefined;
    const retained = siblingBranchIds
      ? current.expandedKeys.filter((key) => !siblingBranchIds.has(keyId(key)))
      : current.expandedKeys;
    const next = opening ? [...retained, node.key] : current.expandedKeys.filter((key) => keyId(key) !== id);
    current.props.onExpandedKeysChange(next, node, opening);
  }, []);

  const select = useCallback((node: TreeNodeData) => {
    const current = latestStateRef.current;
    if (current.selectionMode === 'none') return;
    const selectableParents = current.props.selectableParents ?? true;
    const hasLoadData = Boolean(current.props.loadData);
    if (!selectableParents && isParentNode(node, hasLoadData)) return;
    const id = keyId(node.key); const selected = current.selectedSet.has(id);
    if (current.selectionMode === 'single') {
      if (selected) return;
      if (current.props.selectedKeys === undefined) setInternalSelectedKeys([node.key]);
      current.props.onSelectedKeysChange?.([node.key], node, true);
      return;
    }

    // 多选父节点时联动整棵子树：未全选则补齐所有可选节点，已全选则整组反选。
    const selectableKeys = collectSelectableKeys([node], selectableParents, hasLoadData);
    const subtreeIds = new Set(selectableKeys.map(keyId));
    const allSelected = selectableKeys.every((key) => current.selectedSet.has(keyId(key)));
    let next = allSelected
      ? current.selectedKeys.filter((key) => !subtreeIds.has(keyId(key)))
      : [...current.selectedKeys, ...selectableKeys.filter((key) => !current.selectedSet.has(keyId(key)))];

    const normalized = normalizeMultipleSelectionWithStates(current.data, next, selectableParents, hasLoadData);
    next = normalized.keys;
    pendingSelectionStatesRef.current = {
      data: current.data,
      selectableParents,
      hasLoadData,
      selectedIds: new Set(next.map(keyId)),
      states: normalized.states,
    };
    if (current.props.selectedKeys === undefined) setInternalSelectedKeys(next);
    current.props.onSelectedKeysChange?.(next, node, !allSelected);
  }, []);

  const openMenu = useCallback((event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, node: TreeNodeData, source: 'context' | 'trigger' = 'context') => {
    const currentProps = latestStateRef.current.props;
    if (currentProps.readOnly) return;
    if (source === 'context') currentProps.onNodeContextMenu?.(node, event as React.MouseEvent<HTMLElement>);
    if (!currentProps.menuItems) return;
    event.preventDefault();
    event.stopPropagation();
    if (source === 'trigger') {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: Math.max(4, rect.right - 140), y: rect.bottom + 4, node, returnFocus: event.currentTarget });
      return;
    }
    const pointerEvent = event as React.MouseEvent<HTMLElement>;
    setMenu({ x: pointerEvent.clientX, y: pointerEvent.clientY, node, returnFocus: event.currentTarget });
  }, []);
  const closeMenu = useCallback((restoreFocus = false) => {
    if (restoreFocus) menuRef.current?.returnFocus.focus();
    setMenu(undefined);
  }, []);
  const setSearch = (value: string) => { if (props.searchValue === undefined) setInternalSearch(value); props.onSearchValueChange?.(value); };
  virtualMetricsRef.current = { total: renderedFlat.length, height, rowStride, overscan };
  const updateVirtualRange = useCallback((scrollTop: number, defer = false) => {
    pendingVirtualScrollTopRef.current = scrollTop;
    const commit = () => {
      virtualAnimationFrameRef.current = undefined;
      const metrics = virtualMetricsRef.current;
      const next = getVirtualRange(pendingVirtualScrollTopRef.current, metrics.total, metrics.height, metrics.rowStride, metrics.overscan);
      setVirtualRange((current) => current.start === next.start && current.end === next.end ? current : next);
    };
    if (!defer || typeof window.requestAnimationFrame !== 'function') {
      commit();
      return;
    }
    if (virtualAnimationFrameRef.current === undefined) virtualAnimationFrameRef.current = window.requestAnimationFrame(commit);
  }, []);
  useEffect(() => {
    if (!virtual) return;
    updateVirtualRange(viewportRef.current?.scrollTop ?? 0);
  }, [height, overscan, renderedFlat.length, rowStride, updateVirtualRange, virtual]);
  const maximumStart = Math.max(0, renderedFlat.length - 1);
  const start = virtual ? Math.min(virtualRange.start, maximumStart) : 0;
  const end = virtual ? Math.min(renderedFlat.length, Math.max(start + 1, virtualRange.end)) : renderedFlat.length;
  const visible = useMemo(
    () => renderedFlat.slice(start, end).map(materializeFlatTreeNode),
    [end, renderedFlat, start],
  );
  const { focusedKey, setFocusedKey, registerRowElement, handleRowKeyDown } = useTreeKeyboardNavigation({
    renderedFlat,
    virtual,
    height,
    rowStride,
    treeIndex,
    props,
    viewportRef,
    updateVirtualRange,
    load,
    toggle,
    select,
    openMenu,
  });
  const visibleIds = new Set(visible.map((item) => keyId(item.node.key)));
  const activeFocusedKey = focusedKey !== undefined && visibleIds.has(keyId(focusedKey)) ? focusedKey : visible[0]?.node.key;
  const navigationRef = useRef({ renderedFlat, virtual, height, rowStride, treeIndex, props });
  navigationRef.current = { renderedFlat, virtual, height, rowStride, treeIndex, props };
  const handleVirtualScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (navigationRef.current.virtual) updateVirtualRange(event.currentTarget.scrollTop, true);
  }, [updateVirtualRange]);
  const handleVirtualDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const current = navigationRef.current;
    const viewport = viewportRef.current;
    if (!current.virtual || !current.props.draggable || current.props.readOnly || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const edge = Math.min(64, Math.max(28, rect.height / 5));
    const distanceFromTop = event.clientY - rect.top;
    const distanceFromBottom = rect.bottom - event.clientY;
    let delta = 0;
    if (distanceFromTop < edge) delta = -Math.ceil(18 * (1 - Math.max(0, distanceFromTop) / edge));
    else if (distanceFromBottom < edge) delta = Math.ceil(18 * (1 - Math.max(0, distanceFromBottom) / edge));
    if (!delta) return;
    const maximum = Math.max(0, current.renderedFlat.length * current.rowStride - viewport.clientHeight);
    const next = Math.max(0, Math.min(maximum, viewport.scrollTop + delta));
    if (next === viewport.scrollTop) return;
    viewport.scrollTop = next;
    updateVirtualRange(next, true);
  }, [updateVirtualRange]);
  const rootClass = ['rc-tree', props.className, props.classNames?.root].filter(Boolean).join(' ');
  // iconColor 作为 Tree 的交互主题色，同时驱动图标、复选框、选中行、焦点和拖拽反馈。
  const themeVariables = props.iconColor ? {
    '--tree-icon-color': props.iconColor,
    '--tree-primary': props.iconColor,
    '--tree-selected': `color-mix(in srgb, ${props.iconColor} 12%, transparent)`,
  } : {};
  const rootStyle = { ...props.styles?.root, ...props.style, ...themeVariables } as CSSProperties;
  const { className: _className, style: _style, ...domRest } = props;
  const excluded = new Set(['data','fieldNames','expandedKeys','selectedKeys','defaultSelectedKeys','onExpandedKeysChange','onSelectedKeysChange','selectionMode','showSelectionIcon','selectionIconPosition','selectableParents','selectionTrigger','defaultExpandAll','defaultExpandedKeys','accordion','expandOnParentClick','autoExpandSelected','readOnly','searchable','searchValue','onSearchValueChange','searchPlaceholder','renderSearch','renderTitle','renderActions','renderEmpty','emptyContent','loading','renderLoading','loadData','loadTimeout','onLoad','onLoadError','draggable','dragMode','dragTrigger','showDragHandle','dragIcon','dragIconPosition','onDragStart','onDragEnd','onDragOver','onDrop','renameEnabled','renameEditingKey','onRenameEditingKeyChange','canRenameNode','onRename','showLines','lineStyle','indent','nodeGap','switcherPosition','expandIcon','collapseIcon','selectionIcon','showNodeIcon','fileIcon','folderIcon','folderOpenIcon','iconColor','menuItems','onNodeClick','onNodeDoubleClick','onNodeContextMenu','onNodeMouseEnter','onNodeMouseLeave','virtual','virtualHeightMode','height','itemHeight','overscan','styles','classNames','errorFallback']);
  const domProps = Object.fromEntries(Object.entries(domRest).filter(([key]) => !excluded.has(key)));

  return <div {...domProps} className={rootClass} style={rootStyle}>
    {searchable && <div className={["rc-tree__search", props.classNames?.search].filter(Boolean).join(' ')} style={props.styles?.search}>
      {props.renderSearch?.(searchValue, setSearch) ?? <div className="rc-tree__search-control">
        <span className="rc-tree__search-icon" aria-hidden="true"><Search /></span>
        <input type="search" value={searchValue} placeholder={props.searchPlaceholder ?? 'Search'} onChange={(e) => setSearch(e.target.value)} />
        {searchValue && <button type="button" className="rc-tree__search-clear" aria-label="Clear search" onClick={() => setSearch('')}><Close /></button>}
      </div>}
    </div>}
    {props.loading ? <div className="rc-tree__initial-loading">{props.renderLoading?.() ?? <span className="rc-tree__spinner" />}</div> : flat.length === 0 ?
      <div className={["rc-tree__empty", props.classNames?.empty].filter(Boolean).join(' ')} style={props.styles?.empty}>{props.renderEmpty?.() ?? props.emptyContent ?? <div className="rc-tree__empty-default"><span className="rc-tree__empty-icon"><Empty /></span><span>No data</span></div>}</div> :
      <div ref={viewportRef} role="tree" aria-label={props['aria-label'] ?? 'Tree'} aria-labelledby={props['aria-labelledby']} aria-multiselectable={selectionMode === 'multiple' || undefined}
        className={["rc-tree__viewport", props.classNames?.viewport].filter(Boolean).join(' ')} style={{ ...(virtual ? { height, overflowY: 'auto' } : {}), ...props.styles?.viewport }}
        onScroll={handleVirtualScroll} onDragOverCapture={handleVirtualDragOver}>
        <div style={virtual ? { height: renderedFlat.length * rowStride, position: 'relative' } : undefined}>
          {visible.map((item, index) => {
            const selectable = (props.selectableParents ?? true) || !isParentNode(item.node, Boolean(props.loadData));
            const selectionState = selectionStates?.get(keyId(item.node.key));
            const selected = selectable && (selectionMode === 'multiple' ? Boolean(selectionState?.selected) : selectedSet.has(keyId(item.node.key)));
            const indeterminate = selectionMode === 'multiple' && Boolean(selectionState?.indeterminate);
            return <TreeRow key={keyId(item.node.key)} item={item} props={props} query={query} dndScope={dndScope}
              top={virtual ? (start + index) * rowStride : undefined} expanded={searchExpanded.has(keyId(item.node.key))} selected={selected} indeterminate={indeterminate}
              loading={loadingKeys.has(keyId(item.node.key))}
              focused={activeFocusedKey !== undefined && keyId(activeFocusedKey) === keyId(item.node.key)} onFocus={setFocusedKey} onKeyDown={handleRowKeyDown} registerElement={registerRowElement}
              onToggle={toggle} onSelect={select} onLoad={load} onMenu={openMenu} />;
          })}
        </div>
      </div>}
    {!props.readOnly && menu && <TreeContextMenu items={props.menuItems?.(menu.node) ?? []} {...menu} close={closeMenu} />}
  </div>;
}

/** 公开入口只维护受控/非受控展开状态，并为内部实现提供错误边界。 */
export function Tree(input: TreeProps) {
  const normalizedData = useMemo(() => normalizeTreeData(input.data, input.fieldNames), [input.data, input.fieldNames]);
  const [internalExpandedKeys, setInternalExpandedKeys] = useState<TreeKey[]>(() => input.expansion?.defaultKeys ?? input.defaultExpandedKeys ?? []);
  const controlledExpandedKeys = input.expansion?.keys ?? input.expandedKeys;
  const expandedKeys = controlledExpandedKeys ?? internalExpandedKeys;
  const onExpandedKeysChange = useCallback((keys: TreeKey[], node: TreeNodeData, expanded: boolean) => {
    if (controlledExpandedKeys === undefined) setInternalExpandedKeys(keys);
    (input.expansion?.onChange ?? input.onExpandedKeysChange)?.(keys, node, expanded);
  }, [controlledExpandedKeys, input.expansion?.onChange, input.onExpandedKeysChange]);
  const props = resolveTreeProps({ ...input, data: normalizedData }, expandedKeys, onExpandedKeysChange);

  return <TreeErrorBoundary
    fallback={props.errorFallback}
    onError={(error) => props.onLoadError?.(error)}
    resetKeys={[input.data, input.fieldNames, props.renderTitle, props.renderActions, props.renderEmpty, props.errorFallback]}
  ><TreeInner {...props} /></TreeErrorBoundary>;
}
