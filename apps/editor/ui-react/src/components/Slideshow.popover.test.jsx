import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { preloadImage } from "../lib/imagePreload.js";
import { ImagePopover } from "./Slideshow.jsx";

const FRONT_1 = "/api/images/notes/1/front-full.jpg?v=1";
const THUMB_1 = "/api/images/notes/1/front-thumbnail.jpg?v=1";
const THUMB_2 = "/api/images/notes/2/front-thumbnail.jpg?v=1";
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

function imageWrap() {
  return document.querySelector(".image-popover-image-wrap");
}

function zoomLevel() {
  return document.querySelector(".image-popover-zoom-level");
}

function zoomButton(label) {
  return document.querySelector(`[aria-label="${label}"]`);
}

function box({ width, height, left = 0, top = 0 }) {
  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function measureImageBox(
  image,
  { naturalWidth, naturalHeight, fitWidth, fitHeight },
) {
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    value: naturalWidth,
  });
  Object.defineProperty(image, "naturalHeight", {
    configurable: true,
    value: naturalHeight,
  });
  image.getBoundingClientRect = () =>
    box({ width: fitWidth, height: fitHeight });
  fireEvent.load(image);
}

function measurePopoverWrap({ width, height, left = 0, top = 0 }) {
  document.querySelector(".image-popover-image-wrap").getBoundingClientRect =
    () => box({ width, height, left, top });
}

