import type { CSSProperties } from 'react';

/**
 * Centralized SVG icons used by the grid chrome and editors.
 *
 * Keeping the SVG paths here prevents the main grid component from mixing
 * rendering logic with vector asset details. The class names stay unchanged so
 * the existing CSS remains the single source of visual styling.
 */

/** Date and time editor trigger icon. */
export function CalendarIcon() {
  return (
    <svg className="rvg-calendar-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M825.94 181.85H741.7v-54.42c0-15.79-12.22-28.6-27.3-28.6s-27.3 12.81-27.3 28.6v54.42H336.9v-54.42c0-15.79-12.22-28.6-27.3-28.6s-27.3 12.81-27.3 28.6v54.42h-84.24c-45.16 0-81.9 38.49-81.9 85.8v571.73c0 47.31 36.74 85.79 81.9 85.79h627.88c45.16 0 81.9-38.48 81.9-85.79V267.65c-.01-47.31-36.74-85.8-81.9-85.8zm-627.88 57.2h84.24v50.65c0 15.79 12.22 28.6 27.3 28.6s27.3-12.8 27.3-28.6v-50.65h350.2v50.65c0 15.79 12.22 28.6 27.3 28.6s27.3-12.8 27.3-28.6v-50.65h84.24c15.06 0 27.3 12.82 27.3 28.6v138.93H170.76V267.65c0-15.78 12.25-28.6 27.3-28.6zm627.88 628.92H198.06c-15.06 0-27.3-12.83-27.3-28.6v-375.6h682.47v375.6c.01 15.77-12.24 28.6-27.29 28.6z" />
      <path d="M641.08 629.99H382.92c-15.08 0-27.3 12.8-27.3 28.6s12.22 28.6 27.3 28.6h258.15c15.08 0 27.3-12.8 27.3-28.6s-12.22-28.6-27.29-28.6z" />
    </svg>
  );
}

/** Double-arrow calendar navigation used for year jumps. */
export function YearStepIcon({ direction }: { direction: 'previous' | 'next' }) {
  const paths = direction === 'previous'
    ? ['M10.5 3.5 6 8l4.5 4.5', 'M15 3.5 10.5 8l4.5 4.5']
    : ['M5 3.5 9.5 8 5 12.5', 'M9.5 3.5 14 8l-4.5 4.5'];
  return (
    <svg className="rvg-calendar-step-icon" viewBox="0 0 20 16" aria-hidden="true">
      {paths.map((path) => <path d={path} key={path} />)}
    </svg>
  );
}

