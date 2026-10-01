import type { ReactNode } from 'react';

const DATABASE_NAME = 'binaa-private-vault-v1';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'vault';
const VAULT_RECORD_KEY = 'active';
const BACKUP_FORMAT = 'binaa-encrypted-vault-backup';
const PBKDF2_ITERATIONS = 310_000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type WrappedKey = {
  salt: string;
  iv: string;
  ciphertext: string;
};

export type VaultEnvelope = {
  version: 1;
  data: {
    iv: string;
    ciphertext: string;
  };
  passwordWrap: WrappedKey;
  recoveryWrap: {
    iv: string;
    ciphertext: string;
  };
};

export type VaultSession<T> = {
  data: T;
  save: (data: T) => Promise<void>;
  lock: () => void;
  exportBackup: () => Promise<void>;
  restoreBackup: (file: File, password: string) => Promise<T>;
  changePassword: (current: string, next: string) => Promise<void>;
};

export type VaultValidation<T> = (value: unknown) => value is T;

export type VaultGateProps<T> = {
  initialData: T;
  children: (session: VaultSession<T>) => ReactNode;
  validateData?: VaultValidation<T>;
};

export const VAULT_IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MS;

function fail(message: string): Error {
  return new Error(message);
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw fail('هذا المتصفح لا يدعم التشفير الآمن المطلوب للخزنة.');
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64ToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw fail('ملف الخزنة غير صالح أو تالف.');
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw fail('ملف الخزنة غير صالح أو تالف.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(size: number): Uint8Array {
  return cryptoApi().getRandomValues(new Uint8Array(size));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password);
}

function additionalData(value: string): Uint8Array {
  return new TextEncoder().encode(`binaa-vault-v1:${value}`);
}

function assertPassword(password: string): void {
  if (password.length < 8) throw fail('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.');
}

function assertData<T>(value: unknown, validator?: VaultValidation<T>): asserts value is T {
  if (validator && !validator(value)) {
    throw fail('البيانات لا تطابق بنية المشروع المطلوبة.');
  }
}

function serializeData(data: unknown): Uint8Array {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(data);
  } catch {
    throw fail('تعذر تجهيز البيانات للتشفير. تأكد أن البيانات بصيغة JSON.');
  }
  if (serialized === undefined) throw fail('تعذر حفظ قيمة غير قابلة للتحويل إلى JSON.');
  return new TextEncoder().encode(serialized);
}

async function derivePasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = cryptoApi();
  const encodedPassword = passwordBytes(password);
  try {
    const material = await crypto.subtle.importKey('raw', toArrayBuffer(encodedPassword), 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    encodedPassword.fill(0);
  }
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return cryptoApi().subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array, purpose: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const ciphertext = await cryptoApi().subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(additionalData(purpose)) },
    key,
    toArrayBuffer(bytes),
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptBytes(
  key: CryptoKey,
  encrypted: { iv: string; ciphertext: string },
  purpose: string,
): Promise<Uint8Array> {
  const iv = base64ToBytes(encrypted.iv);
  if (iv.length !== 12) throw fail('ملف الخزنة غير صالح أو تالف.');
  const clear = await cryptoApi().subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(additionalData(purpose)) },
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext)),
  );
  return new Uint8Array(clear);
}

async function wrapDataKeyWithPassword(rawDataKey: Uint8Array, password: string): Promise<WrappedKey> {
  assertPassword(password);
  const salt = randomBytes(16);
  const wrappingKey = await derivePasswordKey(password, salt);
  const wrapped = await encryptBytes(wrappingKey, rawDataKey, 'password-key-wrap');
  return { salt: bytesToBase64(salt), ...wrapped };
}

async function unwrapDataKeyWithPassword(envelope: VaultEnvelope, password: string): Promise<Uint8Array> {
  const salt = base64ToBytes(envelope.passwordWrap.salt);
  if (salt.length !== 16) throw fail('ملف الخزنة غير صالح أو تالف.');
  const wrappingKey = await derivePasswordKey(password, salt);
  return decryptBytes(wrappingKey, envelope.passwordWrap, 'password-key-wrap');
}

