import type { ResolvedTreeNodeData as TreeNodeData, TreeKey, TreeProps } from '../types.js';

/** Tree 内部使用的扁平归一化配置，节点行不再重复解析公开分组 API。 */
export type ResolvedTreeProps = Omit<TreeProps, 'data' | 'virtual' | 'rename'> & {
  data: TreeNodeData[];
  expandedKeys: TreeKey[];
  onExpandedKeysChange: NonNullable<TreeProps['onExpandedKeysChange']>;
  virtual?: boolean;
  virtualHeightMode?: 'fixed' | 'parent';
  renameEnabled?: boolean;
  renameEditingKey?: TreeKey | null;
  onRenameEditingKeyChange?: (key: TreeKey | null) => void;
  canRenameNode?: (node: TreeNodeData) => boolean;
  onRename?: (node: TreeNodeData, title: string) => void;
  autoExpandSelected?: boolean;
};

const normalizeNumber = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;

/** 布局和虚拟列表参数统一容错，避免 0、负数、Infinity 破坏滚动区间计算。 */
const normalizeIndent = (value: number | undefined) => normalizeNumber(value, 24, 0, 100_000);
const normalizeNodeGap = (value: number | undefined) => normalizeNumber(value, 2, 0, 100_000);
const normalizeHeight = (value: number | undefined) => normalizeNumber(value, 320, 1, 1_000_000);
const normalizeItemHeight = (value: number | undefined) => normalizeNumber(value, 32, 1, 100_000);
const normalizeOverscan = (value: number | undefined) => Math.floor(normalizeNumber(value, 4, 0, 10_000));
const normalizeLoadTimeout = (value: number | undefined) => normalizeNumber(value, 10_000, 1, 2_147_483_647);

export const sameStringSets = (left: ReadonlySet<string> | undefined, right: ReadonlySet<string>) => {
  if (!left || left.size !== right.size) return false;
  for (const id of right) if (!left.has(id)) return false;
  return true;
};

export interface VirtualRange {
  start: number;
  end: number;
}

export const getVirtualRange = (scrollTop: number, total: number, height: number, rowStride: number, overscan: number): VirtualRange => ({
  start: Math.max(0, Math.floor(scrollTop / rowStride) - overscan),
  end: Math.min(total, Math.ceil((scrollTop + height) / rowStride) + overscan),
});

/** children 数组表示同步父节点；loadData 下未声明为叶子的节点也属于父节点。 */
export const isParentNode = (node: TreeNodeData, hasLoadData: boolean) =>
  node.isLeaf !== true && (Array.isArray(node.children) || hasLoadData);

