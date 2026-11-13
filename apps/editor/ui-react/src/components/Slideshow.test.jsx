import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Slideshow } from "./Slideshow.jsx";
import { ToastProvider } from "./Toast.jsx";

function note(overrides = {}) {
  return {
    id: 1,
    denomination: "1 Leu",
    issue_date: "1920",
    catalog_number: "P-1",
    grading_company: "PMG",
    grade: "65",
    watermark: "",
    serial: "A1",
    notes: "Crisp paper.",
    images: [],
    tags: [],
    scraped_data: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function slideshow(noteOverrides = {}, props = {}) {
  const entry = note(noteOverrides);

  return render(
    <Slideshow
      currentIndex={0}
      notes={[entry]}
      onChangeIndex={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Slideshow slide card", () => {
  test("a note without images gets one empty state, not two placeholders", () => {
    slideshow();

    expect(document.querySelectorAll(".slide-empty-state")).toHaveLength(1);
    expect(document.querySelectorAll(".slide-thumb-btn")).toHaveLength(0);
    expect(screen.queryByText("Front")).toBeNull();
    expect(screen.queryByText("Back")).toBeNull();
  });

  test("an empty denomination reads as Untitled note", () => {
    slideshow({ denomination: "" });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Untitled note",
    );
  });

  test("the curated scraped details sit on the slide and the rest in the disclosure", () => {
    slideshow({
      scraped_data: {
        country: "Romania",
        catalog_number: "P-1",
        date: "1920",
        grade: "65",
        page_comments: "Guaranteed genuine.",
        cert_no: "12345",
        population: 12,
        source_url: "https://www.pmgnotes.com/certlookup/12345",
      },
    });

    const curated = document.querySelector(".scraped-details-grid--curated");
    expect(curated).toHaveTextContent("Country: Romania");
    expect(curated).toHaveTextContent("Catalog: P-1");
    expect(curated).toHaveTextContent("Date: 1920");
    expect(curated).toHaveTextContent("Grade: 65");
    expect(curated).toHaveTextContent("Comment: Guaranteed genuine.");
    expect(curated).not.toHaveTextContent("Cert No");

    const more = document.querySelector(".scraped-details-more");
    expect(more.querySelector("summary")).toHaveTextContent(
      "Scraped details · 3",
    );
    expect(more).toHaveTextContent("Cert No: 12345");
    expect(more).toHaveTextContent("Population: 12");
    expect(more).toHaveTextContent("Source: www.pmgnotes.com");
    expect(more).not.toHaveTextContent(
      "https://www.pmgnotes.com/certlookup/12345",
    );
  });

  test("a PCGS banknote detail is the curated comment", () => {
    slideshow({
      grading_company: "PCGS",
      scraped_data: {
        country: "Romania",
        banknote_details: "Crisp, bright paper.",
        source_url: "https://www.pcgs.com/banknotes/cert/999",
      },
    });

    const curated = document.querySelector(".scraped-details-grid--curated");
    expect(curated).toHaveTextContent("Comment: Crisp, bright paper.");
    expect(document.querySelector(".scraped-details-more")).toHaveTextContent(
      "Scraped details · 1",
    );
  });

  test("a synonym with a different value stays in the disclosure", () => {
    slideshow({
      scraped_data: {
        country: "Romania",
        region: "Wallachia",
        source_url: "https://www.pmgnotes.com/certlookup/12345",
      },
    });

    const curated = document.querySelector(".scraped-details-grid--curated");
    expect(curated).toHaveTextContent("Country: Romania");
    expect(curated).not.toHaveTextContent("Wallachia");

    const more = document.querySelector(".scraped-details-more");
    expect(more).toHaveTextContent("Region: Wallachia");
    expect(more).toHaveTextContent("Scraped details · 2");
  });

  test("a note without scraped data shows neither panel nor disclosure", () => {
    slideshow();

    expect(document.querySelector(".scraped-details-panel")).toBeNull();
    expect(document.querySelector(".scraped-details-more")).toBeNull();
  });

  test("a front plate paints its thumbnail before the full scan loads", () => {
    slideshow({
      images: [
        { type: "front", variant: "thumbnail", localPath: "/front-thumb.jpg" },
        { type: "front", variant: "full", localPath: "/front-full.jpg" },
      ],
    });

    expect(
      screen.getByRole("img", { name: "1 Leu - P-1, Front" }),
    ).toHaveAttribute(
      "src",
      "/front-thumb.jpg?v=2026-01-01T00%3A00%3A00Z",
    );

    const full = document.querySelector(".slide-plate-full");
    expect(full).toHaveAttribute(
      "src",
      "/front-full.jpg?v=2026-01-01T00%3A00%3A00Z&w=1600",
    );
    expect(full).not.toHaveClass("slide-plate-full--loaded");
    expect(document.querySelector(".image-loading-spinner")).not.toBeNull();

    fireEvent.load(full);
    expect(full).toHaveClass("slide-plate-full--loaded");
    expect(document.querySelector(".image-loading-spinner")).toBeNull();

    expect(document.querySelectorAll(".slide-thumb-btn")).toHaveLength(2);
    expect(document.querySelector(".slide-empty-state")).toBeNull();
  });

  test("switching notes returns to the new thumbnail until its full scan loads", () => {
    const first = note({
      id: 1,
      images: [
        { type: "front", variant: "thumbnail", localPath: "/front-thumb.jpg" },
        { type: "front", variant: "full", localPath: "/front-full.jpg" },
      ],
    });
    const second = note({
      id: 2,
      denomination: "5 Lei",
      images: [
        { type: "front", variant: "thumbnail", localPath: "/next-thumb.jpg" },
        { type: "front", variant: "full", localPath: "/next-full.jpg" },
      ],
    });
    const { rerender } = render(
      <Slideshow
        currentIndex={0}
        notes={[first, second]}
        onChangeIndex={() => {}}
        onClose={() => {}}
      />,
    );

    const firstFull = document.querySelector(".slide-plate-full");
    fireEvent.load(firstFull);

    rerender(
      <Slideshow
        currentIndex={1}
        notes={[first, second]}
        onChangeIndex={() => {}}
        onClose={() => {}}
      />,
    );

    const nextFull = document.querySelector(".slide-plate-full");
    expect(nextFull).not.toBe(firstFull);
    expect(nextFull).toHaveAttribute(
      "src",
      "/next-full.jpg?v=2026-01-01T00%3A00%3A00Z&w=1600",
    );
    expect(nextFull).not.toHaveClass("slide-plate-full--loaded");

    fireEvent.load(nextFull);
    expect(nextFull).toHaveClass("slide-plate-full--loaded");
  });

  test("the popover keeps the full scan while the room paints a preview", async () => {
    const decode = vi.fn(() => Promise.resolve());
    window.HTMLImageElement.prototype.decode = decode;

    try {
      slideshow(
        {
          images: [
            {
              type: "front",
              variant: "thumbnail",
              localPath: "/front-thumb.jpg",
            },
            { type: "front", variant: "full", localPath: "/front-full.jpg" },
          ],
        },
        { previewKind: "front" },
      );

      await waitFor(() => {
        expect(document.querySelector(".image-popover-full")).toHaveAttribute(
          "src",
          "/front-full.jpg?v=2026-01-01T00%3A00%3A00Z",
        );
      });
    } finally {
      delete window.HTMLImageElement.prototype.decode;
    }
  });

  test("an unloaded full plate pauses while the preview covers the room", () => {
    slideshow(
      {
        images: [
          {
            type: "front",
            variant: "thumbnail",
            localPath: "/front-thumb.jpg",
          },
          { type: "front", variant: "full", localPath: "/front-full.jpg" },
        ],
      },
      { previewKind: "front" },
    );

    expect(document.querySelector(".image-popover-overlay")).not.toBeNull();
    expect(document.querySelector(".slide-plate-thumb")).not.toBeNull();
    expect(document.querySelector(".slide-plate-full")).toBeNull();
  });

  test("Enter on the scraped-details summary does not open the preview", () => {
    const onOpenPreview = vi.fn();

    slideshow(
      {
        scraped_data: {
          cert_no: "12345",
          source_url: "https://www.pmgnotes.com/certlookup/12345",
        },
      },
      { onOpenPreview },
    );

    const summary = document.querySelector(".scraped-details-more summary");
    summary.focus();
    fireEvent.keyDown(summary, { key: "Enter" });

    expect(onOpenPreview).not.toHaveBeenCalled();
  });
});

describe("Image popover over the slideshow", () => {
  function plate(width, height) {
    return {
      width,
      height,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }

  function naturalSize(image, width, height) {
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(image, "naturalHeight", {
      configurable: true,
      value: height,
    });
  }

  test("keeps the zoom across a note's faces and resets on the next note", async () => {
    const decode = vi.fn(() => Promise.resolve());
    window.HTMLImageElement.prototype.decode = decode;

    const notes = [
      note({
        id: 1,
        images: [
          { type: "front", variant: "full", localPath: "/front-full.jpg" },
          { type: "back", variant: "full", localPath: "/back-full.jpg" },
        ],
      }),
      note({
        id: 2,
        images: [
          { type: "front", variant: "full", localPath: "/second-full.jpg" },
        ],
      }),
    ];

    function previewAt(currentIndex, previewKind) {
      return (
        <Slideshow
          currentIndex={currentIndex}
          notes={notes}
          onChangeIndex={() => {}}
          onClose={() => {}}
          previewKind={previewKind}
        />
      );
    }

    try {
      const { rerender } = render(previewAt(0, "front"));

      const image = await waitFor(() => {
        const full = document.querySelector(".image-popover-full");
        expect(full).not.toBeNull();
        return full;
      });

      naturalSize(image, 2000, 1000);
      image.getBoundingClientRect = () => plate(500, 250);
      document.querySelector(
        ".image-popover-image-wrap",
      ).getBoundingClientRect = () => plate(800, 600);
      fireEvent.load(image);

      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

      expect(image.style.width).toBe("625px");

      // The same note's back face keeps the scale.
      rerender(previewAt(0, "back"));

      expect(image.style.width).toBe("625px");

      // The next note starts again at Fit.
      rerender(previewAt(1, "front"));

      expect(image.style.width).toBe("");
    } finally {
      delete window.HTMLImageElement.prototype.decode;
    }
  });

  test("the side toggle pages to the note's other face", async () => {
    const onMovePreview = vi.fn();
    const entries = [
      note({
        id: 1,
        images: [
          { type: "front", variant: "full", localPath: "/front-full.jpg" },
          { type: "back", variant: "full", localPath: "/back-full.jpg" },
        ],
      }),
    ];

    const { rerender } = render(
      <Slideshow
        currentIndex={0}
        notes={entries}
        onChangeIndex={() => {}}
        onClose={() => {}}
        onMovePreview={onMovePreview}
        previewKind="front"
      />,
    );

    fireEvent.click(
      within(document.querySelector(".image-popover-overlay")).getByRole(
        "button",
        { name: "Back" },
      ),
    );

    expect(onMovePreview).toHaveBeenCalledWith(1);

    rerender(
      <Slideshow
        currentIndex={0}
        notes={entries}
        onChangeIndex={() => {}}
        onClose={() => {}}
        onMovePreview={onMovePreview}
        previewKind="back"
      />,
    );

    fireEvent.click(
      within(document.querySelector(".image-popover-overlay")).getByRole(
        "button",
        { name: "Front" },
      ),
    );

    // A second move inside the pacing interval lands on the trailing edge.
    await waitFor(() => {
      expect(onMovePreview).toHaveBeenLastCalledWith(-1);
    });
  });

  test("a missing side shows the empty state and an inert side toggle", () => {
    const onClosePreview = vi.fn();
    const onEdit = vi.fn();
    const onMovePreview = vi.fn();
    const entries = [
      note({
        id: 1,
        images: [
          { type: "front", variant: "full", localPath: "/front-full.jpg" },
        ],
      }),
    ];

    const { rerender } = render(
      <Slideshow
        currentIndex={0}
        notes={entries}
        onChangeIndex={() => {}}
        onClose={() => {}}
        onClosePreview={onClosePreview}
        onEdit={onEdit}
        onMovePreview={onMovePreview}
        previewKind="front"
      />,
    );

    // The slideshow keeps both flat slots even though the note has one image,
    // so the missing back is still a page the counter and arrows reach.
    expect(document.querySelector(".note-counter-value")).toHaveTextContent(
      "1 / 2",
    );
    fireEvent.click(
      within(document.querySelector(".image-popover-overlay")).getByRole(
        "button",
        { name: "Show next image" },
      ),
    );
    expect(onMovePreview).toHaveBeenCalledWith(1);

    rerender(
      <Slideshow
        currentIndex={0}
        notes={entries}
        onChangeIndex={() => {}}
        onClose={() => {}}
        onClosePreview={onClosePreview}
        onEdit={onEdit}
        onMovePreview={onMovePreview}
        previewKind="back"
      />,
    );

    const popover = within(
      document.querySelector(".image-popover-overlay"),
    );

    expect(
      document.querySelector(".image-popover-empty-state"),
    ).not.toBeNull();
    expect(popover.queryByRole("group", { name: "Image zoom" })).toBeNull();

    const back = popover.getByRole("button", { name: "Back" });

    expect(back).toHaveAttribute("aria-pressed", "true");
    expect(back).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(popover.getByRole("button", { name: "Edit note" }));

    // The editor opens over the room, not behind the preview.
    expect(onClosePreview).toHaveBeenCalledWith(1);
    expect(onEdit).toHaveBeenCalledWith(1);
  });
});

describe("Slideshow catalogue page", () => {
  test("the header names the set, the filter and the walk", () => {
    const entries = [
      note({ id: 1 }),
      note({ id: 2, denomination: "5 Lei", issue_date: "1900" }),
      note({ id: 3, denomination: "10 Lei", issue_date: "1910" }),
    ];

    slideshow({}, {
      collectionName: "John's collection",
      currentIndex: 2,
      filterConditions: [
        { id: "chip-1", field: "grade", value: "65", negated: false },
      ],
      notes: entries,
    });

    expect(
      screen.getByText("Collection · walking 3 notes"),
    ).toBeInTheDocument();
    expect(screen.getByText("John's collection")).toBeInTheDocument();
    expect(document.querySelector(".slideshow-filter-chip")).toHaveTextContent(
      "Grade 65",
    );
    expect(
      screen
        .getByRole("textbox", { name: "Note position" })
        .closest(".note-counter-value"),
    ).toHaveTextContent("3 of 3");
    expect(document.querySelector(".slideshow-progress-fill")).toHaveStyle({
      width: "100%",
    });
  });

  test("the foot names the neighbours", () => {
    const entries = [
      note({ id: 1, denomination: "1 Leu", issue_date: "1914" }),
      note({ id: 2, denomination: "5 Lei", issue_date: "1920" }),
      note({ id: 3, denomination: "10 Lei", issue_date: "1930" }),
    ];

    slideshow({}, { currentIndex: 1, notes: entries });

    const turns = document.querySelectorAll(".slideshow-turn-name");
    expect(turns[0]).toHaveTextContent("1 Leu 1914");
    expect(turns[1]).toHaveTextContent("10 Lei 1930");
  });

  test("the last note's next turn is inert and the arrow does not wrap", () => {
    const onChangeIndex = vi.fn();
    const entries = [note({ id: 1 }), note({ id: 2 })];

    render(
      <Slideshow
        currentIndex={1}
        notes={entries}
        onChangeIndex={onChangeIndex}
        onClose={() => {}}
      />,
    );

    const next = screen.getByRole("button", { name: /^Next note/ });
    expect(next).toBeDisabled();
    expect(next).toHaveTextContent("End of set");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onChangeIndex).not.toHaveBeenCalled();

    // Home still reaches the other edge of the set.
    fireEvent.keyDown(window, { key: "Home" });
    expect(onChangeIndex).toHaveBeenCalledWith(0);
  });

  test("the first note's previous turn is inert and says the set starts", () => {
    slideshow({}, {
      notes: [note({ id: 1 }), note({ id: 2 })],
    });

    const previous = screen.getByRole("button", { name: /^Previous note/ });
    expect(previous).toBeDisabled();
    expect(previous).toHaveTextContent("Start of set");
  });

  test("End reaches the last note even though the turns stop there", () => {
    const onChangeIndex = vi.fn();

    slideshow({}, {
      notes: [note({ id: 1 }), note({ id: 2 }), note({ id: 3 })],
      onChangeIndex,
    });

    fireEvent.keyDown(window, { key: "End" });
    expect(onChangeIndex).toHaveBeenCalledWith(2);
  });

  test("Enter skips a failed plate and opens the face that still loads", () => {
    const onOpenPreview = vi.fn();

    slideshow(
      {
        images: [
          {
            type: "front",
            variant: "thumbnail",
            localPath: "/missing/front-thumb.jpg",
          },
          {
            type: "back",
            variant: "thumbnail",
            localPath: "/back-thumb.jpg",
          },
        ],
      },
      { onOpenPreview },
    );

    fireEvent.error(document.querySelector(".slide-plate-thumb"));
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onOpenPreview).toHaveBeenCalledWith(1, "back");
  });

  test("a read-only room keeps the set header but drops Add and Edit", () => {
    slideshow({}, { collectionName: "All notes", readOnly: true });

    expect(screen.getByText("All notes")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add before this note" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy fields" }),
    ).toBeInTheDocument();
  });

  test("Copy fields raises the success toast", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <Slideshow
          currentIndex={0}
          notes={[note()]}
          onChangeIndex={() => {}}
          onClose={() => {}}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Copy fields" }));
    expect(await screen.findByText("Note fields copied")).toBeInTheDocument();
  });

  test("a failed copy keeps the danger line", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("denied"));

    try {
      render(
        <Slideshow
          currentIndex={0}
          notes={[note()]}
          onChangeIndex={() => {}}
          onClose={() => {}}
          onCopy={onCopy}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Copy fields" }));

      await waitFor(() => {
        expect(onCopy).toHaveBeenCalledWith(
          "Could not copy note details to clipboard.",
        );
      });
    } finally {
      writeText.mockRestore();
    }
  });

  test("a plate whose image failed keeps its geometry and cannot be previewed", () => {
    slideshow({
      images: [
        {
          type: "front",
          variant: "thumbnail",
          localPath: "/missing/front-thumb.jpg",
        },
      ],
    });

    fireEvent.error(document.querySelector(".slide-plate-thumb"));

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(screen.getByText("front-thumb.jpg")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Front image unavailable: front-thumb.jpg",
      }),
    ).toBeDisabled();
  });

  test("an empty value reads as the table's muted dash", () => {
    slideshow({
      catalog_number: "",
      grade: "",
      issue_date: "",
      serial: "",
      watermark: "",
    });

    const values = document.querySelectorAll(".detail-grid p");
    expect(values).toHaveLength(4);

    values.forEach((value) => {
      expect(value.querySelector(".muted")).toHaveTextContent("-");
    });
    expect(document.querySelector(".slide-issue .muted")).toHaveTextContent(
      "-",
    );
  });

  test("a note without a body renders no body line", () => {
    slideshow({ notes: "" });

    expect(document.querySelector(".slide-notes")).toBeNull();
  });
});

