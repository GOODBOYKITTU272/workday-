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

`ENCRYPTION_KEY` must be exactly 32 bytes. Service-role and Zoho client secret values belong only in the worker/runtime environment, never in Expo public variables.

Phase 11 stores only encrypted Zoho token values in `public.zoho_mailboxes`. It does not read emails, parse OTPs, call Workday, use Playwright, claim runs, approve submit, or submit applications.
