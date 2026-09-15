# @lensui/lens-table

`@lensui/lens-table` 是一个面向大数据量的 React 表格组件。主体单元格使用 Canvas 绘制，编辑器、筛选器、菜单和可选中文本使用 DOM 承载，适合需要 10 万行级别滚动、固定列、拖拽、编辑和键盘操作的业务表格。

## 安装

```bash
npm install @lensui/lens-table
```

React 和 React DOM 18 或更高版本为 peer dependencies。

## 基础使用

```tsx
import { useState } from 'react';
import {
  Table,
  type CellChange,
  type GridColumn,
} from '@lensui/lens-table';
import '@lensui/lens-table/style.css';

interface Row {
  id: number;
  name: string;
  department: string;
  joinedAt: string;
  amount: number;
}

const columns: GridColumn<Row>[] = [
  { key: 'name', title: '姓名', dataIndex: 'name', width: 180, editable: true },
  {
    key: 'department',
    title: '部门',
    dataIndex: 'department',
    width: 160,
    editable: true,
    editor: {
      type: 'select',
      options: [
        { label: '研发', value: '研发' },
        { label: '设计', value: '设计' },
      ],
    },
  },
  {
    key: 'joinedAt',
    title: '入职日期',
    dataIndex: 'joinedAt',
    width: 160,
    editable: true,
    editor: { type: 'date' },
  },
  { key: 'amount', title: '金额', dataIndex: 'amount', width: 140, align: 'right' },
];

export function Example() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, name: '用户 1', department: '研发', joinedAt: '2026-01-15', amount: 120 },
  ]);

  const handleCellChange = ({ row, columnKey, value }: CellChange<Row>) => {
    setRows((current) =>
      current.map((item) =>
        item.id === row.id ? { ...item, [columnKey]: value } : item,
      ),
    );
  };

  return (
    <Table
      columns={columns}
      rows={rows}
      height={560}
      onCellChange={handleCellChange}
    />
  );
}
```

## Table 参数

