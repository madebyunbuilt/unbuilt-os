'use node';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

// Vault encryption (10-vault.md, Storage). Only ever imported by a "use node" action: nothing that runs in a query or
// a mutation may touch a key, so there is no path by which plaintext could reach a document, a log or a response.

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, as the spec requires and as GCM expects.
const KEY_BYTES = 32;

export class VaultKeyError extends Error {}

/** The key for a version, from `VAULT_KEY_v<n>`. Old versions stay readable until a rotation has finished. */
export function keyFor(version: number): Buffer {
  const raw = process.env[`VAULT_KEY_v${version}`];
  if (!raw) throw new VaultKeyError(`VAULT_KEY_v${version} is not set on this deployment`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new VaultKeyError(`VAULT_KEY_v${version} must be ${KEY_BYTES} random bytes, base64 encoded`);
  }
  return key;
}

/** The version new writes use. Rotation changes this after re-encrypting everything. */
export function activeKeyVersion(): number {
  const raw = process.env.VAULT_ACTIVE_KEY_VERSION;
  const version = Number(raw);
  if (!raw || !Number.isSafeInteger(version) || version < 1) {
    throw new VaultKeyError('VAULT_ACTIVE_KEY_VERSION must name the key version new secrets are written with');
  }
  return version;
}

export type Sealed = { ciphertext: string; iv: string; keyVersion: number };

/**
 * Encrypts one field. The IV is random per field, never reused, and stored beside the ciphertext — it is not a
 * secret, and GCM needs it to decrypt. The authentication tag is appended to the ciphertext, so a document altered in
 * the database fails to decrypt rather than returning something plausible.
 */
export function seal(plaintext: string, version = activeKeyVersion()): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFor(version), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
    iv: iv.toString('base64'),
    keyVersion: version,
  };
}

export function open({ ciphertext, iv, keyVersion }: Sealed): string {
  const raw = Buffer.from(ciphertext, 'base64');
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(0, raw.length - 16);
  const decipher = createDecipheriv(ALGORITHM, keyFor(keyVersion), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Compares two secrets without leaking which character differed, for anything that has to match a stored value. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
