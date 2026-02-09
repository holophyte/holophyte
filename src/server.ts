import homepage from "../public/index.html";
import {
  getSession,
  resizeSession,
  startSession,
  stopSession,
  subscribe,
  writeToSession,
} from "./claude/manager";

interface WsData {
  sessionId: string;
  unsubscribe?: () => void;
}

const server = Bun.serve<WsData>({
  port: Number(process.env.PORT) || 3000,
  routes: {
    "/": homepage,

    "/api/config": {
      GET() {
        return Response.json({
          convexUrl: process.env.CONVEX_URL ?? "",
        });
      },
    },

    "/api/pick-directory": {
      async POST() {
        try {
          const proc = Bun.spawn(
            [
              "osascript",
              "-e",
              'POSIX path of (choose folder with prompt "Select a git repository")',
            ],
            { stdout: "pipe", stderr: "pipe" },
          );
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            // User cancelled the dialog
            return Response.json({ cancelled: true });
          }
          const raw = await new Response(proc.stdout).text();
          // osascript returns path with trailing newline and slash
          const dirPath = raw.trim().replace(/\/$/, "");
          const { basename } = await import("node:path");

          const gitHead = Bun.file(`${dirPath}/.git/HEAD`);
          const isGitRepo = await gitHead.exists();

          // Try to get the repo name from the git remote URL
          let name = basename(dirPath);
          if (isGitRepo) {
            try {
              const gitConfig = await Bun.file(`${dirPath}/.git/config`).text();
              const remoteMatch = gitConfig.match(
                /\[remote "origin"\][^[]*url\s*=\s*(.+)/,
              );
              if (remoteMatch?.[1]) {
                const url = remoteMatch[1].trim();
                // Handle git@host:org/repo.git or https://host/org/repo.git
                const repoName = url
                  .split("/")
                  .pop()
                  ?.replace(/\.git$/, "");
                if (repoName) name = repoName;
              }
            } catch {
              // fall back to folder name
            }
          }

          return Response.json({
            cancelled: false,
            path: dirPath,
            name,
            isGitRepo,
          });
        } catch {
          return Response.json(
            { error: "Failed to open directory picker." },
            { status: 500 },
          );
        }
      },
    },

    "/api/sessions/start": {
      async POST(req: Request) {
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
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },
  },

  fetch(req, server) {
    const url = new URL(req.url);

    // POST /api/sessions/:id/stop
    const stopMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/stop$/);
    if (stopMatch && req.method === "POST") {
      const sessionId = stopMatch[1] ?? "";
      return stopSession(sessionId).then(() => Response.json({ ok: true }));
    }

    // POST /api/sessions/:id/resize
    const resizeMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/resize$/);
    if (resizeMatch && req.method === "POST") {
      return (async () => {
        const sessionId = resizeMatch[1] ?? "";
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
      const { sessionId } = ws.data;
      const session = getSession(sessionId);
      if (!session) {
        ws.send("\x1b[31mSession not found.\x1b[0m");
        ws.close();
        return;
      }

      ws.data.unsubscribe = subscribe(sessionId, (data) => {
        ws.send(data);
      });
    },

    message(ws, message) {
      writeToSession(ws.data.sessionId, String(message));
    },

    close(ws) {
      ws.data.unsubscribe?.();
    },
  },

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Holophyte running at http://localhost:${server.port}`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