| 参数                           | 类型                                                                                 | 默认值            | 说明                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `columns`                    | `GridColumn<Row>[]`                                                                | 必填              | 表格列配置。Canvas 绘制、DOM 编辑器和交互都依赖这份配置。                                                                               |
| `rows`                       | `Row[]`                                                                            | 必填              | 表格数据。组件不会直接修改数据，编辑后通过事件通知外部更新。                                                                            |
| `rowKey`                     | `keyof Row \| ((row, index) => string \| number)`                                    | `id`            | 行唯一标识。默认读取每行的`id` 字段；如果数据不是 `id` 主键，请显式传入字段名或函数。                                               |
| `width`                      | `number \| string`                                                                  | `100%`          | 表格宽度。数字按像素处理，字符串可传`100%`、`80vw` 等。                                                                             |
| `height`                     | `number \| string`                                                                  | `100%`          | 表格最大高度。默认继承父容器高度；如果父容器没有可计算高度，则回落到`480px`。数据较少时默认按真实内容高度收缩，数据较多时不超过该高度。 |
| `layout`                     | `{ rowHeight?: number; headerHeight?: number }`                                    | `{ rowHeight: 36, headerHeight: 40 }` | 表格布局尺寸配置。推荐把行高、表头高度等样式相关参数放在这里；自定义多行表头会以 `headerHeight` 为最小高度自动撑开。              |
| `rowHeight`                  | `number`                                                                           | `36`            | 已兼容保留，建议改用 `layout.rowHeight`。                                                                                                  |
| `headerHeight`               | `number`                                                                           | `40`            | 已兼容保留，建议改用 `layout.headerHeight`。                                                                                              |
| `fixedHeader`                | `boolean`                                                                          | `true`          | 表头是否固定在顶部。                                                                                                                    |
| `locale`                     | `'zh-CN' \| 'en-US' \| LocaleConfig`                                                 | `'zh-CN'`       | 国际化配置。传字符串时使用内置中英文文案；传对象时可通过`language` 指定语言，并通过 `labels` 覆盖文案。                             |
| `borderless`                 | `boolean`                                                                          | `false`         | 是否弱化竖向边框。开启后隐藏单元格之间的竖线，但保留横向分隔线。                                                                        |
| `verticalBorderless`         | `boolean`                                                                          | `false`         | 已兼容保留，建议改用 `borderless`。                                                                                                      |
| `striped`                    | `boolean \| string`                                                                 | `false`         | 是否显示斑马纹行背景。传`true` 使用主题变量，传颜色字符串可自定义斑马纹颜色，例如 `'#f6faff'`。                                     |
| `highlight`                  | `{ editedCells?: boolean \| string; insertedRows?: boolean \| string }`             | `{}`            | 高亮反馈配置。`editedCells` 控制编辑过的单元格底色，`insertedRows` 控制乐观插入行底色；传 `true` 使用默认色，传颜色字符串可自定义。   |
| `cellSpans`                  | `TableCellSpan[] \| ((ctx) => TableCellSpan \| { rowSpan?: number; colSpan?: number } \| null)` | `[]`            | 合并主体单元格配置。可传数组，也可传函数按单元格生成规则。推荐使用 `rowKey` 定位；横向合并会限制在同一个固定列分区内，工具列不会参与合并。 |
| `loading`                    | `boolean`                                                                          | `false`         | 显示加载态。                                                                                                                            |
| `loadingContent`             | `ReactNode`                                                                        | -                 | 自定义加载内容。传入后，首次加载和刷新加载不再区分，都会统一展示这个内容。                                                              |
| `virtualized`                | `boolean \| { enabled?: boolean; overscan?: number }`                               | `true`          | 虚拟渲染配置。传`false` 时渲染全部行列；传对象时可通过 `enabled` 开关，并用 `overscan` 配置可见范围外的缓冲行列数量，默认 `4`。 |
| `tooltip`                    | `boolean \| { header?: boolean; cell?: boolean }`                                   | `true`          | 文本 tooltip 总配置。传`true` 时表头和单元格 hover 都显示完整文本；传 `false` 可关闭；传对象可分别控制表头和单元格。                |
| `summary`                    | `boolean \| { position?: 'top' \| 'bottom'; verticalBordered?: boolean; emptyValue?: ReactNode }` | `false`         | 表格级合计行配置。默认不显示；传 `true` 或对象即开启合计行，对象可控制显示在表头下方或底部、是否显示内部竖线，以及无合计值单元格的填充内容。     |
| `rowNumber`                  | `boolean`                                                                          | `true`          | 是否显示序号列。默认开启并自动生成左侧序号列，不需要在`columns` 中配置；传 `false` 可关闭。                                         |
| `selectedCell`               | `GridSelection \| null`                                                             | 非受控            | 受控单元格选中状态。                                                                                                                    |
| `defaultSelectedCell`        | `GridSelection \| null`                                                             | `null`          | 非受控模式下的默认选中单元格。                                                                                                          |
| `onSelectedCellChange`       | `(selection) => void`                                                              | -                 | 单元格选中变化回调。                                                                                                                    |
| `rangeSelection`             | `boolean`                                                                          | `false`         | 是否允许鼠标拖动选择多个单元格。开启后支持范围复制、范围右键菜单和右下角拖拽扩展范围。                                                  |
| `rowSelection`               | `boolean \| AxisSelectionConfig`                                                    | `false`         | 开启行选择。可传`{ mode: 'single' \| 'multiple' }`；开启后组件自动生成左侧选择列，不需要在 `columns` 中配置。                        |
| `selectedRowKeys`            | `GridKey[]`                                                                        | 非受控            | 受控行选择 key 列表。                                                                                                                   |
| `defaultSelectedRowKeys`     | `GridKey[]`                                                                        | `[]`            | 非受控模式下默认选中的行 key。                                                                                                          |
| `onSelectedRowKeysChange`    | `(keys, rows, indices) => void`                                                    | -                 | 行选择变化回调。                                                                                                                        |
| `columnSelection`            | `boolean \| AxisSelectionConfig`                                                    | `false`         | 开启列选择。可传`{ mode: 'single' \| 'multiple' }`。                                                                                   |
| `selectedColumnKeys`         | `string[]`                                                                         | 非受控            | 受控列选择 key 列表。                                                                                                                   |
| `defaultSelectedColumnKeys`  | `string[]`                                                                         | `[]`            | 非受控模式下默认选中的列 key。                                                                                                          |
| `onSelectedColumnKeysChange` | `(keys) => void`                                                                   | -                 | 列选择变化回调。                                                                                                                        |
| `columnDraggable`            | `boolean`                                                                          | `true`          | 是否允许拖拽调整列顺序。默认开启，普通列默认显示表头拖拽入口，传`false` 可关闭。                                                      |
| `columnResizable`            | `boolean`                                                                          | `false`         | 是否允许拖拽调整列宽。                                                                                                                  |
| `onColumnOrderChange`        | `(sourceIndex, targetIndex) => void`                                               | -                 | 列拖拽排序回调。需要在外部更新`columns`。                                                                                             |
| `onColumnResize`             | `(columnKey, width) => void`                                                       | -                 | 列宽变化回调。需要在外部更新对应列宽。                                                                                                  |
| `rowDraggable`               | `boolean`                                                                          | `false`         | 是否允许拖拽调整行顺序。开启后组件自动生成左侧拖拽手柄列，不需要在`columns` 中配置。                                                  |
| `onRowOrderChange`           | `(sourceIndex, targetIndex) => void`                                               | -                 | 行拖拽排序回调。需要在外部更新`rows`。                                                                                                |
| `onInsertRows`               | `(event) => void`                                                                  | -                 | 右键菜单插入行回调。                                                                                                                    |
| `onDeleteRows`               | `(event) => void`                                                                  | -                 | 右键菜单删除行回调。                                                                                                                    |
| `sortState`                  | `GridSortState \| null`                                                             | 非受控            | 受控排序状态。组件只管理 UI 状态，数据排序由外部完成。                                                                                  |
| `onSortStateChange`          | `(state) => void`                                                                  | -                 | 点击表头排序时触发。                                                                                                                    |
| `filterValues`               | `Record<string, string>`                                                           | 非受控            | 受控筛选值。组件只管理输入值，数据过滤由外部完成。                                                                                      |
| `onFilterValuesChange`       | `(values) => void`                                                                 | -                 | 表头筛选值变化回调。                                                                                                                    |
| `onCellChange`               | `(change) => void`                                                                 | -                 | 单元格编辑提交回调。                                                                                                                    |
| `onCellContextMenu`          | `(event) => void`                                                                  | -                 | 单元格右键回调，可用于扩展自定义菜单逻辑。                                                                                              |
| `contextMenu`                | `boolean \| { header?, cell?, range? }`                                             | `true`          | `true` 开启默认右键菜单，`false` 关闭右键菜单，传对象可自定义菜单项、顺序和分割线。                                                 |
| `emptyContent`               | `ReactNode`                                                                        | 内置空状态        | 自定义空数据内容。                                                                                                                      |
| `className`                  | `string`                                                                           | -                 | 根节点 className。                                                                                                                      |
| `style`                      | `CSSProperties`                                                                    | -                 | 根节点内联样式，可用于传入主题 CSS 变量。                                                                                               |
| `ariaLabel`                  | `string`                                                                           | `Table` | 表格区域无障碍名称。                                                                                                                    |

