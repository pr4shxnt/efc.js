/** Auth-owned app code: stable whether account-security is added now or later. */
export function twoFactorLibrary(ts: boolean, table: boolean, collection: boolean): string {
  const T = (type: string) => (ts ? type : '');
  const where = table ? '{ where, data }' : 'where, data';
  const result = table ? 'result.count' : collection ? 'result.modifiedCount' : 'result';
  const less = table ? 'lt' : '$lt';
  return `import crypto from 'node:crypto';
import { HttpError } from 'express-file-cluster';
import { enqueue } from 'express-file-cluster/tasks';

${T(`interface SecurityAccount {
  id: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorLastStep?: number;
  email: string; twoFactorMethod?: string;
  twoFactorEmailHash?: string; twoFactorEmailExpiry?: Date; twoFactorEmailPurpose?: string;
}
type SecurityData = {
  twoFactorEnabled?: boolean; twoFactorSecret?: string; twoFactorLastStep?: number;
  twoFactorMethod?: string; twoFactorPendingMethod?: string;
  twoFactorEmailHash?: string; twoFactorEmailExpiry?: Date; twoFactorEmailPurpose?: string;
  twoFactorPendingSecret?: string; twoFactorPendingExpiry?: Date;
  refreshToken?: string; refreshTokenExpiry?: Date;
};
type SecurityWhere = {
  id: string; password?: string; refreshToken?: string; twoFactorEnabled?: ${table ? 'boolean' : 'boolean | { $ne: true }'}; twoFactorSecret?: string;
  twoFactorPendingSecret?: string; twoFactorEmailHash?: string; twoFactorPendingMethod?: string; twoFactorLastStep?: { ${less}: number };
};
interface SecurityModel {
  updateMany(${table ? 'args: { where: SecurityWhere; data: SecurityData }' : 'where: SecurityWhere, data: SecurityData'}): Promise<${table ? '{ count: number }' : collection ? '{ modifiedCount: number }' : 'number'}>;
}
`)}
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret()${T(': string')} {
  const bytes = crypto.randomBytes(20);
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += ALPHABET[(value >>> bits) & 31]; }
  }
  return result;
}
function secretBytes(secret${T(': string')}) {
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error('Invalid TOTP secret');
  let bits = 0, value = 0;
  const bytes${T(': number[]')} = [];
  for (const char of secret) {
    value = (value << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
// RFC 6238: SHA-1, six digits, 30-second steps, one step of clock drift.
export function totp(secret${T(': string')}, step${T(': number')})${T(': string')} {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', secretBytes(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]${T('!')} & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function codeStep(secret${T(': string')}, code${T(': unknown')}, last = -1, now = Date.now())${T(': number | undefined')} {
  if (typeof code !== 'string' || !/^\\d{6}$/.test(code)) return undefined;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate > last && candidate >= 0 && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(totp(secret, candidate)))) return candidate;
  }
  return undefined;
}
function encryptionKey() {
  const key = process.env.TWO_FACTOR_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) throw new HttpError(503, 'TWO_FACTOR_KEY must be 32 random bytes encoded as 64 hex characters');
  return Buffer.from(key, 'hex');
}
export function sealSecret(secret${T(': string')}, identity${T(': string')})${T(': string')} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openSecret(encrypted${T(': string')}, identity${T(': string')})${T(': string')} {
  const key = encryptionKey();
  try {
    const data = Buffer.from(encrypted, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new HttpError(503, 'Two-factor secret could not be decrypted'); }
}
export async function updateSecurity(model${T(': SecurityModel')}, where${T(': SecurityWhere')}, data${T(': SecurityData')})${T(': Promise<boolean>')} {
${table ? '' : `  // Older MongoDB records may predate the defaulted enabled flag. Missing means off.\n  if (where.twoFactorEnabled === false) where = { ...where, twoFactorEnabled: { $ne: true } };\n`}  const result = await model.updateMany(${where});
  return ${result} === 1;
}
export function allowedMethods()${T(': string[]')} {
  const value = process.env.TWO_FACTOR_METHOD ?? 'totp';
  if (!['totp', 'email', 'both'].includes(value)) throw new HttpError(503, 'Invalid TWO_FACTOR_METHOD');
  return value === 'both' ? ['totp', 'email'] : [value];
}
function emailDigest(identity${T(': string')}, purpose${T(': string')}, code${T(': string')}) {
  return crypto.createHmac('sha256', encryptionKey()).update(identity + ':' + purpose + ':' + code).digest('hex');
}
export async function sendEmailCode(model${T(': SecurityModel')}, account${T(': SecurityAccount')}, kind${T(': string')}, purpose${T(': string')}) {
  if (!process.env.SMTP_HOST) throw new HttpError(503, 'Configure the email-client SMTP settings before using email OTP');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const twoFactorEmailHash = emailDigest(kind + ':' + account.id + ':' + account.email, purpose, code);
  const updated = await updateSecurity(model, { id: account.id, twoFactorEnabled: !!account.twoFactorEnabled }, {
    twoFactorEmailHash, twoFactorEmailExpiry: new Date(Date.now() + 300000), twoFactorEmailPurpose: purpose,
  });
  if (!updated) throw new HttpError(409, 'Account security changed; try again');
  try {
    await enqueue('SendEmail', { to: account.email, subject: 'Your EFC verification code', body: 'Your verification code is <b>' + code + '</b>. It expires in 5 minutes.' });
  } catch (error) {
    await updateSecurity(model, { id: account.id, twoFactorEmailHash }, { twoFactorEmailHash: '' });
    throw error;
  }
}
export async function consumeEmailCode(model${T(': SecurityModel')}, account${T(': SecurityAccount')}, kind${T(': string')}, purpose${T(': string')}, code${T(': unknown')})${T(': Promise<boolean>')} {
  if (typeof code !== 'string' || !/^\\d{6}$/.test(code) || !account.twoFactorEmailHash || account.twoFactorEmailPurpose !== purpose || !account.twoFactorEmailExpiry || new Date(account.twoFactorEmailExpiry).getTime() <= Date.now()) return false;
  const digest = emailDigest(kind + ':' + account.id + ':' + account.email, purpose, code);
  const stored = Buffer.from(account.twoFactorEmailHash, 'hex');
  const supplied = Buffer.from(digest, 'hex');
  if (stored.length !== supplied.length || !crypto.timingSafeEqual(stored, supplied)) return false;
  return updateSecurity(model, { id: account.id, twoFactorEmailHash: account.twoFactorEmailHash, twoFactorEnabled: !!account.twoFactorEnabled }, { twoFactorEmailHash: '', twoFactorEmailExpiry: new Date(0) });
}
export async function acceptTwoFactor(model${T(': SecurityModel')}, account${T(': SecurityAccount')}, kind${T(': string')}, code${T(': unknown')}, purpose = 'login')${T(': Promise<boolean>')} {
  if (!account.twoFactorEnabled) return true;
  const method = account.twoFactorMethod ?? 'totp';
  if (!allowedMethods().includes(method)) return false;
  if (method === 'email') {
    if (code === undefined) { await sendEmailCode(model, account, kind, purpose); return false; }
    return consumeEmailCode(model, account, kind, purpose, code);
  }
  if (!account.twoFactorSecret) return false;
  const step = codeStep(openSecret(account.twoFactorSecret, kind + ':' + account.id), code, account.twoFactorLastStep ?? -1);
  if (step === undefined) return false;
  // Compare-and-set in the database: only one worker can accept a given code.
  return updateSecurity(model, { id: account.id, twoFactorEnabled: true, twoFactorSecret: account.twoFactorSecret, twoFactorLastStep: { ${less}: step } }, { twoFactorLastStep: step });
}
`;
}

export function twoFactorRoutes(
  ts: boolean,
  table: boolean,
  hasAdmin: boolean,
): Record<string, string> {
  const T = (type: string) => (ts ? type : '');
  const find = (model: string) =>
    table ? `${model}.findUnique({ where: { id } })` : `${model}.findById(id)`;
  const imports = `import { requireAuth, getCurrentUser, verifyPassword, revokeAllSessions } from 'express-file-cluster/auth';
