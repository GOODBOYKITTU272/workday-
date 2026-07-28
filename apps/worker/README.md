# ApplyWizz Worker

Server-side worker foundation for ApplyWizz automation phases.

## Phase 11 Environment

Required for Zoho OAuth token handling:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REDIRECT_URI=
```

Generate a valid 32-byte `ENCRYPTION_KEY`:

```bash
openssl rand -base64 24
```

Service-role and Zoho client secret values belong only in the worker/runtime environment, never in Expo public variables.

Phase 11 stores only encrypted Zoho token values in `public.zoho_mailboxes`. It does not read emails, parse OTPs, call Workday, use Playwright, claim runs, approve submit, or submit applications.

Phase 12 adds server-side helpers for Zoho OAuth authorization URLs, signed state validation, callback validation, and authorization-code exchange into encrypted mailbox token updates. It still does not read emails, parse OTPs, call Workday, use Playwright, claim runs, approve submit, or submit applications.

Phase 13 adds worker-only Zoho Mail API helper structure for recent message search plus mocked-parser coverage for Workday verification codes and verification links. It does not write OTP logs, read real mail in tests, call Workday, use Playwright, claim runs, approve submit, or submit applications.

Zoho Mail API scopes to verify before production:

```text
ZohoMail.messages.READ
ZohoMail.accounts.READ
```

Phase 14 adds worker-only encrypted Workday account password helpers. Configure `WORKDAY_STANDARD_PASSWORD` in the worker/server environment, do not commit the real value, and use a strong password that satisfies current Workday tenant policies. The previously committed example value must be treated as burned and not used for real accounts.

Phase 17 adds an explicit Playwright browser smoke test only. It opens a local `data:` page, not Workday or any external job link.

Install Chromium locally when running the optional smoke test:

```bash
corepack pnpm --filter @applywizz/worker exec playwright install chromium
```

Run the optional smoke test:

```bash
corepack pnpm --filter @applywizz/worker smoke:browser
```

Phase 18 adds an optional Workday page open smoke test. It opens only a trusted `https://` Workday job URL and stops after a safe metadata snapshot.

Run the optional Workday page smoke test:

```bash
RUN_WORKDAY_PAGE_OPEN_SMOKE_TEST=1 TEST_WORKDAY_JOB_URL="https://acme.wd5.myworkdayjobs.com/External/job/Engineer" corepack pnpm --filter @applywizz/worker smoke:workday-page
```

If `TEST_WORKDAY_JOB_URL` is missing, the script prints a skip message and exits 0.
