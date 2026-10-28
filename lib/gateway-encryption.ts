import crypto from 'crypto';

/**
 * Gateway Security & Encryption Utilities
 * Handles secure storage and retrieval of API keys using AES-256-GCM encryption
 */

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_LENGTH = 16;
const IV_LENGTH = 12;
const SALT_LENGTH = 32;

export interface EncryptedData {
  iv: string; // base64
  authTag: string; // base64
  salt: string; // base64
  encrypted: string; // base64
}

/**
 * Derives a 256-bit key from a master key and salt using PBKDF2
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
}

/**
 * Encrypts sensitive data (API keys) using AES-256-GCM
 * @param plaintext - The sensitive data to encrypt (e.g., API key)
 * @param masterKey - The master encryption key (from env)
 * @returns Encrypted data with IV, auth tag, and salt
 */
export function encryptSensitiveData(plaintext: string, masterKey: string): EncryptedData {
  if (!masterKey || masterKey.length < 16) {
    throw new Error('Master encryption key must be at least 16 characters');
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive encryption key from master key
  const key = deriveKey(masterKey, salt);

  // Create cipher and encrypt
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'binary');
  encrypted += cipher.final('binary');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
    encrypted: Buffer.from(encrypted, 'binary').toString('base64'),
  };
}

/**
 * Decrypts data encrypted with encryptSensitiveData
 * @param encryptedData - The encrypted data object
 * @param masterKey - The master encryption key (from env)
 * @returns Decrypted plaintext
 */
export function decryptSensitiveData(encryptedData: EncryptedData, masterKey: string): string {
  if (!masterKey || masterKey.length < 16) {
    throw new Error('Master encryption key must be at least 16 characters');
  }

  try {
    // Decode base64 components
    const salt = Buffer.from(encryptedData.salt, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    const encrypted = Buffer.from(encryptedData.encrypted, 'base64');

    // Derive the same key
    const key = deriveKey(masterKey, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('binary'), 'binary', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Failed to decrypt data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Mask API keys for display (show only last 4 characters)
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '••••';
  return '••••' + apiKey.slice(-4);
}

/**
 * Validates that the encryption master key is configured
 */
export function validateEncryptionKey(): boolean {
  const masterKey = process.env.GATEWAY_ENCRYPTION_KEY;
  return !!masterKey && masterKey.length >= 16;
}

/**
 * Type for encrypted API key storage
 */
export interface StoredApiKey {
  provider: string;
  encryptedKey: EncryptedData;
  lastUpdated: number;
  masked: string;
}
