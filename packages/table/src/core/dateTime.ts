import { parseDate, type DateValue } from '@internationalized/date';

// Precomputed option lists keep the time editors cheap to render and ensure all
// time columns use the same zero-padded value shape.
export const TIME_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
export const TIME_MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
export const TIME_SECONDS = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

/**
 * Infers the user's date shape from the current cell value.
 *
 * Editors may be configured without an explicit format. In that case we keep
 * the visible separator and year position from the original value so committing
 * a new date does not unexpectedly rewrite the user's preferred display style.
 */
export function inferDateFormat(value: string): string {
  const sample = value.split(' ~ ')[0]?.trim() ?? '';
  const yearFirst = sample.match(/^\d{4}([^\d])\d{1,2}\1\d{1,2}$/);
  if (yearFirst) return `YYYY${yearFirst[1]}MM${yearFirst[1]}DD`;
  const yearLast = sample.match(/^\d{1,2}([^\d])\d{1,2}\1\d{4}$/);
  if (yearLast) return `MM${yearLast[1]}DD${yearLast[1]}YYYY`;
  return 'YYYY-MM-DD';
}

/**
 * Parses a date using the grid's small formatting vocabulary.
 *
 * We intentionally support only YYYY/MM/DD tokens used by the public editor
 * API. Keeping this parser narrow makes failed user input easy to reason about.
 */
export function parseFormattedDate(value: string, format: string): DateValue {
  const tokens = ['YYYY', 'MM', 'DD'] as const;
  const groups: string[] = [];
  let source = '';
  for (let index = 0; index < format.length;) {
    const token = tokens.find((candidate) => format.startsWith(candidate, index));
    if (token) {
      groups.push(token);
      source += token === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})';
      index += token.length;
    } else {
      source += format[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      index += 1;
    }
  }
  const match = value.trim().match(new RegExp(`^${source}$`));
  if (!match) throw new Error('Invalid date');
  const parts = Object.fromEntries(groups.map((token, index) => [token, match[index + 1]]));
  return parseDate(`${parts.YYYY}-${String(parts.MM).padStart(2, '0')}-${String(parts.DD).padStart(2, '0')}`);
}

export function formatDateValue(value: DateValue, format: string): string {
  // Formatting is intentionally token-based rather than locale-based because
  // this value is committed back into user data. Locale affects picker labels;
  // the format string controls persisted cell text.
  return format
    .replace(/YYYY/g, String(value.year).padStart(4, '0'))
    .replace(/MM/g, String(value.month).padStart(2, '0'))
    .replace(/DD/g, String(value.day).padStart(2, '0'));
}

export function timeFormatHasSeconds(format: string | undefined, value: string): boolean {
  // A configured format is the source of truth. Without one, infer seconds from
  // the existing draft so values like 09:30:15 keep their precision.
  if (format) return format.includes('ss');
  return /\d{2}:\d{2}:\d{2}/.test(value);
}
