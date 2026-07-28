import { describe, expect, it } from "vitest";

import { encryptWorkdayPassword } from "../src/workday-password";
import {
  canDecryptWorkdayLoginPassword,
  evaluateWorkdayLoginReadiness,
  validateWorkdayLoginAccountShape
} from "../src/workday-login-readiness";

const encryptionKey = "01234567890123456789012345678901".slice(0, 32);

describe("validateWorkdayLoginAccountShape", () => {
  it("blocks a missing account", () => {
    expect(validateWorkdayLoginAccountShape(null)).toEqual({ blockedReason: "account_missing", ok: false });
  });

  it("blocks a locked account", () => {
    expect(
      validateWorkdayLoginAccountShape({ account_status: "locked", email: "candidate@example.com", password_encrypted: "enc" })
    ).toEqual({ blockedReason: "account_locked", ok: false });
  });

  it("blocks a disabled account", () => {
    expect(
      validateWorkdayLoginAccountShape({ account_status: "disabled", email: "candidate@example.com", password_encrypted: "enc" })
    ).toEqual({ blockedReason: "account_disabled", ok: false });
  });

  it("blocks a missing email", () => {
    expect(validateWorkdayLoginAccountShape({ account_status: "existing", email: null, password_encrypted: "enc" })).toEqual({
      blockedReason: "email_missing",
      ok: false
    });
  });

  it("blocks a missing encrypted password", () => {
    expect(
      validateWorkdayLoginAccountShape({ account_status: "existing", email: "candidate@example.com", password_encrypted: null })
    ).toEqual({ blockedReason: "password_missing", ok: false });
  });

  it("passes a well-formed existing account", () => {
    expect(
      validateWorkdayLoginAccountShape({ account_status: "existing", email: "candidate@example.com", password_encrypted: "enc" })
    ).toEqual({ ok: true });
  });
});

describe("canDecryptWorkdayLoginPassword", () => {
  it("confirms a correctly encrypted password decrypts without returning it", () => {
    const encrypted = encryptWorkdayPassword("super-secret-password", encryptionKey);

    expect(canDecryptWorkdayLoginPassword(encrypted, encryptionKey)).toEqual({ ok: true });
  });

  it("blocks safely when the encrypted value is malformed", () => {
    expect(canDecryptWorkdayLoginPassword("not-a-valid-token", encryptionKey)).toEqual({
      blockedReason: "password_decrypt_failed",
      ok: false
    });
  });

  it("blocks safely when the encryption key is wrong", () => {
    const encrypted = encryptWorkdayPassword("super-secret-password", encryptionKey);
    const wrongKey = "98765432109876543210987654321098".slice(0, 32);

    expect(canDecryptWorkdayLoginPassword(encrypted, wrongKey)).toEqual({ blockedReason: "password_decrypt_failed", ok: false });
  });
});

describe("evaluateWorkdayLoginReadiness", () => {
  it("blocks when the tenant is unknown", () => {
    expect(evaluateWorkdayLoginReadiness(null, { account_status: "existing", email: "a@b.com", password_encrypted: "enc" }, encryptionKey)).toEqual(
      { blockedReason: "tenant_unknown", ok: false }
    );
  });

  it("blocks when the account is missing", () => {
    expect(evaluateWorkdayLoginReadiness("acme", null, encryptionKey)).toEqual({ blockedReason: "account_missing", ok: false });
  });

  it("is ready when the account and password are safe to use", () => {
    const encrypted = encryptWorkdayPassword("super-secret-password", encryptionKey);

    expect(
      evaluateWorkdayLoginReadiness("acme", { account_status: "existing", email: "candidate@example.com", password_encrypted: encrypted }, encryptionKey)
    ).toEqual({ ok: true });
  });

  it("never includes the plaintext password anywhere in its result", () => {
    const encrypted = encryptWorkdayPassword("super-secret-password", encryptionKey);
    const result = evaluateWorkdayLoginReadiness(
      "acme",
      { account_status: "existing", email: "candidate@example.com", password_encrypted: encrypted },
      encryptionKey
    );

    expect(JSON.stringify(result)).not.toContain("super-secret-password");
  });
});