import { HttpError, rateLimit } from 'express-file-cluster';
${T("import type { Request, Response } from 'express';\n")}import { User } from '../../../model/User.js';
${hasAdmin ? "import { Admin } from '../../../model/Admin.js';\n" : ''}import { newSecret, sealSecret, openSecret, codeStep, updateSecurity, acceptTwoFactor, allowedMethods, sendEmailCode, consumeEmailCode } from '../../../lib/two-factor.js';

export const middlewares = [requireAuth, rateLimit({ window: '15m', max: 10, name: 'two-factor-management', key: () => String(getCurrentUser()?.id ?? ''), onCacheError: 'reject' })];

async function currentAccount() {
  const principal = getCurrentUser();
  if (!principal || typeof principal.id !== 'string') throw new HttpError(401, 'Unauthorized');
  const id = principal.id;
  const kind = ${hasAdmin ? "principal.role === 'admin' ? 'admin' : 'user'" : "'user'"};
  const model = ${hasAdmin ? "kind === 'admin' ? Admin : User" : 'User'};
  const account = ${hasAdmin ? `kind === 'admin' ? await ${find('Admin')} : await ${find('User')}` : `await ${find('User')}`};
  if (!account || !account.isActive) throw new HttpError(403, 'Account unavailable');
  return { account, kind, model };
}
`;
  const revoke = `  await revokeAllSessions(account.id);
  res.clearCookie('efc_refresh_token');
