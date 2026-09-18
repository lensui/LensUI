# 高性能表格组件开发方案

## 1. 项目目标

基于当前需求，开发一个轻量级、高性能、交互流畅的表格组件，支持行列选择、单元格编辑、自定义单元格、排序筛选、合并单元格、固定列、固定表头和虚拟滚动等能力。

组件设计上应优先满足以下目标：

1. **受控优先**：表格数据、选择状态、排序状态、筛选状态、编辑状态等核心状态都支持外部控制。
2. **高性能渲染**：大数据量下仍能保持滚动、选择、编辑流畅。
3. **轻量封装**：核心表格逻辑保持独立，编辑器、菜单、筛选器等功能按需接入。
4. **可扩展**：支持自定义单元格、自定义编辑器、自定义右键菜单、自定义列配置。
5. **可靠性**：做好错误边界、异常兜底、超时处理和渲染降级。
6. **工程可维护**：模块拆分清晰，关键逻辑有详细注释，方便后续扩展。

## 2. 技术原则

### 2.1 不为每个单元格创建复杂组件

表格性能的关键是避免一次性渲染全部行列。组件只渲染当前视口可见区域，并通过虚拟滚动复用渲染结构。

推荐策略：

1. 默认使用 DOM 表格布局或 div grid 布局实现基础版本。
2. 对大数据开启虚拟滚动，只渲染可见行和少量缓冲行。
3. 横向列很多时，后续支持列虚拟化。
4. 编辑态使用浮层输入控件，不让每个单元格长期挂载复杂编辑器。

### 2.2 数据模型和渲染模型分离

表格内部需要区分：

1. 原始数据：用户传入的 `dataSource`。
2. 列配置：用户传入的 `columns`。
3. 派生数据：排序、筛选、合并、固定列、虚拟滚动计算后的结果。
4. 渲染区域：当前视口真正需要渲染的行列。
5. 交互状态：选中、聚焦、编辑、右键菜单等状态。

这样可以避免每次交互都重新计算整张表。

### 2.3 核心状态受控

组件既支持外部完全受控，也支持内部非受控默认值。

建议命名：

1. `selectedRowKeys` / `onSelectedRowChange`
2. `selectedColumnKeys` / `onSelectedColumnChange`
3. `sortState` / `onSortStateChange`
4. `filterState` / `onFilterStateChange`
5. `editingCell` / `onEditingCellChange`
6. `dataSource` / `onDataSourceChange`

内部通过 `useControlledState` 统一处理受控和非受控逻辑。

## 3. 组件 API 设计

### 3.1 基础用法

```tsx
<ProTable
  rowKey="id"
  columns={columns}
  dataSource={data}
  selectedRowKeys={selectedRowKeys}
  onSelectedRowChange={setSelectedRowKeys}
  sortState={sortState}
  onSortStateChange={setSortState}
  filterState={filterState}
  onFilterStateChange={setFilterState}
  virtual
/>
```

### 3.2 表格属性

```ts
interface ProTableProps<RecordType> {
  rowKey: string | ((record: RecordType) => string);
  columns: TableColumn<RecordType>[];
  dataSource: RecordType[];

  height?: number | string;
  rowHeight?: number | ((record: RecordType, index: number) => number);
  headerHeight?: number;

  virtual?: boolean;
  overscan?: number;

  rowSelection?: RowSelectionConfig;
  columnSelection?: ColumnSelectionConfig;

  selectedRowKeys?: string[];
  defaultSelectedRowKeys?: string[];
  onSelectedRowChange?: (keys: string[], rows: RecordType[], indices: number[]) => void;

  selectedColumnKeys?: string[];
  defaultSelectedColumnKeys?: string[];
  onSelectedColumnChange?: (keys: string[]) => void;

  sortState?: SortState[];
  defaultSortState?: SortState[];
  onSortStateChange?: (state: SortState[]) => void;

  filterState?: FilterState;
  defaultFilterState?: FilterState;
  onFilterStateChange?: (state: FilterState) => void;

  editingCell?: EditingCell | null;
  defaultEditingCell?: EditingCell | null;
  onEditingCellChange?: (cell: EditingCell | null) => void;

  onCellValueChange?: (params: CellValueChangeParams<RecordType>) => void;
  onDataSourceChange?: (nextData: RecordType[]) => void;

  onRowContextMenu?: (params: RowContextMenuParams<RecordType>) => void;
  onColumnContextMenu?: (params: ColumnContextMenuParams<RecordType>) => void;

  errorFallback?: React.ReactNode | ((error: Error) => React.ReactNode);
}
```

