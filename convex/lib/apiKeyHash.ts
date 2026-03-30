/**
 * Hashes a raw API key string using SHA-256.
 * Returns the hash as a lowercase hex string.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  const encoded = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