describe("Slideshow walking", () => {
  test("a held arrow key moves at most once per pacing interval", () => {
    vi.useFakeTimers();
    const onChangeIndex = vi.fn();

    slideshow({}, {
      onChangeIndex,
      notes: [note({ id: 1 }), note({ id: 2 }), note({ id: 3 })],
    });

    act(() => {
      for (let press = 0; press < 5; press += 1) {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      }
    });

    expect(onChangeIndex).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(onChangeIndex).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // The newest press in the window still runs.
    expect(onChangeIndex).toHaveBeenCalledTimes(2);
  });

  test("Home cancels a pending walk move", () => {
    vi.useFakeTimers();
    const onChangeIndex = vi.fn();
    const entries = [
      note({ id: 1 }),
      note({ id: 2 }),
      note({ id: 3 }),
    ];
    const { rerender } = render(
      <Slideshow
        currentIndex={0}
        notes={entries}
        onChangeIndex={onChangeIndex}
        onClose={() => {}}
      />,
    );

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    rerender(
      <Slideshow
        currentIndex={1}
        notes={entries}
        onChangeIndex={onChangeIndex}
        onClose={() => {}}
      />,
    );

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "Home" });
    });

    expect(onChangeIndex).toHaveBeenLastCalledWith(0);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // The pending ArrowRight must not undo Home.
    expect(onChangeIndex).toHaveBeenCalledTimes(2);
  });

  test("a full plate waits for the walk to settle", () => {
    vi.useFakeTimers();
    const first = note({
      id: 1,
      images: [
        { type: "front", variant: "thumbnail", localPath: "/front-thumb.jpg" },
        { type: "front", variant: "full", localPath: "/front-full.jpg" },
      ],
    });
    const second = note({
      id: 2,
      denomination: "5 Lei",
      images: [
        { type: "front", variant: "thumbnail", localPath: "/next-thumb.jpg" },
        { type: "front", variant: "full", localPath: "/next-full.jpg" },
      ],
    });
    const { rerender } = render(
      <Slideshow
        currentIndex={0}
        notes={[first, second]}
        onChangeIndex={() => {}}
        onClose={() => {}}
      />,
    );

    expect(document.querySelector(".slide-plate-full")).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    rerender(
      <Slideshow
        currentIndex={1}
        notes={[first, second]}
        onChangeIndex={() => {}}
        onClose={() => {}}
      />,
    );

    expect(document.querySelector(".slide-plate-full")).toBeNull();
    expect(document.querySelector(".image-loading-spinner")).toBeNull();
    expect(document.querySelector(".slide-plate-thumb")).toHaveAttribute(
      "src",
      "/next-thumb.jpg?v=2026-01-01T00%3A00%3A00Z",
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(document.querySelector(".slide-plate-full")).toHaveAttribute(
      "src",
      "/next-full.jpg?v=2026-01-01T00%3A00%3A00Z&w=1600",
    );
  });
});