## 高亮和范围选择

编辑高亮、插入行高亮和鼠标拖动多单元格选择默认都不开启。需要这些视觉反馈或批量选择能力时，通过表格级配置显式开启：

```tsx
<Table
  columns={columns}
  rows={rows}
  highlight={{
    editedCells: true,
    insertedRows: '#c8ead4',
  }}
  rangeSelection
/>
```

`highlight.editedCells` 和 `highlight.insertedRows` 传 `true` 时使用主题默认色；传颜色字符串时只覆盖对应高亮色。`rangeSelection` 开启后，可以用鼠标拖动选择多个单元格，并在范围内复制或打开范围右键菜单。

## 合并单元格

通过 `cellSpans` 配置主体区域的合并单元格。每个合并项以左上角单元格为锚点，`rowSpan` 和 `colSpan` 分别控制覆盖的行数和列数：

```tsx
<Table
  columns={columns}
  rows={rows}
  cellSpans={[
    { rowKey: rows[2].id, columnKey: 'role', rowSpan: 2 },
    { rowKey: rows[7].id, columnKey: 'department', colSpan: 2 },
  ]}
/>
```

也可以传函数按单元格声明规则。函数返回值会默认使用当前单元格作为锚点，因此只需要返回跨度：

```tsx
<Table
  columns={columns}
  rows={rows}
  cellSpans={({ rowIndex, column }) => {
    if (column.key === 'department' && rowIndex % 3 === 0) return { rowSpan: 2 };
    return null;
  }}
/>
```

