/**
 * Allows component source files to import global CSS for side effects.
 *
 * Table publishes plain CSS rather than CSS Modules, so this declaration only
 * teaches TypeScript that `import './style.css'` is valid.
 */
declare module '*.css';