export function resolveTreeProps(input: Omit<TreeProps, 'data'> & { data: TreeNodeData[] }, expandedKeys: TreeKey[], onExpandedKeysChange: ResolvedTreeProps['onExpandedKeysChange']): ResolvedTreeProps {
  const {
    expansion,
    selection,
    search,
    drag,
    rename,
    appearance,
    asyncLoad,
    renderers,
    events,
    virtual,
    ...legacy
  } = input;
  const selectionConfig = selection && typeof selection === 'object' ? selection : undefined;
  const searchConfig = search && typeof search === 'object' ? search : undefined;
  const dragConfig = drag && typeof drag === 'object' ? drag : undefined;
  const renameConfig = rename && typeof rename === 'object' ? rename : undefined;
  const virtualConfig = virtual && typeof virtual === 'object' ? virtual : undefined;
  const icons = appearance?.icons;
  const readOnly = legacy.readOnly ?? false;
  const configuredSelectionMode = selection === false ? 'none' : selectionConfig ? selectionConfig.mode ?? 'single' : legacy.selectionMode ?? 'single';
  const configuredSelectedKeys = selectionConfig?.keys ?? legacy.selectedKeys;
  const configuredDefaultSelectedKeys = selectionConfig?.defaultKeys ?? legacy.defaultSelectedKeys;

  return {
    ...legacy,
    expandedKeys,
    onExpandedKeysChange,
    selectionMode: readOnly ? 'single' : configuredSelectionMode,
    selectedKeys: readOnly ? configuredSelectedKeys?.slice(0, 1) : configuredSelectedKeys,
    defaultSelectedKeys: readOnly ? configuredDefaultSelectedKeys?.slice(0, 1) : configuredDefaultSelectedKeys,
    onSelectedKeysChange: selectionConfig?.onChange ?? legacy.onSelectedKeysChange,
    showSelectionIcon: readOnly ? false : selectionConfig ? selectionConfig.showIcon ?? true : legacy.showSelectionIcon ?? legacy.selectionMode !== undefined,
    selectionIconPosition: selectionConfig?.iconPosition ?? legacy.selectionIconPosition,
    selectableParents: selectionConfig?.parentsSelectable ?? legacy.selectableParents,
    selectionTrigger: readOnly ? 'node' : selectionConfig?.trigger ?? legacy.selectionTrigger,
    defaultExpandAll: expansion?.defaultAll ?? legacy.defaultExpandAll,
    defaultExpandedKeys: expansion?.defaultKeys ?? legacy.defaultExpandedKeys,
    accordion: expansion?.accordion ?? legacy.accordion,
    expandOnParentClick: expansion?.onParentClick ?? legacy.expandOnParentClick,
    autoExpandSelected: expansion?.autoExpandSelected ?? true,
    searchable: search === false ? false : search === true || searchConfig ? true : legacy.searchable,
    searchValue: searchConfig?.value ?? legacy.searchValue,
    onSearchValueChange: searchConfig?.onChange ?? legacy.onSearchValueChange,
    searchPlaceholder: searchConfig?.placeholder ?? legacy.searchPlaceholder,
    renderSearch: searchConfig?.render ?? legacy.renderSearch,
    draggable: drag === false ? false : drag === true || dragConfig ? true : legacy.draggable,
    dragMode: dragConfig?.mode ?? legacy.dragMode,
    dragTrigger: dragConfig?.trigger ?? legacy.dragTrigger,
    showDragHandle: dragConfig?.showHandle ?? legacy.showDragHandle,
    dragIcon: dragConfig?.icon ?? legacy.dragIcon,
    dragIconPosition: dragConfig?.iconPosition ?? legacy.dragIconPosition,
    onDragStart: dragConfig?.onStart ?? legacy.onDragStart,
    onDragEnd: dragConfig?.onEnd ?? legacy.onDragEnd,
    onDragOver: dragConfig?.onOver ?? legacy.onDragOver,
    onDrop: dragConfig?.onDrop ?? legacy.onDrop,
    renameEnabled: !readOnly && Boolean(renameConfig),
    renameEditingKey: renameConfig?.editingKey,
    onRenameEditingKeyChange: renameConfig?.onEditingKeyChange,
    canRenameNode: renameConfig?.canRename,
    onRename: renameConfig?.onChange,
    showLines: appearance?.lines ?? legacy.showLines,
    lineStyle: appearance?.lineStyle ?? legacy.lineStyle,
    indent: normalizeIndent(appearance?.indent ?? legacy.indent),
    nodeGap: normalizeNodeGap(appearance?.nodeGap ?? legacy.nodeGap),
    switcherPosition: appearance?.switcherPosition ?? legacy.switcherPosition,
    expandIcon: icons?.expand ?? legacy.expandIcon,
    collapseIcon: icons?.collapse ?? legacy.collapseIcon,
    selectionIcon: icons?.selection ?? legacy.selectionIcon,
    showNodeIcon: icons?.showNode ?? legacy.showNodeIcon,
    fileIcon: icons?.file ?? legacy.fileIcon,
    folderIcon: icons?.folder ?? legacy.folderIcon,
    folderOpenIcon: icons?.folderOpen ?? legacy.folderOpenIcon,
    iconColor: icons?.color ?? legacy.iconColor,
    loading: asyncLoad?.loading ?? legacy.loading,
    loadData: asyncLoad?.load ?? legacy.loadData,
    loadTimeout: normalizeLoadTimeout(asyncLoad?.timeout ?? legacy.loadTimeout),
    renderLoading: asyncLoad?.renderLoading ?? legacy.renderLoading,
    onLoad: asyncLoad?.onLoad ?? legacy.onLoad,
    onLoadError: asyncLoad?.onError ?? legacy.onLoadError,
    renderTitle: renderers?.title ?? legacy.renderTitle,
    renderActions: renderers?.actions ?? legacy.renderActions,
    renderEmpty: renderers?.empty ?? legacy.renderEmpty,
    emptyContent: renderers?.emptyContent ?? legacy.emptyContent,
    menuItems: renderers?.menu ?? legacy.menuItems,
    errorFallback: renderers?.errorFallback ?? legacy.errorFallback,
    onNodeClick: events?.onClick ?? legacy.onNodeClick,
    onNodeDoubleClick: events?.onDoubleClick ?? legacy.onNodeDoubleClick,
    onNodeContextMenu: events?.onContextMenu ?? legacy.onNodeContextMenu,
    onNodeMouseEnter: events?.onMouseEnter ?? legacy.onNodeMouseEnter,
    onNodeMouseLeave: events?.onMouseLeave ?? legacy.onNodeMouseLeave,
    virtual: virtualConfig ? true : virtual,
    height: normalizeHeight(typeof virtualConfig?.height === 'number' ? virtualConfig.height : legacy.height),
    virtualHeightMode: virtualConfig?.height === 'parent'
      || (virtual && virtualConfig?.height === undefined && legacy.height === undefined)
      ? 'parent'
      : 'fixed',
    itemHeight: normalizeItemHeight(virtualConfig?.itemHeight ?? legacy.itemHeight),
    overscan: normalizeOverscan(virtualConfig?.overscan ?? legacy.overscan),
  } as ResolvedTreeProps;
}