`rowKey` 优先于 `rowIndex`，在排序、过滤或插入删除行后更稳定。被合并覆盖的单元格不会单独绘制或命中，点击覆盖区域会选中合并区域的锚点单元格。横向合并不会跨越固定左列、滚动列、固定右列这三个区域；如果声明跨区，组件会自动收缩到当前区域内。

## Column 参数

| 参数           | 类型                                                                       | 默认值               | 说明                                                                                        |
| -------------- | -------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `key`        | `string`                                                                 | 必填                 | 列唯一标识。排序、筛选、选择、编辑回调都使用它。                                            |
| `title`      | `string`                                                                 | 必填                 | 表头展示文本。                                                                              |
| `renderHeader` | `(column) => ReactNode`                                                | -                    | 自定义表头 React 内容。多行内容会自动撑开表头高度；`title` 仍用于 tooltip、拖拽预览和回退文本。 |
| `dataIndex`  | `keyof Row`                                                              | -                    | 从行数据中读取和写入的字段。工具列可不传。                                                  |
| `width`      | `number`                                                                 | `140`              | 列宽，单位 px。最小宽度由内部布局保护。                                                     |
| `fixed`      | `'left' \| 'right'`                                                       | -                    | 固定列位置。左/右固定列会覆盖滚动列并显示阴影。                                             |
| `align`      | `'left' \| 'center' \| 'right'`                                            | `'left'`           | 单元格文本和拖拽预览文本对齐方式。                                                          |
| `editable`   | `boolean`                                                                | `false`            | 是否允许双击或按 Enter 进入编辑。                                                           |
| `editor`     | `EditorConfig`                                                           | `{ type: 'text' }` | 内置编辑器配置。详见下方编辑器表。未配置时默认使用文本编辑器。                              |
| `sortable`   | `boolean`                                                                | `true`             | 表头显示排序按钮，并触发`onSortStateChange`。普通数据列默认开启，传 `false` 可关闭。    |
| `filterable` | `boolean`                                                                | `true`             | 表头显示筛选按钮，并触发`onFilterValuesChange`。普通数据列默认开启，传 `false` 可关闭。 |
| `formatter`  | `(value, row, rowIndex) => string`                                       | -                    | 自定义展示文本。异常会被隔离并显示渲染错误文案。                                            |
| `renderCell` | `(value, row, rowIndex) => ReactNode`                                    | -                    | 自定义单元格 React 内容。适合标签、徽标、图标组合等内置编辑器无法表达的展示。               |
| `summary`    | `boolean \| ((rows, column) => ReactNode)`                                | `false`            | 是否在合计行显示该列合计。传`true` 自动累加数字值；传函数可自定义合计内容。               |
| `cellStyle`  | `(value, row, rowIndex) => { color?: string; backgroundColor?: string }` | -                    | 自定义单元格绘制样式。支持文本颜色和背景色，适合金额、状态等条件高亮。                      |

## 列合计

