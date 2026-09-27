import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeKeyVersion, keyFor, open, seal, VaultKeyError } from './crypto';

// Vault encryption (10-vault.md, Storage). These tests are about the one promise the vault makes: what is written
// down cannot be read without a key, and what comes back is exactly what went in or nothing at all.

const KEY_ONE = Buffer.alloc(32, 1).toString('base64');
const KEY_TWO = Buffer.alloc(32, 2).toString('base64');

afterEach(() => vi.unstubAllEnvs());

function withKeys() {
  vi.stubEnv('VAULT_KEY_v1', KEY_ONE);
  vi.stubEnv('VAULT_KEY_v2', KEY_TWO);
  vi.stubEnv('VAULT_ACTIVE_KEY_VERSION', '2');
}

describe('sealing a secret', () => {
  it('gives back exactly what went in', () => {
    withKeys();
    for (const secret of ['hunter2', 'a'.repeat(5000), 'ünïcødé 🔐 and\nnewlines', '']) {
      expect(open(seal(secret))).toBe(secret);
    }
  });

  it('writes nothing that looks like the secret', () => {
    withKeys();
    const sealed = seal('correct-horse-battery-staple');
    expect(JSON.stringify(sealed)).not.toContain('correct-horse');
    expect(sealed.keyVersion).toBe(2);
  });

  it('never reuses an IV, so the same secret is never the same ciphertext', () => {
    withKeys();
    const first = seal('hunter2');
    const second = seal('hunter2');
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('refuses to open something that has been tampered with', () => {
    withKeys();
    const sealed = seal('hunter2');
    const raw = Buffer.from(sealed.ciphertext, 'base64');
    raw[0] ^= 0xff;
    // Better to fail than to return something plausible from an altered document.
    expect(() => open({ ...sealed, ciphertext: raw.toString('base64') })).toThrow();
  });

  it('refuses to open with the wrong key', () => {
    withKeys();
    const sealed = seal('hunter2', 1);
    expect(() => open({ ...sealed, keyVersion: 2 })).toThrow();
  });

  it('still reads a secret sealed with an older key, so rotation can take its time', () => {
    withKeys();
    const old = seal('hunter2', 1);
    expect(old.keyVersion).toBe(1);
    expect(open(old)).toBe('hunter2');
  });
});

describe('the keys themselves', () => {
  it('says plainly when one is missing rather than writing something unreadable', () => {
    vi.stubEnv('VAULT_ACTIVE_KEY_VERSION', '3');
    expect(() => keyFor(3)).toThrow(VaultKeyError);
  });

  it('refuses a key that is not 32 bytes', () => {
    vi.stubEnv('VAULT_KEY_v1', Buffer.alloc(16, 1).toString('base64'));
    expect(() => keyFor(1)).toThrow(/32 random bytes/);
  });

  it('refuses to guess which key version to write with', () => {
    vi.stubEnv('VAULT_ACTIVE_KEY_VERSION', '');
    expect(() => activeKeyVersion()).toThrow(VaultKeyError);
  });
});