### 3.3 列配置

```ts
interface TableColumn<RecordType> {
  key: string;
  title: React.ReactNode;
  dataIndex?: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;

  fixed?: 'left' | 'right';

  sortable?: boolean | SortConfig<RecordType>;
  filterable?: boolean | FilterConfig<RecordType>;

  editable?: boolean | EditableConfig<RecordType>;
  editor?: CellEditorType | CustomCellEditor<RecordType>;

  render?: (value: unknown, record: RecordType, rowIndex: number) => React.ReactNode;

  align?: 'left' | 'center' | 'right';
  className?: string;
  headerClassName?: string;
}
```

## 4. 功能设计

### 4.1 行选择

支持能力：

1. 开启或关闭行选择。
2. 单选和多选。
3. 点击行选择、复选框选择。
4. 支持 Shift 连续选择。
5. 支持 Ctrl / Command 多选。
6. 选中行后支持右键菜单。

设计要点：

1. 选择状态只保存 `rowKey`，不保存整行对象。
2. 当前可见行通过 `rowKey` 反查数据。
3. 多选逻辑独立封装到 `useRowSelection`。
4. 右键菜单只挂载一个浮层，根据当前右键目标更新内容。

### 4.2 列选择

支持能力：

1. 开启或关闭列选择。
2. 单选和多选。
3. 点击表头选择列。
4. 支持 Shift 连续选择列。
5. 支持 Ctrl / Command 多选列。
6. 选中列后支持右键菜单。

设计要点：

1. 列选择状态只保存 `column.key`。
2. 固定列和普通列使用同一套选择状态。
3. 右键菜单位置根据表头单元格或列区域坐标计算。

### 4.3 单元格编辑

支持编辑器：

1. 输入框。
2. 数字框。
3. 选择框，支持单选和多选。
4. 树选择框。
5. 日期选择框，支持年、月、年月、年月日、日期范围。
6. 时间选择框。
7. 日期时间选择框。
8. 自定义编辑器。

设计要点：

1. 默认单元格只渲染展示态内容。
2. 进入编辑时，在当前单元格位置渲染一个编辑浮层。
3. 编辑组件按需挂载，退出编辑后卸载。
4. 编辑提交后触发 `onCellValueChange`。
5. 如果用户传入 `onDataSourceChange`，内部可提供默认数据更新能力。
6. 如果完全受控，则由外部更新 `dataSource`。

编辑流程：

```text
双击单元格 / Enter
  -> 设置 editingCell
  -> 计算单元格位置
  -> 渲染对应编辑器
  -> 用户输入
  -> Enter / blur / 选择完成
  -> 校验
  -> onCellValueChange
  -> onDataSourceChange
  -> 退出编辑态
```

### 4.4 自定义单元格

支持两类自定义：

1. `column.render`：自定义展示内容。
2. `column.editor`：自定义编辑器。

设计要点：

1. 自定义展示内容需要包裹错误边界，避免单个渲染错误影响整张表。
2. 自定义编辑器需要统一接收 `value`、`record`、`rowIndex`、`onChange`、`onSubmit`、`onCancel`。
3. 自定义内容应避免影响行高计算，必要时要求用户设置固定行高。

### 4.5 排序

支持能力：

1. 单列排序。
2. 多列排序。
3. 升序、降序、取消排序。
4. 自定义排序函数。

设计要点：

1. 排序状态外部可控。
2. 内部通过 `useMemo` 生成排序后的行数据。
3. 大数据排序可能耗时，后续可接入 Web Worker。
4. 排序失败时回退到原始顺序，并通过错误回调暴露。

### 4.6 搜索筛选

支持能力：

1. 列搜索。
2. 枚举筛选。
3. 自定义筛选函数。
4. 支持重置当前列筛选。
5. 支持重置全部筛选。

