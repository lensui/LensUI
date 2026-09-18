import { useMemo, useState } from 'react';
import { Tree, type DropPosition, type ResolvedTreeNodeData, type TreeKey, type TreeNodeData } from '../../src';
import '../../src/style.css';

type DemoNode = TreeNodeData & {
  id: string;
  title: string;
  kind: 'workspace' | 'folder' | 'file';
  detail?: string;
  children?: DemoNode[];
};

const initialData: DemoNode[] = [
  {
    id: 'lens-ui', title: 'LensUI', kind: 'workspace', detail: 'workspace', children: [
      {
        id: 'packages', title: 'packages', kind: 'folder', children: [
          {
            id: 'table', title: 'table', kind: 'folder', children: [
              { id: 'table-src', title: 'src', kind: 'folder', children: [
                { id: 'table-component', title: 'Table.tsx', kind: 'file', detail: '42 KB', isLeaf: true },
                { id: 'table-types', title: 'types.ts', kind: 'file', detail: '18 KB', isLeaf: true },
                { id: 'table-style', title: 'style.css', kind: 'file', detail: '31 KB', isLeaf: true },
              ] },
              { id: 'table-package', title: 'package.json', kind: 'file', detail: '2 KB', isLeaf: true },
            ],
          },
          {
            id: 'tree', title: 'tree', kind: 'folder', children: [
              { id: 'tree-src', title: 'src', kind: 'folder', children: [
                { id: 'tree-component', title: 'Tree.tsx', kind: 'file', detail: '19 KB', isLeaf: true },
                { id: 'tree-row', title: 'TreeRow.tsx', kind: 'file', detail: '17 KB', isLeaf: true },
                { id: 'tree-types', title: 'types.ts', kind: 'file', detail: '15 KB', isLeaf: true },
              ] },
              { id: 'tree-readme', title: 'README.md', kind: 'file', detail: '12 KB', isLeaf: true },
              { id: 'tree-package', title: 'package.json', kind: 'file', detail: '1 KB', isLeaf: true },
            ],
          },
        ],
      },
      { id: 'root-package', title: 'package.json', kind: 'file', detail: '2 KB', isLeaf: true },
      { id: 'readme', title: 'README.md', kind: 'file', detail: '4 KB', isLeaf: true },
    ],
  },
  {
    id: 'examples', title: 'Examples', kind: 'workspace', detail: 'workspace', children: [
      { id: 'dashboard', title: 'Dashboard.tsx', kind: 'file', detail: '9 KB', isLeaf: true },
      { id: 'settings', title: 'Settings.tsx', kind: 'file', detail: '7 KB', isLeaf: true },
    ],
  },
];

function mapNodes(nodes: DemoNode[], update: (node: DemoNode) => DemoNode): DemoNode[] {
  return nodes.map((node) => update(node.children
    ? { ...node, children: mapNodes(node.children, update) }
    : { ...node }));
}

function removeNode(nodes: DemoNode[], key: TreeKey): { nodes: DemoNode[]; removed?: DemoNode } {
  let removed: DemoNode | undefined;
  const next = nodes.flatMap((node) => {
    if (node.id === key) {
      removed = node;
      return [];
    }
    if (!node.children) return [node];
    const result = removeNode(node.children, key);
    if (result.removed) removed = result.removed;
    return [{ ...node, children: result.nodes }];
  });
  return removed ? { nodes: next, removed } : { nodes: next };
}

function insertNode(nodes: DemoNode[], targetKey: TreeKey, node: DemoNode, position: DropPosition): DemoNode[] {
  if (position === 'inside') {
    return nodes.map((item) => item.id === targetKey
      ? { ...item, isLeaf: false, children: [...(item.children ?? []), node] }
      : item.children
        ? { ...item, children: insertNode(item.children, targetKey, node, position) }
        : item);
  }
  const targetIndex = nodes.findIndex((item) => item.id === targetKey);
  if (targetIndex >= 0) {
    const next = nodes.slice();
    next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, node);
    return next;
  }
  return nodes.map((item) => item.children
    ? { ...item, children: insertNode(item.children, targetKey, node, position) }
    : item);
}

function findNode(nodes: DemoNode[], key: TreeKey): DemoNode | undefined {
  for (const node of nodes) {
    if (node.id === key) return node;
    const child = node.children ? findNode(node.children, key) : undefined;
    if (child) return child;
  }
  return undefined;
}

