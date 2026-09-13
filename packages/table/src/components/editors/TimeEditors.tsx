import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { TIME_HOURS, TIME_MINUTES, TIME_SECONDS } from '../../core/dateTime';
import { TimeIcon } from '../../icons/gridIcons';
import type { TableLabels } from '../../types';

/**
 * Inline time editor used for both single time and time range cells.
 *
 * The text input remains the canonical draft so keyboard editing keeps working,
 * while the dropdown buttons provide fast hour/minute/second selection.
 */
export function CompactTimeEditor({ value, range, showSeconds, style, labels, onChange, onCommit, onCancel }: {
  value: string;
  range: boolean;
  showSeconds: boolean;
  style: CSSProperties;
  labels: TableLabels;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // For range values we still keep the outer input as one string so copy/paste
  // and direct typing match the cell's stored value. The dropdown, however,
  // edits each endpoint independently through this split array.
  const values = range ? value.split(' ~ ') : [value];
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const optionRefs = useRef<Array<Array<HTMLDivElement | null>>>([[], []]);
  const editorRef = useRef<HTMLDivElement>(null);
  const hasPositionedTimeRef = useRef(false);

  useEffect(() => {
    // The time dropdown is implemented locally rather than as a portal. Closing
    // on outside pointer keeps it behaving like the Ark popover editors.
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, []);

  useLayoutEffect(() => {
    if (!dropdownOpen) return;
    // Scroll the option columns to the current value when the menu opens. The
    // first positioning is instant so the user does not see a jump; later value
    // changes can animate subtly.
    const behavior = hasPositionedTimeRef.current ? 'smooth' : 'auto';
    values.forEach((time, index) => {
      const [hour = '00', minute = '00', second = '00'] = time.split(':');
      optionRefs.current[index]?.[0]?.scrollTo({ top: Math.max(0, Number(hour) * 28), behavior });
      optionRefs.current[index]?.[1]?.scrollTo({ top: Math.max(0, Number(minute) * 28), behavior });
      optionRefs.current[index]?.[2]?.scrollTo({ top: Math.max(0, Number(second) * 28), behavior });
    });
    hasPositionedTimeRef.current = true;
  }, [dropdownOpen, values]);

  const updatePart = (index: number, part: 'hour' | 'minute' | 'second', nextPart: string) => {
    // Rebuild only the edited time segment and then stitch the range string back
    // together for the grid draft. Seconds are included only when configured or
    // detected in the existing value.
    const [hour = '00', minute = '00', second = '00'] = values[index]?.split(':') ?? [];
    const nextTimeParts = [
      part === 'hour' ? nextPart : hour,
      part === 'minute' ? nextPart : minute,
    ];
    if (showSeconds) nextTimeParts.push(part === 'second' ? nextPart : second);
    const nextTime = nextTimeParts.join(':');
    const nextValues = [...values];
    nextValues[index] = nextTime;
    const nextValue = range ? `${nextValues[0] ?? ''} ~ ${nextValues[1] ?? ''}` : nextTime;
    onChange(nextValue);
  };

  return (
    <div ref={editorRef} className="rvg-time-editor" style={style} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Enter') onCommit();
      if (event.key === 'Escape') onCancel();
    }}>
      {(range ? [value] : values).map((part, index) => (
        <div className="rvg-time-field-group" key={index}>
          <input
            value={part}
            inputMode="numeric"
            autoFocus={index === 0}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ))}
      <button
        type="button"
        className="rvg-time-trigger"
        aria-label={dropdownOpen ? labels.collapseTimePicker : labels.expandTimePicker}
        aria-expanded={dropdownOpen}
        onClick={() => setDropdownOpen((open) => !open)}
      >
        <TimeIcon />
      </button>
      <div className={`rvg-time-dropdown${range ? ' is-range' : ''}${showSeconds ? ' has-seconds' : ''}${dropdownOpen ? ' is-open' : ''}`} aria-hidden={!dropdownOpen}>
        <div className="rvg-time-panels">
          {values.map((time, index) => {
            const [hour = '00', minute = '00', second = '00'] = time.split(':');
            return <section className="rvg-time-picker-panel" key={index}>
              {range && <strong>{index === 0 ? labels.startTime : labels.endTime}</strong>}
              <div className={`rvg-time-picker-columns${showSeconds ? ' has-seconds' : ''}`}>
                <span className="rvg-time-column-label">{labels.hour}</span>
                <span className="rvg-time-column-label">{labels.minute}</span>
                {showSeconds && <span className="rvg-time-column-label">{labels.second}</span>}
                <div className="rvg-time-options" ref={(node) => { optionRefs.current[index][0] = node; }} aria-label={labels.hour}>
                  {TIME_HOURS.map((option) => <button type="button" className={option === hour ? 'is-selected' : ''} key={option} onClick={() => updatePart(index, 'hour', option)}>{option}</button>)}
                </div>
                <div className="rvg-time-options" ref={(node) => { optionRefs.current[index][1] = node; }} aria-label={labels.minute}>
                  {TIME_MINUTES.map((option) => <button type="button" className={option === minute ? 'is-selected' : ''} key={option} onClick={() => updatePart(index, 'minute', option)}>{option}</button>)}
                </div>
                {showSeconds && <div className="rvg-time-options" ref={(node) => { optionRefs.current[index][2] = node; }} aria-label={labels.second}>
                  {TIME_SECONDS.map((option) => <button type="button" className={option === second ? 'is-selected' : ''} key={option} onClick={() => updatePart(index, 'second', option)}>{option}</button>)}
                </div>}
              </div>
            </section>;
          })}
        </div>
        <div className="rvg-time-footer">
          <button type="button" onClick={() => onCommit()}>{labels.confirm}</button>
        </div>
      </div>
    </div>
  );
}