设计要点：

1. 筛选状态外部可控。
2. 筛选逻辑独立封装，不耦合 UI。
3. 表头筛选浮层按需挂载。
4. 大数据筛选可做 debounce，避免输入时频繁计算。

### 4.7 合并单元格

支持能力：

1. 横向合并。
2. 纵向合并。
3. 横纵同时合并。

建议 API：

```ts
interface CellSpan {
  rowSpan?: number;
  colSpan?: number;
}

type GetCellSpan<RecordType> = (params: {
  record: RecordType;
  rowIndex: number;
  column: TableColumn<RecordType>;
  columnIndex: number;
}) => CellSpan | undefined;
```

设计要点：

1. 合并单元格需要在渲染前生成 `spanMap`。
2. 被覆盖的单元格不渲染。
3. 虚拟滚动下纵向合并需要额外处理，因为合并区域可能跨越视口边界。
4. 第一阶段建议要求合并行高固定，降低布局复杂度。

### 4.8 固定列

支持能力：

1. 左固定列。
2. 右固定列。
3. 固定列阴影。
4. 固定列与横向滚动联动。

设计要点：

1. 根据 `column.fixed` 将列拆为左、中、右三组。
2. 左右固定区域不参与横向滚动。
3. 中间区域横向滚动。
4. 三个区域共享纵向滚动位置。
5. 行高必须统一，否则固定区域和普通区域容易错位。

### 4.9 固定表头

支持能力：

1. 表头固定在顶部。
2. 表头与横向滚动联动。
3. 固定列表头和内容对齐。

设计要点：

1. 表头单独渲染，内容区独立滚动。
2. 内容区横向滚动时，同步更新表头横向偏移。
3. 表头高度固定，避免滚动中布局抖动。

### 4.10 虚拟滚动

支持能力：

1. 固定行高虚拟滚动。
2. 可配置缓冲行 `overscan`。
3. 保持滚动条高度等于完整数据高度。
4. 后续扩展动态行高。

第一阶段建议优先实现固定行高虚拟滚动：

```text
scrollTop
  -> startIndex = floor(scrollTop / rowHeight)
  -> visibleCount = ceil(containerHeight / rowHeight)
  -> endIndex = startIndex + visibleCount + overscan
  -> translateY = startIndex * rowHeight
```

动态行高可以在后续版本通过高度缓存和前缀和数组实现。

## 5. 性能方案

### 5.1 渲染性能

1. 单元格组件使用 `React.memo`。
2. 行组件使用稳定的 `rowKey`。
3. 列配置需要标准化，并通过 `useMemo` 缓存。
4. 事件使用事件委托，避免每个单元格绑定大量事件。
5. 编辑器、筛选器、右键菜单使用浮层单例。
6. 滚动状态使用 `requestAnimationFrame` 合并更新。
7. 鼠标移动、拖拽、滚动等高频事件避免触发重计算。

### 5.2 数据计算性能

1. 排序、筛选、合并等派生结果通过 `useMemo` 缓存。
2. 数据量大时，搜索输入使用 debounce。
3. 重计算时只依赖必要状态，避免无关状态导致全表刷新。
4. 后续可将排序筛选迁移到 Web Worker。

### 5.3 交互性能

1. 选择状态只保存 key。
2. 单元格 hover 不进入 React state，优先使用 CSS 或事件委托。
3. 当前聚焦单元格可以独立维护，避免引发整表重渲染。
4. 滚动时暂停复杂浮层更新，滚动结束后再校准位置。

## 6. 错误边界和异常处理

### 6.1 渲染错误

需要提供 `TableErrorBoundary`，包裹以下区域：

1. 自定义单元格内容。
2. 自定义表头内容。
3. 自定义编辑器。
4. 自定义筛选器。

如果单个单元格渲染失败，应显示降级内容，不影响整张表。

### 6.2 数据异常

需要处理：

1. `dataSource` 不是数组。
2. `columns` 为空或非法。
3. `rowKey` 缺失。
4. 重复 `rowKey`。
5. 列宽非法。
6. 合并单元格范围非法。

开发环境可以使用 `console.warn` 提示，生产环境尽量静默降级。

### 6.3 超时处理

