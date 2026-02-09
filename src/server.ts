import homepage from "../public/index.html";
import {
  startSession,
  stopSession,
  resizeSession,
  getSession,
  subscribe,
  writeToSession,
} from "./claude/manager";

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  routes: {
    "/": homepage,

    "/api/validate-repo": {
      async POST(req) {
        const { path } = await req.json();
        try {
          const gitHead = Bun.file(`${path}/.git/HEAD`);
          const exists = await gitHead.exists();
          if (!exists) {
            return Response.json({
              valid: false,
              error: "Not a git repository (no .git/HEAD found).",
            });
          }
          return Response.json({ valid: true });
        } catch {
          return Response.json({
            valid: false,
            error: "Could not access path.",
          });
        }
      },
    },

    "/api/sessions/start": {
      async POST(req) {
        try {
          const { taskId, repoPath, prompt } = await req.json();
          if (!taskId || !repoPath || !prompt) {
            return Response.json(
              { error: "taskId, repoPath, and prompt are required" },
              { status: 400 },
            );
          }
          const result = await startSession({ taskId, repoPath, prompt });
          return Response.json(result);
        } catch (err) {
          console.error("Failed to start session:", err);
          return Response.json(
            { error: String(err) },
            { status: 500 },
          );
        }
      },
    },
  },

  fetch(req, server) {
    const url = new URL(req.url);

    // POST /api/sessions/:id/stop
    const stopMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/stop$/);
    if (stopMatch && req.method === "POST") {
      const sessionId = stopMatch[1]!;
      stopSession(sessionId);
      return Response.json({ ok: true });
    }

    // POST /api/sessions/:id/resize
    const resizeMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/resize$/);
    if (resizeMatch && req.method === "POST") {
      return (async () => {
        const sessionId = resizeMatch[1]!;
        const { cols, rows } = await req.json();
        resizeSession(sessionId, cols, rows);
        return Response.json({ ok: true });
      })();
    }

    // WebSocket upgrade for /ws/terminal/:sessionId
    if (url.pathname.startsWith("/ws/terminal/")) {
      const sessionId = url.pathname.slice("/ws/terminal/".length);
      const upgraded = server.upgrade(req, { data: { sessionId } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      const session = getSession(sessionId);
      if (!session) {
        ws.send("\x1b[31mSession not found.\x1b[0m");
        ws.close();
        return;
      }

      const unsubscribe = subscribe(sessionId, (data) => {
        ws.send(data);
      });

      // Store cleanup function on the ws data
      (ws.data as any).unsubscribe = unsubscribe;
    },

    message(ws, message) {
      const { sessionId } = ws.data as { sessionId: string };
      writeToSession(sessionId, String(message));
    },

    close(ws) {
      const { unsubscribe } = ws.data as { unsubscribe?: () => void };
      unsubscribe?.();
    },
  },

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Holophyte running at http://localhost:${server.port}`);
