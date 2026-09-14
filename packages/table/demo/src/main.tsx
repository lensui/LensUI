import React, {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Table,
  type CellChange,
  type DeleteRowsEvent,
  type TableCellSpan,
  type GridColumn,
  type GridSortState,
  type InsertRowsEvent,
} from "../../src";
import "../../src/style.css";
import "./page.css";

interface Person {
  id: string | number;
  name: string;
  department: string;
  city: string;
  role: string;
  status: string;
  email: string;
  phone: string;
  joinedAt: string;
  workTime: string;
  appointmentAt: string;
  year: string;
  month: string;
  dateRange: string;
  timeRange: string;
  dateTimeRange: string;
  score: number | "";
  amount: number | "";
  projects: number | "";
  hours: number | "";
}

const createInsertedRowId = () =>
  `inserted-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });

const filterRowsInChunks = async (
  source: Person[],
  deletedIds: Set<Person["id"]>,
) => {
  const chunkSize = 5000;
  const next: Person[] = [];
  for (let start = 0; start < source.length; start += chunkSize) {
    const end = Math.min(source.length, start + chunkSize);
    for (let index = start; index < end; index += 1) {
      const row = source[index];
      if (!deletedIds.has(row.id)) next.push(row);
    }
    await waitForNextPaint();
  }
  return next;
};

const scheduleAfterPaint = (callback: () => void | Promise<void>) =>
  new Promise<void>((resolve, reject) => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const requestIdleCallback = window.requestIdleCallback;
      const run = () => {
        Promise.resolve(callback()).then(resolve, reject);
      };
      if (requestIdleCallback) requestIdleCallback(run, { timeout: 120 });
      else window.setTimeout(run, 0);
    });
  });
});

const insertRowsInChunks = async (
  source: Person[],
  index: number,
  additions: Person[],
) => {
  const chunkSize = 5000;
  const next: Person[] = [];
  for (let start = 0; start < index; start += chunkSize) {
    next.push(...source.slice(start, Math.min(index, start + chunkSize)));
    await waitForNextPaint();
  }
  next.push(...additions);
  await waitForNextPaint();
  for (let start = index; start < source.length; start += chunkSize) {
    next.push(...source.slice(start, Math.min(source.length, start + chunkSize)));
    await waitForNextPaint();
  }
  return next;
};

class DemoErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    if (this.state.error)
      return (
        <main>
          <div className="demo-error">
            <strong>演示页加载失败</strong>
            <pre>{this.state.error.message}</pre>
          </div>
        </main>
      );
    return this.props.children;
  }
}

const initialColumns: GridColumn<Person>[] = [
  {
    key: "name",
    title: "姓名",
    dataIndex: "name",
    fixed: "left",
    editable: true,
    sortable: true,
    filterable: true,
  },
  {
    key: "department",
    title: "部门",
    dataIndex: "department",
    editable: true,
    editor: {
      type: "select",
      options: [
        { label: "研发", value: "研发" },
        { label: "设计", value: "设计" },
        { label: "市场", value: "市场" },
      ],
    },
    sortable: true,
    filterable: true,
  },
  {
    key: "role",
    title: "岗位",
    dataIndex: "role",
    editable: true,
    editor: {
      type: "select",
      options: [
        { label: "工程师", value: "工程师" },
        { label: "产品经理", value: "产品经理" },
        { label: "设计师", value: "设计师" },
        { label: "运营", value: "运营" },
      ],
    },
    sortable: true,
    filterable: true,
  },
  {
    key: "city",
    title: "城市",
    dataIndex: "city",
    editable: true,
    sortable: true,
    filterable: true,
  },
  {
    key: "status",
    title: "状态",
    dataIndex: "status",
    width: 120,
    sortable: true,
    filterable: true,
    renderCell: (value) => {
      const status = String(value);
      if (!status) return null;
      const className =
        status === "在职"
          ? "rvg-tag is-success"
          : status === "休假"
            ? "rvg-tag is-warning"
            : "rvg-tag is-danger";
      return <span className={className}>{status}</span>;
    },
  },
  {
    key: "phone",
    title: "联系电话",
    dataIndex: "phone",
    width: 180,
    editable: true,
    sortable: true,
    filterable: true,
  },
  {
    key: "email",
    title: "邮箱",
    dataIndex: "email",
    width: 240,
    editable: true,
    sortable: true,
    filterable: true,
  },
  {
    key: "joinedAt",
    title: "入职日期",
    dataIndex: "joinedAt",
    width: 160,
    editable: true,
    editor: { type: "date" },
    sortable: true,
    filterable: true,
  },
  {
    key: "workTime",
    title: "工作时间",
    dataIndex: "workTime",
    width: 150,
    editable: true,
    editor: { type: "time" },
    sortable: true,
    filterable: true,
  },
  {
    key: "appointmentAt",
    title: "预约日期时间",
    dataIndex: "appointmentAt",
    width: 210,
    editable: true,
    editor: { type: "date-time" },
    sortable: true,
    filterable: true,
  },
  {
    key: "year",
    title: "年度",
    dataIndex: "year",
    width: 120,
    editable: true,
    editor: { type: "year" },
    sortable: true,
    filterable: true,
  },
  {
    key: "month",
    title: "结算年月",
    dataIndex: "month",
    width: 140,
    editable: true,
    editor: { type: "month" },
    sortable: true,
    filterable: true,
  },
  {
    key: "dateRange",
    title: "日期范围",
    dataIndex: "dateRange",
    width: 250,
    editable: true,
    editor: { type: "date-range" },
    sortable: true,
    filterable: true,
  },
  {
    key: "timeRange",
    title: "时间范围",
    dataIndex: "timeRange",
    width: 190,
    editable: true,
    editor: { type: "time-range" },
    sortable: true,
    filterable: true,
  },
  {
    key: "dateTimeRange",
    title: "日期时间范围",
    dataIndex: "dateTimeRange",
    width: 360,
    editable: true,
    editor: { type: "date-time-range" },
    sortable: true,
    filterable: true,
  },
  {
    key: "score",
    title: "评分",
    dataIndex: "score",
    width: 140,
    align: "right",
    editable: true,
    sortable: true,
    filterable: true,
  },
  {
    key: "amount",
    title: "金额",
    dataIndex: "amount",
    width: 160,
    align: "right",
    fixed: "right",
    editable: true,
    summary: true,
    sortable: true,
    filterable: true,
    formatter: (value) =>
      value === "" || value == null
        ? ""
        : `¥${Number(value).toLocaleString("zh-CN")}`,
    cellStyle: (value) => {
      const amount = Number(value ?? 0);
      if (amount > 4500) return { color: "#d93025" };
      if (amount < 3200) return { color: "#188038" };
      return {};
    },
  },
];

function App() {
  const initialRows = useMemo<Person[]>(
    () =>
      Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        name: `用户 ${index + 1}`,
        department: ["研发", "设计", "市场"][index % 3],
        city: ["上海", "杭州", "深圳", "北京"][index % 4],
        role: ["工程师", "产品经理", "设计师", "运营"][index % 4],
        status: index % 3 === 0 ? "在职" : index % 2 === 0 ? "离职" : "休假",
        email: `user${index + 1}@example.com`,
        phone: `138${String(index).padStart(8, "0").slice(-8)}`,
        joinedAt: `202${index % 6}-${String((index % 12) + 1).padStart(2, "0")}-15`,
        workTime: `${String(8 + (index % 3)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
        appointmentAt: `202${index % 6}-${String((index % 12) + 1).padStart(2, "0")}-15 ${String(9 + (index % 8)).padStart(2, "0")}:30`,
        year: String(2020 + (index % 7)),
        month: `202${index % 6}-${String((index % 12) + 1).padStart(2, "0")}`,
        dateRange: `202${index % 6}-01-01 ~ 202${index % 6}-01-15`,
        timeRange: "09:00 ~ 18:00",
        dateTimeRange: `202${index % 6}-01-01 09:00 ~ 202${index % 6}-01-01 18:00`,
        score: 60 + (index % 40),
        amount: 3000 + index * 128,
        projects: 1 + (index % 9),
        hours: 120 + (index % 80),
      })),
    [],
  );
  const [rows, setRows] = useState(initialRows);
  const rowsRef = useRef(rows);
  const [columns, setColumns] = useState(initialColumns);
  const [sortState, setSortState] = useState<GridSortState | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 900);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const refresh = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 900);
  };
  const activeFilters = useMemo(
    () =>
      Object.entries(filterValues).filter(([, query]) => query.trim() !== ""),
    [filterValues],
  );
  const computedVisibleRows = useMemo(() => {
    if (activeFilters.length === 0 && !sortState) return rows;
    const filtered =
      activeFilters.length === 0
        ? rows
        : rows.filter((row) =>
            activeFilters.every(([key, query]) =>
              String(row[key as keyof Person] ?? "")
                .toLowerCase()
                .includes(query.toLowerCase()),
            ),
          );
    if (!sortState) return filtered;
    return filtered.slice().sort((a, b) => {
      const left = a[sortState.columnKey as keyof Person];
      const right = b[sortState.columnKey as keyof Person];
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return sortState.direction === "asc" ? result : -result;
    });
  }, [activeFilters, rows, sortState]);
  const [visibleRowsOverride, setVisibleRowsOverride] = useState<Person[] | null>(null);
  const visibleRows = visibleRowsOverride ?? computedVisibleRows;
  const cellSpans = useMemo<TableCellSpan[]>(() => [
    { rowKey: visibleRows[2]?.id, columnKey: "role", rowSpan: 2, colSpan: 1 },
    { rowKey: visibleRows[7]?.id, columnKey: "department", rowSpan: 1, colSpan: 2 },
  ].filter((span) => span.rowKey !== undefined), [visibleRows]);
  useEffect(() => {
    setVisibleRowsOverride(null);
  }, [computedVisibleRows]);
  const handleChange = async ({ row, columnKey, value }: CellChange<Person>) => {
    setRows((current) => {
      const next = current.slice();
      const rowIndex = next.findIndex((item) => item.id === row.id);
      if (rowIndex >= 0)
        next[rowIndex] = { ...next[rowIndex], [columnKey]: value };
      return next;
    });
    await waitForNextPaint();
  };
  const reorderColumns = (sourceIndex: number, targetIndex: number) =>
    setColumns((current) => {
      const next = current.slice();
      const [column] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  const resizeColumn = (columnKey: string, width: number) =>
    setColumns((current) =>
      current.map((column) =>
        column.key === columnKey ? { ...column, width } : column,
      ),
    );
  const reorderRows = (sourceIndex: number, targetIndex: number) =>
    setRows((current) => {
      const next = current.slice();
      const [row] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, row);
      return next;
    });
  const insertRows = async ({ rowIndex, row, position, count, insertedRows }: InsertRowsEvent<Person>) => {
    const current = rowsRef.current;
    const matchedIndex = current.findIndex((item) => item.id === row.id);
    const anchor = matchedIndex >= 0 ? matchedIndex : rowIndex;
    if (anchor < 0) return;
    const additions: Person[] = insertedRows ?? Array.from({ length: count }, () => ({
      id: createInsertedRowId(),
      name: "",
      department: "",
      city: "",
      role: "",
      status: "",
      email: "",
      phone: "",
      joinedAt: "",
      workTime: "",
      appointmentAt: "",
      year: "",
      month: "",
      dateRange: "",
      timeRange: "",
      dateTimeRange: "",
      score: "",
      amount: "",
      projects: "",
      hours: "",
    }));
    const insertIndex = anchor + (position === "after" ? 1 : 0);
    const next = await insertRowsInChunks(current, insertIndex, additions);
    setRows(next);
  };
  const deleteRows = async ({ rows: targets, viewportRange }: DeleteRowsEvent<Person>) => {
    const ids = new Set(targets.map(({ row }) => row.id));
    if (viewportRange) {
      const { rowStart, rowEnd } = viewportRange;
      setVisibleRowsOverride((current) => {
        const source = current ?? computedVisibleRows;
        const next = source.slice();
        const visibleWindow = next.slice(rowStart, rowEnd).filter((row) => !ids.has(row.id));
        let cursor = rowEnd;
        while (visibleWindow.length < rowEnd - rowStart && cursor < source.length) {
          const row = source[cursor];
          if (!ids.has(row.id)) visibleWindow.push(row);
          cursor += 1;
        }
        next.splice(rowStart, rowEnd - rowStart, ...visibleWindow);
        return next;
      });
    }
    await scheduleAfterPaint(async () => {
      const next = await filterRowsInChunks(rowsRef.current, ids);
      setRows(next);
      setVisibleRowsOverride(null);
    });
  };
  return (
    <main>
      <header>
        <div>
          <h1>Table</h1>
          <p>100,000 行 Canvas 虚拟表格</p>
        </div>
        <div className="demo-header-actions">
          <span>{visibleRows.length.toLocaleString()} rows</span>
          <button
            type="button"
            aria-label="刷新数据"
            title="刷新数据"
            onClick={refresh}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.3-2.4L20 9M4 15l2.6 2.4A7 7 0 0 0 17.9 15" />
            </svg>
          </button>
        </div>
      </header>
      <Table
        columns={columns}
        rows={visibleRows}
        height={620}
        autoHeight
        loading={loading}
        columnResizable
        sortState={sortState}
        onSortStateChange={setSortState}
        filterValues={filterValues}
        onFilterValuesChange={setFilterValues}
        onColumnOrderChange={reorderColumns}
        onColumnResize={resizeColumn}
        onRowOrderChange={reorderRows}
        onInsertRows={insertRows}
        onDeleteRows={deleteRows}
        onCellChange={handleChange}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DemoErrorBoundary>
      <App />
    </DemoErrorBoundary>
  </React.StrictMode>,
);