合计行由表格级 `summary` 和列级 `columns[].summary` 共同控制：表格级 `summary` 控制是否显示、位置、内部竖线和空白填充；列级 `summary` 控制这一列显示什么合计内容。默认不显示合计行；传 `summary={true}` 或对象即开启合计行。合计行不参与虚拟滚动、排序、筛选、选择和编辑。

```tsx
<Table
  columns={columns}
  rows={rows}
  summary={{ position: 'bottom' }}
/>
```

表格级 `summary` 支持：

| 属性                 | 类型                 | 默认值       | 说明                                                                                      |
| -------------------- | -------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `position`         | `'top' \| 'bottom'` | `'bottom'` | 合计行位置。`top` 显示在表头下方，`bottom` 显示在表格底部。                           |
| `verticalBordered` | `boolean`          | `true`     | 是否显示合计行内部竖线。全局 `verticalBorderless` 为 `true` 时优先隐藏竖线。          |
| `emptyValue`       | `ReactNode`        | `''`       | 合计行没有值的单元格填充内容。默认显示为空。                                             |

```tsx
const columns: GridColumn<Row>[] = [
  {
    key: 'amount',
    title: '金额',
    dataIndex: 'amount',
    align: 'right',
    formatter: (value) => `¥${Number(value).toLocaleString('zh-CN')}`,
    summary: true,
  },
];
```

`summary: true` 会自动累加该列的数字值，非数字值会被忽略；如果列配置了 `formatter`，合计结果也会复用该 `formatter` 展示。

需要自定义合计内容时，可以传函数：

```tsx
const columns: GridColumn<Row>[] = [
  {
    key: 'name',
    title: '姓名',
    dataIndex: 'name',
    summary: (rows) => `共 ${rows.length} 条`,
  },
  {
    key: 'amount',
    title: '金额',
    dataIndex: 'amount',
    summary: (rows) =>
      rows.reduce((total, row) => total + Number(row.amount ?? 0), 0),
  },
];
```

## 内置编辑器

| `editor.type`     | 数据格式示例                              | 说明                                                                |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `text`            | `''`                                    | 默认文本编辑器。`editable: true` 且不传 `editor` 时也会使用它。 |
| `select`          | `''`                                    | 下拉选择。需要传`options: Array<{ label; value }>`。              |
| `date`            | `'2026-01-15'`                          | 日期选择器。                                                        |
| `time`            | `'09:30'` 或 `'09:30:15'`             | 时间选择器。是否显示秒由`format` 或当前值推断。                   |
| `date-time`       | `'2026-01-15 09:30'`                    | 日期时间选择器。日期和时间默认使用空格连接。                        |
| `year`            | `'2026'`                                | 年选择器。                                                          |
| `month`           | `'2026-01'`                             | 年月选择器。                                                        |
| `date-range`      | `'2026-01-01 ~ 2026-01-15'`             | 日期范围选择器。                                                    |
| `time-range`      | `'09:00 ~ 18:00'`                       | 时间范围选择器。                                                    |
| `date-time-range` | `'2026-01-01 09:00 ~ 2026-01-01 18:00'` | 日期时间范围选择器，包含日期和时间面板。                            |

可选 `format` 用于控制提交到数据里的字符串格式，例如：

```tsx
{
  key: 'startAt',
  title: '开始时间',
  dataIndex: 'startAt',
  editable: true,
  editor: { type: 'date-time', format: 'yyyy-MM-dd HH:mm:ss' },
}
```

## 右键菜单

`contextMenu` 支持三种模式：

- `true`：开启默认右键菜单。不传时也是这个行为。
- `false`：关闭组件右键菜单。
- 对象：自定义表头、单元格和范围选择菜单。对象里的 `header`、`cell`、`range` 可以传 `true` 使用该区域默认菜单，传 `false` 关闭该区域菜单，传数组自定义该区域菜单，也可以传 `{ exclude }` 基于默认菜单关闭部分内置项。

对象配置里的数组顺序就是菜单显示顺序，移除某个内置 key 就会关闭该项，`'|'` 会渲染分割线。也可以插入自定义菜单项。直接写 key 使用内置行为；传对象且 `key` 命中内置项时，可以覆盖 `label`、`icon`、`shortcut`、`disabled`、`hidden`，传 `onClick` 时会替换该内置行为。

