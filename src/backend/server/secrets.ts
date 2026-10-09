import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { GLOBAL_USER_ID } from './user';
import { dataFile } from './paths';

interface KeyStore {
  prepare(sql: string): {
    get(...params: Array<string | number | boolean | null>): Promise<Record<string, unknown> | undefined>;
    run(...params: Array<string | number | boolean | null>): Promise<unknown>;
  };
}

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_SETTING = 'encryptionKey';

let cachedKey: Buffer | null = null;
let decryptKeys: Buffer[] = [];

function envTrim(name: string): string | undefined {
  const raw = process.env[name];
  if (raw == null) return undefined;
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

function keyFromBase64(value: string, label: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${label} must decode to ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  return key;
}

function keyFromAuthSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function readLegacyFileKey(): Buffer | undefined {
  const keyPath = dataFile('secret.key');
  if (!existsSync(keyPath)) return undefined;
  try {
    const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
    return key.length === KEY_BYTES ? key : undefined;
  } catch {
    return undefined;
  }
}

async function persistKey(store: KeyStore, key: Buffer): Promise<void> {
  await store
    .prepare(
      `INSERT INTO app_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO NOTHING`,
    )
    .run(GLOBAL_USER_ID, KEY_SETTING, key.toString('base64'));
}

/**
 * Loads the AES key from the database so a restart does not invent a new key
 * and lock out the stored Jira token. METRICS_DASHBOARD_KEY wins when set.
 */
function rememberKey(key: Buffer): void {
  const seen = new Set(decryptKeys.map((item) => item.toString('hex')));
  if (!seen.has(key.toString('hex'))) decryptKeys.push(key);
}

export async function ensureEncryptionKey(store: KeyStore): Promise<void> {
  if (cachedKey) return;

  const fromEnv = envTrim('METRICS_DASHBOARD_KEY');
  if (fromEnv) rememberKey(keyFromBase64(fromEnv, 'METRICS_DASHBOARD_KEY'));

  const authSecret = envTrim('AUTH_SECRET');
  if (authSecret) rememberKey(keyFromAuthSecret(authSecret));

  const row = (await store
    .prepare('SELECT value FROM app_settings WHERE user_id = ? AND key = ?')
    .get(GLOBAL_USER_ID, KEY_SETTING)) as { value?: string } | undefined;
  if (row?.value) rememberKey(keyFromBase64(row.value, 'app_settings.encryptionKey'));

  const legacy = readLegacyFileKey();
  if (legacy) rememberKey(legacy);

  if (decryptKeys.length === 0) rememberKey(randomBytes(KEY_BYTES));

  cachedKey = decryptKeys[0];
  await persistKey(store, cachedKey);
}

function loadKey(): Buffer {
  if (!cachedKey) {
    throw new Error('Encryption key is not ready. Open the database before reading secrets.');
  }
  return cachedKey;
}

/** Encrypts a Jira token for storage. Format: v1.<iv>.<tag>.<ciphertext>, base64url parts. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [version, ivPart, tagPart, dataPart] = stored.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('Stored credential is not in the expected format.');
  }
  const keys = decryptKeys.length > 0 ? decryptKeys : [loadKey()];
  let lastError: unknown;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Stored credential could not be decrypted.');
}

/** Shows only enough of a token to recognise it, never the token itself. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '*'.repeat(plain.length);
  return `${plain.slice(0, 3)}${'*'.repeat(Math.min(12, plain.length - 7))}${plain.slice(-4)}`;
}
