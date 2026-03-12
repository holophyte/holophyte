/** Constant-time string comparison to prevent timing attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validates the Bearer token from the Authorization header against
 * the INTERNAL_API_SECRET environment variable.
 *
 * @returns null if valid, or an error Response if invalid.
 */
export function validateSecret(request: Request): Response | null {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error('INTERNAL_API_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const token = authHeader.slice(7);
  if (!constantTimeEqual(token, secret)) {
    return new Response(JSON.stringify({ error: 'Invalid secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

/** Constant-time check for companion queries. Returns true if valid. */
export function validateCompanionSecret(secret: string): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  return constantTimeEqual(secret, expected);
}
