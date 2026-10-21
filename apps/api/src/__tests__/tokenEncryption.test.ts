import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../lib/tokenEncryption";

const key = () => randomBytes(32);

describe("tokenEncryption", () => {
  it("round-trips a token", () => {
    const k = key();
    const plaintext = "1//0abcDEF-fakeRefreshTokenMaterial";
    const encrypted = encryptToken(plaintext, k);
    expect(decryptToken(encrypted, k)).toBe(plaintext);
  });

  it("produces different ciphertext on each call (fresh IV)", () => {
    const k = key();
    const a = encryptToken("same-input", k);
    const b = encryptToken("same-input", k);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("produces a 12-byte IV and 16-byte tag", () => {
    const encrypted = encryptToken("x", key());
    expect(encrypted.iv.length).toBe(12);
    expect(encrypted.tag.length).toBe(16);
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptToken("secret", key());
    expect(() => decryptToken(encrypted, key())).toThrow();
  });

  it("fails to decrypt when the ciphertext is tampered", () => {
    const k = key();
    const encrypted = encryptToken("secret", k);
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[0] = tampered[0]! ^ 0x01;
    expect(() =>
      decryptToken({ ...encrypted, ciphertext: tampered }, k),
    ).toThrow();
  });

  it("fails to decrypt when the auth tag is tampered", () => {
    const k = key();
    const encrypted = encryptToken("secret", k);
    const tag = Buffer.from(encrypted.tag);
    tag[0] = tag[0]! ^ 0x01;
    expect(() => decryptToken({ ...encrypted, tag }, k)).toThrow();
  });

  it("rejects a non-32-byte key at encrypt time", () => {
    expect(() => encryptToken("x", randomBytes(16))).toThrow(/32 bytes/);
  });

  it("rejects a non-32-byte key at decrypt time", () => {
    const encrypted = encryptToken("x", key());
    expect(() => decryptToken(encrypted, randomBytes(16))).toThrow(/32 bytes/);
  });

  it("stores the key version so rotation can be detected later", () => {
    const encrypted = encryptToken("x", key(), 2);
    expect(encrypted.keyVersion).toBe(2);
  });
});
