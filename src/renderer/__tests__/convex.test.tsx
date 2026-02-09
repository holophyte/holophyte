import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConvexClientProvider } from "../convex";

describe("ConvexClientProvider", () => {
  it("renders children when VITE_CONVEX_URL is not set", () => {
    render(
      <ConvexClientProvider>
        <div>child content</div>
      </ConvexClientProvider>,
    );
    expect(screen.getByText("child content")).toBeDefined();
  });
});
