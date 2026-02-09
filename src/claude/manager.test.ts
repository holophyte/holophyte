// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock convex before importing manager
const mockMutation = vi.fn().mockResolvedValue("mock-session-id");
vi.mock("convex/browser", () => {
  return {
    ConvexHttpClient: class {
      mutation = mockMutation;
    },
  };
});

vi.mock("@convex/_generated/api", () => ({
  api: {
    sessions: {
      create: "sessions:create",
      updateStatus: "sessions:updateStatus",
    },
  },
}));

// Mock Bun.spawn and Bun.file
function createMockTerminal() {
  return {
    write: vi.fn().mockReturnValue(0),
    resize: vi.fn(),
    close: vi.fn(),
    stdin: 0,
    stdout: 1,
    closed: false,
    setRawMode: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(),
  };
}

function createMockProc(terminal: ReturnType<typeof createMockTerminal>) {
  let resolveExited: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });
  return {
    proc: {
      terminal,
      pid: 12345,
      exited,
      exitCode: null as number | null,
      signalCode: null,
      killed: false,
      kill: vi.fn(),
      ref: vi.fn(),
      unref: vi.fn(),
      stdin: null,
      stdout: null,
      stderr: null,
      readable: null,
      send: vi.fn(),
      disconnect: vi.fn(),
      resourceUsage: vi.fn(),
      [Symbol.asyncDispose]: vi.fn(),
    },
    resolveExited: resolveExited!,
  };
}

let mockTerminal: ReturnType<typeof createMockTerminal>;
let mockProc: ReturnType<typeof createMockProc>;

const originalBunSpawn = globalThis.Bun?.spawn;
const originalBunFile = globalThis.Bun?.file;

beforeEach(() => {
  mockTerminal = createMockTerminal();
  mockProc = createMockProc(mockTerminal);

  // @ts-expect-error -- mocking Bun globals for tests
  globalThis.Bun = {
    ...globalThis.Bun,
    spawn: vi.fn().mockReturnValue(mockProc.proc),
    file: vi.fn().mockReturnValue({ exists: vi.fn().mockResolvedValue(false) }),
  };
});

afterEach(async () => {
  // Clean up sessions between tests
  const { getActiveSessions, stopSession } = await import("./manager");
  for (const id of getActiveSessions()) {
    await stopSession(id);
  }
  vi.restoreAllMocks();
});

describe("claude/manager", () => {
  describe("startSession", () => {
    it("spawns a process with terminal option and registers the session", async () => {
      const { startSession, getSession, getActiveSessions } = await import(
        "./manager"
      );

      const result = await startSession({
        taskId: "task-id" as any,
        repoPath: "/tmp/test-repo",
        prompt: "fix the bug",
      });

      expect(result.sessionId).toBe("mock-session-id");
      expect(getSession("mock-session-id")).toBeDefined();
      expect(getActiveSessions()).toContain("mock-session-id");

      // Verify Bun.spawn was called with terminal option
      expect(Bun.spawn).toHaveBeenCalledWith(
        expect.arrayContaining(["fix the bug"]),
        expect.objectContaining({
          cwd: "/tmp/test-repo",
          terminal: expect.objectContaining({
            cols: 120,
            rows: 30,
          }),
        }),
      );
    });
  });

  describe("stopSession", () => {
    it("closes terminal, kills process with SIGKILL, and removes session", async () => {
      const { startSession, stopSession, getSession } = await import(
        "./manager"
      );

      const { sessionId } = await startSession({
        taskId: "task-id" as any,
        repoPath: "/tmp/test-repo",
        prompt: "fix the bug",
      });

      await stopSession(sessionId);

      expect(mockTerminal.close).toHaveBeenCalled();
      expect(mockProc.proc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(getSession(sessionId)).toBeUndefined();
    });

    it("does nothing for a non-existent session", async () => {
      const { stopSession } = await import("./manager");
      // Should not throw
      await stopSession("non-existent-id");
    });
  });

  describe("subscribe", () => {
    it("adds and removes subscribers", async () => {
      const { startSession, subscribe } = await import("./manager");

      const { sessionId } = await startSession({
        taskId: "task-id" as any,
        repoPath: "/tmp/test-repo",
        prompt: "test",
      });

      const callback = vi.fn();
      const unsubscribe = subscribe(sessionId, callback);

      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
      // After unsubscribe, callback should not be in the set
    });

    it("returns a no-op unsubscribe for non-existent session", async () => {
      const { subscribe } = await import("./manager");
      const unsubscribe = subscribe("non-existent", vi.fn());
      expect(typeof unsubscribe).toBe("function");
      unsubscribe(); // should not throw
    });
  });

  describe("writeToSession", () => {
    it("writes data to the terminal", async () => {
      const { startSession, writeToSession } = await import("./manager");

      const { sessionId } = await startSession({
        taskId: "task-id" as any,
        repoPath: "/tmp/test-repo",
        prompt: "test",
      });

      writeToSession(sessionId, "hello\n");
      expect(mockTerminal.write).toHaveBeenCalledWith("hello\n");
    });

    it("does nothing for non-existent session", async () => {
      const { writeToSession } = await import("./manager");
      writeToSession("non-existent", "hello");
      // Should not throw
    });
  });

  describe("resizeSession", () => {
    it("resizes the terminal", async () => {
      const { startSession, resizeSession } = await import("./manager");

      const { sessionId } = await startSession({
        taskId: "task-id" as any,
        repoPath: "/tmp/test-repo",
        prompt: "test",
      });

      resizeSession(sessionId, 200, 50);
      expect(mockTerminal.resize).toHaveBeenCalledWith(200, 50);
    });

    it("does nothing for non-existent session", async () => {
      const { resizeSession } = await import("./manager");
      resizeSession("non-existent", 80, 24);
      // Should not throw
    });
  });

  describe("process exit handling", () => {
    it("cleans up session on process exit with code 0", async () => {
      const { startSession, getSession } = await import("./manager");

      const { sessionId } = await startSession({
        taskId: "task-id" as any,
        repoPath: "/tmp/test-repo",
        prompt: "test",
      });

      expect(getSession(sessionId)).toBeDefined();

      // Simulate process exit
      mockProc.resolveExited(0);
      // Allow the .then() handler to run
      await new Promise((r) => setTimeout(r, 10));

      expect(getSession(sessionId)).toBeUndefined();
      expect(mockTerminal.close).toHaveBeenCalled();
    });
  });
});
