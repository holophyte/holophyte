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
  path: '/api/internal/sessions/markStaleRunning',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const result = await ctx.runMutation(
        internal.sessions.serverMarkStaleRunning,
        {},
      );
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('serverMarkStaleRunning failed:', err);
      return jsonError('Mutation failed', 500);
    }
  }),
});

http.route({
  path: '/api/internal/sessions/markStoppedAsIdle',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const result = await ctx.runMutation(
        internal.sessions.serverMarkStoppedAsIdle,
        {},
      );
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('serverMarkStoppedAsIdle failed:', err);
      return jsonError('Mutation failed', 500);
    }
  }),
});

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
  path: '/api/internal/sessions/updateActivity',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id } = body;
      await ctx.runMutation(internal.sessions.serverUpdateActivity, { id });
      return jsonOk();
    } catch (err) {
      console.error('serverUpdateActivity failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

http.route({
  path: '/api/internal/sessions/updateName',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id, name } = body;
      await ctx.runMutation(internal.sessions.serverUpdateName, { id, name });
      return jsonOk();
    } catch (err) {
      console.error('serverUpdateName failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

// ── Companion polling endpoints ───────────────────────────────────────

http.route({
  path: '/api/internal/sessions/listQueued',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const sessions = await ctx.runQuery(internal.sessions.listQueued, {});
      return new Response(JSON.stringify(sessions), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('listQueued failed:', err);
      return jsonError('Query failed', 500);
    }
  }),
});

http.route({
  path: '/api/internal/sessions/claimQueued',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id } = body;
      const result = await ctx.runMutation(internal.sessions.claimQueued, {
        id,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('claimQueued failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

http.route({
  path: '/api/internal/sessions/listStopped',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const sessions = await ctx.runQuery(internal.sessions.listStopped, {});
      return new Response(JSON.stringify(sessions), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('listStopped failed:', err);
      return jsonError('Query failed', 500);
    }
  }),
});

http.route({
  path: '/api/internal/sessionMessages/listPending',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    try {
      const messages = await ctx.runQuery(
        internal.sessionMessages.listPending,
        {},
      );
      return new Response(JSON.stringify(messages), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('listPending failed:', err);
      return jsonError('Query failed', 500);
    }
  }),
});

http.route({
  path: '/api/internal/sessionMessages/markConsumed',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id } = body;
      await ctx.runMutation(internal.sessionMessages.markConsumed, { id });
      return jsonOk();
    } catch (err) {
      console.error('markConsumed failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

// ── Pending approvals ────────────────────────────────────────────────

http.route({
  path: '/api/internal/pendingApprovals/create',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { sessionId, requestId, tool, input } = body;
      await ctx.runMutation(internal.pendingApprovals.serverCreate, {
        sessionId,
        requestId,
        tool,
        input,
      });
      return jsonOk();
    } catch (err) {
      console.error('pendingApprovals.serverCreate failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

http.route({
  path: '/api/internal/pendingApprovals/listResolvedUnconsumed',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { sessionId } = body;
      const approvals = await ctx.runQuery(
        internal.pendingApprovals.serverListResolvedUnconsumed,
        { sessionId },
      );
      return new Response(JSON.stringify(approvals), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('pendingApprovals.listResolvedUnconsumed failed:', err);
      return jsonError('Query failed', 500);
    }
  }),
});

http.route({
  path: '/api/internal/pendingApprovals/markConsumed',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { id } = body;
      await ctx.runMutation(internal.pendingApprovals.serverMarkConsumed, {
        id,
      });
      return jsonOk();
    } catch (err) {
      console.error('pendingApprovals.serverMarkConsumed failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

http.route({
  path: '/api/internal/pendingApprovals/denyAll',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { sessionId } = body;
      await ctx.runMutation(internal.pendingApprovals.serverDenyAll, {
        sessionId,
      });
      return jsonOk();
    } catch (err) {
      console.error('pendingApprovals.serverDenyAll failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

// ── Session heartbeat ────────────────────────────────────────────────

http.route({
  path: '/api/internal/sessions/batchHeartbeat',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { sessionIds } = body;
      await ctx.runMutation(internal.sessions.serverBatchHeartbeat, {
        sessionIds,
      });
      return jsonOk();
    } catch (err) {
      console.error('serverBatchHeartbeat failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

// ── Session event persistence ────────────────────────────────────────

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

http.route({
  path: '/api/internal/sessionEvents/getNextBatchIndex',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { sessionId } = body;
      const nextBatchIndex = await ctx.runQuery(
        internal.sessionEvents.getNextBatchIndex,
        { sessionId },
      );
      return new Response(JSON.stringify(nextBatchIndex), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('getNextBatchIndex failed:', err);
      return jsonError('Query failed', 400);
    }
  }),
});

// ── Companion heartbeat ───────────────────────────────────────────────

http.route({
  path: '/api/internal/companion/heartbeat',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateSecret(request);
    if (authError) return authError;

    const body = await parseBody(request);
    if (body instanceof Response) return body;

    try {
      const { activeSessionCount, machineId, url } = body;
      if (url != null && !/^http:\/\/localhost(:\d+)?$/.test(url)) {
        return jsonError('url must be a localhost address', 400);
      }
      await ctx.runMutation(internal.companion.upsertHeartbeat, {
        activeSessionCount,
        machineId,
        url,
      });
      return jsonOk();
    } catch (err) {
      console.error('companion.upsertHeartbeat failed:', err);
      return jsonError('Mutation failed', 400);
    }
  }),
});

export default http;
