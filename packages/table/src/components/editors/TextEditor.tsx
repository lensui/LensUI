import type { CSSProperties, KeyboardEvent } from 'react';
import { ClearValueIcon } from '../../icons/gridIcons';
import type { TableLabels } from '../../types';
import { CELL_FONT } from '../../core/typography';

interface TextEditorProps {
  value: string;
  type: 'text' | 'number';
  style: CSSProperties;
  labels: TableLabels;
  onChange: (value: string) => void;
  onCommit: (value?: string) => void;
  onCancel: () => void;
}

/**
 * Fallback editor for plain text and numeric cells.
 */
export function TextEditor({ value, type, style, labels, onChange, onCommit, onCancel }: TextEditorProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') onCommit();
    if (event.key === 'Escape') onCancel();
  };

  return (
    <div className="rvg-native-editor has-clear" style={style}>
      <input
        type={type}
        style={{ font: CELL_FONT, textAlign: style.textAlign }}
        value={value}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <button
          type="button"
          className="rvg-clear-trigger"
          aria-label={labels.clearContent}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => {
            onChange('');
            onCommit('');
          }}
        >
          <ClearValueIcon />
        </button>
      )}
    </div>
  );
}
