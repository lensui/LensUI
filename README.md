# LensUI

LensUI is a React component library split into two installable components: Table and Tree.

## Packages

| Package | Description |
| --- | --- |
| `lensui` | Full package, exporting Table and Tree. |
| `@lensui/table` | Canvas-rendered virtual table component. |
| `@lensui/tree` | Type-safe tree component with selection, search, async loading, drag and drop, and virtual scrolling. |

## Install

Install the full library:

```bash
npm install lensui
```

Or install a single component package:

```bash
npm install @lensui/table
npm install @lensui/tree
```

## Usage

```tsx
import { Table, Tree } from 'lensui';
import 'lensui/style.css';
```

Single component packages:

```tsx
import { Table } from '@lensui/table';
import '@lensui/table/style.css';

import { Tree } from '@lensui/tree';
import '@lensui/tree/style.css';
```

Full-package subpaths are also available:

```tsx
import { Table } from 'lensui/table';
import { Tree } from 'lensui/tree';
```

## Repository Layout

```txt
.
├── src/              # lensui full-package entrypoints
├── packages/
│   ├── table/        # @lensui/table
│   └── tree/         # @lensui/tree
├── demo/             # local docs/demo app
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm build:packages
pnpm --filter @lensui/table test
pnpm --filter @lensui/tree test
```