export function DateTimePanel({ values, labels, showSeconds, onChange }: { values: string[]; labels: TableLabels; showSeconds: boolean; onChange: (values: string[]) => void }) {
  // Date-time ranges have two date-time strings. The active tab selects which
  // endpoint the shared hour/minute/second columns are editing.
  const [activeIndex, setActiveIndex] = useState(0);
  const activeValue = values[activeIndex] ?? '';
  const [, hour = '00', minute = '00', second = '00'] = activeValue.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?/) ?? [];
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);
  const secondsRef = useRef<HTMLDivElement>(null);
  const positionedRef = useRef(false);

  useLayoutEffect(() => {
    // Keep the selected time visible whenever the user switches between start
    // and end tabs or picks a new date with a different stored time.
    const behavior = positionedRef.current ? 'smooth' : 'auto';
    hoursRef.current?.scrollTo({ top: Number(hour) * 28, behavior });
    minutesRef.current?.scrollTo({ top: Number(minute) * 28, behavior });
    secondsRef.current?.scrollTo({ top: Number(second) * 28, behavior });
    positionedRef.current = true;
  }, [activeIndex, hour, minute, second]);

  const updatePart = (part: 'hour' | 'minute' | 'second', nextPart: string) => {
    // Preserve the date section and replace only the time token. If a malformed
    // or empty draft reaches this point, create a harmless placeholder date so
    // the user can continue editing instead of crashing the editor.
    const nextTimeParts = [
      part === 'hour' ? nextPart : hour,
      part === 'minute' ? nextPart : minute,
    ];
    if (showSeconds) nextTimeParts.push(part === 'second' ? nextPart : second);
    const nextTime = nextTimeParts.join(':');
    const nextValues = [...values];
    const current = nextValues[activeIndex] ?? '';
    nextValues[activeIndex] = /[T ]\d{2}:\d{2}(?::\d{2})?/.test(current)
      ? current.replace(/([T ])\d{2}:\d{2}(?::\d{2})?/, `$1${nextTime}`)
      : `${current || '1970-01-01'}T${nextTime}`;
    onChange(nextValues);
  };

  return (
    <div className="rvg-date-time-panel">
      {values.length > 1 && <div className="rvg-date-time-tabs">
        {values.map((_, index) => <button type="button" className={activeIndex === index ? 'is-active' : ''} key={index} onClick={() => setActiveIndex(index)}>{index === 0 ? labels.start : labels.end}</button>)}
      </div>}
      <div className={`rvg-date-time-columns${showSeconds ? ' has-seconds' : ''}`}>
        <span className="rvg-time-column-label">{labels.hour}</span>
        <span className="rvg-time-column-label">{labels.minute}</span>
        {showSeconds && <span className="rvg-time-column-label">{labels.second}</span>}
        <div className="rvg-time-options" ref={hoursRef} aria-label={labels.hour}>{TIME_HOURS.map((option) => <button type="button" className={option === hour ? 'is-selected' : ''} key={option} onClick={() => updatePart('hour', option)}>{option}</button>)}</div>
        <div className="rvg-time-options" ref={minutesRef} aria-label={labels.minute}>{TIME_MINUTES.map((option) => <button type="button" className={option === minute ? 'is-selected' : ''} key={option} onClick={() => updatePart('minute', option)}>{option}</button>)}</div>
        {showSeconds && <div className="rvg-time-options" ref={secondsRef} aria-label={labels.second}>{TIME_SECONDS.map((option) => <button type="button" className={option === second ? 'is-selected' : ''} key={option} onClick={() => updatePart('second', option)}>{option}</button>)}</div>}
      </div>
    </div>
  );
}
