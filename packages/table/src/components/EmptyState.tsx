import { useId } from 'react';
import { ZH_CN_GRID_LABELS } from '../core/i18n';

/**
 * Built-in empty state shown when the consumer does not provide emptyContent.
 *
 * The generated ids keep SVG defs unique when several grids are mounted on the
 * same page, avoiding gradient or mask collisions between component instances.
 */
export function DefaultEmptyState({ label = ZH_CN_GRID_LABELS.empty }: { label?: string }) {
  const id = useId().replace(/:/g, '');
  const gradientOne = `${id}-empty-gradient-one`;
  const gradientTwo = `${id}-empty-gradient-two`;
  const mask = `${id}-empty-mask`;
  return (
    <div className="rvg-default-empty">
      <svg viewBox="0 0 79 86" aria-hidden="true">
        <defs>
          <linearGradient id={gradientOne} x1="38.8503086%" y1="0%" x2="61.1496914%" y2="100%">
            <stop stopColor="#fcfcfd" offset="0%" />
            <stop stopColor="#eeeff3" offset="100%" />
          </linearGradient>
          <linearGradient id={gradientTwo} x1="0%" y1="9.5%" x2="100%" y2="90.5%">
            <stop stopColor="#fcfcfd" offset="0%" />
            <stop stopColor="#e9ebef" offset="100%" />
          </linearGradient>
          <mask id={mask}>
            <rect width="17" height="36" fill="#fff" />
          </mask>
        </defs>
        <path d="M39.5 86C61.315 86 79 83.91 79 81.333 79 78.756 57.315 78 35.5 78S0 78.756 0 81.333C0 83.91 17.685 86 39.5 86Z" fill="#f7f8fc" />
        <path d="M13 45h40L42 58H2z" fill="#e5e7e9" />
        <g transform="translate(34.5 31.5) scale(-1 1) rotate(-25) translate(-27.5 -21.5)">
          <path d="M0 3h18l5 4H5z" fill="#e5e7e9" />
          <path d="M0 7h38v36H0z" fill="#edeef2" />
          <path d="M38 7h17v36H38z" fill={`url(#${gradientOne})`} />
          <path d="M24 7h17L55 0H38z" fill="#f8f9fb" />
        </g>
        <rect x="13" y="45" width="40" height="36" fill={`url(#${gradientTwo})`} />
        <g transform="translate(53 45)" mask={`url(#${mask})`}>
          <rect width="17" height="36" fill="#e0e3e9" />
          <path d="M7 0h17l-4 18L0 16z" fill="#d5d7de" />
        </g>
        <path d="M62 45h17l-9 13H53z" fill="#f8f9fb" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
