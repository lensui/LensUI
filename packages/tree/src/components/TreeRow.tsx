import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createTreeDragData, getDropOperations, getTreeDragData, instructionToDropPosition, isDropAllowedByMode, pathContainsTreeKey } from '../utils/dragAndDrop.js';
import { highlightTitle, keyId } from '../utils/tree.js';
import type { DropPosition, FlatTreeNode, IconPosition, ResolvedTreeNodeData as TreeNodeData, TreeKey } from '../types.js';
import type { ResolvedTreeProps } from './treeConfig.js';
import { Check, Chevron, DragDots, File, Folder, FolderOpen, Radio } from './icons.js';

const useSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface RowProps {
  /** 扁平化后的节点、深度和父路径信息。 */
  item: FlatTreeNode;
  /** 完整 Tree 配置；行会读取自定义渲染、样式和事件回调。 */
  props: ResolvedTreeProps;
  /** 从受控 expandedKeys 计算出的当前展开状态。 */
  expanded: boolean;
  /** 从受控 selectedKeys 计算出的当前选中状态。 */
  selected: boolean;
  /** 多选模式下部分后代已选中的中间态。 */
  indeterminate: boolean;
  /** 当前节点是否正在执行异步 children 加载。 */
  loading: boolean;
  /** 已防抖的搜索词，只用于标题高亮。 */
  query: string;
  /** 虚拟滚动时节点相对完整列表的绝对 top；普通模式不传。 */
  top?: number | undefined;
  /** 当前 Tree 实例唯一作用域，阻止不同 Tree 之间意外互拖。 */
  dndScope: string;
  /** 请求父级改变受控展开状态。 */
  onToggle: (node: TreeNodeData) => void;
  /** 请求父级改变受控选择状态。 */
  onSelect: (node: TreeNodeData) => void;
  /** 启动当前节点的异步子节点加载。 */
  onLoad: (node: TreeNodeData) => void;
  /** 统一处理业务右键回调和自定义菜单定位。 */
  onMenu: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, node: TreeNodeData, source?: 'context' | 'trigger') => void;
  /** roving tabindex 当前焦点行。 */
  focused: boolean;
  onFocus: (key: TreeKey) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, item: FlatTreeNode, expanded: boolean) => void;
  registerElement: (key: TreeKey, element: HTMLDivElement | null) => void;
}

const rowConfigKeys = [
  'canRenameNode', 'collapseIcon', 'dragIcon', 'dragIconPosition', 'dragMode',
  'dragTrigger', 'draggable', 'expandIcon', 'expandOnParentClick', 'fileIcon', 'folderIcon', 'folderOpenIcon',
  'indent', 'itemHeight', 'lineStyle', 'loadData', 'nodeGap', 'onDragEnd', 'onDragOver', 'onDragStart', 'onDrop',
  'onNodeClick', 'onNodeDoubleClick', 'onNodeMouseEnter', 'onNodeMouseLeave', 'onRename',
  'onRenameEditingKeyChange', 'readOnly', 'renameEditingKey', 'renameEnabled', 'renderActions', 'renderLoading',
  'renderTitle', 'selectableParents', 'selectionIcon', 'selectionIconPosition', 'selectionMode', 'selectionTrigger', 'showDragHandle',
  'showLines', 'showNodeIcon', 'showSelectionIcon', 'switcherPosition',
] as const satisfies readonly (keyof ResolvedTreeProps)[];

const sameTypedKeys = (left: TreeKey[], right: TreeKey[]) => left.length === right.length
  && left.every((key, index) => keyId(key) === keyId(right[index]!));

const shallowEqualRecord = (left: object | undefined, right: object | undefined) => {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
};

const sameRowClassNames = (left: ResolvedTreeProps['classNames'], right: ResolvedTreeProps['classNames']) =>
  left === right || (left?.node === right?.node
    && left?.nodeSelected === right?.nodeSelected
    && left?.icon === right?.icon
    && left?.title === right?.title);