对于排序、筛选、合并等可能耗时的计算，需要预留超时保护。

第一阶段可以提供轻量方案：

1. 记录计算开始时间。
2. 超过阈值后停止继续计算。
3. 回退到上一次可用结果或原始数据。
4. 触发 `onError` 或 `onPerformanceWarning`。

后续版本可以引入 Web Worker 彻底隔离耗时计算。

## 7. 目录结构建议

```text
src/
  components/
    ProTable/
      index.ts
      ProTable.tsx
      types.ts

      core/
        normalizeColumns.ts
        getRowKey.ts
        deriveRows.ts
        sortRows.ts
        filterRows.ts
        buildSpanMap.ts

      hooks/
        useControlledState.ts
        useVirtualRows.ts
        useScrollSync.ts
        useRowSelection.ts
        useColumnSelection.ts
        useEditingCell.ts
        useContextMenu.ts

      render/
        TableRoot.tsx
        TableHeader.tsx
        TableBody.tsx
        TableRow.tsx
        TableCell.tsx
        FixedLeftPane.tsx
        FixedRightPane.tsx

      editors/
        TextEditor.tsx
        NumberEditor.tsx
        SelectEditor.tsx
        TreeSelectEditor.tsx
        DateEditor.tsx
        TimeEditor.tsx
        DateTimeEditor.tsx
        EditorLayer.tsx

      overlays/
        ContextMenuLayer.tsx
        FilterDropdown.tsx

      error/
        TableErrorBoundary.tsx

      styles/
        index.css
```

## 8. 开发阶段规划

### 第一阶段：核心表格和受控状态

目标：搭建可用的基础表格骨架。

任务：

1. 定义 `ProTableProps`、`TableColumn` 等核心类型。
2. 实现列标准化。
3. 实现 `rowKey` 解析。
4. 实现基础表头和表体渲染。
5. 实现受控状态工具 `useControlledState`。
6. 实现固定行高基础布局。
7. 实现基础错误边界。

交付结果：

1. 可以渲染普通表格。
2. 支持外部传入数据和列配置。
3. 支持基础错误兜底。

### 第二阶段：选择和右键菜单

目标：完成行列选择能力。

任务：

1. 实现行单选、多选。
2. 实现列单选、多选。
3. 实现 Shift 连续选择。
4. 实现 Ctrl / Command 增量选择。
5. 实现右键菜单浮层。
6. 暴露行列右键菜单回调。

交付结果：

1. 行和列可以稳定选择。
2. 选择状态支持完全受控。
3. 右键菜单能基于选中行列触发。

### 第三阶段：单元格编辑

目标：完成主流编辑能力。

任务：

1. 实现编辑态管理。
2. 实现编辑浮层定位。
3. 实现输入框编辑器。
4. 实现数字框编辑器。
5. 实现选择框编辑器。
6. 实现日期、时间、日期时间编辑器接口。
7. 预留树选择编辑器接口。
8. 实现提交、取消、校验、失焦处理。

交付结果：

1. 单元格可以进入编辑态。
2. 编辑完成后能回传变更。
3. 编辑器不影响普通渲染性能。

### 第四阶段：排序筛选和自定义渲染

目标：完成常用数据处理能力。

任务：

1. 实现单列排序。
2. 实现多列排序。
3. 实现列搜索。
4. 实现枚举筛选。
5. 实现自定义排序函数。
6. 实现自定义筛选函数。
7. 实现 `column.render`。
8. 自定义渲染接入错误边界。

交付结果：

1. 表格支持排序和筛选。
2. 表格支持自定义展示内容。
3. 数据处理状态支持受控。

### 第五阶段：固定表头、固定列和虚拟滚动

目标：重点优化大数据体验。

任务：

1. 实现固定表头。
2. 实现左固定列。
3. 实现右固定列。
4. 实现横向滚动同步。
5. 实现纵向滚动同步。
6. 实现固定行高虚拟滚动。
7. 实现 `requestAnimationFrame` 滚动调度。
8. 增加大数据压测页面。

交付结果：

1. 大数据量下滚动流畅。
2. 固定表头和固定列对齐稳定。
3. 普通交互不因数据量增长明显卡顿。

