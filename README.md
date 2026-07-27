# ApplyWizz Workday Dry-Run Automation Engine V1

Phase 1 creates the monorepo foundation. Phase 2 adds the Supabase database. Phase 3 adds email/password authentication.

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

For the frontend, only these Supabase values are used:

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

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

## Supabase Auth Setup

1. Enable Email provider in Supabase Auth.
2. Create an Auth user with email and password.
3. Insert a matching active app user row:

```sql
insert into public.users (id, full_name, email, role, status)
values (
  '<AUTH_USER_UUID>',
  'Ramakrishna Chanda',
  '<YOUR_LOGIN_EMAIL>',
  'admin',
  'active'
);
```

## V1 Safety Defaults

- Dry-run stays required.
- Human approval stays required.
- Auto-submit is not enabled.
