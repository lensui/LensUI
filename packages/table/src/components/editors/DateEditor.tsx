import { useState, type CSSProperties, type PointerEvent } from 'react';
import { DatePicker, type DateValue } from '@ark-ui/react/date-picker';
import { Portal } from '@ark-ui/react/portal';
import { parseDate } from '@internationalized/date';
import { formatDateValue, inferDateFormat, parseFormattedDate, timeFormatHasSeconds } from '../../core/dateTime';
import { CalendarIcon, MonthStepIcon, YearStepIcon } from '../../icons/gridIcons';
import type { TableLabels } from '../../types';
import { DateTimePanel } from './TimeEditors';

export type DateEditorConfig = { type: 'date' | 'date-range' | 'date-time' | 'date-time-range' | 'year' | 'month'; format?: string };

interface DateEditorProps {
  editor: DateEditorConfig;
  value: string;
  style: CSSProperties;
  locale: string;
  labels: TableLabels;
  onChange: (value: string) => void;
  onCommit: (value?: string) => void;
  onCancel: () => void;
}

/**
 * Calendar-backed editor for date, month, year, date-time, and range cells.
 *
 * It keeps calendar selection, time selection, and free text editing in a
 * single draft string because the parent grid only commits one cell value.
 */
export function DateEditor({ editor, value: draft, style, locale, labels, onChange, onCommit, onCancel }: DateEditorProps) {
  // During range picking, Ark UI only has a committed start date until the user
  // clicks the second endpoint. This state stores the day currently under the
  // pointer so we can paint a live preview range.
  const [rangeHoverValue, setRangeHoverValue] = useState<DateValue>();

  // Collapse the editor union into booleans used throughout rendering. Keeping
  // these names close to the top makes the calendar branches easier to scan.
  const editorType = editor.type;
  const isRange = editorType === 'date-range' || editorType === 'date-time-range';
  const isYear = editorType === 'year';
  const isMonth = editorType === 'month';
  const isDateTime = editorType === 'date-time' || editorType === 'date-time-range';

  // The grid stores one string per cell. Range editors encode both endpoints in
  // that string with " ~ ", so the calendar receives a parsed array while the
  // parent continues to own a simple draft string.
  const parts = isRange ? draft.split(' ~ ') : [draft];
  const editorFormat = editor.format;
  const dateFormat = editorFormat ?? inferDateFormat(draft);
  let selectedDates: DateValue[];

  try {
    // DatePicker works with DateValue objects. Year and month editors still use
    // DateValue internally, anchoring missing precision to January / day 1.
    selectedDates = parts.filter(Boolean).map((part) => {
      if (isYear) return parseDate(`${part.slice(0, 4)}-01-01`);
      if (isMonth) return parseDate(`${part.slice(0, 7)}-01`);
      if (isDateTime) return parseDate(part.slice(0, 10).replace(/\//g, '-'));
      return parseFormattedDate(part, dateFormat);
    });
  } catch {
    selectedDates = [];
  }

  const formatSelectedValue = (date: DateValue, index: number) => {
    // Convert a picked date back to the cell's string format. Date-time editors
    // preserve the old time portion, because the side time panel edits that
    // portion independently from the calendar.
    if (isYear) return String(date.year).padStart(4, '0');
    if (isMonth) return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}`;
    if (isDateTime) {
      const original = parts[index] ?? '';
      const [, hour = '00', minute = '00', second = '00'] = original.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?/) ?? [];
      if (editorFormat) {
        // Custom format is authoritative. It may choose T or a space between
        // date and time, and may include seconds.
        return editorFormat
          .replace(/YYYY/g, String(date.year).padStart(4, '0'))
          .replace(/MM/g, String(date.month).padStart(2, '0'))
          .replace(/DD/g, String(date.day).padStart(2, '0'))
          .replace(/HH/g, hour)
          .replace(/mm/g, minute)
          .replace(/ss/g, second);
      }
      const separator = original.includes('/') ? '/' : '-';
      const datePart = [date.year, String(date.month).padStart(2, '0'), String(date.day).padStart(2, '0')].join(separator);
      // When no format is configured, keep the previous date/time token if it
      // exists; empty values default to the normal space-separated date-time
      // shape used by the public examples.
      const timePart = original.match(/[T ]\d{2}:\d{2}(?::\d{2})?/)?.[0] ?? ' 00:00';
      return `${datePart}${timePart}`;
    }
    return formatDateValue(date, dateFormat);
  };

  // Ark's DatePicker view controls are reused for year/month/day modes. The
  // min/max view locks the picker so a year editor cannot drill into months,
  // and a month editor cannot drill into days.
  const initialView = isYear ? 'year' : isMonth ? 'month' : 'day';
  const rangePreviewClass = (day: DateValue, month: DateValue) => {
    // Only style visible days from this month. Outside-range cells are rendered
    // by Ark for calendar alignment but should not become preview endpoints.
    const start = selectedDates[0];
    const end = selectedDates.length > 1 ? selectedDates[1] : rangeHoverValue;
    if (!start || !end) return undefined;
    if (day.year !== month.year || day.month !== month.month) return undefined;
    const lower = start.compare(end) <= 0 ? start : end;
    const upper = start.compare(end) <= 0 ? end : start;
    if (day.compare(lower) < 0 || day.compare(upper) > 0) return undefined;
    if (day.compare(start) === 0 || day.compare(end) === 0) return 'is-range-preview is-range-preview-end';
    return 'is-range-preview';
  };

  const updateRangeHover = (event: PointerEvent) => {
    // Pointer events may originate from nested text nodes inside Ark triggers.
    // Climbing to [data-value] gives us the DatePicker cell value regardless of
    // the exact DOM shape generated by Ark.
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (target?.hasAttribute('data-outside-range')) return;
    const rawValue = target?.dataset.value;
    if (!rawValue) return;
    try { setRangeHoverValue(parseDate(rawValue.slice(0, 10))); } catch { /* Ignore non-day targets. */ }
  };

  return (
    <DatePicker.Root
      className={`rvg-date-editor${isDateTime ? ' is-date-time' : ''}${isRange ? ' has-range-selection' : ''}${editorType === 'date-range' ? ' is-date-range' : ''}`}
      style={style}
      locale={locale}
      value={selectedDates}
      defaultOpen
      openOnClick
      startOfWeek={1}
      selectionMode={isRange ? 'range' : 'single'}
      numOfMonths={1}
      defaultView={initialView}
      minView={initialView}
      maxView={initialView}
      closeOnSelect={!isDateTime}
      positioning={{ placement: 'bottom-start' }}
      onValueChange={(details) => {
        // Empty changes are usually transient state while the user is navigating
        // the popover. Avoid committing blanks unless the user explicitly edits
        // the input text and confirms through the grid.
        if (details.value.length === 0) return;
        const next = details.value.map(formatSelectedValue).join(' ~ ');
        onChange(next);
        if (!isDateTime && (!isRange || details.value.length === 2)) onCommit(next);
      }}
    >
      <DatePicker.Control>
        <input
          className="rvg-date-value"
          value={isRange ? draft : parts[0] ?? ''}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !isDateTime) onCommit();
            if (event.key === 'Escape') onCancel();
          }}
        />
        <DatePicker.Trigger aria-label={labels.selectDate}><CalendarIcon /></DatePicker.Trigger>
      </DatePicker.Control>
      <Portal>
        {/* DatePicker popovers are portalled so they can escape the canvas/text
            stacking context. Theme variables are defined globally in CSS so the
            popup keeps its background even outside .rvg-root. */}
        <DatePicker.Positioner>
          <DatePicker.Content className={`rvg-date-content${isDateTime ? ' is-date-time' : ''}${isRange ? ' has-range-selection' : ''}${editorType === 'date-range' ? ' is-date-range' : ''}`}>
            <DatePicker.Context>
              {(datePicker) => (
                <DatePicker.View className={`rvg-date-view-${initialView}`} view={initialView}>
                  {editorType === 'date-range' ? <>
                    {/* date-range uses a custom two-month header so both months
                        can share one previous/next control row. */}
                    <DatePicker.ViewControl className="rvg-date-range-control">
                      <button type="button" className="rvg-year-step" aria-label={labels.previousYear} onClick={() => datePicker.setFocusedValue(datePicker.visibleRange.start.subtract({ years: 1 }))}><YearStepIcon direction="previous" /></button>
                      <button type="button" aria-label={labels.previousMonth} onClick={() => datePicker.setFocusedValue(datePicker.visibleRange.start.subtract({ months: 1 }))}><MonthStepIcon direction="previous" /></button>
                      {[0, 1].map((index) => {
                        const offset = datePicker.getOffset({ months: index });
                        return <strong key={index}>{datePicker.format(offset.visibleRange.start, { year: 'numeric', month: 'long' })}</strong>;
                      })}
                      <button type="button" aria-label={labels.nextMonth} onClick={() => datePicker.setFocusedValue(datePicker.visibleRange.start.add({ months: 1 }))}><MonthStepIcon direction="next" /></button>
                      <button type="button" className="rvg-year-step" aria-label={labels.nextYear} onClick={() => datePicker.setFocusedValue(datePicker.visibleRange.start.add({ years: 1 }))}><YearStepIcon direction="next" /></button>
                    </DatePicker.ViewControl>
                    <div className="rvg-date-range-months">
                      {[0, 1].map((index) => {
                        const offset = datePicker.getOffset({ months: index });
                        return <DatePicker.Table key={index} onPointerMoveCapture={updateRangeHover} onPointerLeave={() => setRangeHoverValue(undefined)}>
                          <DatePicker.TableHead><DatePicker.TableRow>{datePicker.weekDays.map((day) => <DatePicker.TableHeader key={day.short}>{day.narrow}</DatePicker.TableHeader>)}</DatePicker.TableRow></DatePicker.TableHead>
                          <DatePicker.TableBody>{offset.weeks.map((week, weekIndex) => <DatePicker.TableRow key={weekIndex}>{week.map((day) => <DatePicker.TableCell key={day.toString()} value={day} visibleRange={offset.visibleRange}><DatePicker.TableCellTrigger className={rangePreviewClass(day, offset.visibleRange.start)}>{day.day}</DatePicker.TableCellTrigger></DatePicker.TableCell>)}</DatePicker.TableRow>)}</DatePicker.TableBody>
                        </DatePicker.Table>;
                      })}
                    </div>
                  </> : <>
                    {/* Single month/year/date-time editors use Ark's built-in
                        visible range, with an extra year jump button for day
                        view to match the two-month range picker controls. */}
                    <DatePicker.ViewControl className={initialView === 'day' ? 'rvg-date-day-control' : undefined}>
                      {initialView === 'day' && <button type="button" className="rvg-year-step" aria-label={labels.previousYear} onClick={() => datePicker.setFocusedValue(datePicker.focusedValue.subtract({ years: 1 }))}><YearStepIcon direction="previous" /></button>}
                      <DatePicker.PrevTrigger aria-label={labels.previousPage}><MonthStepIcon direction="previous" /></DatePicker.PrevTrigger>
                      <DatePicker.ViewTrigger><DatePicker.RangeText /></DatePicker.ViewTrigger>
                      <DatePicker.NextTrigger aria-label={labels.nextPage}><MonthStepIcon direction="next" /></DatePicker.NextTrigger>
                      {initialView === 'day' && <button type="button" className="rvg-year-step" aria-label={labels.nextYear} onClick={() => datePicker.setFocusedValue(datePicker.focusedValue.add({ years: 1 }))}><YearStepIcon direction="next" /></button>}
                    </DatePicker.ViewControl>
                    {initialView === 'day' && <DatePicker.Table onPointerMoveCapture={isRange ? updateRangeHover : undefined} onPointerLeave={isRange ? () => setRangeHoverValue(undefined) : undefined}>
                      <DatePicker.TableHead><DatePicker.TableRow>{datePicker.weekDays.map((day) => <DatePicker.TableHeader key={day.short}>{day.narrow}</DatePicker.TableHeader>)}</DatePicker.TableRow></DatePicker.TableHead>
                      <DatePicker.TableBody>{datePicker.weeks.map((week, weekIndex) => <DatePicker.TableRow key={weekIndex}>{week.map((day) => <DatePicker.TableCell key={day.toString()} value={day}><DatePicker.TableCellTrigger className={isRange ? rangePreviewClass(day, datePicker.visibleRange.start) : undefined}>{day.day}</DatePicker.TableCellTrigger></DatePicker.TableCell>)}</DatePicker.TableRow>)}</DatePicker.TableBody>
                    </DatePicker.Table>}
                    {initialView === 'month' && <DatePicker.Table columns={4}><DatePicker.TableBody>{datePicker.getMonthsGrid({ columns: 4, format: 'short' }).map((months, rowIndex) => <DatePicker.TableRow key={rowIndex}>{months.map((month) => <DatePicker.TableCell key={month.value} value={month.value}><DatePicker.TableCellTrigger>{month.label}</DatePicker.TableCellTrigger></DatePicker.TableCell>)}</DatePicker.TableRow>)}</DatePicker.TableBody></DatePicker.Table>}
                    {initialView === 'year' && <DatePicker.Table columns={4}><DatePicker.TableBody>{datePicker.getYearsGrid({ columns: 4 }).map((years, rowIndex) => <DatePicker.TableRow key={rowIndex}>{years.map((year) => <DatePicker.TableCell key={year.value} value={year.value}><DatePicker.TableCellTrigger>{year.label}</DatePicker.TableCellTrigger></DatePicker.TableCell>)}</DatePicker.TableRow>)}</DatePicker.TableBody></DatePicker.Table>}
                  </>}
                </DatePicker.View>
              )}
            </DatePicker.Context>
            {/* Date-time editors add an adjacent time panel. Date-only editors
                commit immediately, so they do not need an explicit footer. */}
            {isDateTime && <DateTimePanel values={parts} labels={labels} showSeconds={timeFormatHasSeconds(editorFormat, draft)} onChange={(nextParts) => onChange(nextParts.join(' ~ '))} />}
            {isDateTime && <div className="rvg-date-footer">
              <button type="button" disabled={isRange ? parts.length < 2 || parts.some((part) => !part) : !parts[0]} onClick={() => onCommit()}>{labels.confirm}</button>
            </div>}
          </DatePicker.Content>
        </DatePicker.Positioner>
      </Portal>
    </DatePicker.Root>
  );
}
