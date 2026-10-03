import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PortfolioScreen } from "./PortfolioScreen.jsx";

describe("PortfolioScreen", () => {
  test("renders the destination heading and a coming-soon empty state", () => {
    render(
      <PortfolioScreen
        description="Categories will group notes by theme."
        title="Categories"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Categories" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Categories are coming soon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Categories will group notes by theme."),
    ).toBeInTheDocument();
  });
});
