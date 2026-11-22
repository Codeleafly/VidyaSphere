/**
 * Pure Web Crypto Subtle Engine for VidyaSphere
 * Zero external packages, zero npm dependencies.
 * Implements:
 * - PBKDF2 Password Hashing & Verification
 * - HMAC-SHA256 JWT Signing & Verification
 * - High-Entropy Activation Codes & Token Generators
 * - SHA-256 Digest Hashing
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Helper: Uint8Array / ArrayBuffer to Hex String
export function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// Helper: Hex String to Uint8Array
export function fromHex(hexString) {
  const match = hexString.match(/.{1,2}/g);
  if (!match) return new Uint8Array(0);
  return new Uint8Array(match.map(byte => parseInt(byte, 16)));
}

// Helper: Buffer to Base64URL
export function bufferToBase64Url(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Helper: Base64URL to ArrayBuffer
export function base64UrlToBuffer(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function stringToBase64Url(str) {
  return bufferToBase64Url(ENCODER.encode(str));
}

export function base64UrlToString(base64url) {
  const buf = base64UrlToBuffer(base64url);
  return DECODER.decode(buf);
}

/**
 * Generate cryptographically secure random token (e.g., tracking tokens, IDs)
 */
export function generateId(prefix = 'vs', byteLength = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return `${prefix}_${toHex(bytes)}`;
}

/**
 * Generate 256-bit cryptographically secure random session token (impossible to forge or guess)
 */
export function generateSecureSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits of pure randomness
  return `vss_${toHex(bytes)}`;
}

/**
 * Constant-time comparison to prevent timing-attack vulnerabilities
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate 6-digit alphanumeric Activation Code (easy for students to type)
 */
export function generateActivationCode(length = 6) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude ambiguous 0,1,I,O
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Compute SHA-256 hash of a string (used for activation code indexing)
 */
export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(text));
  return toHex(digest);
}

/**
 * PBKDF2 Password Hashing
 * 20,000 iterations PBKDF2-HMAC-SHA256
 */
export async function hashPassword(password, saltHex = null) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const pwKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 20000,
      hash: 'SHA-256'
    },
    pwKey,
    256
  );
  return {
    hash: toHex(derivedBits),
    salt: toHex(salt)
  };
}

/**
 * Verify password against stored hash and salt
 */
export async function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = await hashPassword(password, storedSalt);
  return hash === storedHash;
}

/**
 * Generate Stateless HMAC-SHA256 JWT
 */
export async function createJWT(payload, secret, expiresInSeconds = 86400 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(fullPayload));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, ENCODER.encode(dataToSign));
  const sigB64 = bufferToBase64Url(sigBuffer);

  return `${dataToSign}.${sigB64}`;
}

/**
 * Verify HMAC-SHA256 JWT
 */
export async function verifyJWT(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const dataToVerify = `${headerB64}.${payloadB64}`;

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      ENCODER.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBuffer = base64UrlToBuffer(sigB64);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      sigBuffer,
      ENCODER.encode(dataToVerify)
    );

    if (!isValid) return null;

    const payload = JSON.parse(base64UrlToString(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch (err) {
    return null;
  }
}
