import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const version = "v1";

function keyBytes(encryptionKey: string) {
  const raw = Buffer.from(encryptionKey);

  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 32 bytes.");
  }

  return raw;
}

export function encryptToken(token: string, encryptionKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, keyBytes(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [version, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(encryptedToken: string, encryptionKey: string) {
  const [tokenVersion, iv, tag, ciphertext] = encryptedToken.split(":");

  if (tokenVersion !== version || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted token format.");
  }

  const decipher = createDecipheriv(algorithm, keyBytes(encryptionKey), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