`;
  const setup = `${imports}
export const GET = async (_req${T(': Request')}, res${T(': Response')}) => {
  const { account } = await currentAccount();
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: !!account.twoFactorEnabled, method: account.twoFactorMethod || null, methods: allowedMethods() });
};

export const POST = async (req${T(': Request')}, res${T(': Response')}) => {
  res.set('Cache-Control', 'no-store');
  const { password, code, method = 'totp' } = req.body ?? {};
  if (typeof password !== 'string' || !password || (code !== undefined && (typeof code !== 'string' || !/^\\d{6}$/.test(code)))) return res.status(400).json({ error: 'password and a six-digit code (when confirming) are required' });
  const { account, kind, model } = await currentAccount();
  if (!(await verifyPassword(password, account.password))) return res.status(401).json({ error: 'Invalid credentials' });
  if (account.twoFactorEnabled) return res.status(409).json({ error: 'Two-factor authentication is already enabled' });
  const identity = kind + ':' + account.id;
  if (typeof method !== 'string' || !allowedMethods().includes(method)) return res.status(400).json({ error: 'Choose an allowed two-factor method' });
  if (code === undefined && method === 'email') {
    const updated = await updateSecurity(model, { id: account.id, twoFactorEnabled: false }, { twoFactorPendingMethod: 'email', twoFactorPendingSecret: '', twoFactorPendingExpiry: new Date(Date.now() + 300000) });
    if (!updated) return res.status(409).json({ error: 'Account changed; try again' });
    await sendEmailCode(model, account, kind, 'enroll');
    return res.status(202).json({ method: 'email', codeSent: true, expiresIn: 300 });
  }
  if (code === undefined) {
    const secret = newSecret();
    const encrypted = sealSecret(secret, identity);
    const updated = await updateSecurity(model, { id: account.id, twoFactorEnabled: false }, { twoFactorPendingMethod: 'totp', twoFactorPendingSecret: encrypted, twoFactorPendingExpiry: new Date(Date.now() + 600000) });
    if (!updated) return res.status(409).json({ error: 'Account changed; try again' });
    const issuer = 'EFC';
    const otpauthUrl = 'otpauth://totp/' + encodeURIComponent(issuer + ':' + account.email) + '?secret=' + secret + '&issuer=' + issuer + '&algorithm=SHA1&digits=6&period=30';
    return res.json({ method: 'totp', secret, otpauthUrl, expiresIn: 600 });
  }
  if (account.twoFactorPendingMethod !== method || !account.twoFactorPendingExpiry || new Date(account.twoFactorPendingExpiry).getTime() <= Date.now()) return res.status(400).json({ error: 'Enrollment expired; start again' });
  let step = -1;
  if (method === 'email') {
    if (!(await consumeEmailCode(model, account, kind, 'enroll', code))) return res.status(401).json({ error: 'Invalid or expired email code' });
  } else {
    if (!account.twoFactorPendingSecret) return res.status(400).json({ error: 'Start enrollment first' });
    const matched = codeStep(openSecret(account.twoFactorPendingSecret, identity), code);
    if (matched === undefined) return res.status(401).json({ error: 'Invalid authenticator code' });
    step = matched;
  }
  const enabled = await updateSecurity(model, { id: account.id, twoFactorEnabled: false, twoFactorPendingMethod: method, twoFactorPendingSecret: account.twoFactorPendingSecret ?? '' }, {
    twoFactorEnabled: true, twoFactorMethod: method, twoFactorSecret: method === 'totp' ? (account.twoFactorPendingSecret ?? '') : '', twoFactorLastStep: step,
    twoFactorPendingMethod: '', twoFactorPendingSecret: '', twoFactorPendingExpiry: new Date(0), refreshToken: '', refreshTokenExpiry: new Date(0),
  });
  if (!enabled) return res.status(409).json({ error: 'Enrollment changed; start again' });
${revoke}  res.json({ message: '2FA enabled; log in again with your verification code' });
};
`;
  // Reuse the entire login flow, including password, account state, rate limit,
  // code replay protection and issuing access/refresh tokens only after success.
  const verify = `export { middlewares, POST } from '../login.js';\n`;
  const disable = `${imports}
