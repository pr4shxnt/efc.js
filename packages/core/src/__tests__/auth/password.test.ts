import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, passwordNeedsRehash } from '../../auth/index.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips and rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct horsf', hash)).toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('verifies hashes made with other cost parameters', async () => {
    // Same format, cheaper parameters — e.g. a hash stored before the defaults were raised.
    const { scryptSync } = await import('node:crypto');
    const salt = Buffer.from('0123456789abcdef');
    const key = scryptSync('pw', salt, 32, { N: 1024, r: 8, p: 1 });
    const hash = `scrypt$1024$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPassword('pw', hash)).toBe(true);
    expect(passwordNeedsRehash(hash)).toBe(true);
  });

  it('returns false for malformed or abusive hashes instead of throwing', async () => {
    for (const bad of [
      '',
      'plain',
      'scrypt$1$2$3',
      'scrypt$1000$8$1$c2FsdA==$a2V5',
      'scrypt$2097152$8$1$c2FsdA==$a2V5',
    ]) {
      expect(await verifyPassword('pw', bad)).toBe(false);
    }
  });

  it('refuses an empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow(/non-empty string/);
  });

  it('never verifies a bcrypt hash — there is no bcrypt fallback', async () => {
    const legacy = '$2b$10$abcdefghijklmnopqrstuuXyZ0123456789abcdefghijklmnopqrs';
    expect(await verifyPassword('pw', legacy)).toBe(false);
    expect(passwordNeedsRehash(legacy)).toBe(true);
  });
});
