# MVP Dry-Run Readiness

## Current MVP Capability

The Workday worker can process one queued dry-run application run and stop at manual review. The supported path is:

1. Claim a queued run.
2. Validate candidate, active resume, job link, and Zoho mailbox readiness.
3. Open a trusted Workday job URL with tenant validation.
4. Perform a guarded Apply click dry-run when one high-confidence Apply action is present.
5. Classify the post-Apply state.
6. Check Workday login readiness.
7. Inspect the trusted login page.
8. Attempt the guarded Workday login.
9. Route the post-login state.
10. Detect questionnaire/form presence with safe booleans.
11. Capture a safe questionnaire summary snapshot with counts only.
12. Write run step rows, automation log rows, and one `manual_review_items` routing row.
13. Finish with `manual_review_required`.

## Safety Boundaries

The MVP is a dry-run and manual-review system, not an autonomous application filer.

- No Submit action is allowed.
- No Continue or Next action is allowed after login.
- No resume upload is allowed.
- No questionnaire answer filling or auto-answering is allowed.
- No raw question extraction is allowed.
- No LLM or ScrapeGraphAI extraction is used.
- No OTP reading or entry is used.
- No Verification-link clicking is used.
- No email inbox reading is used.
- No raw HTML, raw page text, input values, Hidden fields, browser storage, Screenshots, Cookies, or exact locator strings are stored.
- No secrets, credentials, email bodies, tokens, one-time codes, or Verification links are written to run logs or manual review rows.

Every routing decision keeps `execution_allowed: false` and `requires_human_review: true`.

## Manual Review Queue

Routing rows use `manual_review_items.item_type = 'routing_review'`. The row stores fixed enums, safe tenant/host metadata, post-Apply state, post-login route/state, questionnaire discovery booleans, and questionnaire snapshot counts. It does not store question labels, option labels, field values, page text, HTML, or locator strings.

The unique routing-review index keeps one routing row per run. If queue insertion fails, the worker logs only a fixed safe error.

## Required Environment

Worker:

- `SUPABASE_URL`
- Worker-only Supabase service role key
- `ENCRYPTION_KEY`
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REDIRECT_URI`
- `APPLYWIZZ_LEADS_API_URL`
- `APPLYWIZZ_LEADS_BASIC_AUTH`

Mobile web:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_APP_ENV`

The privileged Supabase key and encrypted Workday credential fields belong only on the worker/server side. They must not be exposed to the mobile web app.
The ApplyWizz Leads API values are worker-only secrets. Never put them in `EXPO_PUBLIC` variables, frontend code, or browser-visible Vercel public environment variables.
`APPLYWIZZ_LEADS_API_URL` must include `status=In%20Progress&services_opted=applications&services_opted_logic=and`. The worker also defensively enforces `lead.status == "In Progress"` after trimming and case normalization, so Paused or Completed clients are not imported if the URL is changed later.

Manual candidate sync:

```bash
corepack pnpm --filter @applywizz/worker sync:applywizz-leads
```

## Supabase Migrations

Apply migrations in filename order:

1. `20260727180000_phase_2_database_schema.sql`
2. `20260728000100_fix_anon_function_execute_grants.sql`
3. `20260728000200_enforce_resume_storage_upload_constraints.sql`
4. `20260728000300_allow_viewers_read_safe_zoho_metadata.sql`
5. `20260728000400_allow_viewers_read_safe_workday_metadata.sql`
6. `20260728000500_add_manual_review_routing_support.sql`
7. `20260728000600_add_post_login_manual_review_routing.sql`
8. `20260728000700_add_questionnaire_discovery_manual_review_metadata.sql`
9. `20260728000800_add_questionnaire_safe_snapshot_manual_review_metadata.sql`
10. `20260728000900_add_applywizz_leads_candidate_sync_fields.sql`

The `supabase/migrations` and `packages/database/migrations` copies must stay mirrored.

## Known Limitations

- Questionnaire discovery and snapshot capture reopen a trusted URL in a fresh browser context, so authenticated pages can be conservative or unknown until session continuity exists.
- Login can stop at manual review for OTP, Verification, invalid credentials, locked accounts, still-on-login, unknown state, tenant mismatch, or untrusted redirect.
- The worker captures only safe summary metadata for forms. It does not extract raw question text or answer options.
- There is no LLM/ScrapeGraphAI integration.
- There is no Submit path.
- There is no multi-portal support.

## Internal Run Checklist

1. Confirm all migrations are applied in order.
2. Confirm worker env vars are set only in the worker runtime.
3. Confirm mobile web uses only public Supabase env vars.
4. Run `corepack pnpm build`.
5. Run `corepack pnpm typecheck`.
6. Run `corepack pnpm test`.
7. Run `corepack pnpm lint`.
8. Run the final safety scans from the Phase 32 report.
9. Run `corepack pnpm --filter @applywizz/worker sync:applywizz-leads` when importing ApplyWizz Leads candidates.
10. Use a non-production candidate and Workday account for internal dry-run testing.
11. Confirm resulting runs stop at `manual_review_required`.

## Rollback

If the Phase 32 build is not accepted, revert the Phase 32 commit. If migrations were applied, roll back only after confirming no internal test data depends on the added nullable questionnaire snapshot columns. The Phase 31 worker remains the last passed implementation baseline.
