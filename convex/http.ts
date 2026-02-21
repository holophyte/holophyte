import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { auth } from './auth';
import { validateSecret } from './lib/validateSecret';

const http = httpRouter();

const jsonError = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const jsonOk = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Parse JSON body, validate it's a non-null object, and return it typed
 * as `any` so callers can destructure fields for Convex's runtime validators.
 */
// biome-ignore lint/suspicious/noExplicitAny: Convex runtime validators handle type safety
async function parseBody(request: Request): Promise<any | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('Invalid request body', 400);
  }
  return body;
}

auth.addHttpRoutes(http);

http.route({
  path: '/api/internal/sessions/updateSdkSessionId',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id, sdkSessionId, model, permissionMode } = body;
      await ctx.runMutation(internal.sessions.updateSdkSessionId, {
        id,
        sdkSessionId,
        model,
        permissionMode,
      });
      return jsonOk();
    } catch (err) {
      console.error('updateSdkSessionId failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

http.route({
  path: '/api/internal/sessions/updateStatus',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id, status } = body;
      await ctx.runMutation(internal.sessions.serverUpdateStatus, {
        id,
        status,
      });
      return jsonOk();
    } catch (err) {
      console.error('serverUpdateStatus failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

http.route({
  path: '/api/internal/sessionEvents/insertBatch',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { sessionId, events, batchIndex } = body;
      await ctx.runMutation(internal.sessionEvents.insertBatch, {
        sessionId,
        events,
        batchIndex,
      });
      return jsonOk();
    } catch (err) {
      console.error('insertBatch failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

export default http;
