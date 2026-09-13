# LensUI

LensUI is a React component library split into two installable components: Table and Tree.

## Packages

| Package | Description |
| --- | --- |
| `@ycxy/lensui` | Full package, exporting Table and Tree. |
| `@ycxy/lensui-table` | Canvas-rendered virtual table component. |
| `@ycxy/lensui-tree` | Type-safe tree component with selection, search, async loading, drag and drop, and virtual scrolling. |

## Install

Install the full library:

```bash
npm install @ycxy/lensui
```

Or install a single component package:

```bash
npm install @ycxy/lensui-table
npm install @ycxy/lensui-tree
```

## Usage

```tsx
import { Table, Tree } from '@ycxy/lensui';
import '@ycxy/lensui/style.css';
```

Single component packages:

```tsx
import { Table } from '@ycxy/lensui-table';
import '@ycxy/lensui-table/style.css';

import { Tree } from '@ycxy/lensui-tree';
import '@ycxy/lensui-tree/style.css';
```

Full-package subpaths are also available:

```tsx
import { Table } from '@ycxy/lensui/table';
import { Tree } from '@ycxy/lensui/tree';
```

## Repository Layout

```txt
.
├── src/              # lensui full-package entrypoints
├── packages/
│   ├── table/        # @ycxy/lensui-table
│   └── tree/         # @ycxy/lensui-tree
├── demo/             # local docs/demo app
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm build:packages
pnpm --filter @ycxy/lensui-table test
pnpm --filter @ycxy/lensui-tree test
```
