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

  test("a front plate still renders beside the missing back", () => {
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
      "/front-full.jpg?v=2026-01-01T00%3A00%3A00Z",
    );
    expect(document.querySelectorAll(".slide-thumb-btn")).toHaveLength(2);
    expect(document.querySelector(".slide-empty-state")).toBeNull();
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
