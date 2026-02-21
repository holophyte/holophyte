/**
 * Validates the Bearer token from the Authorization header against
 * the INTERNAL_API_SECRET environment variable.
 *
 * @returns null if valid, or a 401 Response if invalid.
 */
export function validateSecret(request: Request): Response | null {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'INTERNAL_API_SECRET not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const token = authHeader.slice(7);
  if (token !== secret) {
    return new Response(JSON.stringify({ error: 'Invalid secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}
