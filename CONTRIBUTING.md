# Contributing

## Development

```bash
pnpm install
pnpm typecheck
pnpm build:packages
pnpm --filter @lensui/table test
pnpm --filter @lensui/tree test
```

## Package Layout

- `src/` contains the full `lensui` package entrypoints.
- `packages/table/` contains `@lensui/table`.
- `packages/tree/` contains `@lensui/tree`.
- `demo/` is a local documentation/demo app and is not published.
