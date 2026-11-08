import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Slideshow } from "./Slideshow.jsx";

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
      screen.getByRole("img", { name: "1 Leu - P-1 front" }),
    ).toHaveAttribute(
      "src",
      "/front-thumb.jpg?v=2026-01-01T00%3A00%3A00Z",
    );

    const full = document.querySelector(".slide-plate-full");
    expect(full).toHaveAttribute(
      "src",
      "/front-full.jpg?v=2026-01-01T00%3A00%3A00Z",
    );
    expect(full).not.toHaveClass("slide-plate-full--loaded");

    fireEvent.load(full);
    expect(full).toHaveClass("slide-plate-full--loaded");

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
      "/next-full.jpg?v=2026-01-01T00%3A00%3A00Z",
    );
    expect(nextFull).not.toHaveClass("slide-plate-full--loaded");

    fireEvent.load(nextFull);
    expect(nextFull).toHaveClass("slide-plate-full--loaded");
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
