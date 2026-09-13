import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

/** 节点的唯一标识。内部会同时保留类型，因此数字 `1` 与字符串 `'1'` 不会冲突。 */
export type TreeKey = string | number;
/** 节点选择策略：关闭选择、单选或多选。 */
export type SelectionMode = 'none' | 'single' | 'multiple';
/** 点击整行选择节点，或仅允许通过选择图标操作。 */
export type SelectionTrigger = 'node' | 'icon';
/** 可移动图标位于节点标题左侧还是右侧。 */
export type IconPosition = 'left' | 'right';
/** 从独立手柄开始拖拽，或允许从整行开始拖拽。 */
export type DragTrigger = 'handle' | 'node';
/** 自由跨层级嵌套，或只允许在同一个父节点下重新排序。 */
export type DragMode = 'nested' | 'same-level';
/** 相对于目标节点的最终放置位置。 */
export type DropPosition = 'before' | 'inside' | 'after';

/**
 * 业务侧传入的开放节点记录。
 *
 * 没有必填字段，任意业务字段都可以直接传入；下面的可选字段仅为默认字段名
 * 和旧版 key/title 数据提供类型提示。Tree 默认从 `id` 读取唯一键，也可以
 * 通过 `fieldNames` 映射标题、子节点及其他能力字段。
 */
