# Database Package

Phase 2 adds the Supabase schema migration for the V1 backend foundation.

## Migration Files

- `migrations/20260727180000_phase_2_database_schema.sql`
- `migrations/20260728000100_fix_anon_function_execute_grants.sql`

Supabase CLI reads migrations from `supabase/migrations/`. This package keeps mirrored copies for database package documentation and review. When adding a migration, add it in both locations and verify the files match:

```bash
cmp -s packages/database/migrations/<file>.sql supabase/migrations/<file>.sql
shasum -a 256 packages/database/migrations/<file>.sql supabase/migrations/<file>.sql
```

## Storage Buckets

The migration creates these private Supabase Storage buckets:

- `candidate-resumes`
- `run-screenshots`
- `playwright-traces`
- `html-captures`

## Security Gates

The Phase 2 migration keeps these gates in the database:

- Non-admin users cannot create final-submit approval state on `application_runs`.
- Non-admin users cannot update protected `users` fields such as role, status, email, or id.
- `claim_next_application_run()` and `calculate_run_readiness(uuid)` execute only for `service_role`.
- Zoho mailbox and Workday account table-level `select` is revoked from frontend roles, then only safe columns are granted back to `authenticated`.
- Frontend audit inserts must use the current user's `auth.uid()`.
- Global `question_bank` approvals are admin-only.

## Local Apply

Supabase local requires Docker and a configured Supabase project.

```bash
supabase init
supabase start
supabase db reset
```

## Rollback Plan

Before applying this migration to a shared environment, take a database backup.
To roll back in local development, reset the local database to the previous migration state and reapply only approved migrations.
For staging or production, restore the backup or apply a reviewed down migration that drops Phase 2 objects in reverse dependency order.
