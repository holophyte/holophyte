import { http, HttpResponse } from "msw";

export const handlers = [
  // Example API handlers - modify as needed
  http.get("/api/health", () => {
    return HttpResponse.json({ status: "ok" });
  }),

  http.get("/api/user", () => {
    return HttpResponse.json({
      id: "1",
      name: "Test User",
      email: "test@example.com",
    });
  }),

  http.post("/api/tasks", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        id: crypto.randomUUID(),
        ...body,
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    );
  }),
];