function recoveryBytesFromKey(recoveryKey: string): Uint8Array {
  const compact = recoveryKey.replace(/[\s.]/g, '');
  try {
    const bytes = base64ToBytes(compact);
    if (bytes.length === 32) return bytes;
  } catch {
    // Older displayed keys used hyphens as separators. Preserve exact base64url
    // parsing first, then accept that legacy grouping only as a fallback.
  }
  if (compact.includes('-')) {
    try {
      const legacyBytes = base64ToBytes(compact.replace(/-/g, ''));
      if (legacyBytes.length === 32) return legacyBytes;
    } catch {
      // Report a stable user-facing recovery-key error below.
    }
  }
  throw fail('مفتاح الاستعادة غير صحيح.');
}

export function createRecoveryKey(): string {
  const raw = randomBytes(32);
  const compact = bytesToBase64(raw);
  raw.fill(0);
  return compact.match(/.{1,4}/g)?.join('.') ?? compact;
}

async function wrapDataKeyWithRecovery(rawDataKey: Uint8Array, recoveryKey: string): Promise<VaultEnvelope['recoveryWrap']> {
  const recoveryBytes = recoveryBytesFromKey(recoveryKey);
  try {
    const wrappingKey = await importAesKey(recoveryBytes);
    return await encryptBytes(wrappingKey, rawDataKey, 'recovery-key-wrap');
  } finally {
    recoveryBytes.fill(0);
  }
}

async function unwrapDataKeyWithRecovery(envelope: VaultEnvelope, recoveryKey: string): Promise<Uint8Array> {
  const recoveryBytes = recoveryBytesFromKey(recoveryKey);
  try {
    const wrappingKey = await importAesKey(recoveryBytes);
    return await decryptBytes(wrappingKey, envelope.recoveryWrap, 'recovery-key-wrap');
  } finally {
    recoveryBytes.fill(0);
  }
}

function validateEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VaultEnvelope>;
  const wrappedKeyValid = (wrapped: unknown): wrapped is WrappedKey => {
    if (!wrapped || typeof wrapped !== 'object') return false;
    const record = wrapped as Partial<WrappedKey>;
    return typeof record.salt === 'string' && typeof record.iv === 'string' && typeof record.ciphertext === 'string';
  };
  const cipherValid = (cipher: unknown): cipher is { iv: string; ciphertext: string } => {
    if (!cipher || typeof cipher !== 'object') return false;
    const record = cipher as { iv?: unknown; ciphertext?: unknown };
    return typeof record.iv === 'string' && typeof record.ciphertext === 'string';
  };
  return candidate.version === 1 &&
    cipherValid(candidate.data) &&
    wrappedKeyValid(candidate.passwordWrap) &&
    cipherValid(candidate.recoveryWrap);
}

function parseBackup(value: unknown): VaultEnvelope {
  if (!value || typeof value !== 'object') throw fail('ملف النسخة الاحتياطية غير صالح.');
  const backup = value as { format?: unknown; envelope?: unknown };
  if (backup.format !== BACKUP_FORMAT || !validateEnvelope(backup.envelope)) {
    throw fail('صيغة ملف النسخة الاحتياطية غير مدعومة أو أن الملف تالف.');
  }
  return backup.envelope;
}

async function decryptVaultData<T>(envelope: VaultEnvelope, rawKey: Uint8Array, validator?: VaultValidation<T>): Promise<{ key: CryptoKey; data: T }> {
  if (rawKey.length !== 32) {
    rawKey.fill(0);
    throw fail('مفتاح الخزنة غير صالح.');
  }
  try {
    const key = await importAesKey(rawKey);
    const plaintext = await decryptBytes(key, envelope.data, 'vault-data');
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw fail('تعذر قراءة بيانات الخزنة؛ قد تكون تالفة.');
    } finally {
      plaintext.fill(0);
    }
    assertData<T>(value, validator);
    return { key, data: value };
  } finally {
    rawKey.fill(0);
  }
}