```tsx
<Table
  columns={columns}
  rows={rows}
  contextMenu={{
    header: true,
    cell: [
      'edit',
      'copy',
      'undo',
      'clear',
      '|',
      'select-column',
      {
        key: 'inspect',
        label: '查看详情',
        onClick: ({ row }) => console.log(row),
      },
    ],
    range: false,
  }}
/>
```

如果只是想关闭默认菜单中的一两个内置项，可以用 `exclude`：

```tsx
<Table
  columns={columns}
  rows={rows}
  contextMenu={{
    cell: { exclude: ['undo', 'delete-row'] },
  }}
/>
```

对象菜单项支持这些属性：

| 属性         | 说明                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `key`      | 菜单项唯一标识。命中内置 key 时覆盖内置菜单项；未命中时表示自定义菜单项。                         |
| `label`    | 菜单主文本，支持`ReactNode`。内置项不传时使用默认文案；自定义项建议必传。                       |
| `icon`     | 菜单左侧图标，支持`ReactNode`。内置项不传时使用默认图标；传入后会覆盖默认图标。                 |
| `shortcut` | 菜单右侧快捷键提示，支持`ReactNode`，只负责展示，不会自动绑定键盘事件。                         |
| `disabled` | 是否禁用菜单项。可以传布尔值，也可以传`(context) => boolean` 按当前表头、单元格或范围动态判断。 |
| `danger`   | 是否使用危险操作样式。                                                                            |
| `hidden`   | 是否隐藏菜单项。可以传布尔值，也可以传`(context) => boolean` 按当前表头、单元格或范围动态判断。 |
| `onClick`  | 点击回调。命中内置 key 时会替换内置行为；自定义菜单项通常需要提供。                               |
| `children` | 子菜单配置，只支持数组。数组项同样支持对象菜单项属性，也可以继续嵌套`children`。                |
| `render`   | 自定义右侧面板内容，支持`ReactNode` 或 `(context) => ReactNode`。                             |

`children` 用于配置多级菜单：

```tsx
<Table
  columns={columns}
  rows={rows}
  contextMenu={{
    cell: [
      'copy',
      {
        key: 'more',
        label: '更多操作',
        children: [
          { key: 'copy-id', label: '复制 ID', onClick: ({ row }) => console.log(row.id) },
          '|',
          {
            key: 'export',
            label: '导出',
            children: [
              { key: 'export-json', label: '导出 JSON', onClick: ({ row }) => console.log(row) },
            ],
          },
        ],
      },
    ],
  }}
/>
```

`render` 用于渲染自定义面板：

```tsx
<Table
  columns={columns}
  rows={rows}
  contextMenu={{
    cell: [
      {
        key: 'custom-panel',
        label: '自定义面板',
        render: ({ row }) => <div style={{ padding: 12 }}>{row.name}</div>,
      },
    ],
  }}
/>
```

内置 key：

| 区域     | key                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表头     | `copy`, `select-column`                                                                                                                                                |
| 单元格   | `edit`, `copy`, `annotation`, `select-row`, `select-column`, `insert-above`, `insert-below`, `move-up`, `move-down`, `undo`, `clear`, `delete-row` |
| 范围选择 | `copy`, `annotation`, `clear`                                                                                                                                        |
| 分割线   | `\|`，可写在 `header`、`cell`、`range` 数组中，用于渲染菜单分割线。                                                                                                 |

## 表头默认能力

普通数据列默认显示三个表头入口：拖拽排序、正序/倒序排序、筛选。大多数列不需要显式写 `sortable: true` 或 `filterable: true`。

```tsx
const columns: GridColumn<Row>[] = [
  { key: 'name', title: '姓名', dataIndex: 'name' },
  { key: 'amount', title: '金额', dataIndex: 'amount', align: 'right' },
];

<Table columns={columns} rows={rows} />;
```

如果某一列不需要排序或筛选，显式传 `false`：

