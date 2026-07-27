import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../migrations/20260727180000_phase_2_database_schema.sql", import.meta.url)),
  "utf8"
);

function grantedColumnsFor(tableName: string) {
  const match = migrationSql.match(
    new RegExp(`grant select \\(([^)]+)\\) on public\\.${tableName} to authenticated;`, "i")
  );

  return match?.[1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

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

  it("uses allow-listed frontend grants for Zoho mailbox columns", () => {
    expect(migrationSql).toContain(
      "revoke select on public.zoho_mailboxes from anon, authenticated"
    );

    expect(grantedColumnsFor("zoho_mailboxes")).toEqual([
      "id",
      "candidate_id",
      "email",
      "zoho_account_id",
      "token_expires_at",
      "connection_status",
      "last_otp_check_at",
      "last_success_at",
      "last_error",
      "created_at",
      "updated_at"
    ]);
  });

  it("uses allow-listed frontend grants for Workday account columns", () => {
    expect(migrationSql).toContain("revoke select on public.workday_accounts from anon, authenticated");

    expect(grantedColumnsFor("workday_accounts")).toEqual([
      "id",
      "candidate_id",
      "tenant_key",
      "tenant_name",
      "workday_base_url",
      "email",
      "username",
      "account_status",
      "last_login_at",
      "last_error",
      "created_at",
      "updated_at"
    ]);
  });

  it("prevents audit actor spoofing and operator global question bank approvals", () => {
    expect(migrationSql).toContain(
      "with check (public.is_admin() or actor_user_id = auth.uid())"
    );
    expect(migrationSql).toContain("public.prevent_non_admin_question_bank_approval()");
  });
});
