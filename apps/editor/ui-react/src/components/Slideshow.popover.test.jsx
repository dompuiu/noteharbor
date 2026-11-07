import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ImagePopover } from "./Slideshow.jsx";

const FRONT_1 = "/api/images/notes/1/front-full.jpg?v=1";
const THUMB_1 = "/api/images/notes/1/front-thumbnail.jpg?v=1";
const FRONT_2 = "/api/images/notes/2/front-full.jpg?v=1";
const FRONT_3 = "/api/images/notes/3/front-full.jpg?v=1";

function popover(overrides = {}) {
  return (
    <ImagePopover
      alt="1 leu front"
      canGoNext
      canGoPrevious
      counterPosition={1}
      counterTotal={3}
      noteLabel="1 leu - Front"
      onClose={() => {}}
      onNext={() => {}}
      onPrevious={() => {}}
      placeholderText="No image yet."
      src={FRONT_1}
      thumb={THUMB_1}
      {...overrides}
    />
  );
}

// Off-screen decodes stay pending until the test settles them by source.
let pendingDecodes;

beforeEach(() => {
  pendingDecodes = new Map();
  window.HTMLImageElement.prototype.decode = function decode() {
    const src = this.getAttribute("src");
    return new Promise((resolve) => pendingDecodes.set(src, resolve));
  };
});

afterEach(() => {
  delete window.HTMLImageElement.prototype.decode;
});

async function finishDecode(src) {
  await act(async () => {
    pendingDecodes.get(src)?.();
  });
}

function fullImage() {
  return document.querySelector(".image-popover-full");
}

function thumbImage() {
  return document.querySelector(".image-popover-thumb");
}

describe("ImagePopover image loading", () => {
  test("shows the thumbnail on first open until the full image is decoded", async () => {
    render(popover());

    expect(thumbImage()).toHaveAttribute("src", THUMB_1);
    expect(fullImage()).toBeNull();

    await finishDecode(FRONT_1);

    expect(fullImage()).toHaveAttribute("src", FRONT_1);
    expect(thumbImage()).toBeNull();
  });

  test("does not paint a thumbnail when it is the full image", () => {
    render(popover({ thumb: FRONT_1 }));

    expect(thumbImage()).toBeNull();
  });

  test("keeps the previous image on the same element until the next is decoded", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);
    const element = fullImage();

    rerender(popover({ alt: "5 lei front", src: FRONT_2 }));

    expect(fullImage()).toBe(element);
    expect(element).toHaveAttribute("src", FRONT_1);
    expect(thumbImage()).toBeNull();

    await finishDecode(FRONT_2);

    expect(fullImage()).toBe(element);
    expect(element).toHaveAttribute("src", FRONT_2);
  });

  test("skips images that finish decoding after the user has moved on", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    rerender(popover({ src: FRONT_2 }));
    rerender(popover({ src: FRONT_3 }));
    await finishDecode(FRONT_2);

    expect(fullImage()).toHaveAttribute("src", FRONT_1);

    await finishDecode(FRONT_3);

    expect(fullImage()).toHaveAttribute("src", FRONT_3);
  });

  test("shows a cached full image straight away", () => {
    const proto = window.HTMLImageElement.prototype;
    const completeSpy = vi.spyOn(proto, "complete", "get").mockReturnValue(true);
    const widthSpy = vi.spyOn(proto, "naturalWidth", "get").mockReturnValue(800);

    try {
      render(popover());

      expect(fullImage()).toHaveAttribute("src", FRONT_1);
      expect(thumbImage()).toBeNull();
    } finally {
      completeSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });
});