```tsx
{
  key: 'remark',
  title: '备注',
  dataIndex: 'remark',
  sortable: false,
  filterable: false,
}
```

## 排序和筛选

组件只负责展示排序/筛选交互，不会直接改变 `rows`。业务侧需要根据回调结果自行排序、过滤。

```tsx
const [sortState, setSortState] = useState<GridSortState | null>(null);
const [filterValues, setFilterValues] = useState<Record<string, string>>({});

const visibleRows = useMemo(() => {
  const filtered = rows.filter((row) =>
    Object.entries(filterValues).every(([key, value]) =>
      String(row[key as keyof Row] ?? '').includes(value),
    ),
  );

  if (!sortState) return filtered;

  return filtered.slice().sort((a, b) => {
    const left = a[sortState.columnKey as keyof Row];
    const right = b[sortState.columnKey as keyof Row];
    const result = String(left).localeCompare(String(right));
    return sortState.direction === 'asc' ? result : -result;
  });
}, [rows, sortState, filterValues]);

<Table
  columns={columns}
  rows={visibleRows}
  sortState={sortState}
  filterValues={filterValues}
  onSortStateChange={setSortState}
  onFilterValuesChange={setFilterValues}
/>;
```

## 拖拽和列宽

拖拽排序和调整列宽都采用外部受控数据模式：组件告诉你发生了什么，真正的 `rows` 或 `columns` 更新由你完成。

`columnDraggable` 默认开启，普通列会自动显示表头拖拽入口。行选择和行拖拽是表格级配置：开启 `rowSelection` 后自动生成左侧选择列，开启 `rowDraggable` 后自动生成左侧拖拽手柄列，不需要在 `columns` 里配置 `rowSelection` 或 `rowDragHandle`。

```tsx
<Table
  columns={columns}
  rows={rows}
  rowSelection={{ mode: 'multiple' }}
  columnResizable
  rowDraggable
  onColumnOrderChange={(sourceIndex, targetIndex) => {
    setColumns((current) => {
      const next = current.slice();
      const [column] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  }}
  onColumnResize={(columnKey, width) => {
    setColumns((current) =>
      current.map((column) =>
        column.key === columnKey ? { ...column, width } : column,
      ),
    );
  }}
  onRowOrderChange={(sourceIndex, targetIndex) => {
    setRows((current) => {
      const next = current.slice();
      const [row] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, row);
      return next;
    });
  }}
/>;
```

## 虚拟渲染

默认开启虚拟渲染，只绘制可见区域和少量缓冲区域。缓冲数量默认是 `4`，可以通过对象形式调整。

```tsx
<Table
  columns={columns}
  rows={rows}
  virtualized={{ enabled: true, overscan: 6 }}
/>
```

如果数据量很小，或需要一次性渲染全部 DOM 文本层，可以关闭虚拟渲染：

```tsx
<Table
  columns={columns}
  rows={rows}
  virtualized={false}
/>
```

## 加载状态

默认加载态会区分两种场景：首次加载显示骨架层，已有数据刷新时显示 spinner 遮罩。如果传入 `loadingContent`，组件不会再区分这两种场景，所有加载状态都会统一展示自定义内容。

```tsx
<Table
  columns={columns}
  rows={rows}
  loading={loading}
  loadingContent={<div className="table-loading">加载中...</div>}
/>
```

## 主题适配

样式通过 CSS 变量开放。可以在全局、页面容器或单个表格上覆盖变量。

```tsx
<Table
  columns={columns}
  rows={rows}
  style={{
    '--rvg-color-primary': '#10b981',
    '--rvg-color-bg': '#0f172a',
    '--rvg-color-text': '#e5e7eb',
    '--rvg-color-grid': '#334155',
  } as React.CSSProperties}
/>
```

常用变量：