### 第六阶段：合并单元格和性能加固

目标：处理复杂表格场景。

任务：

1. 实现横向合并。
2. 实现纵向合并。
3. 实现合并单元格遮盖计算。
4. 处理合并单元格与虚拟滚动的边界。
5. 增加计算超时保护。
6. 增加异常数据校验。
7. 增加性能监控回调。

交付结果：

1. 支持基础合并单元格。
2. 异常输入不会导致整表崩溃。
3. 大计算任务有降级方案。

## 9. 测试方案

### 9.1 单元测试

重点覆盖纯函数：

1. `getRowKey`
2. `normalizeColumns`
3. `sortRows`
4. `filterRows`
5. `buildSpanMap`
6. `useControlledState`
7. `useVirtualRows`

### 9.2 组件测试

重点覆盖用户交互：

1. 行选择。
2. 列选择。
3. 多选。
4. 右键菜单。
5. 单元格编辑。
6. 排序切换。
7. 筛选输入。
8. 固定表头滚动同步。

### 9.3 性能测试

建议准备以下数据规模：

1. 1,000 行 x 20 列。
2. 10,000 行 x 50 列。
3. 100,000 行 x 50 列。

重点观察：

1. 首屏渲染时间。
2. 滚动帧率。
3. 编辑响应速度。
4. 选择响应速度。
5. 排序筛选耗时。
6. 内存占用。

## 10. 风险点和应对方案

### 10.1 固定列和虚拟滚动对齐问题

风险：左、中、右三个区域分开渲染，滚动时容易出现行错位。

应对：

1. 第一阶段限制固定行高。
2. 所有区域共享同一个虚拟行计算结果。
3. 行高、偏移、滚动位置统一由 `useVirtualRows` 输出。

### 10.2 合并单元格和虚拟滚动冲突

风险：纵向合并可能跨越可视区域，导致起始单元格不在视口内但视觉上仍需展示。

应对：

1. 第一版明确限制复杂跨视口合并。
2. 渲染前向上回溯合并起点。
3. 后续增加 span 索引缓存。

### 10.3 自定义单元格影响性能

风险：用户传入复杂 render，导致滚动卡顿。

应对：

1. 单元格 memo。
2. 开发文档说明 render 需要保持轻量。
3. 提供性能 warning。
4. 滚动过程中可选择展示轻量占位内容。

### 10.4 受控状态过多导致 API 复杂

风险：组件 API 变得难用。

应对：

1. 所有受控状态都提供 default 版本。
2. 常用能力封装为配置对象。
3. 文档中区分基础用法和高级用法。

## 11. 推荐优先级

建议按以下顺序推进：

1. 基础渲染。
2. 受控状态。
3. 行列选择。
4. 单元格编辑。
5. 排序筛选。
6. 固定表头。
7. 固定列。
8. 虚拟滚动。
9. 合并单元格。
10. 错误边界和性能加固贯穿所有阶段。

其中虚拟滚动、固定表头、固定列是流畅体验的核心，建议不要放到最后才整体处理，而是在基础布局阶段就预留结构。

## 12. 第一版最小可交付范围

为了尽快跑通组件闭环，第一版建议包含：

1. 基础表格渲染。
2. 受控数据。
3. 固定行高。
4. 行选择。
5. 输入框和数字框编辑。
6. 单列排序。
7. 列搜索。
8. 固定表头。
9. 固定行高虚拟滚动。
10. 错误边界。

暂缓到第二版：

1. 树选择框。
2. 完整日期时间编辑器矩阵。
3. 多列排序。
4. 复杂合并单元格。
5. 动态行高虚拟滚动。
6. Web Worker 排序筛选。

## 13. 总结

这个表格组件的核心不是堆功能，而是先把底层渲染模型设计好。只要做到数据模型、交互状态、渲染视口三者分离，后续无论是编辑、筛选、固定列还是合并单元格，都可以在同一套架构上扩展。

第一版应该优先保证：

1. 状态可控。
2. 滚动流畅。
3. 编辑稳定。
4. 错误可兜底。
5. 代码结构清晰。

这样后面继续加复杂功能时，组件不会越来越重，也不会因为某个高级功能影响基础表格的性能。
