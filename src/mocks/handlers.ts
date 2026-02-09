import { HttpResponse, http } from "msw";

export const handlers = [
  // Health check endpoint for connectivity testing
  http.get("/api/health", () => {
    return HttpResponse.json({ status: "ok" });
  }),
];
