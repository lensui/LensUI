# LensUI

LensUI is a React component library split into two installable components: Table and Tree.

## Packages

| Package | Description |
| --- | --- |
| `@lensui/lens` | Full package, exporting Table and Tree. |
| `@lensui/lens-table` | Canvas-rendered virtual table component. |
| `@lensui/lens-tree` | Type-safe tree component with selection, search, async loading, drag and drop, and virtual scrolling. |

## Install

Install the full library:

```bash
npm install @lensui/lens
```

Or install a single component package:

```bash
npm install @lensui/lens-table
npm install @lensui/lens-tree
```

## Usage

```tsx
import { Table, Tree } from '@lensui/lens';
import '@lensui/lens/style.css';
```

Single component packages:

```tsx
import { Table } from '@lensui/lens-table';
import '@lensui/lens-table/style.css';

import { Tree } from '@lensui/lens-tree';
import '@lensui/lens-tree/style.css';
```

Full-package subpaths are also available:

```tsx
import { Table } from '@lensui/lens/table';
import { Tree } from '@lensui/lens/tree';
```

## Repository Layout

```txt
.
├── src/              # lensui full-package entrypoints
├── packages/
│   ├── table/        # @lensui/lens-table
│   └── tree/         # @lensui/lens-tree
├── demo/             # local docs/demo app
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm build:packages
pnpm --filter @lensui/lens-table test
pnpm --filter @lensui/lens-tree test
```