describe("ImagePopover image loading", () => {
  test("shows the thumbnail on first open until the full image is decoded", async () => {
    render(popover());

    expect(thumbImage()).toHaveAttribute("src", THUMB_1);
    expect(imageWrap()).toHaveClass("image-popover-image-wrap--warming");
    expect(fullImage()).toBeNull();
    expect(document.querySelector(".image-loading-spinner")).not.toBeNull();

    await finishDecode(FRONT_1);

    expect(fullImage()).toHaveAttribute("src", FRONT_1);
    expect(thumbImage()).toBeNull();
    expect(imageWrap()).not.toHaveClass("image-popover-image-wrap--warming");
    expect(document.querySelector(".image-loading-spinner")).toBeNull();
  });

  test("does not paint a thumbnail when it is the full image", () => {
    render(popover({ thumb: FRONT_1 }));

    expect(thumbImage()).toBeNull();
  });

  test("shows the next thumbnail while the previous full plate is held", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);
    const element = fullImage();

    rerender(
      popover({ alt: "5 lei front", src: FRONT_2, thumb: THUMB_2 }),
    );

    expect(fullImage()).toBe(element);
    expect(element).toHaveAttribute("src", FRONT_1);
    expect(thumbImage()).toHaveAttribute("src", THUMB_2);
    expect(imageWrap()).toHaveClass("image-popover-image-wrap--warming");

    await finishDecode(FRONT_2);

    expect(fullImage()).toBe(element);
    expect(element).toHaveAttribute("src", FRONT_2);
    expect(thumbImage()).toBeNull();
    expect(imageWrap()).not.toHaveClass("image-popover-image-wrap--warming");
  });

  test("keeps showing images that finish while the user is still moving", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    rerender(popover({ src: FRONT_2 }));
    rerender(popover({ src: FRONT_3 }));
    await finishDecode(FRONT_2);

    expect(fullImage()).toHaveAttribute("src", FRONT_2);

    await finishDecode(FRONT_3);

    expect(fullImage()).toHaveAttribute("src", FRONT_3);
  });

  test("never steps back to an older image that finishes late", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    rerender(popover({ src: FRONT_2 }));
    rerender(popover({ src: FRONT_3 }));
    await finishDecode(FRONT_3);
    await finishDecode(FRONT_2);

    expect(fullImage()).toHaveAttribute("src", FRONT_3);
  });

  test("drops images still decoding when the arrow key is released", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    rerender(popover({ src: FRONT_2 }));
    rerender(popover({ src: FRONT_3 }));
    fireEvent.keyUp(window, { key: "ArrowRight" });
    await finishDecode(FRONT_2);

    expect(fullImage()).toHaveAttribute("src", FRONT_1);

    await finishDecode(FRONT_3);

    expect(fullImage()).toHaveAttribute("src", FRONT_3);
  });

  test("holds key repeats until the current image is decoded", async () => {
    const onNext = vi.fn();
    const { rerender } = render(popover({ onNext }));
    await finishDecode(FRONT_1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNext).toHaveBeenCalledTimes(1);
    rerender(popover({ onNext, src: FRONT_2 }));

    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(onNext).toHaveBeenCalledTimes(1);

    await finishDecode(FRONT_2);
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(onNext).toHaveBeenCalledTimes(2);
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

  test("reuses a warmed full image instead of probing it again", () => {
    const src = "/api/images/notes/9/front-full.jpg?v=1";
    const warmed = preloadImage(src);
    Object.defineProperty(warmed, "complete", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(warmed, "naturalWidth", {
      configurable: true,
      value: 900,
    });

    render(
      popover({
        src,
        thumb: "/api/images/notes/9/front-thumbnail.jpg?v=1",
      }),
    );

    expect(fullImage()).toHaveAttribute("src", src);
    expect(thumbImage()).toBeNull();
  });
});

describe("ImagePopover zoom", () => {
  test("steps from the fitted size and reports the level", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    // The first press is 1.25x the fitted plate (625px), not 100% of the
    // 2000px scan.
    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("625px");
    expect(image.style.height).toBe("312.5px");
    expect(zoomLevel()).toHaveTextContent("31%");

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));

    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("25%");

    fireEvent.click(screen.getByRole("button", { name: "100%" }));

    expect(image.style.width).toBe("2000px");
    expect(image.style.height).toBe("1000px");
    expect(zoomLevel()).toHaveTextContent("100%");
  });

  test("centres the double-clicked point on the first zoom", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 700,
      fitHeight: 350,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    // Click the centre of the fitted image. The first zoom is 1.25x fit, so
    // the image is 875px wide and its centre must sit at the plate centre.
    fireEvent.doubleClick(image, { clientX: 400, clientY: 300 });

    expect(image.style.width).toBe("875px");
    expect(image.style.transform).toMatch(
      /^translate\(-37\.5\d*px, 81\.25px\)$/,
    );
  });

  test("does not shrink a scan that already fits the plate", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 400,
      naturalHeight: 200,
      fitWidth: 400,
      fitHeight: 200,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    expect(screen.getByRole("button", { name: "100%" })).toBeDisabled();

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("500px");
    expect(image.style.height).toBe("250px");
    expect(image.style.transform).toBe("translate(150px, 175px)");
    expect(zoomLevel()).toHaveTextContent("125%");
  });

  test("wheel zooms in, and Escape unwinds the zoom before closing", async () => {
    const onClose = vi.fn();

    render(popover({ onClose }));
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    fireEvent.wheel(image, { deltaY: -100, clientX: 400, clientY: 300 });

    expect(image.style.width).toBe("625px");
    expect(zoomLevel()).toHaveTextContent("31%");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("25%");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("wheel zoom cancels the wheel event so the overlay stays put", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    // dispatchEvent returns false only when a listener prevented the default;
    // React's delegated wheel listener is passive, so it cannot.
    const notCanceled = fireEvent.wheel(image, {
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });

    expect(notCanceled).toBe(false);
  });

  test("keeps 100% as the top stop when the ladder ends below it", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 5000,
      naturalHeight: 2500,
      fitWidth: 1000,
      fitHeight: 500,
    });
    measurePopoverWrap({ width: 1000, height: 600 });

    fireEvent.click(screen.getByRole("button", { name: "100%" }));

    expect(image.style.width).toBe("5000px");
    expect(zoomButton("Zoom in")).toBeDisabled();

    // At 100% the ladder's top rung (4x fit, 80%) is below the current scale;
    // a further zoom-in must hold still rather than step backwards.
    fireEvent.keyDown(window, { key: "+" });

    expect(image.style.width).toBe("5000px");
    expect(zoomLevel()).toHaveTextContent("100%");
  });
});
