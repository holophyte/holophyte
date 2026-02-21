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
      const args = await request.json();
      await ctx.runMutation(internal.sessions.updateSdkSessionId, args);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
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
      const args = await request.json();
      await ctx.runMutation(internal.sessions.serverUpdateStatus, args);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
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
      const args = await request.json();
      await ctx.runMutation(internal.sessionEvents.insertBatch, args);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
});

export default http;