export default function App() {
  const [data, setData] = useState(initialData);
  const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>(['lens-ui', 'packages', 'tree', 'tree-src']);
  const [selectedKeys, setSelectedKeys] = useState<TreeKey[]>(['tree-component']);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('multiple');
  const [editingKey, setEditingKey] = useState<TreeKey | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [virtual, setVirtual] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [lastEvent, setLastEvent] = useState('Demo ready');

  const selectedNodes = useMemo(
    () => selectedKeys.flatMap((key) => findNode(data, key) ?? []),
    [data, selectedKeys],
  );

  const reset = () => {
    setData(initialData);
    setExpandedKeys(['lens-ui', 'packages', 'tree', 'tree-src']);
    setSelectedKeys(['tree-component']);
    setEditingKey(null);
    setLastEvent('Demo reset');
  };

  const renameNode = (node: ResolvedTreeNodeData, title: string) => {
    setData((current) => mapNodes(current, (item) => item.id === node.key ? { ...item, title } : item));
    setLastEvent(`Renamed ${String(node.title)} to ${title}`);
  };

  const deleteNode = (node: ResolvedTreeNodeData) => {
    setData((current) => removeNode(current, node.key).nodes);
    setSelectedKeys((current) => current.filter((key) => key !== node.key));
    setLastEvent(`Deleted ${String(node.title)}`);
  };

  return (
    <main className="demo-shell">
      <header className="demo-header">
        <div>
          <h1>Tree</h1>
          <p>Interactive component workbench</p>
        </div>
        <button type="button" className="reset-button" onClick={reset}>重置数据</button>
      </header>

      <div className="demo-workspace">
        <section className="tree-panel" aria-label="Tree preview">
          <div className="panel-heading">
            <div>
              <h2>项目文件</h2>
              <span>{data.length} 个工作区</span>
            </div>
            <span className="status-dot">Live</span>
          </div>
          <div className="tree-frame">
            <Tree
              aria-label="Project files"
              data={data}
              readOnly={readOnly}
              expansion={{
                keys: expandedKeys,
                onChange: (keys, node, expanded) => {
                  setExpandedKeys(keys);
                  setLastEvent(`${expanded ? 'Expanded' : 'Collapsed'} ${String(node.title)}`);
                },
              }}
              selection={{
                mode: selectionMode,
                keys: selectedKeys,
                showIcon: true,
                onChange: (keys, node, selected) => {
                  setSelectedKeys(keys);
                  setLastEvent(`${selected ? 'Selected' : 'Deselected'} ${String(node.title)}`);
                },
              }}
              search={{ placeholder: '搜索文件或目录' }}
              drag={{
                mode: 'nested',
                onDrop: ({ dragNode, targetNode, position }) => {
                  setData((current) => {
                    const result = removeNode(current, dragNode.key);
                    return result.removed ? insertNode(result.nodes, targetNode.key, result.removed, position) : current;
                  });
                  setLastEvent(`Moved ${String(dragNode.title)} ${position} ${String(targetNode.title)}`);
                },
              }}
              rename={{ editingKey, onEditingKeyChange: setEditingKey, onChange: renameNode }}
              appearance={{ lines: showLines, lineStyle: 'solid', icons: { showNode: true, color: '#1677ff' } }}
              renderers={{
                title: (node, highlightedTitle) => (
                  <span className="node-title">
                    <span>{highlightedTitle}</span>
                    {(node as DemoNode).kind === 'workspace' && <span className="node-badge">workspace</span>}
                    {(node as DemoNode).detail && <span className="node-detail">{(node as DemoNode).detail}</span>}
                  </span>
                ),
                actions: (node, openMenu) => (
                  <button type="button" className="node-menu-button" aria-label={`Open ${String(node.title)} menu`} title="节点操作" onClick={openMenu}>...</button>
                ),
                menu: (node) => [
                  { key: 'rename', label: '重命名', onClick: () => setEditingKey(node.key) },
                  { key: 'delete', label: '删除', danger: true, disabled: node.key === 'lens-ui', onClick: () => deleteNode(node) },
                ],
              }}
              virtual={virtual ? { height: 420, itemHeight: 34, overscan: 4 } : false}
            />
          </div>
        </section>

        <aside className="inspector" aria-label="Tree controls">
          <section className="control-section">
            <h2>选择</h2>
            <div className="segmented" role="group" aria-label="Selection mode">
              <button type="button" className={selectionMode === 'single' ? 'is-active' : ''} onClick={() => { setSelectionMode('single'); setSelectedKeys((keys) => keys.slice(0, 1)); }}>单选</button>
              <button type="button" className={selectionMode === 'multiple' ? 'is-active' : ''} onClick={() => setSelectionMode('multiple')}>多选</button>
            </div>
          </section>

          <section className="control-section">
            <h2>行为</h2>
            <label className="toggle-row"><span>显示辅助线</span><input type="checkbox" checked={showLines} onChange={(event) => setShowLines(event.target.checked)} /></label>
            <label className="toggle-row"><span>虚拟滚动</span><input type="checkbox" checked={virtual} onChange={(event) => setVirtual(event.target.checked)} /></label>
            <label className="toggle-row"><span>只读模式</span><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} /></label>
          </section>

          <section className="control-section selection-output">
            <h2>已选择 <span>{selectedKeys.length}</span></h2>
            {selectedNodes.length ? selectedNodes.map((node) => (
              <div className="selected-item" key={node.id}>
                <span>{node.title}</span>
                <code>{node.id}</code>
              </div>
            )) : <p className="empty-copy">暂无选择</p>}
          </section>

          <section className="control-section event-output" aria-live="polite">
            <h2>最近事件</h2>
            <p>{lastEvent}</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
