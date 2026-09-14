import type { CSSProperties } from 'react';
import { Portal } from '@ark-ui/react/portal';
import { Select, createListCollection } from '@ark-ui/react/select';
import { ChoiceCheckIcon, ChoiceChevronIcon } from '../../icons/gridIcons';
import type { TableLabels } from '../../types';

interface ChoiceEditorProps {
  value: string;
  options: Array<{ label: string; value: string }>;
  style: CSSProperties;
  labels: TableLabels;
  onChange: (value: string) => void;
  onCommit: (value?: string) => void;
  onCancel: () => void;
}

/**
 * Select-style cell editor.
 *
 * Ark UI owns focus management and popover positioning; this wrapper only
 * adapts the grid draft lifecycle to the select component API.
 */
export function ChoiceEditor({ value, options, style, labels, onChange, onCommit, onCancel }: ChoiceEditorProps) {
  const editorStyle = typeof style.width === 'number'
    ? { ...style, width: Math.max(0, style.width - 1) }
    : style;
  // Ark Select expects a collection object rather than a raw array. We build it
  // locally so the parent grid can stay editor-agnostic and only pass column
  // metadata plus the current draft value.
  const collection = createListCollection({
    items: options,
    itemToValue: (item) => item.value,
    itemToString: (item) => item.label,
  });
  return (
    <Select.Root
      className="rvg-choice-editor"
      style={editorStyle}
      collection={collection}
      value={value ? [value] : []}
      defaultOpen
      closeOnSelect
      lazyMount
      unmountOnExit
      // Keep the menu aligned to the edited cell width. Ark UI owns the actual
      // floating positioning, including portal placement and focus movement.
      positioning={{ sameWidth: true, placement: 'bottom-start' }}
      onSelect={(details) => {
        onChange(details.value);
        onCommit(details.value);
      }}
      onValueChange={(details) => onChange(details.value[0] ?? '')}
      onKeyDown={(event) => {
        // Stop editor keystrokes from bubbling to the grid-level keyboard
        // navigation handler. Escape closes only this editor.
        event.stopPropagation();
        if (event.key === 'Escape') onCancel();
      }}
      onKeyUp={(event) => {
        // Ark Select finalizes highlighted options on keydown. Committing on
        // keyup lets the selected option reach the draft before the grid saves.
        event.stopPropagation();
        if (event.key === 'Enter') onCommit();
      }}
    >
      <Select.Control>
        <Select.Trigger autoFocus>
          <Select.ValueText placeholder={labels.choose} />
          <Select.Indicator><ChoiceChevronIcon /></Select.Indicator>
        </Select.Trigger>
      </Select.Control>
      <Portal>
        {/* Popovers render outside the grid DOM tree, so their z-index and theme
            tokens are handled in the shared stylesheet rather than inherited
            from the inline editor wrapper. */}
        <Select.Positioner>
          <Select.Content className="rvg-choice-content">
            {options.map((option) => (
              <Select.Item className="rvg-choice-item" key={option.value} item={option}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator><ChoiceCheckIcon /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
      <Select.HiddenSelect />
    </Select.Root>
  );
}