export const POST = async (req${T(': Request')}, res${T(': Response')}) => {
  const { password, code } = req.body ?? {};
  if (typeof password !== 'string' || !password || (code !== undefined && (typeof code !== 'string' || !/^\\d{6}$/.test(code)))) return res.status(400).json({ error: 'password and a six-digit code are required' });
  const { account, kind, model } = await currentAccount();
  if (!(await verifyPassword(password, account.password))) return res.status(401).json({ error: 'Invalid credentials' });
  if (!account.twoFactorEnabled) return res.status(409).json({ error: 'Two-factor authentication is not enabled' });
  if (account.twoFactorMethod === 'email' && code === undefined) {
    await sendEmailCode(model, account, kind, 'disable');
    return res.status(202).json({ codeSent: true, expiresIn: 300 });
  }
  if (!(await acceptTwoFactor(model, account, kind, code, 'disable'))) return res.status(401).json({ error: 'Invalid or already used authenticator code' });
  const disabled = await updateSecurity(model, { id: account.id, twoFactorEnabled: true, twoFactorSecret: account.twoFactorSecret ?? '' }, {
    twoFactorEnabled: false, twoFactorMethod: '', twoFactorSecret: '', twoFactorLastStep: -1, twoFactorPendingSecret: '', twoFactorPendingMethod: '', twoFactorEmailHash: '', twoFactorEmailExpiry: new Date(0),
    twoFactorPendingExpiry: new Date(0), refreshToken: '', refreshTokenExpiry: new Date(0),
  });
  if (!disabled) return res.status(409).json({ error: 'Account changed; try again' });
${revoke}  res.json({ message: '2FA disabled; log in again' });
};
`;
  return { '2fa/setup': setup, '2fa/verify': verify, '2fa/disable': disable };
}
