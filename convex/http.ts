import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { auth } from './auth';
import { validateSecret } from './lib/validateSecret';

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: '/api/internal/sessions/updateSdkSessionId',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const { id, sdkSessionId, model, permissionMode } = await request.json();
      await ctx.runMutation(internal.sessions.updateSdkSessionId, {
        id,
        sdkSessionId,
        model,
        permissionMode,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('updateSdkSessionId failed:', err);
      return new Response(JSON.stringify({ error: 'Mutation failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
});

http.route({
  path: '/api/internal/sessions/updateStatus',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const { id, status } = await request.json();
      await ctx.runMutation(internal.sessions.serverUpdateStatus, {
        id,
        status,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('serverUpdateStatus failed:', err);
      return new Response(JSON.stringify({ error: 'Mutation failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
});

http.route({
  path: '/api/internal/sessionEvents/insertBatch',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const { sessionId, events, batchIndex } = await request.json();
      await ctx.runMutation(internal.sessionEvents.insertBatch, {
        sessionId,
        events,
        batchIndex,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('insertBatch failed:', err);
      return new Response(JSON.stringify({ error: 'Mutation failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
});

export default http;