const sameRowStyles = (left: ResolvedTreeProps['styles'], right: ResolvedTreeProps['styles']) =>
  left === right || (shallowEqualRecord(left?.node, right?.node)
    && shallowEqualRecord(left?.nodeSelected, right?.nodeSelected)
    && shallowEqualRecord(left?.nodeHover, right?.nodeHover)
    && shallowEqualRecord(left?.icon, right?.icon)
    && shallowEqualRecord(left?.title, right?.title));

/** 只比较单行真正使用的配置，避免 expandedKeys/selectedKeys 变化使所有行失去 memo 收益。 */
function areTreeRowsEqual(previous: RowProps, next: RowProps) {
  if (previous.item.node !== next.item.node
    || previous.item.level !== next.item.level
    || previous.item.isLast !== next.item.isLast
    || previous.item.disabled !== next.item.disabled
    || !sameTypedKeys(previous.item.parentKeys, next.item.parentKeys)
    || previous.item.ancestorIsLast.length !== next.item.ancestorIsLast.length
    || previous.item.ancestorIsLast.some((value, index) => value !== next.item.ancestorIsLast[index])
    || previous.expanded !== next.expanded
    || previous.selected !== next.selected
    || previous.indeterminate !== next.indeterminate
    || previous.loading !== next.loading
    || previous.focused !== next.focused
    || previous.query !== next.query
    || previous.top !== next.top
    || previous.dndScope !== next.dndScope
    || previous.onToggle !== next.onToggle
    || previous.onSelect !== next.onSelect
    || previous.onLoad !== next.onLoad
    || previous.onMenu !== next.onMenu
    || previous.onFocus !== next.onFocus
    || previous.onKeyDown !== next.onKeyDown
    || previous.registerElement !== next.registerElement
    || !sameRowClassNames(previous.props.classNames, next.props.classNames)
    || !sameRowStyles(previous.props.styles, next.props.styles)) return false;
  return rowConfigKeys.every((key) => previous.props[key] === next.props[key]);
}

/** 自定义图标既可以是固定 ReactNode，也可以根据节点和展开状态动态生成。 */
const renderIcon = (icon: ResolvedTreeProps['expandIcon'], node: TreeNodeData, expanded: boolean) =>
  typeof icon === 'function' ? icon(node, expanded) : icon;

/** 节点内容图标与交互图标使用相同的动态渲染约定。 */
const renderNodeIcon = (icon: TreeNodeData['icon'], node: TreeNodeData, expanded: boolean) =>
  typeof icon === 'function' ? icon(node, expanded) : icon;

/** 行内编辑需要纯文本；复杂标题可通过 searchText 提供可编辑名称。 */
const getEditableTitle = (node: TreeNodeData) => {
  if (node.searchText !== undefined) return node.searchText;
  if (typeof node.title === 'string' || typeof node.title === 'number') return String(node.title);
  return undefined;
};

/**
 * 图标尺寸控制层。
 * SVG 和自定义 ReactNode 都不直接承担尺寸配置；使用方只需在 Tree 根节点覆盖
 * `--tree-icon-size`，所有展开、选择、拖拽和业务图标即可同步缩放。
 */
function IconGraphic({ children }: { children: ReactNode }) {
  return <span className="rc-tree__icon-graphic" aria-hidden="true">{children}</span>;
}

/**
 * 单个可见节点行。
 *
 * 行组件独立 memo，并将 hover、拖拽源状态、放置目标状态保存在行内。
 * 这样移动指针或拖拽一个节点时，不需要让整棵树同步重新渲染。
 */
