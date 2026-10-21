import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Fixed sizes for AES-256-GCM. 12-byte nonce is the NIST recommendation; a
// larger IV weakens GCM's authentication. 16-byte auth tag is the maximum
// and the default.
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

export interface EncryptedToken {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

/**
 * AES-256-GCM-encrypt a short string (OAuth refresh token). A fresh random IV
 * is generated per call — never reuse an IV with the same key.
 *
 * The key must be exactly 32 bytes; env parsing guarantees this before this
 * function is called. The returned tag is required at decrypt time to detect
 * tampered ciphertext.
 */
export function encryptToken(plaintext: string, key: Buffer, keyVersion = 1): EncryptedToken {
  if (key.length !== 32) {
    throw new Error(`tokenEncryption: key must be 32 bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag, keyVersion };
}

/**
 * Decrypt a token produced by `encryptToken`. Throws if the key is wrong, the
 * ciphertext is corrupted, or the tag doesn't match — GCM's AEAD guarantee
 * means tampering is detected, not quietly accepted.
 */
export function decryptToken(encrypted: EncryptedToken, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error(`tokenEncryption: key must be 32 bytes, got ${key.length}`);
  }
  if (encrypted.iv.length !== IV_LENGTH) {
    throw new Error(`tokenEncryption: iv must be ${IV_LENGTH} bytes, got ${encrypted.iv.length}`);
  }
  if (encrypted.tag.length !== TAG_LENGTH) {
    throw new Error(`tokenEncryption: tag must be ${TAG_LENGTH} bytes, got ${encrypted.tag.length}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
  decipher.setAuthTag(encrypted.tag);
  const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