export async function createVaultEnvelope<T>(data: T, password: string, recoveryKey: string): Promise<{ envelope: VaultEnvelope; key: CryptoKey }> {
  assertPassword(password);
  const serializedData = serializeData(data);
  const rawKey = randomBytes(32);
  try {
    const key = await importAesKey(rawKey);
    const [passwordWrap, recoveryWrap, encryptedData] = await Promise.all([
      wrapDataKeyWithPassword(rawKey, password),
      wrapDataKeyWithRecovery(rawKey, recoveryKey),
      encryptBytes(key, serializedData, 'vault-data'),
    ]);
    return { envelope: { version: 1, data: encryptedData, passwordWrap, recoveryWrap }, key };
  } finally {
    rawKey.fill(0);
    serializedData.fill(0);
  }
}

export async function unlockVaultWithPassword<T>(
  envelope: VaultEnvelope,
  password: string,
  validator?: VaultValidation<T>,
): Promise<{ key: CryptoKey; data: T }> {
  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapDataKeyWithPassword(envelope, password);
  } catch {
    throw fail('كلمة المرور غير صحيحة أو ملف الخزنة تالف.');
  }
  try {
    return await decryptVaultData(envelope, rawKey, validator);
  } catch (error) {
    if (error instanceof Error && error.message === 'البيانات لا تطابق بنية المشروع المطلوبة.') throw error;
    throw fail('تعذر فك تشفير بيانات الخزنة؛ قد تكون تالفة.');
  }
}

export async function unlockVaultWithRecovery<T>(
  envelope: VaultEnvelope,
  recoveryKey: string,
  validator?: VaultValidation<T>,
): Promise<{ key: CryptoKey; data: T }> {
  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapDataKeyWithRecovery(envelope, recoveryKey);
  } catch {
    throw fail('مفتاح الاستعادة غير صحيح أو ملف الخزنة تالف.');
  }
  try {
    return await decryptVaultData(envelope, rawKey, validator);
  } catch (error) {
    if (error instanceof Error && error.message === 'البيانات لا تطابق بنية المشروع المطلوبة.') throw error;
    throw fail('تعذر فك تشفير بيانات الخزنة؛ قد تكون تالفة.');
  }
}

export async function rewrapVaultPassword(
  envelope: VaultEnvelope,
  currentPassword: string,
  nextPassword: string,
): Promise<VaultEnvelope> {
  assertPassword(nextPassword);
  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapDataKeyWithPassword(envelope, currentPassword);
  } catch {
    throw fail('كلمة المرور الحالية غير صحيحة.');
  }
  try {
    return { ...envelope, passwordWrap: await wrapDataKeyWithPassword(rawKey, nextPassword) };
  } finally {
    rawKey.fill(0);
  }
}

export async function rewrapVaultPasswordWithRecovery<T>(
  envelope: VaultEnvelope,
  recoveryKey: string,
  nextPassword: string,
  validator?: VaultValidation<T>,
): Promise<{ envelope: VaultEnvelope; key: CryptoKey; data: T }> {
  assertPassword(nextPassword);
  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapDataKeyWithRecovery(envelope, recoveryKey);
  } catch {
    throw fail('مفتاح الاستعادة غير صحيح.');
  }
  try {
    const nextEnvelope = { ...envelope, passwordWrap: await wrapDataKeyWithPassword(rawKey, nextPassword) };
    const opened = await decryptVaultData<T>(envelope, rawKey.slice(), validator);
    return { envelope: nextEnvelope, key: opened.key, data: opened.data };
  } finally {
    rawKey.fill(0);
  }
}

export async function encryptVaultData<T>(key: CryptoKey, data: T): Promise<VaultEnvelope['data']> {
  const plaintext = serializeData(data);
  try {
    return await encryptBytes(key, plaintext, 'vault-data');
  } finally {
    plaintext.fill(0);
  }
}

