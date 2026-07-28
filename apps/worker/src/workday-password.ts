import { decryptToken, encryptToken } from "./token-crypto.js";

export type WorkdayPasswordUpdate = {
  password_encrypted: string;
};

export function encryptWorkdayPassword(password: string, encryptionKey: string) {
  return encryptToken(password, encryptionKey);
}

export function decryptWorkdayPassword(encryptedPassword: string, encryptionKey: string) {
  return decryptToken(encryptedPassword, encryptionKey);
}

export function buildEncryptedWorkdayPasswordUpdate(password: string, encryptionKey: string): WorkdayPasswordUpdate {
  return {
    password_encrypted: encryptWorkdayPassword(password, encryptionKey)
  };
}
