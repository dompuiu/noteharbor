import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api.js", () => ({
  createShowcase: vi.fn(),
  deleteShowcase: vi.fn(),
  getShowcases: vi.fn(),
  renameShowcase: vi.fn(),
  reorderShowcases: vi.fn(),
}));

import {
  createShowcase,
  deleteShowcase,
  getShowcases,
  renameShowcase,
  reorderShowcases,
} from "./api.js";
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

  test("renaming updates the row and the sidebar without refetching", async () => {
    renderProvider();
    await screen.findByText("Summer,Vienna");

    const loadsBefore = getShowcases.mock.calls.length;
    renameShowcase.mockResolvedValue({
      showcase: { id: 1, name: "Winter" },
    });

    await act(async () => {
      await context.renameShowcase(1, "Winter");
    });

    expect(screen.getByTestId("names")).toHaveTextContent("Winter,Vienna");
    expect(renameShowcase).toHaveBeenCalledWith(1, "Winter");
    expect(getShowcases.mock.calls.length).toBe(loadsBefore);
  });

  test("deleting removes the row and hands back the next showcase", async () => {
    renderProvider();
    await screen.findByText("Summer,Vienna");

    const loadsBefore = getShowcases.mock.calls.length;
    deleteShowcase.mockResolvedValue({ success: true });

    let result;

    await act(async () => {
      result = await context.deleteShowcase(1);
    });

    expect(result).toEqual({ nextShowcaseId: 2 });
    expect(screen.getByTestId("names")).toHaveTextContent("Vienna");
    expect(getShowcases.mock.calls.length).toBe(loadsBefore);
  });

  test("deleting the last showcase hands back no next showcase", async () => {
    renderProvider();
    await screen.findByText("Summer,Vienna");

    deleteShowcase.mockResolvedValue({ success: true });

    let result;

    await act(async () => {
      result = await context.deleteShowcase(2);
    });

    expect(result).toEqual({ nextShowcaseId: null });
    expect(screen.getByTestId("names")).toHaveTextContent("Summer");
  });

  test("reordering applies the server order without refetching", async () => {
    renderProvider();
    await screen.findByText("Summer,Vienna");

    const loadsBefore = getShowcases.mock.calls.length;
    reorderShowcases.mockResolvedValue({
      showcases: [
        { id: 2, name: "Vienna" },
        { id: 1, name: "Summer" },
      ],
    });

    await act(async () => {
      await context.reorderShowcases([2, 1]);
    });

    expect(screen.getByTestId("names")).toHaveTextContent("Vienna,Summer");
    expect(reorderShowcases).toHaveBeenCalledWith([2, 1]);
    expect(getShowcases.mock.calls.length).toBe(loadsBefore);
  });
});