| 变量                                | 说明                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `--rvg-color-bg`                  | 表格背景色。                                                                       |
| `--rvg-color-header-bg`           | 表头背景色。                                                                       |
| `--rvg-color-text`                | 主文本颜色。                                                                       |
| `--rvg-color-muted`               | 次级文本颜色。                                                                     |
| `--rvg-color-icon`                | 图标颜色。                                                                         |
| `--rvg-color-grid`                | Canvas 网格线颜色。                                                                |
| `--rvg-color-border`              | 弹层、输入框等 DOM 边框颜色。                                                      |
| `--rvg-color-primary`             | 选中、按钮、焦点等强调色。                                                         |
| `--rvg-color-selection-fill`      | 单元格选中背景。                                                                   |
| `--rvg-color-axis-selection-fill` | 行/列选中背景。                                                                    |
| `--rvg-color-edited-fill`         | 已编辑单元格背景。                                                                 |
| `--rvg-color-stripe`              | `striped={true}` 时的斑马纹背景。也可以直接通过 `striped="#f6faff"` 单独指定。 |

## 国际化

`locale` 是统一的国际化入口。直接传 `'zh-CN'` 或 `'en-US'` 时会使用组件内置文案；传对象时通过 `language` 指定基础语言，并在 `labels` 里覆盖你关心的字段。

目前组件内置文案只提供中文和英文两套：`zh-CN`、`en-US`。日期选择器的底层库可以接受更多地区格式，但组件菜单、按钮、提示文案需要你通过对象模式自行覆盖。

```tsx
<Table
  columns={columns}
  rows={rows}
  locale="en-US"
/>
```

```tsx
<Table
  columns={columns}
  rows={rows}
  locale={{
    language: 'en-US',
    labels: {
      choose: 'Choose',
      confirm: 'OK',
      reset: 'Reset',
      search: 'Search',
      empty: 'No data',
      deleteConfirmDescription: (count) => `Delete ${count} row(s)?`,
    },
  }}
/>
```

如果项目里已经有自己的 i18n 封装，可以把翻译函数的结果映射到 `locale` 对象里传入：

```tsx
import { Table, type TableLocaleConfig } from '@lensui/lens-table';
import { useTranslation } from 'react-i18next';

function UserTable() {
  const { t, i18n } = useTranslation();

  const gridLocale: TableLocaleConfig = {
    language: i18n.language.startsWith('en') ? 'en-US' : 'zh-CN',
    labels: {
      choose: t('grid.choose'),
      confirm: t('grid.confirm'),
      reset: t('grid.reset'),
      search: t('grid.search'),
      empty: t('grid.empty'),
      filterWithValue: (value) => t('grid.filterWithValue', { value }),
      filterColumn: (title) => t('grid.filterColumn', { title }),
      deleteConfirmDescription: (count) =>
        t('grid.deleteConfirmDescription', { count }),
    },
  };

  return (
    <Table
      columns={columns}
      rows={rows}
      locale={gridLocale}
    />
  );
}
```

也可以只覆盖部分字段，未传的字段会从 `language` 对应的内置中英文文案里补齐：

```tsx
<Table
  locale={{
    language: 'zh-CN',
    labels: {
      empty: i18n.t('common.empty'),
      confirm: i18n.t('common.confirm'),
    },
  }}
/>
```

## 常用交互

| 操作             | 行为                                     |
| ---------------- | ---------------------------------------- |
| 单击单元格       | 选中单元格。                             |
| 拖拽单元格       | 创建多单元格范围选择。                   |
| 双击可编辑单元格 | 进入编辑。                               |
| `Enter`        | 进入编辑或提交当前编辑。                 |
| `Escape`       | 取消编辑或关闭弹层。                     |
| 表头排序按钮     | 切换升序、降序、无排序。                 |
| 表头筛选按钮     | 打开当前列筛选输入。                     |
| 右键单元格       | 打开复制、清空、编辑、插入、删除等菜单。 |

## 开发

```bash
pnpm install
pnpm dev
pnpm check
```

## 发布

1. 在 `package.json` 中确认 npm 包名、版本和仓库信息。
2. 执行 `pnpm check`，确保类型检查、测试和构建通过。
3. 更新版本号并创建发布。

## License

MIT
