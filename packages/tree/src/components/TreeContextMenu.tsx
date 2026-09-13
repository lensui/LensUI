import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ResolvedTreeNodeData as TreeNodeData, TreeMenuItem } from '../types.js';
import { keyId } from '../utils/tree.js';

const useSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function TreeContextMenu({ items, x, y, node, close }: { items: TreeMenuItem[]; x: number; y: number; node: TreeNodeData; close: (restoreFocus?: boolean) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useSafeLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [items.length, x, y]);

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [close]);

  const moveFocus = (direction: 1 | -1) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
  };

  const nodeLabel = node.searchText ?? (typeof node.title === 'string' || typeof node.title === 'number' ? String(node.title) : String(node.key));
  return <div ref={menuRef} role="menu" aria-label={`Actions for ${nodeLabel}`} className="rc-tree__menu" style={{ left: position.x, top: position.y }}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); }
      else if (event.key === 'Home') { event.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
      else if (event.key === 'End') { event.preventDefault(); const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]; buttons[buttons.length - 1]?.focus(); }
      else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); close(event.key === 'Escape'); }
    }}>
    {items.map((item) => <button type="button" role="menuitem" key={keyId(item.key)} disabled={item.disabled}
      className={item.danger ? 'rc-tree__menu-item--danger' : ''} onClick={() => { item.onClick?.(node); close(true); }}>{item.label}</button>)}
  </div>;
}