/** Single-arrow calendar navigation used for month jumps. */
export function MonthStepIcon({ direction }: { direction: 'previous' | 'next' }) {
  const path = direction === 'previous' ? 'M12.25 3.5 7.75 8l4.5 4.5' : 'M7.75 3.5 12.25 8l-4.5 4.5';
  return (
    <svg className="rvg-calendar-step-icon" viewBox="0 0 20 16" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** Clock icon for compact time-only editors. */
export function TimeIcon() {
  return (
    <svg className="rvg-time-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.7v3.6l2.4 1.4" />
    </svg>
  );
}

/** Clear current editor value. */
export function ClearValueIcon() {
  return (
    <svg className="rvg-clear-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5" />
    </svg>
  );
}

/** Dropdown affordance for choice cells. */
export function ChoiceChevronIcon() {
  return (
    <svg className="rvg-choice-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

/** Selected option marker inside the choice list. */
export function ChoiceCheckIcon() {
  return (
    <svg className="rvg-choice-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8 2.6 2.6L12.5 4" />
    </svg>
  );
}

/** Column reorder handle shown in headers when column dragging is enabled. */
export function HeaderDragIcon({ className, style }: { className: string; style: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="2.5" r="1.25" /><circle cx="7" cy="7" r="1.25" /><circle cx="7" cy="11.5" r="1.25" />
    </svg>
  );
}

/** Sort indicator with independent active states for ascending/descending. */
export function HeaderSortIcon({ className, style, direction }: { className: string; style: CSSProperties; direction: 'asc' | 'desc' | null }) {
  return (
    <svg className={className} style={style} viewBox="0 0 14 14" aria-hidden="true">
      <path className={direction === 'asc' ? 'is-active' : ''} d="M3 5.5 7 1.5l4 4Z" />
      <path className={direction === 'desc' ? 'is-active' : ''} d="M3 8.5 7 12.5l4-4Z" />
    </svg>
  );
}

/** Header filter/search trigger. */
export function HeaderSearchIcon({ className, style }: { className: string; style: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4.25" /><path d="m8.75 8.75 2.25 2.25" />
    </svg>
  );
}

/**
 * Shared selection glyph for checkbox and radio modes.
 *
 * The visual state is expressed with class names so theme tokens can recolor
 * selected, indeterminate, and inactive states without changing the SVG paths.
 */
export function SelectionIcon({ checked, indeterminate = false, radio = false }: { checked: boolean; indeterminate?: boolean; radio?: boolean }) {
  if (radio) {
    return (
      <svg className={`rvg-selection-svg rvg-radio-svg${checked ? ' is-active' : ''}`} viewBox="0 0 16 16" focusable="false" aria-hidden="true">
        <circle className="rvg-selection-outline" cx="8" cy="8" r="6.25" />
        {checked && <circle className="rvg-selection-dot" cx="8" cy="8" r="3.25" />}
      </svg>
    );
  }
  return (
    <svg className={`rvg-selection-svg rvg-checkbox-svg${checked || indeterminate ? ' is-active' : ''}`} viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <rect className="rvg-selection-outline" x="1.5" y="1.5" width="13" height="13" rx="3" />
      {indeterminate
        ? <path className="rvg-selection-mark" d="M4.25 8h7.5" />
        : checked && <path className="rvg-selection-mark" d="m4.1 8 2.35 2.35 5.45-5.2" />}
    </svg>
  );
}

/** Arrow used by context menu items that open a nested submenu. */
export function SubmenuArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

export function ContextMenuIcon({ type }: { type: 'edit' | 'copy' | 'undo' | 'clear' | 'annotation' | 'remove-annotation' | 'select-row' | 'select-column' | 'insert-above' | 'insert-below' | 'move-up' | 'move-down' | 'delete' }) {
  if (type === 'remove-annotation') {
    return (
      <svg className="rvg-context-menu-svg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.4 3.5h9.2v6.5H7.5L4 13v-3H3.4Z" />
        <path d="M2.6 6.8h10.8" />
      </svg>
    );
  }
  const paths: Record<typeof type, string[]> = {
    edit: ['M4 11.5 4.5 8.8 10.8 2.5a1.4 1.4 0 0 1 2 2L6.5 10.8 4 11.5Z', 'M9.8 3.5l2.7 2.7'],
    copy: ['M5.5 5.5h6v6h-6Z', 'M3.5 9.5h-1v-7h7v1'],
    undo: ['M5.5 5 3 7.5 5.5 10', 'M3.2 7.5H9a3 3 0 1 1 0 6H6.5'],
    clear: ['M4 4 12 12', 'M12 4 4 12'],
    annotation: ['M3.5 3.5h9v6.5h-5L4 13v-3H3.5Z'],
    'select-row': ['M3 4.5h10', 'M3 8h10', 'M3 11.5h10'],
    'select-column': ['M4.5 3v10', 'M8 3v10', 'M11.5 3v10'],
    'insert-above': ['M8 12.5v-7', 'M5.5 8 8 5.5 10.5 8', 'M3 3.5h10'],
    'insert-below': ['M8 3.5v7', 'M5.5 8 8 10.5 10.5 8', 'M3 12.5h10'],
    'move-up': ['M8 12.5v-9', 'M4.5 7 8 3.5 11.5 7'],
    'move-down': ['M8 3.5v9', 'M4.5 9 8 12.5 11.5 9'],
    delete: ['M3.5 4.5h9', 'M6 4.5v-1h4v1', 'M5 6.5v6h6v-6'],
  };
  return (
    <svg className="rvg-context-menu-svg" viewBox="0 0 16 16" aria-hidden="true">
      {paths[type].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

/** Left-side row drag handle rendered in utility cells. */
export function RowDragHandleIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false">
      <circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" />
      <circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" />
      <circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" />
    </svg>
  );
}

/** Lightweight loading spinner used by the empty/loading overlay. */
export function LoadingSpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-3.1-6.3" />
    </svg>
  );
}
