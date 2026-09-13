# lensui

轻量、类型完整、可主题化的 React Tree 组件。支持受控/非受控展开与选择、单选/多选联动、搜索、异步加载、拖拽排序、行内重命名、右键菜单、虚拟滚动、错误边界和细粒度样式扩展。

## 功能概览

- 默认支持点击节点进行单选高亮，不显示选择框。
- 可开启单选圆形选择框或多选复选框；多选父子节点自动正选、反选和中间态联动。
- 父节点可配置为不可选，并可选择是否点击整行展开/收起。
- 禁用会从父节点继承到所有后代：禁止选择、拖拽和重命名，但仍可展开/收起。
- 搜索支持默认输入框、受控输入和完全自定义渲染，筛选固定防抖 `300ms`。
- 拖拽支持自由嵌套与仅同级排序，使用 Pragmatic Drag and Drop 计算落点。
- 支持异步加载子节点、加载超时、初始 Loading、自定义 Loading 和错误降级。
- 支持右键菜单、节点操作区和行内重命名。
- 支持固定行高虚拟滚动、辅助线、图标替换和 CSS 变量主题。
- 支持树节点 roving tabindex、方向键导航、键盘选择以及右键菜单焦点管理。

## 文档导航

- [安装](#安装)
- [最小用法](#最小用法)
- [状态模式](#状态模式)
- [常用场景](#常用场景)
- [键盘操作](#键盘操作)
- [完整 Props](#完整-props)
- [主题变量](#主题变量)
- [旧版扁平 Props 迁移](#旧版扁平-props-迁移)
- [行为与数据职责](#行为与数据职责)

## 安装

```bash
npm install @ycxy/lensui
```

```tsx
import { Tree } from '@ycxy/lensui';
// 也可以使用单组件子路径
import { Tree } from '@ycxy/lensui/tree';

import '@ycxy/lensui/style.css';
```

React 和 ReactDOM 是 peer dependency，使用方需要安装 React 18 或更高版本。

## 最小用法

只传 `data` 时，Tree 默认允许点击整行进行单选高亮，不显示选择框；展开状态和选中状态由组件内部维护。

```tsx
import { Tree, type TreeNodeData } from '@ycxy/lensui';
import '@ycxy/lensui/style.css';

const data: TreeNodeData[] = [
  {
    id: 'src',
    title: 'src',
    children: [
      { id: 'tree', title: 'Tree.tsx', isLeaf: true },
      { id: 'types', title: 'types.ts', isLeaf: true },
    ],
  },
];

export function App() {
  return <Tree data={data} />;
}
```

## API 设计

推荐使用“核心 Props + 领域配置对象”：

```tsx
<Tree
  data={data}
  expansion={{ /* 展开 */ }}
  selection={{ /* 选择 */ }}
  search={{ /* 搜索 */ }}
  drag={{ /* 拖拽 */ }}
  rename={{ /* 重命名 */ }}
  appearance={{ /* 外观 */ }}
  asyncLoad={{ /* 异步加载 */ }}
  renderers={{ /* 自定义渲染 */ }}
  events={{ /* 原始节点事件 */ }}
  virtual={{ /* 虚拟滚动 */ }}
/>
```

旧版扁平 Props 仍然兼容。同一种能力同时使用分组配置和旧版 Props 时，分组配置优先。

## 状态模式

### 非受控

不传 `keys`，Tree 在内部维护状态；`defaultKeys` 只用于初始化。

```tsx
<Tree
  data={data}
  expansion={{ defaultKeys: ['src'] }}
  selection={{ mode: 'multiple', defaultKeys: ['tree'] }}
/>
```

### 受控

传入 `keys` 后必须在 `onChange` 中更新对应状态，否则界面不会变化。所有节点回调都会返回标准化后的完整 `node`，其中保留业务自定义字段，而不是只返回标题。

```tsx
import { useState } from 'react';
import { Tree, type TreeKey, type TreeNodeData } from '@ycxy/lensui';

export function ControlledTree({ data }: { data: TreeNodeData[] }) {
  const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>([]);

  return (
    <Tree
      data={data}
      expansion={{
        keys: expandedKeys,
        onChange: (keys, node, expanded) => {
          setExpandedKeys(keys);
          console.log('展开状态变化', node, { keys, expanded });
        },
      }}
      selection={{
        mode: 'multiple',
        keys: selectedKeys,
        onChange: (keys, node, selected) => {
          setSelectedKeys(keys);
          console.log('选择状态变化', node, { keys, selected });
        },
      }}
    />
  );
}
```

## 常用场景

### 不显示选择框的默认单选

```tsx
<Tree
  data={data}
  selection={{
    mode: 'single',
    showIcon: false,
    onChange: (keys, node) => console.log(keys, node),
  }}
/>
```

单选节点再次点击时不会取消选择。如果完全不需要选择能力，传入 `selection={false}`。

```tsx
<Tree data={data} selection={false} />
```

### 单选框与多选框

```tsx
// 单选：默认使用圆形图标
<Tree data={data} selection={{ mode: 'single', showIcon: true }} />

// 多选：默认使用方形复选框
<Tree data={data} selection={{ mode: 'multiple', showIcon: true }} />
```

多选模式下：

- 选择父节点会选择全部可选后代。
- 取消父节点会取消整棵子树。
- 取消任一子节点后，父节点进入中间态。
- 所有可选子节点再次选中后，父节点恢复全选。
- 禁用节点及其后代不会进入联动结果。

只允许点击选择框、不允许点击节点行时：

```tsx
<Tree
  data={data}
  selection={{ mode: 'multiple', showIcon: true, trigger: 'icon' }}
/>
```

关闭父节点选择，并允许点击父节点行展开：

```tsx
<Tree
  data={data}
  selection={{ mode: 'multiple', parentsSelectable: false }}
  expansion={{ onParentClick: true }}
/>
```

父节点选择的优先级最高。只有 `selection={false}` 或 `selection.parentsSelectable=false` 时，`expansion.onParentClick` 才会接管父节点整行点击。

### 默认展开与手风琴

```tsx
<Tree
  data={data}
  expansion={{
    defaultAll: false,
    defaultKeys: ['tree'],
    accordion: true,
  }}
/>
```

`defaultKeys` 指向深层节点时会自动补齐祖先路径。`defaultAll` 为 `true` 时优先于 `defaultKeys`。手风琴只会收起同一父节点下的兄弟分支，不影响其他层级已经展开的节点。

### 只读浏览

```tsx
<Tree data={data} readOnly />
```

只读模式仍允许整行单选高亮、展开、收起、搜索和滚动，但会隐藏选择框、拖拽入口和操作区，并禁止右键菜单与重命名。

### 搜索

使用默认搜索框：

```tsx
<Tree data={data} search />
<Tree data={data} search={{ placeholder: '搜索文件或目录...' }} />
```

搜索值变化会立即调用 `onChange`，实际过滤和高亮固定防抖 `300ms`。`title` 不是字符串或数字时，应在节点上提供 `searchText`。命中叶子节点时展示其祖先路径；命中父节点时展示并临时展开其完整子树。搜索只控制节点可见性，不会克隆或裁剪节点；点击、菜单、拖拽、重命名和自定义渲染收到的始终是 `data` 中的完整原始节点。

受控搜索：

```tsx
const [keyword, setKeyword] = useState('');

<Tree
  data={data}
  search={{
    value: keyword,
    onChange: setKeyword,
    placeholder: '搜索...',
  }}
/>
```

自定义整个搜索区域：

```tsx
<Tree
  data={data}
  search={{
    value: keyword,
    onChange: setKeyword,
    render: (value, onChange) => (
      <div className="my-search">
        <input value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" onClick={() => onChange('')}>清空</button>
      </div>
    ),
  }}
/>
```

### 异步加载

未声明 `isLeaf: true` 的节点在配置 `asyncLoad.load` 后可以异步展开。Tree 不会自动把返回结果写入 `data`，需要在 `onLoad` 中不可变更新数据。

```tsx
function replaceChildren(
  nodes: TreeNodeData[],
  key: TreeKey,
  children: TreeNodeData[],
): TreeNodeData[] {
  return nodes.map((node) => {
    if (node.key === key) return { ...node, children };
    if (!node.children) return node;
    return { ...node, children: replaceChildren(node.children, key, children) };
  });
}

function AsyncTree() {
  const [data, setData] = useState<TreeNodeData[]>([
    { key: 'remote', title: '远程目录', isLeaf: false },
  ]);

  return (
    <Tree
      data={data}
      asyncLoad={{
        timeout: 10_000,
        load: async (node, signal) => {
          const response = await fetch(`/api/tree/${node.key}`, { signal });
          if (!response.ok) throw new Error('加载失败');
          return response.json() as Promise<TreeNodeData[]>;
        },
        onLoad: (node, children = []) => {
          setData((current) => replaceChildren(current, node.key, children));
        },
        onError: (error, node) => console.error('节点加载失败', node, error),
        renderLoading: (node) => node ? '正在加载子节点…' : '正在加载目录…',
      }}
    />
  );
}
```

`AbortSignal` 会在超时后终止，业务请求应传给 `fetch`。初次加载可使用 `asyncLoad.loading`；此时 `renderLoading` 收到的 `node` 为 `undefined`。

### 拖拽排序

下面的辅助函数演示如何根据 `TreeDropInfo` 不可变移动节点。实际项目也可以在 `onDrop` 中调用后端接口，再用服务端返回的数据替换当前树。

```ts
import type { TreeDropInfo, TreeKey, TreeNodeData } from '@ycxy/lensui';

function detachTreeNode(
  nodes: TreeNodeData[],
  key: TreeKey,
): { nodes: TreeNodeData[]; removed?: TreeNodeData } {
  let removed: TreeNodeData | undefined;
  const next = nodes.flatMap((node) => {
    if (node.key === key) {
      removed = node;
      return [];
    }
    if (!node.children || removed) return [node];
    const childResult = detachTreeNode(node.children, key);
    if (!childResult.removed) return [node];
    removed = childResult.removed;
    return [{ ...node, children: childResult.nodes }];
  });
  return { nodes: next, removed };
}

function insertTreeNode(
  nodes: TreeNodeData[],
  targetKey: TreeKey,
  inserted: TreeNodeData,
  position: TreeDropInfo['position'],
): TreeNodeData[] {
  return nodes.flatMap((node) => {
    if (node.key === targetKey) {
      if (position === 'before') return [inserted, node];
      if (position === 'after') return [node, inserted];
      return [{ ...node, children: [...(node.children ?? []), inserted] }];
    }
    if (!node.children) return [node];
    return [{ ...node, children: insertTreeNode(node.children, targetKey, inserted, position) }];
  });
}

function moveTreeNode(data: TreeNodeData[], info: TreeDropInfo): TreeNodeData[] {
  const detached = detachTreeNode(data, info.dragNode.key);
  if (!detached.removed) return data;
  return insertTreeNode(detached.nodes, info.targetNode.key, detached.removed, info.position);
}
```

```tsx
<Tree
  data={data}
  drag={{
    mode: 'nested',
    trigger: 'handle',
    showHandle: true,
    iconPosition: 'left',
    onStart: (node) => console.log('开始拖拽', node),
    onOver: (node, position) => console.log('当前落点', node, position),
    onEnd: (node) => console.log('结束拖拽', node),
    onDrop: (info) => {
      console.log(info.dragNode, info.targetNode, info.position);
      setData((current) => moveTreeNode(current, info));
    },
  }}
/>
```

拖拽模式：

| 模式           | 行为                                                           |
| -------------- | -------------------------------------------------------------- |
| `nested`     | 允许跨层级移动，产生`before`、`inside`、`after` 三种落点 |
| `same-level` | 只允许同一父节点下排序，只产生`before`、`after`            |

`trigger="handle"` 只能从拖拽手柄开始，`trigger="node"` 可从整行开始。将 `showHandle` 设为 `false` 会隐藏手柄并自动使用整行拖拽，避免失去拖拽入口。Tree 只报告 `TreeDropInfo`，不会修改 `data`；业务侧需要执行移动并传回新的数据。

以下情况会自动阻止拖拽：只读、当前节点或祖先禁用、拖到自身/后代、同级模式跨父级、正在重命名。

### 右键菜单、操作区和重命名

右键菜单与操作区可复用同一份菜单。`openMenu(event)` 会在操作按钮附近打开与右键相同的菜单。

```tsx
function removeTreeNode(nodes: TreeNodeData[], key: TreeKey): TreeNodeData[] {
  return nodes.flatMap((node) => {
    if (node.key === key) return [];
    if (!node.children) return [node];
    return [{ ...node, children: removeTreeNode(node.children, key) }];
  });
}

function EditableTree({ initialData }: { initialData: TreeNodeData[] }) {
  const [data, setData] = useState<TreeNodeData[]>(initialData);
  const [editingKey, setEditingKey] = useState<TreeKey | null>(null);

  const renameNode = (nodes: TreeNodeData[], key: TreeKey, title: string): TreeNodeData[] =>
    nodes.map((node) => node.key === key
      ? { ...node, title, searchText: title }
      : { ...node, ...(node.children ? { children: renameNode(node.children, key, title) } : {}) });

  return (
    <Tree
      data={data}
      rename={{
        editingKey,
        onEditingKeyChange: setEditingKey,
        canRename: (node) => node.kind !== 'system',
        onChange: (node, title) => {
          setData((current) => renameNode(current, node.key, title));
        },
      }}
      renderers={{
        actions: (node, openMenu) => (
          <button type="button" aria-label={`打开 ${String(node.title)} 菜单`} onClick={openMenu}>
            ···
          </button>
        ),
        menu: (node) => [
          { key: 'inspect', label: '查看', onClick: (current) => console.log(current) },
          { key: 'rename', label: '重命名', onClick: () => setEditingKey(node.key) },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => setData((current) => removeTreeNode(current, node.key)),
          },
        ],
      }}
    />
  );
}
```

重命名行为：

- 通过受控 `editingKey` 进入编辑，不提供双击重命名入口。
- `Enter` 或失焦提交，`Escape` 取消。
- 空名称或与原名称相同不会触发 `onChange`。
- `title` 不是字符串/数字时，必须提供 `searchText` 作为可编辑文本。
- Tree 不会直接修改节点标题，业务侧必须在 `onChange` 中更新 `data`。
- 禁用、只读或 `canRename` 返回 `false` 的节点不能重命名。

### 节点图标与外观

```tsx
<Tree
  data={data}
  appearance={{
    lines: true,
    lineStyle: 'dashed',
    indent: 24,
    nodeGap: 2,
    switcherPosition: 'left',
    icons: {
      showNode: true,
      color: '#7c3aed',
      expand: <span>＋</span>,
      collapse: <span>−</span>,
      file: <FileIcon />,
      folder: <FolderIcon />,
      folderOpen: <FolderOpenIcon />,
      selection: (node, selected, indeterminate) => (
        <MySelectionIcon selected={selected} indeterminate={indeterminate} />
      ),
    },
  }}
/>
```

节点自身的 `icon` 优先于 Tree 级 `file`、`folder` 和 `folderOpen`：

```tsx
const data: TreeNodeData[] = [
  {
    key: 'dynamic',
    title: '动态图标',
    icon: (_node, expanded) => expanded ? <OpenIcon /> : <ClosedIcon />,
    children: [],
  },
];
```

### 虚拟滚动

```tsx
<Tree
  data={largeData}
  virtual={{ itemHeight: 32, overscan: 6 }}
  appearance={{ nodeGap: 2 }}
/>
```

- 省略 `height` 时，滚动视口填满父容器剩余高度；父容器需要有确定高度。
- 传入数字 `height` 时使用固定像素高度。
- `itemHeight` 是单个节点本身的固定高度，必须与最终渲染高度一致。
- 实际行步长为 `itemHeight + appearance.nodeGap`。
- `overscan` 是可视区上下额外挂载的行数。
- 普通模式和虚拟模式共用展开、选择、拖拽及辅助线逻辑。
- 虚拟拖拽靠近视口上下边缘时会自动滚动，使屏幕外节点逐步进入可放置区域。
- 滚动事件按动画帧合并，并且只有可视窗口的起止行变化时才触发 React 更新。
- Tree 内部用结构共享保存父路径，仅为进入渲染窗口的节点生成完整路径，超深层级不会复制所有祖先数组。
- 多选归一化结果会复用其中间态；空选择集合不会扫描整棵树。
- 键盘位置索引在首次键盘导航时按需创建，普通鼠标操作不承担额外初始化成本。
- 拖拽运行时为独立异步 chunk；未开启拖拽和服务端渲染不会加载 DnD 代码。
- 1000 节点以上建议开启虚拟滚动；数据索引、父链和多选状态均避免递归调用，可处理超深树。

### 键盘操作

节点行使用 roving tabindex，始终只有一个树节点进入 Tab 顺序：

| 按键                        | 行为                                              |
| --------------------------- | ------------------------------------------------- |
| `ArrowDown` / `ArrowUp` | 移动到下一个/上一个可见节点                       |
| `ArrowRight`              | 展开父节点；已展开时进入第一个子节点              |
| `ArrowLeft`               | 收起父节点；已收起或叶子节点时返回父节点          |
| `Home` / `End`          | 移动到第一个/最后一个可见节点，虚拟模式会同步滚动 |
| `Enter` / `Space`       | 选择当前节点                                      |
| `Shift + F10` / 菜单键    | 打开当前节点的右键菜单                            |

菜单支持 `ArrowUp`、`ArrowDown`、`Home`、`End` 导航，`Escape` 关闭并把焦点还给原节点。禁用节点仍可获得焦点并展开，但不会被选择。

### 原始节点事件

业务状态变化优先使用对应配置的 `onChange`。`events` 适合埋点或需要原始鼠标事件的场景。

```tsx
<Tree
  data={data}
  events={{
    onClick: (node, event) => console.log('click', node, event),
    onDoubleClick: (node, event) => console.log('double click', node, event),
    onContextMenu: (node, event) => console.log('context menu', node, event),
    onMouseEnter: (node, event) => console.log('enter', node, event),
    onMouseLeave: (node, event) => console.log('leave', node, event),
  }}
/>
```

## 完整 Props

### `TreeProps`

| 属性           | 类型                               | 默认值                    | 说明                                              |
| -------------- | ---------------------------------- | ------------------------- | ------------------------------------------------- |
| `data`       | `TreeNodeData[]`                 | 必填                      | 任意业务节点记录；Tree 不会直接修改数组或节点     |
| `fieldNames` | `TreeFieldNames`                 | `id / title / children` | 把动态业务字段映射为 Tree 使用的标准字段          |
| `expansion`  |  `TreeExpansionConfig`           | 内部状态                  | 展开能力配置                                      |
| `selection`  | `TreeSelectionConfig \| false`    | 默认整行单选              | 选择配置；`false` 完全关闭选择                  |
| `search`     | `boolean \| TreeSearchConfig`     | `false`                 | `true` 使用默认搜索框，对象用于受控或自定义搜索 |
| `drag`       | `boolean \| TreeDragConfig`       | `false`                 | `true` 使用默认拖拽配置，对象用于详细设置       |
| `rename`     | `TreeRenameConfig \| false`       | `false`                 | 受控行内重命名                                    |
| `appearance` | `TreeAppearanceConfig`           | 见下表                    | 辅助线、缩进、间距和图标                          |
| `asyncLoad`  | `TreeAsyncLoadConfig`            | -                         | 初次加载及异步子节点加载                          |
| `renderers`  | `TreeRenderersConfig`            | -                         | 标题、操作区、菜单、空状态和错误降级              |
| `events`     | `TreeEventsConfig`               | -                         | 节点原始鼠标事件                                  |
| `readOnly`   | `boolean`                        | `false`                 | 浏览模式；保留单选高亮与展开，隐藏或禁止编辑操作  |
| `virtual`    | `boolean \| TreeVirtualConfig`    | `false`                 | 开启固定行高虚拟滚动；高度可固定或继承父容器      |
| `className`  | `string`                         | -                         | Tree 根节点 className                             |
| `style`      | `CSSProperties`                  | -                         | Tree 根节点样式                                   |
| `classNames` | `TreeClassNames`                 | -                         | 各区域 className                                  |
| `styles`     | `TreeStyles`                     | -                         | 各区域内联样式                                    |
| 其他 DOM 属性  | `HTMLAttributes<HTMLDivElement>` | -                         | 传给 Tree 根元素；与 Tree 回调冲突的 DOM 事件除外 |

### `TreeNodeData`

`TreeNodeData` 是没有必填字段的开放记录，不会把业务数据限制成固定接口。Tree 默认读取 `id` 作为唯一标识，并向后兼容已有的 `key` 数据；其他字段可以通过 `fieldNames` 映射。

```tsx
const data: TreeNodeData[] = [
  {
    uuid: 'product',
    name: '产品部',
    nodes: [
      { uuid: 'design', name: '设计组', leaf: true, owner: 'Lin' },
    ],
  },
];

<Tree
  data={data}
  fieldNames={{
    key: 'uuid',
    title: 'name',
    children: 'nodes',
    isLeaf: 'leaf',
  }}
/>;
```

### `TreeFieldNames`

| 字段           | 类型       | 必填 | 说明                                                |
| -------------- | ---------- | ---- | --------------------------------------------------- |
| `key`        | `string` | 否   | 唯一标识字段，默认`id`，未命中时兼容 `key`      |
| `title`      | `string` | 否   | 标题字段，默认`title`，并兼容 `name`、`label` |
| `children`   | `string` | 否   | 子节点数组字段，默认`children`                    |
| `searchText` | `string` | 否   | 搜索纯文本字段，默认`searchText`                  |
| `disabled`   | `string` | 否   | 禁用状态字段，默认`disabled`                      |
| `isLeaf`     | `string` | 否   | 叶子状态字段，默认`isLeaf`                        |
| `icon`       | `string` | 否   | 节点图标字段，默认`icon`                          |
| `className`  | `string` | 否   | 节点行 className 字段，默认`className`            |
| `style`      | `string` | 否   | 节点行内联样式字段，默认`style`                   |

### `ResolvedTreeNodeData`

Tree 会把动态输入转换成统一节点再交给渲染器和回调。统一节点始终包含 `key`、`title`，并保留原始业务字段；`children` 会递归转换。使用旧版 `key` / `title` / `children` 标准结构时，组件继续保留节点对象引用。

| 字段           | 类型                       | 必填 | 说明                                 |
| -------------- | -------------------------- | ---- | ------------------------------------ |
| `key`        | `TreeKey`                | 是   | 标准化后的全树唯一标识               |
| `title`      | `ReactNode`              | 是   | 标准化后的节点展示内容               |
| `children`   | `ResolvedTreeNodeData[]` | 否   | 递归标准化后的子节点                 |
| `searchText` | `string`                 | 否   | 搜索和复杂标题重命名使用的纯文本     |
| `disabled`   | `boolean`                | 否   | 禁止选择、拖拽和重命名；后代继承禁用 |
| `isLeaf`     | `boolean`                | 否   | 明确声明叶子节点                     |
| `icon`       | `TreeNodeIcon`           | 否   | 节点级图标                           |
| `className`  | `string`                 | 否   | 当前节点行附加 className             |
| `style`      | `CSSProperties`          | 否   | 当前节点行附加样式                   |
| 业务字段       | `unknown`                | 否   | 原始节点上的自定义字段               |

`TreeNodeIcon` 类型：

```ts
type TreeNodeIcon =
  | ReactNode
  | ((node: ResolvedTreeNodeData, expanded: boolean) => ReactNode);
```

### `TreeExpansionConfig`

| 属性                   | 类型                               | 默认值    | 说明                                                             |
| ---------------------- | ---------------------------------- | --------- | ---------------------------------------------------------------- |
| `keys`               | `TreeKey[]`                      | 内部状态  | 受控展开节点集合                                                 |
| `defaultKeys`        | `TreeKey[]`                      | `[]`    | 非受控初始展开节点，自动补齐祖先路径                             |
| `defaultAll`         | `boolean`                        | `false` | 首次获得非空数据时展开全部，优先于`defaultKeys`                |
| `accordion`          | `boolean`                        | `false` | 同一父级下的兄弟分支使用手风琴展开                               |
| `onParentClick`      | `boolean`                        | `false` | 父节点不可选时，点击父节点行展开/收起                            |
| `autoExpandSelected` | `boolean`                        | `true`  | 单选时外部或默认选择深层节点会自动展开祖先；多选不会改变展开状态 |
| `onChange`           | `(keys, node, expanded) => void` | -         | 展开状态变化；受控模式必须写回`keys`                           |

### `TreeSelectionConfig`

| 属性                  | 类型                               | 默认值               | 说明                                                   |
| --------------------- | ---------------------------------- | -------------------- | ------------------------------------------------------ |
| `mode`              | `'single' \| 'multiple'`          | `'single'`         | 单选或多选                                             |
| `keys`              | `TreeKey[]`                      | 内部状态             | 受控选中节点集合                                       |
| `defaultKeys`       | `TreeKey[]`                      | `[]`               | 非受控初始选中节点；深层节点会展开祖先                 |
| `showIcon`          | `boolean`                        | 配置对象中为`true` | 是否显示选择图标；省略整个`selection` 时为 `false` |
| `iconPosition`      | `'left' \| 'right'`               | `'left'`           | 选择图标位于标题左侧或右侧                             |
| `parentsSelectable` | `boolean`                        | `true`             | 父节点是否可选                                         |
| `trigger`           | `'node' \| 'icon'`                | `'node'`           | 整行可选或只有选择图标可选                             |
| `onChange`          | `(keys, node, selected) => void` | -                    | 选中状态变化；受控模式必须写回`keys`                 |

### `TreeSearchConfig`

| 属性            | 类型                               | 默认值       | 说明               |
| --------------- | ---------------------------------- | ------------ | ------------------ |
| `value`       | `string`                         | 内部状态     | 受控搜索值         |
| `onChange`    | `(value) => void`                | -            | 输入变化时立即触发 |
| `placeholder` | `string`                         | `'Search'` | 默认输入框占位文案 |
| `render`      | `(value, onChange) => ReactNode` | -            | 完整替换搜索区域   |

筛选和标题高亮固定防抖 `300ms`，不提供动态防抖时间 Prop。

### `TreeDragConfig`

| 属性             | 类型                         | 默认值       | 说明                                     |
| ---------------- | ---------------------------- | ------------ | ---------------------------------------- |
| `mode`         | `'nested' \| 'same-level'`  | `'nested'` | 自由嵌套或仅同级排序                     |
| `trigger`      | `'handle' \| 'node'`        | `'handle'` | 从手柄或整行开始拖拽                     |
| `showHandle`   | `boolean`                  | `true`     | 是否显示拖拽手柄；隐藏时自动改为整行拖拽 |
| `icon`         | `ReactNode`                | 内置六点图标 | 自定义拖拽图标                           |
| `iconPosition` | `'left' \| 'right'`         | `'left'`   | 拖拽图标位置                             |
| `onStart`      | `(node) => void`           | -            | 成功开始拖动                             |
| `onOver`       | `(node, position) => void` | -            | 有效落点变化                             |
| `onDrop`       | `(info) => void`           | -            | 有效放置完成，业务侧更新`data`         |
| `onEnd`        | `(node) => void`           | -            | 拖拽完成或取消                           |

### `TreeDropInfo`

| 字段           | 类型                              | 说明                     |
| -------------- | --------------------------------- | ------------------------ |
| `dragNode`   | `ResolvedTreeNodeData`          | 被拖动的标准化完整节点   |
| `targetNode` | `ResolvedTreeNodeData`          | 放置目标的标准化完整节点 |
| `position`   | `'before' \| 'inside' \| 'after'` | 相对目标的最终位置       |

### `TreeRenameConfig`

| 属性                   | 类型                      | 必填 | 说明                              |
| ---------------------- | ------------------------- | ---- | --------------------------------- |
| `editingKey`         | `TreeKey \| null`        | 是   | 当前编辑节点；`null` 表示未编辑 |
| `onEditingKeyChange` | `(key) => void`         | 是   | 进入、提交或取消编辑时同步 key    |
| `canRename`          | `(node) => boolean`     | 否   | 按节点控制是否允许重命名          |
| `onChange`           | `(node, title) => void` | 是   | 提交新标题；业务侧更新`data`    |

### `TreeAppearanceConfig`

| 属性                 | 类型                   | 默认值       | 说明                                                           |
| -------------------- | ---------------------- | ------------ | -------------------------------------------------------------- |
| `lines`            | `boolean`            | `true`     | 显示父子辅助线                                                 |
| `lineStyle`        | `'dashed' \| 'solid'` | `'dashed'` | 辅助线样式                                                     |
| `indent`           | `number`             | `24`       | 每级缩进，单位 px；负数归一为`0`，非有限数回退默认值         |
| `nodeGap`          | `number`             | `2`        | 相邻节点垂直间距，单位 px；负数归一为`0`，非有限数回退默认值 |
| `switcherPosition` | `'left' \| 'right'`   | `'left'`   | 展开/收起图标位置                                              |
| `icons`            | `TreeIconConfig`     | -            | 集中配置所有图标                                               |

### `TreeIconConfig`

| 属性           | 类型                                                         | 默认值             | 说明                                         |
| -------------- | ------------------------------------------------------------ | ------------------ | -------------------------------------------- |
| `expand`     | `ReactNode \| (node, expanded) => ReactNode`                | 内置箭头           | 收起状态图标                                 |
| `collapse`   | `ReactNode \| (node, expanded) => ReactNode`                | 内置箭头           | 展开状态图标                                 |
| `selection`  | `ReactNode \| (node, selected, indeterminate) => ReactNode` | 内置单选/多选图标  | 自定义选择及中间态图标                       |
| `showNode`   | `boolean`                                                  | 按配置推断         | 显示文件/文件夹图标                          |
| `file`       | `TreeNodeIcon`                                             | 内置文件图标       | 叶子节点图标                                 |
| `folder`     | `TreeNodeIcon`                                             | 内置文件夹图标     | 收起的父节点图标                             |
| `folderOpen` | `TreeNodeIcon`                                             | 内置打开文件夹图标 | 展开的父节点图标                             |
| `color`      | `string`                                                   | CSS 主题色         | 同步设置图标、选择、焦点、选中和拖拽反馈颜色 |

当没有任何节点图标配置时，文件/文件夹图标默认不占位。配置 `showNode: true`、Tree 级文件图标或节点级 `icon` 后显示。

### `TreeAsyncLoadConfig`

| 属性              | 类型                                                 | 默认值       | 说明                                                                               |
| ----------------- | ---------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `loading`       | `boolean`                                          | `false`    | 整棵树初次加载状态                                                                 |
| `load`          | `(node, signal) => Promise<TreeNodeData[] \| void>` | -            | 展开未加载节点时获取子节点                                                         |
| `timeout`       | `number`                                           | `10000`    | 单节点加载硬超时，单位 ms；即使`load` 忽略 signal，超时结果也不会触发 `onLoad` |
| `renderLoading` | `(node?) => ReactNode`                             | 内置 Spinner | 自定义初次/节点加载内容                                                            |
| `onLoad`        | `(node, children?) => void`                        | -            | 加载成功；业务侧写回`data`                                                       |
| `onError`       | `(error, node?) => void`                           | -            | 加载或渲染失败；渲染错误时`node` 为空                                            |

### `TreeRenderersConfig`

| 属性              | 类型                                      | 默认值                            | 说明                                     |
| ----------------- | ----------------------------------------- | --------------------------------- | ---------------------------------------- |
| `title`         | `(node, highlightedTitle) => ReactNode` | 原标题/搜索高亮                   | 自定义标题；应复用第二个参数以保留高亮   |
| `actions`       | `(node, openMenu) => ReactNode`         | -                                 | 节点右侧操作区；点击不会触发选择         |
| `empty`         | `() => ReactNode`                       | -                                 | 自定义空状态，优先于`emptyContent`     |
| `emptyContent`  | `ReactNode`                             | 内置灰色收纳盒图标与`'No data'` | 简单空状态内容；传入后替换整个默认空状态 |
| `menu`          | `(node) => TreeMenuItem[]`              | -                                 | 右键菜单与操作按钮菜单                   |
| `errorFallback` | `ReactNode \| (error) => ReactNode`      | 内置错误提示                      | 渲染异常的降级界面                       |

当 `data`、标题/操作区/空状态渲染器或 `errorFallback` 变化时，错误边界会清除旧错误并尝试重新渲染，无需额外修改 Tree 的 `key`。

### `TreeMenuItem`

| 字段         | 类型               | 必填 | 说明                             |
| ------------ | ------------------ | ---- | -------------------------------- |
| `key`      | `TreeKey`        | 是   | 菜单项唯一标识                   |
| `label`    | `ReactNode`      | 是   | 菜单内容                         |
| `disabled` | `boolean`        | 否   | 禁止点击                         |
| `danger`   | `boolean`        | 否   | 危险操作样式                     |
| `onClick`  | `(node) => void` | 否   | 点击时返回打开菜单对应的完整节点 |

### `TreeEventsConfig`

| 属性              | 类型                      | 说明                             |
| ----------------- | ------------------------- | -------------------------------- |
| `onClick`       | `(node, event) => void` | 节点单击，在内部选择前执行       |
| `onDoubleClick` | `(node, event) => void` | 节点双击                         |
| `onContextMenu` | `(node, event) => void` | 节点右键，在自定义菜单打开前执行 |
| `onMouseEnter`  | `(node, event) => void` | 鼠标进入节点                     |
| `onMouseLeave`  | `(node, event) => void` | 鼠标离开节点                     |

### `TreeVirtualConfig`

| 属性           | 类型                  | 默认值     | 说明                                                                                  |
| -------------- | --------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `height`     | `number \| 'parent'` | `parent` | 省略或传`parent` 时填满父容器剩余空间（父容器需要有确定高度）；数字表示固定像素高度 |
| `itemHeight` | `number`            | `32`     | 节点固定高度，不包含`nodeGap`                                                       |
| `overscan`   | `number`            | `4`      | 上下额外挂载行数                                                                      |

### `TreeClassNames`

| 属性             | 对应区域            |
| ---------------- | ------------------- |
| `root`         | Tree 根容器         |
| `search`       | 搜索区域            |
| `viewport`     | 树列表/虚拟滚动视口 |
| `node`         | 所有节点行          |
| `nodeSelected` | 选中节点行          |
| `icon`         | 节点文件/文件夹图标 |
| `title`        | 节点标题            |
| `empty`        | 空状态容器          |

### `TreeStyles`

`TreeStyles` 提供 `root`、`search`、`viewport`、`node`、`nodeHover`、`nodeSelected`、`icon`、`title`、`empty`。复杂伪类、媒体查询和组合选择器应使用 `classNames` 配合外部 CSS。

```tsx
<Tree
  data={data}
  classNames={{ root: 'project-tree', node: 'project-tree__node' }}
  styles={{
    node: { borderRadius: 8 },
    nodeHover: { transform: 'translateX(2px)' },
    nodeSelected: { fontWeight: 600 },
  }}
/>
```

节点自身 `node.style` 的优先级高于 Tree 级 `styles.node`、`styles.nodeSelected` 和 `styles.nodeHover`。

## 主题变量

```css
.project-tree {
  --tree-color: #1f2329;
  --tree-muted: #646a73;
  --tree-primary: #7c3aed;
  --tree-hover: #f5f3ff;
  --tree-selected: #ede9fe;
  --tree-border: #ddd6fe;
  --tree-danger: #d93026;
  --tree-icon-size: 14px;
  --tree-icon-slot-size: 24px;
  --tree-line-icon-gap: 3px;
}
```

组件内置 `prefers-color-scheme: dark` 适配。应用有自己的主题系统时，在主题容器下覆盖这些变量即可。`appearance.icons.color` 会同步覆盖主要交互主题色。

## 旧版扁平 Props 迁移

旧版仍可用，但新代码建议迁移到分组配置。

| 旧版 Props                                                                                       | 新版配置                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `expandedKeys` / `onExpandedKeysChange`                                                      | `expansion.keys` / `expansion.onChange`                                                                   |
| `defaultExpandedKeys` / `defaultExpandAll`                                                   | `expansion.defaultKeys` / `expansion.defaultAll`                                                          |
| `accordion` / `expandOnParentClick`                                                          | `expansion.accordion` / `expansion.onParentClick`                                                         |
| `selectionMode` / `selectedKeys` / `defaultSelectedKeys`                                   | `selection.mode` / `selection.keys` / `selection.defaultKeys`                                           |
| `showSelectionIcon` / `selectionIconPosition` / `selectableParents` / `selectionTrigger` | `selection.showIcon` / `selection.iconPosition` / `selection.parentsSelectable` / `selection.trigger` |
| `onSelectedKeysChange`                                                                         | `selection.onChange`                                                                                        |
| `searchable` / `searchValue` / `onSearchValueChange`                                       | `search` / `search.value` / `search.onChange`                                                           |
| `searchPlaceholder` / `renderSearch`                                                         | `search.placeholder` / `search.render`                                                                    |
| `draggable` / `dragMode` / `dragTrigger`                                                   | `drag` / `drag.mode` / `drag.trigger`                                                                   |
| `showDragHandle`                                                                               | `drag.showHandle`                                                                                           |
| `dragIcon` / `dragIconPosition`                                                              | `drag.icon` / `drag.iconPosition`                                                                         |
| `onDragStart` / `onDragOver` / `onDrop` / `onDragEnd`                                    | `drag.onStart` / `drag.onOver` / `drag.onDrop` / `drag.onEnd`                                         |
| `showLines` / `lineStyle` / `indent` / `nodeGap`                                         | `appearance.lines` / `lineStyle` / `indent` / `nodeGap`                                               |
| `switcherPosition`                                                                             | `appearance.switcherPosition`                                                                               |
| `expandIcon` / `collapseIcon` / `selectionIcon`                                            | `appearance.icons.expand` / `collapse` / `selection`                                                    |
| `showNodeIcon` / `fileIcon` / `folderIcon` / `folderOpenIcon`                            | `appearance.icons.showNode` / `file` / `folder` / `folderOpen`                                        |
| `iconColor`                                                                                    | `appearance.icons.color`                                                                                    |
| `loading` / `loadData` / `loadTimeout`                                                     | `asyncLoad.loading` / `load` / `timeout`                                                                |
| `renderLoading` / `onLoad` / `onLoadError`                                                 | `asyncLoad.renderLoading` / `onLoad` / `onError`                                                        |
| `renderTitle` / `renderActions`                                                              | `renderers.title` / `renderers.actions`                                                                   |
| `renderEmpty` / `emptyContent` / `menuItems`                                               | `renderers.empty` / `emptyContent` / `menu`                                                             |
| `errorFallback`                                                                                | `renderers.errorFallback`                                                                                   |
| `onNodeClick` 等节点事件                                                                       | `events.onClick` 等                                                                                         |
| `virtual` + `height` / `itemHeight` / `overscan`                                         | `virtual={{ height, itemHeight, overscan }}`                                                                |

迁移示例：

```tsx
// 旧版
<Tree
  data={data}
  selectedKeys={selectedKeys}
  selectionMode="multiple"
  showSelectionIcon
  onSelectedKeysChange={setSelectedKeys}
  draggable
  dragMode="nested"
  onDrop={handleDrop}
/>

// 新版
<Tree
  data={data}
  selection={{
    mode: 'multiple',
    showIcon: true,
    keys: selectedKeys,
    onChange: setSelectedKeys,
  }}
  drag={{ mode: 'nested', onDrop: handleDrop }}
/>
```

## 行为与数据职责

- Tree 不会修改 `data`。异步加载、重命名、拖拽和删除都由业务层更新数据。
- `key` 必须全树唯一且稳定，用于展开、选择、虚拟行复用和拖拽识别；开发环境会对重复 key 给出警告。
- 回调中的 `node` 是 `data` 内的完整原始业务节点，额外字段和未命中的兄弟节点都会保留。
- 受控 `keys` 必须在回调中写回；不写回时视觉状态保持不变。
- 单选模式下，深层默认选中或外部新增选中节点会自动展开祖先路径；传入 `expansion.autoExpandSelected=false` 可关闭。多选不会自动展开子树。
- 搜索期间会临时展开匹配路径；父节点命中时会展示其完整子树，但不会覆盖业务受控展开集合。
- 每个 Tree 有独立拖拽作用域，不会误接收另一个 Tree 的节点。

## 本地开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
