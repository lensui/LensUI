import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import type { FlatTreeNode, ResolvedTreeNodeData as TreeNodeData, TreeKey } from '../types.js';
import { keyId, type CompactFlatTreeNode, type TreeIndex } from '../utils/tree.js';
import type { ResolvedTreeProps } from '../components/treeConfig.js';

interface KeyboardNavigationOptions {
  renderedFlat: readonly CompactFlatTreeNode[];
  virtual: boolean;
  height: number;
  rowStride: number;
  treeIndex: TreeIndex;
  props: ResolvedTreeProps;
  viewportRef: { current: HTMLDivElement | null };
  updateVirtualRange: (scrollTop: number, defer?: boolean) => void;
  load: (node: TreeNodeData) => void;
  toggle: (node: TreeNodeData) => void;
  select: (node: TreeNodeData) => void;
  openMenu: (event: KeyboardEvent<HTMLElement>, node: TreeNodeData, source: 'trigger') => void;
}

/** Roving tabindex、方向键导航以及虚拟列表聚焦滚动。 */
export function useTreeKeyboardNavigation(options: KeyboardNavigationOptions) {
  const [focusedKey, setFocusedKey] = useState<TreeKey>();
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const positionsCacheRef = useRef<{ items: readonly CompactFlatTreeNode[]; positions: Map<string, number> } | undefined>(undefined);
  const latestRef = useRef(options);
  latestRef.current = options;

  const getRenderedPosition = useCallback((items: readonly CompactFlatTreeNode[], id: string) => {
    let cache = positionsCacheRef.current;
    if (cache?.items !== items) {
      const positions = new Map<string, number>();
      items.forEach((item, index) => positions.set(keyId(item.node.key), index));
      cache = { items, positions };
      positionsCacheRef.current = cache;
    }
    return cache.positions.get(id) ?? -1;
  }, []);

  const registerRowElement = useCallback((key: TreeKey, element: HTMLDivElement | null) => {
    const id = keyId(key);
    if (element) rowElementsRef.current.set(id, element);
    else rowElementsRef.current.delete(id);
  }, []);

  const focusRow = useCallback((key: TreeKey) => {
    const current = latestRef.current;
    const id = keyId(key);
    setFocusedKey(key);
    const index = getRenderedPosition(current.renderedFlat, id);
    const viewport = current.viewportRef.current;
    if (current.virtual && viewport && index >= 0) {
      const top = index * current.rowStride;
      const bottom = top + current.rowStride;
      let nextScrollTop = viewport.scrollTop;
      if (top < viewport.scrollTop) nextScrollTop = top;
      else if (bottom > viewport.scrollTop + current.height) nextScrollTop = bottom - current.height;
      if (nextScrollTop !== viewport.scrollTop) {
        viewport.scrollTop = nextScrollTop;
        current.updateVirtualRange(nextScrollTop);
      }
    }
    const applyFocus = () => rowElementsRef.current.get(id)?.focus();
    applyFocus();
    window.setTimeout(applyFocus, 0);
  }, [getRenderedPosition]);

  const handleRowKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, item: FlatTreeNode, expanded: boolean) => {
    const current = latestRef.current;
    const items = current.renderedFlat;
    const index = getRenderedPosition(items, keyId(item.node.key));
    if (index < 0) return;
    const hasChildren = Boolean(item.node.children?.length) || (!item.node.isLeaf && Boolean(current.props.loadData));

    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      current.openMenu(event, item.node, 'trigger');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[Math.min(items.length - 1, index + 1)];
      if (next) focusRow(next.node.key);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previous = items[Math.max(0, index - 1)];
      if (previous) focusRow(previous.node.key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      if (items[0]) focusRow(items[0].node.key);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = items[items.length - 1];
      if (last) focusRow(last.node.key);
    } else if (event.key === 'ArrowRight' && hasChildren) {
      event.preventDefault();
      if (!expanded) {
        if (!item.node.children?.length && current.props.loadData) current.load(item.node);
        current.toggle(item.node);
      } else {
        const firstChild = items[index + 1];
        if (firstChild?.level === item.level + 1) focusRow(firstChild.node.key);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren && expanded) current.toggle(item.node);
      else {
        const parent = current.treeIndex.parentKeys.get(keyId(item.node.key));
        if (parent !== undefined) focusRow(parent);
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && !item.disabled) {
      event.preventDefault();
      current.select(item.node);
    }
  }, [focusRow, getRenderedPosition]);

  return { focusedKey, setFocusedKey, registerRowElement, handleRowKeyDown };
}
