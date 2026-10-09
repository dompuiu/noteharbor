import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api.js", () => ({
  createShowcase: vi.fn(),
  getShowcases: vi.fn(),
}));

import { createShowcase, getShowcases } from "./api.js";
import { ShowcasesProvider, useShowcases } from "./showcases.jsx";

// A tiny consumer that surfaces the context controls so tests can drive them
// and read back the state the provider hands out.
let context;
function Probe() {
  context = useShowcases();
  return (
    <output data-testid="names">
      {context.showcases.map((showcase) => showcase.name).join(",")}
    </output>
  );
}

function renderProvider() {
  return render(
    <ShowcasesProvider>
      <Probe />
    </ShowcasesProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getShowcases.mockResolvedValue({
    showcases: [
      { id: 1, name: "Summer" },
      { id: 2, name: "Vienna" },
    ],
  });
});

describe("ShowcasesProvider", () => {
  test("loads the showcases on mount", async () => {
    renderProvider();

    expect(await screen.findByText("Summer,Vienna")).toBeInTheDocument();
    expect(getShowcases).toHaveBeenCalledTimes(1);
  });

  test("creating a showcase appends it without refetching the whole list", async () => {
    renderProvider();
    await screen.findByText("Summer,Vienna");

    const loadsBefore = getShowcases.mock.calls.length;
    createShowcase.mockResolvedValue({
      showcase: { id: 3, name: "Showcase 3" },
    });

    await act(async () => {
      await context.createShowcase();
    });

    expect(screen.getByTestId("names")).toHaveTextContent(
      "Summer,Vienna,Showcase 3",
    );
    expect(getShowcases.mock.calls.length).toBe(loadsBefore);
    expect(createShowcase).toHaveBeenCalledWith(undefined);
  });
});