export const TreeRow = memo(function TreeRow({ item, props, expanded, selected, indeterminate, loading, query, top, dndScope, onToggle, onSelect, onLoad, onMenu, focused, onFocus, onKeyDown, registerElement }: RowProps) {
  const latestRowPropsRef = useRef(props);
  latestRowPropsRef.current = props;
  // hover 只为支持 styles.nodeHover；CSS :hover 主题不依赖此状态。
  const [hovered, setHovered] = useState(false);
  // dragging 控制原位置半透明反馈，由 Pragmatic DnD 生命周期更新。
  const [dragging, setDragging] = useState(false);
  // dropPosition 决定 before / inside / after 三种可视落点提示。
  const [dropPosition, setDropPosition] = useState<DropPosition>();
  const [renameDraft, setRenameDraft] = useState('');
  const cancelRenameRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Pragmatic DnD 直接绑定真实 DOM；ref 仅用于注册，不对外暴露。
  const rowRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLSpanElement>(null);
  const { node, level, parentKeys, isLast, ancestorIsLast, disabled } = item;
  const setRowElement = useCallback((element: HTMLDivElement | null) => {
    rowRef.current = element;
    registerElement(node.key, element);
  }, [node.key, registerElement]);
  // nested 保持原来的自由嵌套行为；same-level 只允许相同 parentKeys 的节点互相排序。
  const dragMode = props.dragMode ?? 'nested';
  const editableTitle = getEditableTitle(node);
  const renameRequested = props.renameEditingKey !== null && props.renameEditingKey !== undefined
    && keyId(props.renameEditingKey) === keyId(node.key);
  const renameAllowed = Boolean(props.renameEnabled && !props.readOnly && !disabled
    && editableTitle !== undefined && (props.canRenameNode?.(node) ?? true));
  const renaming = renameRequested && renameAllowed;

  const closeRename = () => {
    props.onRenameEditingKeyChange?.(null);
  };

  const finishRename = () => {
    const cancelled = cancelRenameRef.current;
    cancelRenameRef.current = false;
    closeRename();
    const nextTitle = renameDraft.trim();
    if (!cancelled && nextTitle && nextTitle !== editableTitle) props.onRename?.(node, nextTitle);
  };

  useSafeLayoutEffect(() => {
    if (!renaming) return;
    setRenameDraft(editableTitle ?? '');
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editableTitle, renaming]);

  // 有已加载 children，或存在 loadData 且节点未声明为叶子时，才展示展开按钮。
  const hasChildren = Boolean(node.children?.length) || (!node.isLeaf && Boolean(props.loadData));
  // children 数组（包括已加载的空数组）或异步非叶子节点都按文件夹展示。
  const isFolder = node.isLeaf !== true && (Array.isArray(node.children) || Boolean(props.loadData));
  const selectable = (props.selectableParents ?? true) || !isFolder;
  const selectionTrigger = props.selectionTrigger ?? 'node';
  const parentSelectionEnabled = (props.selectionMode ?? 'none') !== 'none' && (props.selectableParents ?? true);
  const indent = props.indent ?? 24;
  const itemHeight = props.itemHeight ?? 32;
  const nodeGap = props.nodeGap ?? 2;
  // 叶子节点不再渲染空 switcher DOM，但左侧少掉的一个图标位仍需计入层级 margin。
  // 否则叶子节点的第一个真实图标会与父节点 switcher 后的图标对齐，视觉上像是同一级。
  // switcher 配置在右侧时，左侧原本就没有该图标位，因此不需要补偿。
  // 叶子缺少的是一个固定 24px switcher 槽位，与层级 indent 无关。
  // 使用 indent 补位只会在默认 24px 时碰巧正确，较大缩进会让叶子额外偏移。
  const switcherMargin = !hasChildren && (props.switcherPosition ?? 'left') === 'left' ? 24 : 0;

  /**
   * 展开按钮点击流程：
   * 1. 阻止冒泡，避免同时触发节点选择；
   * 2. 首次展开未加载节点时先启动异步加载；
   * 3. 无论是否异步加载，都通过 onToggle 请求父组件更新 expandedKeys。
   */
  const switcher = hasChildren ? (
    <button type="button" tabIndex={-1} className="rc-tree__switcher" aria-label={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded}
      onClick={(event) => { event.stopPropagation(); if (!expanded && !node.children?.length && props.loadData) onLoad(node); onToggle(node); }}>
      {loading ? (props.renderLoading?.(node) ?? <span className="rc-tree__spinner" />) :
        <IconGraphic>{renderIcon(expanded ? props.collapseIcon : props.expandIcon, node, expanded) ?? <Chevron expanded={expanded} />}</IconGraphic>}
    </button>
  ) : null;

  // selectionMode 为 none 时完全不占选择图标空间；自定义图标可感知全选与中间态。
  const showSelection = selectionTrigger === 'icon' || (props.showSelectionIcon ?? true);
  const selection = !props.readOnly && selectable && (props.selectionMode ?? 'none') !== 'none' && showSelection ? (
    <button type="button" tabIndex={-1} className={`rc-tree__selection-icon rc-tree__selection-icon--${props.selectionMode}${selected || indeterminate ? ' rc-tree__selection-icon--selected' : ''}`}
      aria-label={selected ? (props.selectionMode === 'multiple' ? 'Deselect node' : 'Selected node') : 'Select node'} aria-pressed={selected} disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onSelect(node); }}>
      <IconGraphic>{typeof props.selectionIcon === 'function'
        ? props.selectionIcon(node, selected, indeterminate)
        : props.selectionIcon ?? (props.selectionMode === 'single' ? <Radio selected={selected} /> : <Check selected={selected} indeterminate={indeterminate} />)}</IconGraphic>
    </button>
  ) : null;

  // 隐藏手柄时自动退回整行拖拽，避免仍处于 handle 模式而失去拖拽入口。
  const dragTrigger = props.showDragHandle === false ? 'node' : props.dragTrigger ?? 'handle';
  const handle = props.draggable && !props.readOnly && props.showDragHandle !== false ? <span ref={dragHandleRef} className="rc-tree__drag" aria-label="Drag node" onClick={(event) => event.stopPropagation()}><IconGraphic>{props.dragIcon ?? <DragDots />}</IconGraphic></span> : null;
  const fallbackNodeIcon = isFolder
    ? (expanded ? renderNodeIcon(props.folderOpenIcon, node, expanded) ?? <FolderOpen /> : renderNodeIcon(props.folderIcon, node, expanded) ?? <Folder />)
    : renderNodeIcon(props.fileIcon, node, expanded) ?? <File />;
  const nodeIcon = renderNodeIcon(node.icon, node, expanded) ?? fallbackNodeIcon;
  const hasConfiguredNodeIcon = node.icon !== undefined || props.fileIcon !== undefined || props.folderIcon !== undefined || props.folderOpenIcon !== undefined;
  const showNodeIcon = props.showNodeIcon ?? hasConfiguredNodeIcon;

  // 图标分成标题前后两个插槽，统一实现 switcher/dragIcon 的左右位置配置。
  const leading: ReactNode[] = [];
  const trailing: ReactNode[] = [];
  // 没有图标时不写入数组，后续 map 就不会创建空的 rc-tree__slot 占位元素。
  const place = (content: ReactNode, position: IconPosition = 'left') => {
    if (content === null || content === undefined || content === false) return;
    (position === 'left' ? leading : trailing).push(content);
  };
  place(switcher, props.switcherPosition);
  if (handle) place(handle, props.dragIconPosition);
  place(selection, props.selectionIconPosition);
  if (showNodeIcon) leading.push(<span className={["rc-tree__node-icon", "rc-tree__custom-icon", props.classNames?.icon].filter(Boolean).join(' ')} style={props.styles?.icon}><IconGraphic>{nodeIcon}</IconGraphic></span>);

  // 状态 class 负责主题和拖拽落点；业务 class 最终也会保留在同一行元素上。
  const classes = ['rc-tree__node', props.classNames?.node, node.className, selected && 'rc-tree__node--selected', selected && props.classNames?.nodeSelected, disabled && 'rc-tree__node--disabled', dragging && 'rc-tree__node--dragging', dropPosition && `rc-tree__node--drop-${dropPosition}`].filter(Boolean).join(' ');

  // 层级偏移使用 margin 而不是 padding：这样节点背景、hover 和选中区域会随整行一起右移，
  // 不会出现“文字已经缩进，但背景仍从树最左侧铺满”的视觉问题。
  // paddingInlineStart 只保留与层级无关的 4px 行内呼吸空间。
  // 样式按“全局节点 → 选中 → hover → 单节点 → 虚拟定位”的顺序合并；
  // 单节点 style 的业务定制优先于状态样式，虚拟定位必须最后写入以保证布局正确。
  // itemHeight 只表示节点本身高度；nodeGap 作为额外间距加入行步长，修改后才能真正拉开节点。
  // 普通流通过 margin 产生间距，虚拟模式则在 TreeInner 中使用相同的 itemHeight + nodeGap 步长。
  const rowStyle: CSSProperties = { marginInlineStart: level * indent + switcherMargin, marginBlockEnd: nodeGap, paddingInlineStart: 4, height: itemHeight, ...props.styles?.node, ...(selected ? props.styles?.nodeSelected : {}), ...(hovered ? props.styles?.nodeHover : {}), ...node.style, ...(top === undefined ? {} : { position: 'absolute', top, left: 0, right: 0 }) };

  /**
   * 辅助线使用“全局树坐标 → 当前行相对坐标”计算位置。
   * 当前行已经通过 margin 向右移动，因此所有线段的 left 通常是负数；线段会从行背景外部
   * 延伸到第一个实际图标，同时不会扩大节点自身的选中或 hover 背景。
   */
  const rowOffset = level * indent + switcherMargin;
  // 4px 是节点固定的 paddingInlineStart；把它计入轴线后，主干会精确穿过 switcher 中心。
  // 辅助线轴心始终对齐 24px switcher 的中心（行内起点 4px + 12px），不随 indent 改变。
  const guideAxis = 16;
  const currentGuideLeft = guideAxis - indent - switcherMargin;
  // 横向分支只连接到节点背景的左边界，不能继续伸进 hover / 选中区域。
  const branchWidth = -currentGuideLeft;
  const lineStyle = props.lineStyle ?? 'dashed';
  const showLines = props.showLines ?? true;

  // ancestorIsLast[0] 描述根节点自身；根节点没有父级连接线，所以从索引 1 开始。
  // 某一级路径节点不是末节点时，它的父级主干需要继续贯穿当前节点及其所有后代。
  const ancestorGuides = ancestorIsLast.flatMap((ancestorLast, ancestorLevel) => {
    if (ancestorLevel === 0 || ancestorLast) return [];
    const globalGuideLeft = (ancestorLevel - 1) * indent + guideAxis;
    return [
      <span
        aria-hidden="true"
        className="rc-tree__guide rc-tree__guide--ancestor"
        key={`ancestor-${ancestorLevel}`}
        style={{ left: globalGuideLeft - rowOffset, bottom: -nodeGap, borderInlineStartStyle: lineStyle }}
      />,
    ];
  });

  // 先得到默认高亮标题，再交给 renderTitle，业务可包裹它而不丢失搜索高亮。
  const title = highlightTitle(node, query);

  useEffect(() => {
    const element = rowRef.current;
    if (!props.draggable || props.readOnly || !element) return;
    const dragHandle = dragTrigger === 'handle' ? dragHandleRef.current : null;
    // 手柄模式下必须等手柄节点存在；这能避免退化成整行可拖拽。
    if (dragTrigger === 'handle' && !dragHandle) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let currentDropPosition: DropPosition | undefined;
    const clearDropPosition = () => {
      currentDropPosition = undefined;
      setDropPosition(undefined);
    };

    void import('../utils/dndRuntime.js').then(({ attachInstruction, combine, draggable, dropTargetForElements, extractInstruction, setCustomNativeDragPreview }) => {
      if (disposed) return;
      const updateDropPosition = (data: Record<string | symbol, unknown>) => {
        const instruction = extractInstruction(data);
        const next = instruction && !instruction.blocked ? instructionToDropPosition(instruction.operation) : undefined;
        if (next === currentDropPosition) return;
        currentDropPosition = next;
        setDropPosition(next);
        if (next) latestRowPropsRef.current.onDragOver?.(node, next);
      };
      cleanup = combine(
        draggable({
          element,
          ...(dragHandle ? { dragHandle } : {}),
          canDrag: () => !props.readOnly && !disabled && !renaming,
          getInitialData: () => createTreeDragData(node, dndScope, parentKeys),
          onGenerateDragPreview: ({ nativeSetDragImage }) => {
            setCustomNativeDragPreview({
              nativeSetDragImage,
              render: ({ container }) => {
                const preview = element.cloneNode(true) as HTMLDivElement;
                const bounds = element.getBoundingClientRect();
                const treeRoot = element.closest<HTMLElement>('.rc-tree');
                const theme = treeRoot ? getComputedStyle(treeRoot) : null;

                container.classList.add('rc-tree', 'rc-tree__drag-preview-host');
                for (const property of ['--tree-color', '--tree-muted', '--tree-primary', '--tree-theme-color', '--tree-hover', '--tree-selected', '--tree-border', '--tree-icon-size', '--tree-icon-slot-size', '--tree-line-icon-gap']) {
                  const value = theme?.getPropertyValue(property);
                  if (value) container.style.setProperty(property, value);
                }
                preview.classList.remove('rc-tree__node--dragging');
                preview.classList.add('rc-tree__drag-preview');
                preview.removeAttribute('draggable');
                preview.setAttribute('aria-hidden', 'true');
                Object.assign(preview.style, {
                  width: `${bounds.width}px`,
                  margin: '0',
                  position: 'relative',
                  top: 'auto',
                  right: 'auto',
                  left: 'auto',
                });
                preview.querySelectorAll('.rc-tree__guide, .rc-tree__guide-branch').forEach((guide) => guide.remove());
                container.append(preview);
              },
            });
          },
          onDragStart: () => { setDragging(true); latestRowPropsRef.current.onDragStart?.(node); },
          onDrop: () => { setDragging(false); latestRowPropsRef.current.onDragEnd?.(node); },
        }),
        dropTargetForElements({
          element,
          canDrop: ({ source }) => {
            const sourceData = getTreeDragData(source.data, dndScope);
            return Boolean(sourceData
              && !props.readOnly
              && !disabled
              && !renaming
              && keyId(sourceData.node.key) !== keyId(node.key)
              && !pathContainsTreeKey(parentKeys, sourceData.node.key)
              && isDropAllowedByMode(dragMode, sourceData.parentKeys, parentKeys));
          },
          getData: ({ input, element: target }) => attachInstruction(
            { type: 'lensui/tree-drop-target', scope: dndScope, node },
            {
              input,
              element: target,
              axis: 'vertical',
              operations: getDropOperations(dragMode),
            },
          ),
          getIsSticky: () => true,
          onDragEnter: ({ self }) => updateDropPosition(self.data),
          onDrag: ({ self }) => updateDropPosition(self.data),
          onDragLeave: clearDropPosition,
          onDrop: ({ source, self, location }) => {
            clearDropPosition();
            // 如果未来节点内部增加嵌套 drop target，仅由最内层目标提交一次结果。
            if (location.current.dropTargets[0]?.element !== self.element) return;
            const sourceData = getTreeDragData(source.data, dndScope);
            const instruction = extractInstruction(self.data);
            // 再校验一次模式，避免拖拽过程中配置变化或第三方事件绕过 canDrop。
            if (!sourceData
              || !instruction
              || instruction.blocked
              || disabled
              || pathContainsTreeKey(parentKeys, sourceData.node.key)
              || !isDropAllowedByMode(dragMode, sourceData.parentKeys, parentKeys)) return;
            latestRowPropsRef.current.onDrop?.({ dragNode: sourceData.node, targetNode: node, position: instructionToDropPosition(instruction.operation) });
          },
        }),
      );
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [disabled, dndScope, dragMode, dragTrigger, node, parentKeys, props.dragIconPosition, props.draggable, props.readOnly, renaming]);

  return <div ref={setRowElement} role="treeitem" draggable={Boolean(props.draggable && !props.readOnly && !disabled && !renaming)} tabIndex={focused ? 0 : -1} aria-level={level + 1} aria-expanded={hasChildren ? expanded : undefined} aria-selected={selected} aria-disabled={disabled} className={classes} style={rowStyle}
    onFocus={(event) => { if (event.target === event.currentTarget) onFocus(node.key); }}
    onKeyDown={(event) => { if (event.target === event.currentTarget) onKeyDown(event, item, expanded); }}
    onClick={(event) => {
      event.currentTarget.focus();
      onFocus(node.key);
      props.onNodeClick?.(node, event);
      // 父节点选择优先级最高；只有父节点不可选时，整行点击才用于展开或收起。
      if (props.expandOnParentClick && !parentSelectionEnabled && hasChildren) {
        if (!expanded && !node.children?.length && props.loadData) onLoad(node);
        onToggle(node);
        return;
      }
      if (!disabled && selectable && selectionTrigger === 'node') onSelect(node);
    }}
    onDoubleClick={(event) => props.onNodeDoubleClick?.(node, event)}
    onContextMenu={(event) => onMenu(event, node)}
    onMouseEnter={(event) => { if (props.styles?.nodeHover) setHovered(true); props.onNodeMouseEnter?.(node, event); }} onMouseLeave={(event) => { if (props.styles?.nodeHover) setHovered(false); props.onNodeMouseLeave?.(node, event); }}>
    {showLines && <>
      {/* 外层祖先仍有后续兄弟时，主干必须连续穿过当前整行。 */}
      {ancestorGuides}

      {/* 展开的父节点从自身中线向下画半行，和第一个子节点的上半段接成连续主干。 */}
      {expanded && Boolean(node.children?.length) && <span
        aria-hidden="true"
        className="rc-tree__guide rc-tree__guide--children-stem"
        style={{ left: guideAxis, bottom: -nodeGap, borderInlineStartStyle: lineStyle }}
      />}

      {level > 0 && <>
        {/* 非末节点竖线贯穿整行；末节点只画到行中线，形成最后一个 L 形收口。 */}
        <span
          aria-hidden="true"
          className={`rc-tree__guide rc-tree__guide--current${isLast ? ' rc-tree__guide--last' : ''}`}
          style={{ left: currentGuideLeft, ...(isLast ? {} : { bottom: -nodeGap }), borderInlineStartStyle: lineStyle }}
        />
        {/* 从父级主干横向连接到当前行第一个真实图标，不依赖空 DOM 占位。 */}
        <span
          aria-hidden="true"
          className="rc-tree__guide-branch"
          style={{ left: currentGuideLeft, width: branchWidth, borderBlockStartStyle: lineStyle }}
        />
      </>}
    </>}
    {leading.map((entry, index) => <span className="rc-tree__slot" key={`l${index}`}>{entry}</span>)}
    <span className={["rc-tree__title", renaming && "rc-tree__title--renaming", props.classNames?.title].filter(Boolean).join(' ')} style={props.styles?.title}>
      {renaming ? <input
        ref={renameInputRef}
        className="rc-tree__rename-input"
        aria-label={`Rename ${editableTitle ?? String(node.key)}`}
        value={renameDraft}
        onChange={(event) => setRenameDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelRenameRef.current = true;
            event.currentTarget.blur();
          }
        }}
        onBlur={finishRename}
      /> : props.renderTitle?.(node, title) ?? title}
    </span>
      {!props.readOnly && <span className="rc-tree__actions" onClick={(event) => event.stopPropagation()}>
        {props.renderActions?.(node, (event) => onMenu(event, node, 'trigger'))}
      </span>}
    {trailing.map((entry, index) => <span className="rc-tree__slot" key={`r${index}`}>{entry}</span>)}
  </div>;
}, areTreeRowsEqual);
