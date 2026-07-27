# Database Package

Phase 2 adds the Supabase schema migration for the V1 backend foundation.

## Migration Files

- `migrations/20260727180000_phase_2_database_schema.sql`

## Storage Buckets

The migration creates these private Supabase Storage buckets:

- `candidate-resumes`
- `run-screenshots`
- `playwright-traces`
- `html-captures`

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
