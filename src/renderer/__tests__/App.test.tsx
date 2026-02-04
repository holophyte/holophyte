import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";

describe("App", () => {
  it("renders the title", () => {
    render(<App />);
    expect(screen.getByText("Holophyte")).toBeDefined();
  });

  it("increments counter when button is clicked", () => {
    render(<App />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("0");
    fireEvent.click(button);
    expect(button.textContent).toContain("1");
  });
});