export async function unlockBackup<T>(
  file: File,
  password: string,
  validator?: VaultValidation<T>,
): Promise<T> {
  let envelope: VaultEnvelope;
  try {
    envelope = parseBackup(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof SyntaxError) throw fail('تعذر قراءة ملف النسخة الاحتياطية.');
    throw error;
  }
  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapDataKeyWithPassword(envelope, password);
  } catch {
    throw fail('كلمة مرور النسخة غير صحيحة.');
  }
  try {
    return (await decryptVaultData(envelope, rawKey, validator)).data;
  } catch (error) {
    if (error instanceof Error && error.message === 'البيانات لا تطابق بنية المشروع المطلوبة.') throw error;
    throw fail('تعذر فك تشفير بيانات النسخة؛ قد تكون تالفة.');
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(fail('التخزين المحلي الآمن غير متاح في هذا المتصفح.'));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      reject(fail('تعذر فتح التخزين المحلي للخزنة.'));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) database.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(fail('تعذر الوصول إلى التخزين المحلي. تحقق من إعدادات المتصفح ومساحته.'));
    request.onblocked = () => reject(fail('الخزنة مشغولة في نافذة أخرى. أغلق النوافذ الأخرى ثم أعد المحاولة.'));
  });
}

export async function readVaultEnvelope(): Promise<VaultEnvelope | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(OBJECT_STORE).get(VAULT_RECORD_KEY);
      let result: unknown;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => {
        if (result === undefined) {
          resolve(null);
        } else if (!validateEnvelope(result)) {
          reject(fail('بيانات الخزنة المخزنة غير صالحة أو تالفة.'));
        } else {
          resolve(result);
        }
      };
      transaction.onerror = () => reject(fail('تعذر قراءة بيانات الخزنة من التخزين المحلي.'));
      transaction.onabort = () => reject(fail('أُلغيت قراءة الخزنة من التخزين المحلي.'));
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('بيانات الخزنة')) throw error;
    throw fail('تعذر قراءة بيانات الخزنة من التخزين المحلي.');
  } finally {
    database.close();
  }
}

function sameEnvelopeRevision(left: VaultEnvelope, right: VaultEnvelope): boolean {
  return left.version === right.version &&
    left.data.iv === right.data.iv &&
    left.data.ciphertext === right.data.ciphertext &&
    left.passwordWrap.salt === right.passwordWrap.salt &&
    left.passwordWrap.iv === right.passwordWrap.iv &&
    left.passwordWrap.ciphertext === right.passwordWrap.ciphertext &&
    left.recoveryWrap.iv === right.recoveryWrap.iv &&
    left.recoveryWrap.ciphertext === right.recoveryWrap.ciphertext;
}

export async function writeVaultEnvelope(envelope: VaultEnvelope, expected: VaultEnvelope | null): Promise<void> {
  if (expected === undefined) throw fail('تعذر التحقق من نسخة الخزنة الحالية قبل الحفظ.');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readwrite');
      const store = transaction.objectStore(OBJECT_STORE);
      let conflictMessage = '';
      const request = store.get(VAULT_RECORD_KEY);
      request.onsuccess = () => {
        const current = request.result;
        if (expected === null) {
          if (current !== undefined) {
            conflictMessage = 'توجد خزنة بالفعل في نافذة أخرى. أعد تحميل الصفحة وافتح الخزنة.';
            transaction.abort();
            return;
          }
        } else if (!validateEnvelope(current) || !sameEnvelopeRevision(current, expected)) {
          conflictMessage = 'تغيّرت الخزنة في نافذة أخرى. أعد تحميل الصفحة ثم أعد المحاولة؛ لم يتم تطبيق التغيير.';
          transaction.abort();
          return;
        }
        store.put(envelope, VAULT_RECORD_KEY);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(fail(conflictMessage || 'تعذر حفظ الخزنة محلياً. تحقق من مساحة التخزين.'));
      transaction.onabort = () => reject(fail(conflictMessage || 'أُلغيت عملية حفظ الخزنة.'));
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('توجد خزنة') ||
      error.message.startsWith('تغيّرت الخزنة') ||
      error.message.startsWith('أُلغيت')
    )) throw error;
    throw fail('تعذر حفظ الخزنة محلياً. تحقق من مساحة التخزين وإعدادات المتصفح.');
  } finally {
    database.close();
  }
}

export function backupBlob(envelope: VaultEnvelope): Blob {
  return new Blob([JSON.stringify({ format: BACKUP_FORMAT, envelope })], { type: 'application/json' });
}