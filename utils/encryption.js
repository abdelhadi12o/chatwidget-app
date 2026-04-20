const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get encryption key from environment and validate it's 32 characters
 */
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
  }
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns the encrypted data as a base64 string in format: iv:ciphertext:authTag
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Combine IV, ciphertext, and authTag
  const encrypted = iv.toString('hex') + ':' + ciphertext + ':' + authTag.toString('hex');

  // Return base64 encoded for safe storage
  return Buffer.from(encrypted).toString('base64');
}

/**
 * Decrypt an encrypted string using AES-256-GCM
 * If decryption fails (e.g., plaintext was not encrypted), returns the original string
 */
function decrypt(encryptedValue) {
  if (!encryptedValue) return encryptedValue;

  try {
    // Decode from base64
    const decoded = Buffer.from(encryptedValue, 'base64').toString('utf8');

    // Check if it has the encrypted format (contains colons)
    const parts = decoded.split(':');
    if (parts.length !== 3) {
      // Not in encrypted format, return as-is (plaintext fallback)
      return encryptedValue;
    }

    const [ivHex, ciphertext, authTagHex] = parts;

    // Validate hex strings
    if (!/^[a-f0-9]+$/i.test(ivHex) || !/^[a-f0-9]+$/i.test(ciphertext) || !/^[a-f0-9]+$/i.test(authTagHex)) {
      // Invalid format, return as-is (plaintext fallback)
      return encryptedValue;
    }

    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (error) {
    // Decryption failed - return original value (plaintext fallback)
    return encryptedValue;
  }
}

module.exports = {
  encrypt,
  decrypt
};
