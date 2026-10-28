import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { getLogger } from '../logger.js';

// Password hashing on node:crypto's scrypt — no native addon, no extra dependency.
// Stored format: `scrypt$<N>$<r>$<p>$<salt b64>$<key b64>`. The cost parameters travel
// with each hash, so raising them later doesn't invalidate passwords already stored.
// N=2^15, r=8, p=1: 32 MiB and ~100–250 ms per hash — above bcrypt cost 10 (what EFC used before)
// without making each login hold a libuv thread for most of a second.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLen: number,
): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes; Node's default maxmem (32 MiB) is exactly that at our defaults.
  const options: ScryptOptions = { N: n, r, p, maxmem: 256 * n * r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Hashes a password with scrypt and a random salt. Store the returned string as-is. */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('[EFC] hashPassword: password must be a non-empty string');
  }
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, N, R, P, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Checks a password against a hash from `hashPassword`. Returns false for a wrong password or any
 * other format — including bcrypt hashes (`$2a$`/`$2b$`/`$2y$`) from apps scaffolded before 0.9.2,
 * which EFC deliberately can't verify: those accounts reset their password.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof hash !== 'string') return false;
  if (/^\$2[aby]\$/.test(hash)) {
    getLogger().warn(
      '[EFC] verifyPassword: bcrypt hash found — not supported since 0.9.2. ' +
        'This account must reset its password (the reset stores a hashPassword() hash).',
    );
    return false;
  }

  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0) || (n & (n - 1)) !== 0) return false;
  // Refuse cost parameters far above ours — a planted hash shouldn't be able to pin a worker.
  if (n > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await derive(password, salt, n, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}

/** True when a stored hash should be replaced with `hashPassword()` (e.g. after a successful login). */
export function passwordNeedsRehash(hash: string): boolean {
  return !hash.startsWith(`scrypt$${N}$${R}$${P}$`);
}
