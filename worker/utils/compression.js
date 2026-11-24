/**
 * Shared Gzip Compression & Binary Normalization Utilities
 * Pure Native Web Standards (CompressionStream / DecompressionStream)
 */

/**
 * Compress an ArrayBuffer or TypedArray losslessly using gzip.
 */
export async function compressData(data) {
  const stream = new Response(data).body.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/**
 * Decompress a gzip-compressed ArrayBuffer or TypedArray.
 */
export async function decompressData(compressedData) {
  const stream = new Response(compressedData).body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/**
 * Normalize SQLite/D1 BLOB values (Uint8Array, ArrayBufferView, Array, or base64 string) into Uint8Array.
 */
export function toUint8Array(rawData) {
  if (rawData instanceof Uint8Array) return rawData;
  if (ArrayBuffer.isView(rawData)) {
    return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
  }
  if (typeof rawData === 'string') {
    const bin = atob(rawData);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  return new Uint8Array(rawData);
}

/**
 * Validate an optional external URL ensuring only http/https schemes are accepted.
 */
export function validateHttpUrl(rawUrl) {
  if (!rawUrl || !String(rawUrl).trim()) return null;
  const trimmed = String(rawUrl).trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'URL must start with http:// or https://' };
    }
    return { url: parsed.toString() };
  } catch {
    return { error: 'Please provide a valid http:// or https:// URL' };
  }
}

/**
 * Parse a SQLite DATETIME string ('YYYY-MM-DD HH:MM:SS') or ISO string safely as UTC Date.
 */
export function parseUtcTimestamp(dateStr) {
  if (!dateStr) return new Date(0);
  const str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
    return new Date(str.replace(' ', 'T') + 'Z');
  }
  return new Date(str);
}
