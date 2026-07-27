# ApplyWizz Workday Dry-Run Automation Engine V1

Phase 1 creates the monorepo foundation only.

## Requirements

- Node.js 24+
- Corepack
- pnpm 11+

## Local Setup

```bash
corepack pnpm --version
corepack pnpm install
cp .env.example .env
```

Fill `.env` with local development values. Do not commit real secrets.

## Scripts

```bash
corepack pnpm dev:mobile
corepack pnpm dev:worker
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
```

## Workspace

- `apps/mobile-web`: Expo React Native, Expo Router, and React Native Web app.
- `apps/worker`: Node.js TypeScript worker shell.
- `packages/shared`: Shared TypeScript constants and types.
- `packages/database`: Database package placeholder for Phase 2 migrations and types.

## V1 Safety Defaults

- Dry-run stays required.
- Human approval stays required.
- Auto-submit is not enabled in Phase 1.
