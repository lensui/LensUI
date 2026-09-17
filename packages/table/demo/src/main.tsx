import React, {
  Component,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Table,
  type CellChange,
  type TableCellSpan,
  type GridColumn,
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

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve()),
    );
  });

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

const columns: GridColumn<Person>[] = [
  {
    key: "name",
    title: "姓名",
    dataIndex: "name",
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
    editable: true,
    summary: true,
    sortable: true,
    filterable: true,
    fixed: "right",
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
      Array.from({ length: 1000 }, (_, index) => ({
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
  const [tableColumns, setTableColumns] = useState(columns);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 900);
    return () => window.clearTimeout(timer);
  }, []);
  const refresh = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 900);
  };
  const visibleRows = rows;
  const cellSpans = useMemo<TableCellSpan[]>(
    () =>
      [
        {
          rowKey: visibleRows[2]?.id,
          columnKey: "role",
          rowSpan: 2,
          colSpan: 1,
        },
        {
          rowKey: visibleRows[7]?.id,
          columnKey: "department",
          rowSpan: 1,
          colSpan: 2,
        },
      ].filter((span) => span.rowKey !== undefined),
    [visibleRows],
  );
  const handleChange = async ({
    row,
    columnKey,
    value,
  }: CellChange<Person>) => {
    console.log("Cell changed:", { row, columnKey, value });
    setRows((current) => {
      const next = current.slice();
      const rowIndex = next.findIndex((item) => item.id === row.id);
      if (rowIndex >= 0)
        next[rowIndex] = { ...next[rowIndex], [columnKey]: value };
      return next;
    });
    await waitForNextPaint();
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
        columns={tableColumns}
        rows={visibleRows}
        defaultSelectedCell={{ rowIndex: 0, columnKey: "name" }}
        height={620}
        loading={loading}
        rowDraggable
        onInsertRows={(nextRows, insertedRows) => {
          console.log("Rows inserted:", { rows: nextRows, insertedRows });
          setRows(nextRows);
        }}
        onDeleteRows={(nextRows, deletedRows) => {
          console.log("Rows deleted:", { rows: nextRows, deletedRows });
          setRows(nextRows);
        }}
        onSelectedCellChange={(cell) => {
          console.log("Selected cell changed:", cell);
        }}
        onCellChange={handleChange}
        summary
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
