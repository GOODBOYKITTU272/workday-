import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../migrations/20260727180000_phase_2_database_schema.sql", import.meta.url)),
  "utf8"
);

describe("Phase 2 migration security gates", () => {
  it("blocks non-admin application run approval state changes", () => {
    expect(migrationSql).toContain("public.prevent_non_admin_run_approval()");
    expect(migrationSql).toContain("new.status = 'approved_for_submit'");
    expect(migrationSql).toContain("new.approved_by is distinct from old.approved_by");
    expect(migrationSql).toContain("new.approved_at is distinct from old.approved_at");
  });

  it("blocks self-service user privilege escalation", () => {
    expect(migrationSql).toContain("public.prevent_user_privilege_escalation()");
    expect(migrationSql).toContain("old.role is distinct from new.role");
    expect(migrationSql).toContain("old.status is distinct from new.status");
    expect(migrationSql).toContain("old.email is distinct from new.email");
  });

  it("restricts security definer worker functions to service role", () => {
    expect(migrationSql).toContain(
      "revoke execute on function public.claim_next_application_run() from public, authenticated"
    );
    expect(migrationSql).toContain(
      "grant execute on function public.claim_next_application_run() to service_role"
    );
    expect(migrationSql).toContain(
      "revoke execute on function public.calculate_run_readiness(uuid) from public, authenticated"
    );
    expect(migrationSql).toContain(
      "grant execute on function public.calculate_run_readiness(uuid) to service_role"
    );
  });

  it("does not expose encrypted secret columns to authenticated frontend clients", () => {
    expect(migrationSql).toContain(
      "revoke select (access_token_encrypted, refresh_token_encrypted) on public.zoho_mailboxes from anon, authenticated"
    );
    expect(migrationSql).toContain(
      "revoke select (password_encrypted) on public.workday_accounts from anon, authenticated"
    );
  });

  it("prevents audit actor spoofing and operator global question bank approvals", () => {
    expect(migrationSql).toContain(
      "with check (public.is_admin() or actor_user_id = auth.uid())"
    );
    expect(migrationSql).toContain("public.prevent_non_admin_question_bank_approval()");
  });
});
