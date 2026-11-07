import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ImagePopover } from "./Slideshow.jsx";

function renderPopover(overrides = {}) {
  return render(
    <ImagePopover
      alt="1 leu front"
      canGoNext
      canGoPrevious
      counterPosition={1}
      counterTotal={2}
      noteLabel="1 leu - Front"
      onClose={() => {}}
      onNext={() => {}}
      onPrevious={() => {}}
      placeholderText="No image yet."
      src="/api/images/notes/1/front-full.jpg?v=1"
      thumb="/api/images/notes/1/front-thumbnail.jpg?v=1"
      {...overrides}
    />,
  );
}

describe("ImagePopover image loading", () => {
  test("holds the thumbnail under the full plate until the full image loads", () => {
    renderPopover();

    const full = screen.getByAltText("1 leu front");
    const placeholder = document.querySelector(".image-popover-thumb");

    expect(full).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-full.jpg?v=1",
    );
    expect(placeholder).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumbnail.jpg?v=1",
    );

    fireEvent.load(full);

    expect(document.querySelector(".image-popover-thumb")).toBeNull();
  });

  test("does not paint a second plate when the thumbnail is the full image", () => {
    renderPopover({ thumb: "/api/images/notes/1/front-full.jpg?v=1" });

    expect(document.querySelector(".image-popover-thumb")).toBeNull();
  });

  test("keeps the previous full image up until the next one loads", () => {
    const { rerender } = renderPopover();
    fireEvent.load(screen.getByAltText("1 leu front"));

    rerender(
      <ImagePopover
        alt="5 lei front"
        canGoNext
        canGoPrevious
        counterPosition={2}
        counterTotal={2}
        noteLabel="5 lei - Front"
        onClose={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        placeholderText="No image yet."
        src="/api/images/notes/2/front-full.jpg?v=1"
        thumb="/api/images/notes/2/front-thumbnail.jpg?v=1"
      />,
    );

    const held = document.querySelector(".image-popover-thumb");
    expect(held).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-full.jpg?v=1",
    );

    fireEvent.load(screen.getByAltText("5 lei front"));

    expect(document.querySelector(".image-popover-thumb")).toBeNull();
  });

  test("shows a cached full image straight away without flashing the thumbnail", () => {
    const proto = window.HTMLImageElement.prototype;
    const completeSpy = vi.spyOn(proto, "complete", "get").mockReturnValue(true);
    const widthSpy = vi
      .spyOn(proto, "naturalWidth", "get")
      .mockReturnValue(800);

    try {
      renderPopover();

      expect(document.querySelector(".image-popover-thumb")).toBeNull();
      expect(screen.getByAltText("1 leu front").style.opacity).toBe("");
    } finally {
      completeSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });
});
