import { describe, expect, it } from "vitest";

import { buildEncryptedWorkdayPasswordUpdate, decryptWorkdayPassword, encryptWorkdayPassword } from "../src/workday-password";

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("Workday password helpers", () => {
  it("encrypts and decrypts Workday account passwords", () => {
    const encrypted = encryptWorkdayPassword("Applying@2026", encryptionKey);

    expect(encrypted).not.toContain("Applying@2026");
    expect(decryptWorkdayPassword(encrypted, encryptionKey)).toBe("Applying@2026");
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const encrypted = encryptWorkdayPassword("Applying@2026", encryptionKey);
    const parts = encrypted.split(":");
    const ciphertext = parts[3] ?? "";
    parts[3] = `${ciphertext.slice(0, -2)}AA`;
    const tampered = parts.join(":");

    expect(() => decryptWorkdayPassword(tampered, encryptionKey)).toThrow();
    expect(() => decryptWorkdayPassword(encrypted, "abcdef0123456789abcdef0123456789")).toThrow();
  });

  it("builds a password update payload without plaintext password", () => {
    const payload = buildEncryptedWorkdayPasswordUpdate("Applying@2026", encryptionKey);

    expect(Object.keys(payload)).toEqual(["password_encrypted"]);
    expect(JSON.stringify(payload)).not.toContain("Applying@2026");
  });
});
