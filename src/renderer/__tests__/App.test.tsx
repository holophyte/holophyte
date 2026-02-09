import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