export interface TreeNodeData {
  [field: string]: unknown;
  id?: TreeKey;
  key?: TreeKey;
  title?: ReactNode;
  children?: TreeNodeData[];
  searchText?: string;
  disabled?: boolean;
  isLeaf?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** 动态节点字段到 Tree 标准能力的映射。 */
export interface TreeFieldNames {
  /** 唯一键字段，默认 `id`；未命中时兼容读取 `key`。 */
  key?: string;
  /** 标题字段，默认 `title`，并兼容 `name` 与 `label`。 */
  title?: string;
  /** 子节点数组字段，默认 `children`。 */
  children?: string;
  /** 搜索纯文本字段，默认 `searchText`。 */
  searchText?: string;
  /** 禁用状态字段，默认 `disabled`。 */
  disabled?: string;
  /** 叶子节点状态字段，默认 `isLeaf`。 */
  isLeaf?: string;
  /** 节点图标字段，默认 `icon`。 */
  icon?: string;
  /** 节点行 className 字段，默认 `className`。 */
  className?: string;
  /** 节点行内联样式字段，默认 `style`。 */
  style?: string;
}

/** 节点内容图标；函数形式可根据节点和展开状态动态返回图标。 */
export type TreeNodeIcon = ReactNode | ((node: ResolvedTreeNodeData, expanded: boolean) => ReactNode);

/**
 * Tree 标准化后的节点。
 *
 * 渲染器与回调接收此结构：始终包含 key/title，并保留原始业务字段。
 * Tree 仍把 `data` 当作不可变输入，不会修改业务节点或 children。
 */
export interface ResolvedTreeNodeData {
  /** 全树唯一 key，用于展开、选择、虚拟行复用和拖拽识别。 */
  key: TreeKey;
  /** 节点展示内容，可以是文本，也可以是任意 React 节点。 */
  title: ReactNode;
  /** 搜索使用的纯文本；title 不是字符串或数字时应显式提供。 */
  searchText?: string;
  /** 已经加载完成的子节点。没有 children 不一定代表叶子节点。 */
  children?: ResolvedTreeNodeData[];
  /** 禁止选中与拖拽该节点；展开按钮仍保持可用。 */
  disabled?: boolean;
  /** 明确声明为叶子节点；设为 true 后不会展示异步展开按钮。 */
  isLeaf?: boolean;
  /** 标题前的节点级图标；优先于 Tree 的文件夹/文件图标，可按展开状态动态返回。 */
  icon?: TreeNodeIcon;
  /** 当前节点行的附加 className。 */
  className?: string;
  /** 当前节点行的附加内联样式，优先级高于 Tree 级节点样式。 */
  style?: CSSProperties;
  /** 允许业务侧携带额外字段，所有回调都会原样返回当前节点。 */
  [extra: string]: unknown;
}

/** 右键菜单中的单个操作项。 */
export interface TreeMenuItem {
  /** 菜单项唯一 key。 */
  key: TreeKey;
  /** 菜单项展示内容。 */
  label: ReactNode;
  /** 禁止点击该菜单项。 */
  disabled?: boolean;
  /** 使用危险操作样式，适合删除等不可逆操作。 */
  danger?: boolean;
  /** 点击后回传打开菜单时对应的树节点。 */
  onClick?: (node: ResolvedTreeNodeData) => void;
}

/** 拖拽完成后的完整上下文，由业务层据此更新受控 data。 */
export interface TreeDropInfo {
  /** 被拖动的原始节点。 */
  dragNode: ResolvedTreeNodeData;
  /** 指针释放时命中的目标节点。 */
  targetNode: ResolvedTreeNodeData;
  /** 放在目标之前、成为目标子节点，或放在目标之后。 */
  position: DropPosition;
}

/**
 * 各区域的内联样式入口。
 * 对伪类、媒体查询等复杂场景，应使用 `classNames` 配合外部 CSS。
 */
export interface TreeStyles {
  /** Tree 最外层容器。 */
  root?: CSSProperties;
  /** 搜索区域容器。 */
  search?: CSSProperties;
  /** 树列表滚动视口。 */
  viewport?: CSSProperties;
  /** 每个节点行的基础样式。 */
  node?: CSSProperties;
  /** 鼠标进入节点行时追加的样式。 */
  nodeHover?: CSSProperties;
  /** 节点选中时追加的样式。 */
  nodeSelected?: CSSProperties;
  /** 业务节点图标样式。 */
  icon?: CSSProperties;
  /** 节点标题样式。 */
  title?: CSSProperties;
  /** 空状态容器样式。 */
  empty?: CSSProperties;
}

/** 各区域的 className 入口，用于接入 CSS Modules、Tailwind 或主题系统。 */
export interface TreeClassNames {
  /** Tree 最外层容器。 */
  root?: string;
  /** 搜索区域容器。 */
  search?: string;
  /** 树列表滚动视口。 */
  viewport?: string;
  /** 所有节点行。 */
  node?: string;
  /** 选中节点行。 */
  nodeSelected?: string;
  /** 业务节点图标。 */
  icon?: string;
  /** 节点标题。 */
  title?: string;
  /** 空状态容器。 */
  empty?: string;
}

/** 展开能力配置。省略 keys 时 Tree 会在内部维护展开状态。 */
export interface TreeExpansionConfig {
  /** 受控展开 key 集合。 */
  keys?: TreeKey[];
  /** 非受控模式的初始展开节点，会自动补齐祖先路径。 */
  defaultKeys?: TreeKey[];
  /** 首次获得非空数据时展开全部节点，优先级高于 defaultKeys。 */
  defaultAll?: boolean;
  /** 展开一个节点时收起其他节点。 */
  accordion?: boolean;
  /** 父节点不可选时，点击整行展开或收起。 */
  onParentClick?: boolean;
  /** 选中深层节点时是否自动展开其祖先，默认 true。 */
  autoExpandSelected?: boolean;
  /** 展开状态变化回调。 */
  onChange?: (keys: TreeKey[], node: ResolvedTreeNodeData, expanded: boolean) => void;
}

/** 选择能力配置。省略时使用无选择框的整行单选，传入 false 时完全关闭选择。 */
export interface TreeSelectionConfig {
  /** 单选或多选，默认 single。 */
  mode?: Exclude<SelectionMode, 'none'>;
  /** 受控选中 key 集合。 */
  keys?: TreeKey[];
  /** 非受控模式的初始选中 key 集合。 */
  defaultKeys?: TreeKey[];
  /** 是否显示选择图标，默认 true。 */
  showIcon?: boolean;
  /** 选择图标位于标题左侧或右侧，默认 left。 */
  iconPosition?: IconPosition;
  /** 父节点是否可选，默认 true。 */
  parentsSelectable?: boolean;
  /** 点击整行选择，或仅允许点击选择图标。 */
  trigger?: SelectionTrigger;
  /** 选中状态变化回调。 */
  onChange?: (keys: TreeKey[], node: ResolvedTreeNodeData, selected: boolean) => void;
}

/** 搜索能力配置。传入 true 使用默认搜索框，传入对象可受控或自定义渲染。 */
export interface TreeSearchConfig {
  /** 受控搜索值。 */
  value?: string;
  /** 输入变化回调。 */
  onChange?: (value: string) => void;
  /** 默认搜索输入框的 placeholder。 */
  placeholder?: string;
  /** 完整替换默认搜索区域。 */
  render?: (value: string, onChange: (value: string) => void) => ReactNode;
}

/** 拖拽能力配置。传入 true 使用默认拖拽行为。 */
export interface TreeDragConfig {
  /** 自由跨层级嵌套，或仅在同一个父节点下排序。 */
  mode?: DragMode;
  /** 从拖拽手柄或整行开始拖拽。 */
  trigger?: DragTrigger;
  /** 是否显示拖拽手柄，默认 true；隐藏后自动使用整行拖拽。 */
  showHandle?: boolean;
  /** 替换默认六点拖拽图标。 */
  icon?: ReactNode;
  /** 拖拽图标位置。 */
  iconPosition?: IconPosition;
  onStart?: (node: ResolvedTreeNodeData) => void;
  onEnd?: (node: ResolvedTreeNodeData) => void;
  onOver?: (node: ResolvedTreeNodeData, position: DropPosition) => void;
  onDrop?: (info: TreeDropInfo) => void;
}

/** 节点行内重命名配置；data 仍由业务侧在 onChange 中不可变更新。 */
export interface TreeRenameConfig {
  /** 当前正在编辑的节点 key；null 表示未编辑。 */
  editingKey: TreeKey | null;
  /** 编辑节点变化回调，用于从右键菜单进入编辑，并在提交或取消后清空状态。 */
  onEditingKeyChange: (key: TreeKey | null) => void;
  /** 按节点决定是否允许重命名；禁用节点始终不可重命名。 */
  canRename?: (node: ResolvedTreeNodeData) => boolean;
  /** 提交新名称时触发；Tree 不会直接修改 data。 */
  onChange: (node: ResolvedTreeNodeData, title: string) => void;
}

/** Tree 中所有图标的集中配置。 */
export interface TreeIconConfig {
  expand?: ReactNode | ((node: ResolvedTreeNodeData, expanded: boolean) => ReactNode);
  collapse?: ReactNode | ((node: ResolvedTreeNodeData, expanded: boolean) => ReactNode);
  selection?: ReactNode | ((node: ResolvedTreeNodeData, selected: boolean, indeterminate: boolean) => ReactNode);
  /** 是否显示节点文件/文件夹图标。 */
  showNode?: boolean;
  file?: TreeNodeIcon;
  folder?: TreeNodeIcon;
  folderOpen?: TreeNodeIcon;
  /** 统一交互主题色。 */
  color?: string;
}

/** 结构、间距、辅助线与图标等视觉配置。 */
export interface TreeAppearanceConfig {
  lines?: boolean;
  lineStyle?: 'dashed' | 'solid';
  /** 每级缩进像素；负数归一为 0，非有限数回退 24。 */
  indent?: number;
  /** 节点垂直间距；负数归一为 0，非有限数回退 2。 */
  nodeGap?: number;
  switcherPosition?: IconPosition;
  icons?: TreeIconConfig;
}

/** 异步节点加载配置。 */
export interface TreeAsyncLoadConfig {
  /** 整棵树是否处于初次加载状态。 */
  loading?: boolean;
  load?: (node: ResolvedTreeNodeData, signal: AbortSignal) => Promise<TreeNodeData[] | void>;
  /** 硬超时时间，单位毫秒；即使 load 忽略 signal，迟到结果也不会触发 onLoad。 */
  timeout?: number;
  renderLoading?: (node?: ResolvedTreeNodeData) => ReactNode;
  onLoad?: (node: ResolvedTreeNodeData, children?: TreeNodeData[]) => void;
  onError?: (error: unknown, node?: ResolvedTreeNodeData) => void;
}

/** 标题、操作区、空状态、菜单和错误降级等渲染入口。 */
export interface TreeRenderersConfig {
  title?: (node: ResolvedTreeNodeData, highlightedTitle: ReactNode) => ReactNode;
  /** 渲染节点操作区；第二个参数可在按钮位置打开与右键相同的菜单。 */
  actions?: (node: ResolvedTreeNodeData, openMenu: (event: React.MouseEvent<HTMLElement>) => void) => ReactNode;
  empty?: () => ReactNode;
  emptyContent?: ReactNode;
  menu?: (node: ResolvedTreeNodeData) => TreeMenuItem[];
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
}

/** 节点原始交互事件。业务状态变化优先使用对应能力配置中的 onChange。 */
export interface TreeEventsConfig {
  onClick?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  onDoubleClick?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  onContextMenu?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  onMouseEnter?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  onMouseLeave?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
}

/** 虚拟滚动配置。传入 true 时默认继承父容器高度。 */
export interface TreeVirtualConfig {
  /** 视口高度；省略或传 parent 表示填满父容器剩余高度，数字表示固定像素。 */
  height?: number | 'parent';
  /** 固定行高，最小 1px，默认 32。 */
  itemHeight?: number;
  /** 视口上下额外渲染行数，向下取整且最小为 0，默认 4。 */
  overscan?: number;
}

/**
 * Tree 的完整公开 API。
 * 推荐通过 expansion、selection、search、drag 等领域配置组织能力；
 * 原有扁平属性仍保留兼容，并在与分组配置同时出现时由分组配置覆盖。
 */
export interface TreeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect' | 'onError' | 'onLoad' | 'onDrop' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'children'> {
  /** 树数据源。组件不会在内部修改该数组。 */
  data: TreeNodeData[];
  /** 动态数据字段映射；key 默认取 `id`，同时兼容已有 `key` 数据。 */
  fieldNames?: TreeFieldNames;
  /** 展开能力配置。 */
  expansion?: TreeExpansionConfig;
  /** 选择能力配置；省略时默认整行单选且不显示选择框，false 表示关闭。 */
  selection?: TreeSelectionConfig | false;
  /** 搜索能力配置；true 使用默认搜索框，false 表示关闭。 */
  search?: TreeSearchConfig | boolean;
  /** 拖拽能力配置；true 使用默认行为，false 表示关闭。 */
  drag?: TreeDragConfig | boolean;
  /** 行内重命名配置；通过受控 editingKey 从右键菜单或自定义操作入口开始编辑。 */
  rename?: TreeRenameConfig | false;
  /** 结构与视觉配置。 */
  appearance?: TreeAppearanceConfig;
  /** 异步节点加载配置。 */
  asyncLoad?: TreeAsyncLoadConfig;
  /** 自定义渲染入口。 */
  renderers?: TreeRenderersConfig;
  /** 节点原始交互事件。 */
  events?: TreeEventsConfig;
  /** 受控展开 key 集合。 */
  expandedKeys?: TreeKey[];
  /** 用户展开或收起节点时触发；父组件必须据此更新 expandedKeys。 */
  onExpandedKeysChange?: (keys: TreeKey[], node: ResolvedTreeNodeData, expanded: boolean) => void;
  /** 受控选中 key 集合；未传时使用内部选择状态。 */
  selectedKeys?: TreeKey[];
  /** 非受控选择时的初始选中 key 集合。 */
  defaultSelectedKeys?: TreeKey[];
  /** 用户改变选择时触发；父组件应据此更新 selectedKeys。 */
  onSelectedKeysChange?: (keys: TreeKey[], node: ResolvedTreeNodeData, selected: boolean) => void;
  /** 选择模式；旧版扁平 API 默认 `single`，设置为 `none` 可关闭选择。 */
  selectionMode?: SelectionMode;
  /** 是否显示选择图标；关闭后仍可点击节点行进行选择。默认配置下为 false，显式设置选择模式时为 true。 */
  showSelectionIcon?: boolean;
  /** 父节点是否可以被选择；关闭后仍可展开和拖拽，默认 true。 */
  selectableParents?: boolean;
  /** 选择触发区域：点击节点行或仅点击选择图标，默认 `node`。 */
  selectionTrigger?: SelectionTrigger;
  /** 首次获得非空 data 时请求父组件展开全部节点。 */
  defaultExpandAll?: boolean;
  /** 首次获得非空 data 时请求展开的节点 key；会自动补齐祖先路径，defaultExpandAll 优先。 */
  defaultExpandedKeys?: TreeKey[];
  /** 展开新节点时只保留该节点，收起其他已展开节点。 */
  accordion?: boolean;
  /** 点击不可选父节点行时展开或收起；selectableParents 为 true 时选择优先，默认 false。 */
  expandOnParentClick?: boolean;
  /** 浏览模式：隐藏选择框并使用整行单选，同时禁止拖拽、操作区和右键菜单；仍允许展开、收起和滚动。 */
  readOnly?: boolean;
  /** 是否显示顶部搜索区域，默认 false。 */
  searchable?: boolean;
  /** 受控搜索值；传入后内部不再自行保存输入值。 */
  searchValue?: string;
  /** 搜索输入变化时立即触发，不受筛选防抖影响。 */
  onSearchValueChange?: (value: string) => void;
  /** 默认搜索输入框的 placeholder。 */
  searchPlaceholder?: string;
  /** 完整替换默认搜索输入区域。 */
  renderSearch?: (value: string, onChange: (value: string) => void) => ReactNode;
  /** 自定义标题渲染；第二个参数已经包含搜索关键字高亮。 */
  renderTitle?: (node: ResolvedTreeNodeData, highlightedTitle: ReactNode) => ReactNode;
  /** 渲染节点右侧操作区；该区域点击不会触发节点选择。 */
  renderActions?: (node: ResolvedTreeNodeData, openMenu: (event: React.MouseEvent<HTMLElement>) => void) => ReactNode;
  /** 自定义空状态，优先级高于 emptyContent。 */
  renderEmpty?: () => ReactNode;
  /** 未提供 renderEmpty 时展示的空状态内容。 */
  emptyContent?: ReactNode;
  /** 整棵树是否处于初次加载状态。 */
  loading?: boolean;
  /** 自定义初次加载或节点异步加载内容；参数为空表示初次加载。 */
  renderLoading?: (node?: ResolvedTreeNodeData) => ReactNode;
  /**
   * 展开未加载节点时获取 children。
   * AbortSignal 会在 loadTimeout 到期时中止，业务请求应将 signal 传给 fetch。
   */
  loadData?: (node: ResolvedTreeNodeData, signal: AbortSignal) => Promise<TreeNodeData[] | void>;
  /** 单节点异步加载超时时间，单位毫秒，默认 10000。 */
  loadTimeout?: number;
  /** 加载成功后触发；Tree 不会自行写回 children，父组件应更新 data。 */
  onLoad?: (node: ResolvedTreeNodeData, children?: TreeNodeData[]) => void;
  /** 异步加载或渲染错误回调；渲染错误时 node 为空。 */
  onLoadError?: (error: unknown, node?: ResolvedTreeNodeData) => void;
  /** 启用 Pragmatic Drag and Drop，默认 false。 */
  draggable?: boolean;
  /** 拖拽模式：`nested` 支持跨层级及 inside，`same-level` 仅支持同级 before/after；默认 `nested`。 */
  dragMode?: DragMode;
  /** 拖拽触发区域，默认 `handle`。 */
  dragTrigger?: DragTrigger;
  /** 是否显示拖拽手柄，默认 true；隐藏后自动使用整行拖拽。 */
  showDragHandle?: boolean;
  /** 替换默认六点拖拽图标。 */
  dragIcon?: ReactNode;
  /** 拖拽图标位于标题左侧或右侧，默认 left。 */
  dragIconPosition?: IconPosition;
  /** 节点成功开始拖动时触发。 */
  onDragStart?: (node: ResolvedTreeNodeData) => void;
  /** 拖拽结束或取消时触发。 */
  onDragEnd?: (node: ResolvedTreeNodeData) => void;
  /** 有效落点从 before/inside/after 之间变化时触发。 */
  onDragOver?: (node: ResolvedTreeNodeData, position: DropPosition) => void;
  /** 有效放置完成时触发；父组件应根据 info 更新 data。 */
  onDrop?: (info: TreeDropInfo) => void;
  /** 显示父子辅助线，默认 true。 */
  showLines?: boolean;
  /** 辅助线样式，默认 dashed。 */
  lineStyle?: 'dashed' | 'solid';
  /** 每级子节点的缩进像素，默认 24。 */
  indent?: number;
  /**
   * 相邻节点之间的垂直间距，单位像素，默认 2。
   * 虚拟滚动时每行的实际步长为 itemHeight + nodeGap。
   */
  nodeGap?: number;
  /** 展开/收起图标位置，默认 left。 */
  switcherPosition?: IconPosition;
  /** 收起状态图标，可以按节点动态返回。 */
  expandIcon?: ReactNode | ((node: ResolvedTreeNodeData, expanded: boolean) => ReactNode);
  /** 展开状态图标，可以按节点动态返回。 */
  collapseIcon?: ReactNode | ((node: ResolvedTreeNodeData, expanded: boolean) => ReactNode);
  /** 选择图标，可以根据节点和选中状态动态返回。 */
  /** 自定义选择图标；第三个参数表示多选父节点处于部分选中的中间态。 */
  selectionIcon?: ReactNode | ((node: ResolvedTreeNodeData, selected: boolean, indeterminate: boolean) => ReactNode);
  /** 选择图标位置，默认 left。 */
  selectionIconPosition?: IconPosition;
  /** 是否显示节点内容图标；默认仅在节点或 Tree 显式配置图标时显示。 */
  showNodeIcon?: boolean;
  /** 叶子节点文件图标；节点自身 icon 的优先级更高。 */
  fileIcon?: TreeNodeIcon;
  /** 收起状态的分支文件夹图标。 */
  folderIcon?: TreeNodeIcon;
  /** 展开状态的分支文件夹图标。 */
  folderOpenIcon?: TreeNodeIcon;
  /** Tree 交互主题色；同步应用于图标、复选框、选中行、焦点和拖拽反馈。 */
  iconColor?: string;
  /** 返回当前节点的右键菜单配置；未提供时不接管浏览器右键菜单。 */
  menuItems?: (node: ResolvedTreeNodeData) => TreeMenuItem[];
  /** 节点单击回调，在内部选择逻辑之前执行。 */
  onNodeClick?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  /** 节点双击回调。 */
  onNodeDoubleClick?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  /** 节点右键回调，在自定义菜单打开之前执行。 */
  onNodeContextMenu?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  /** 鼠标进入节点回调。 */
  onNodeMouseEnter?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  /** 鼠标离开节点回调。 */
  onNodeMouseLeave?: (node: ResolvedTreeNodeData, event: React.MouseEvent) => void;
  /** 只挂载可视窗口附近节点，适合大数据量。 */
  virtual?: boolean | TreeVirtualConfig;
  /** 旧版固定虚拟滚动视口高度；省略时继承父容器。推荐使用 virtual.height。 */
  height?: number;
  /** 虚拟滚动固定行高，默认 32；必须与最终节点高度保持一致。 */
  itemHeight?: number;
  /** 可视区上下额外挂载行数，默认 4。 */
  overscan?: number;
  /** 各区域内联样式。 */
  styles?: TreeStyles;
  /** 各区域 className。 */
  classNames?: TreeClassNames;
  /** 渲染函数抛错后的降级界面，支持根据 Error 动态渲染。 */
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
}

/**
 * 将嵌套树转换为可见列表后的内部行模型。
 * 虚拟滚动和普通渲染共用该结构，从而保证两种模式行为一致。
 */
export interface FlatTreeNode {
  /** 原始业务节点引用。 */
  node: ResolvedTreeNodeData;
  /** 从 0 开始的树深度，用于缩进和 aria-level。 */
  level: number;
  /** 从根到父节点的 key 路径。 */
  parentKeys: TreeKey[];
  /** 当前节点自身或任一祖先是否禁用。 */
  disabled: boolean;
  /** 是否为同级最后一个节点，预留给连接线和主题扩展。 */
  isLast: boolean;
  /**
   * 从根节点到当前节点父级的“是否为同级末节点”状态。
   * 辅助线利用它判断哪些祖先主干需要继续穿过当前行和整段子树。
   */
  ancestorIsLast: boolean[];
}
