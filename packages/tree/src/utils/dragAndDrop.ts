import type { DragMode, DropPosition, ResolvedTreeNodeData as TreeNodeData, TreeKey } from '../types.js';

const TREE_DRAG_TYPE = 'lensui/tree-node';

interface TreeDragData extends Record<PropertyKey, unknown> {
  type: typeof TREE_DRAG_TYPE;
  scope: string;
  node: TreeNodeData;
  /** 源节点从根到父节点的路径，用来判断目标是否与源节点同级。 */
  parentKeys: TreeKey[];
}

/** 为 Pragmatic Drag and Drop 创建带作用域的数据，避免多个 Tree 实例互相干扰。 */
export function createTreeDragData(node: TreeNodeData, scope: string, parentKeys: TreeKey[] = []): TreeDragData {
  return { type: TREE_DRAG_TYPE, scope, node, parentKeys };
}

/** Pragmatic DnD 的 data 有意使用 unknown；所有读取都集中在此处完成运行时校验。 */
export function getTreeDragData(data: Record<string | symbol, unknown>, scope: string): TreeDragData | undefined {
  if (data.type !== TREE_DRAG_TYPE || data.scope !== scope) return undefined;
  const node = data.node;
  const parentKeys = data.parentKeys;
  if (!isTreeNodeData(node) || !Array.isArray(parentKeys) || !parentKeys.every(isTreeKey)) return undefined;
  return { type: TREE_DRAG_TYPE, scope, node, parentKeys };
}

function isTreeKey(value: unknown): value is TreeKey {
  return typeof value === 'string' || typeof value === 'number';
}

function isTreeNodeData(value: unknown): value is TreeNodeData {
  if (!value || typeof value !== 'object' || !('key' in value) || !('title' in value)) return false;
  return isTreeKey(value.key);
}

/** 数字 key 与字符串 key 不等价；路径必须逐级完全一致才属于同一个父节点。 */
export function isSameParentPath(sourceParentKeys: TreeKey[], targetParentKeys: TreeKey[]): boolean {
  return sourceParentKeys.length === targetParentKeys.length
    && sourceParentKeys.every((key, index) => typeof key === typeof targetParentKeys[index] && String(key) === String(targetParentKeys[index]));
}

/** 在同级排序模式中拒绝所有跨父节点目标；自由嵌套模式不限制父路径。 */
export function isDropAllowedByMode(mode: DragMode, sourceParentKeys: TreeKey[], targetParentKeys: TreeKey[]): boolean {
  return mode === 'nested' || isSameParentPath(sourceParentKeys, targetParentKeys);
}

/** 根据目标的祖先路径判断拖拽源是否为其祖先；命中检测只与深度相关。 */
export function pathContainsTreeKey(parentKeys: readonly TreeKey[], targetKey: TreeKey): boolean {
  return parentKeys.some((key) => typeof key === typeof targetKey && String(key) === String(targetKey));
}

/** 判断目标是否位于拖拽源的子树中，所有模式都应拒绝这种会制造循环结构的落点。 */
export function containsTreeNode(sourceNode: TreeNodeData, targetKey: TreeKey): boolean {
  const stack = [...(sourceNode.children ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node.key === typeof targetKey && String(node.key) === String(targetKey)) return true;
    if (node.children?.length) stack.push(...node.children);
  }
  return false;
}

/** 同级排序只把节点分成上、下两块热区，不生成中间的 inside 热区。 */
export function getDropOperations(mode: DragMode) {
  return mode === 'same-level'
    ? { 'reorder-before': 'available' as const, combine: 'not-available' as const, 'reorder-after': 'available' as const }
    : { 'reorder-before': 'available' as const, combine: 'available' as const, 'reorder-after': 'available' as const };
}

export function instructionToDropPosition(operation: 'reorder-before' | 'reorder-after' | 'combine'): DropPosition {
  if (operation === 'reorder-before') return 'before';
  if (operation === 'reorder-after') return 'after';
  return 'inside';
}
