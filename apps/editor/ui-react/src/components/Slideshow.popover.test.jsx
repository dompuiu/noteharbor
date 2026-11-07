import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
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
});
