import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { preloadImage } from "../lib/imagePreload.js";
import { ImagePopover } from "./Slideshow.jsx";

const FRONT_1 = "/api/images/notes/1/front-full.jpg?v=1";
const THUMB_1 = "/api/images/notes/1/front-thumbnail.jpg?v=1";
const BACK_1 = "/api/images/notes/1/back-full.jpg?v=1";
const BACK_THUMB_1 = "/api/images/notes/1/back-thumbnail.jpg?v=1";
const THUMB_2 = "/api/images/notes/2/front-thumbnail.jpg?v=1";
const FRONT_2 = "/api/images/notes/2/front-full.jpg?v=1";
const FRONT_3 = "/api/images/notes/3/front-full.jpg?v=1";
const THUMB_3 = "/api/images/notes/3/front-thumbnail.jpg?v=1";

function popover(overrides = {}) {
  return (
    <ImagePopover
      alt="1 leu - 100, Front"
      availableSides={["front", "back"]}
      canGoNext
      canGoPrevious
      counterPosition={1}
      counterTotal={3}
      noteKey="note-1"
      noteLabel="1 leu - 100"
      onClose={() => {}}
      onJump={() => {}}
      onNext={() => {}}
      onPrevious={() => {}}
      onSelectSide={() => {}}
      placeholderText="No image yet."
      side="front"
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

  test("a late error from the previous page does not mark the new image missing", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    const element = fullImage();
    expect(element).toHaveAttribute("src", FRONT_1);

    // Page to the back while its scan is still decoding: the front stays on
    // screen, so its element can report a late error for the old URL.
    rerender(popover({ src: BACK_1, thumb: BACK_THUMB_1 }));
    fireEvent.error(element);

    expect(document.querySelector(".image-popover-empty-state")).toBeNull();
    expect(
      document.querySelector('.image-popover-announcer[role="status"]'),
    ).not.toHaveTextContent("image unavailable");

    await finishDecode(BACK_1);

    expect(fullImage()).toHaveAttribute("src", BACK_1);
    expect(document.querySelector(".image-popover-empty-state")).toBeNull();
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
  test("keeps Fit enabled and pressed while the image sits at fit", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    measureImageBox(fullImage(), {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    const fit = screen.getByRole("button", { name: "Fit" });

    // The active option is a choice, not a disabled state.
    expect(fit).toBeEnabled();
    expect(fit).toHaveAttribute("aria-pressed", "true");

    const actualSize = screen.getByRole("button", { name: "1:1" });

    expect(actualSize).toBeEnabled();
    expect(actualSize).toHaveAttribute(
      "title",
      "Show the image at one image pixel per screen pixel",
    );
  });

  test("keeps the zoom across a note's faces and resets on another note", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    measureImageBox(fullImage(), {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    fireEvent.click(zoomButton("Zoom in"));

    expect(fullImage().style.width).toBe("625px");

    // The back face of the same note keeps the chosen scale.
    rerender(popover({ src: BACK_1, thumb: BACK_THUMB_1 }));
    await finishDecode(BACK_1);

    expect(fullImage()).toHaveAttribute("src", BACK_1);
    expect(fullImage().style.width).toBe("625px");

    // Another note starts again at Fit.
    rerender(
      popover({
        noteKey: "note-2",
        src: FRONT_3,
        thumb: THUMB_3,
      }),
    );
    await finishDecode(FRONT_3);

    expect(fullImage()).toHaveAttribute("src", FRONT_3);
    expect(fullImage().style.width).toBe("");
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("re-measures the next face's fit before stepping the ladder", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("625px");

    // The back face is square and fits at 250px, so the ladder must step from
    // that fit (1.5x = 375px), not from the front's stale 500px fit.
    rerender(popover({ src: BACK_1, thumb: BACK_THUMB_1 }));
    await finishDecode(BACK_1);
    measureImageBox(image, {
      naturalWidth: 1000,
      naturalHeight: 1000,
      fitWidth: 250,
      fitHeight: 250,
    });

    expect(image.style.width).toBe("312.5px");
    expect(image.style.height).toBe("312.5px");
    expect(imageWrap()).toHaveClass("image-popover-image-wrap--zoomed");

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("375px");
  });

  test("clamps the retained zoom up to a larger face's fit instead of resetting", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("625px");

    // This back already fits at 80% of its natural pixels, so the front's 31%
    // zoom would paint it below its own fit. Clamping up to the back's fit
    // keeps the zoom across the face switch instead of dropping to Fit.
    rerender(popover({ src: BACK_1, thumb: BACK_THUMB_1 }));
    await finishDecode(BACK_1);
    measureImageBox(image, {
      naturalWidth: 1000,
      naturalHeight: 1000,
      fitWidth: 800,
      fitHeight: 800,
    });

    expect(image.style.width).toBe("800px");
    expect(image.style.height).toBe("800px");
    expect(imageWrap()).toHaveClass("image-popover-image-wrap--zoomed");
    expect(zoomLevel()).toHaveTextContent("80%");
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // The ladder now steps from the back's own fit.
    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("1000px");
    expect(zoomLevel()).toHaveTextContent("100%");
  });

  test("steps a retained zoom back while the next scan is still loading", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    const image = fullImage();

    measureImageBox(image, {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("625px");

    // The next scan is not decoded yet, so the front stays on screen. Stepping
    // back needs only the retained zoom, not the incoming page's pixels.
    rerender(popover({ src: BACK_1, thumb: BACK_THUMB_1 }));

    expect(zoomButton("Zoom out")).toBeEnabled();

    fireEvent.click(zoomButton("Zoom out"));

    expect(image.style.width).toBe("");
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await finishDecode(BACK_1);

    expect(fullImage()).toHaveAttribute("src", BACK_1);
    expect(fullImage().style.width).toBe("");
  });

  test("a same-note Home jump keeps the zoom", async () => {
    render(popover({ onPreviewStart: () => true }));

    await finishDecode(FRONT_1);

    measureImageBox(fullImage(), {
      naturalWidth: 2000,
      naturalHeight: 1000,
      fitWidth: 500,
      fitHeight: 250,
    });
    measurePopoverWrap({ width: 800, height: 600 });

    fireEvent.click(zoomButton("Zoom in"));

    expect(fullImage().style.width).toBe("625px");

    fireEvent.keyDown(window, { key: "Home" });

    expect(fullImage().style.width).toBe("625px");
  });

  test("steps from the fitted size and marks the 1:1 stop", async () => {
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

    // The first press is 1.25x the fitted plate (625px), not the 2000px
    // 1:1 stop.
    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("625px");
    expect(image.style.height).toBe("312.5px");
    expect(zoomLevel()).toHaveTextContent("31%");

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));

    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("25%");

    fireEvent.click(screen.getByRole("button", { name: "1:1" }));

    expect(image.style.width).toBe("2000px");
    expect(image.style.height).toBe("1000px");
    expect(zoomLevel()).toHaveTextContent("100%");
    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // The pressed segment says 1:1, so the readout stays a percent.
    expect(zoomLevel()).not.toHaveTextContent("1:1");
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

    const actualSize = screen.getByRole("button", { name: "1:1" });

    // Fit is already one image pixel per screen pixel, so the stop is inert
    // and says why instead of looking broken.
    expect(actualSize).toBeDisabled();
    expect(actualSize).toHaveAttribute(
      "title",
      "The image already shows one image pixel per screen pixel",
    );

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("500px");
    expect(image.style.height).toBe("250px");
    expect(image.style.transform).toBe("translate(150px, 175px)");
    expect(zoomLevel()).toHaveTextContent("125%");

    // Zoomed past the 1:1 fit, the stop has work again: it returns to actual
    // size, and its title stops claiming the image already sits there.
    expect(actualSize).toBeEnabled();
    expect(actualSize).toHaveAttribute(
      "title",
      "Show the image at one image pixel per screen pixel",
    );

    fireEvent.click(actualSize);

    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("100%");
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

    // The Close hint must not promise a single Escape while zoomed.
    expect(
      screen.getByRole("button", { name: "Close preview" }),
    ).toHaveAttribute("data-shortcut", "Esc");

    fireEvent.wheel(image, {
      ctrlKey: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });

    expect(image.style.width).toBe("625px");
    expect(zoomLevel()).toHaveTextContent("31%");
    expect(
      screen.getByRole("button", { name: "Close preview" }),
    ).toHaveAttribute("data-shortcut", "Esc ×2");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("25%");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a modified wheel zoom cancels the wheel event so the overlay stays put", async () => {
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
      metaKey: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });

    expect(notCanceled).toBe(false);
  });

  test("a plain wheel leaves the plate at fit and is not cancelled", async () => {
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

    // No modifier: the plate keeps its fit and the event is left to the
    // overlay's own scroll, never cancelled.
    const notCanceled = fireEvent.wheel(image, {
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });

    expect(notCanceled).toBe(true);
    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("25%");
  });

  test("Shift+wheel stays out of the zoom, matching normal scrolling", async () => {
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

    const notCanceled = fireEvent.wheel(image, {
      shiftKey: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });

    expect(notCanceled).toBe(true);
    expect(image.style.width).toBe("");
    expect(zoomLevel()).toHaveTextContent("25%");
  });

  test("keeps 1:1 as the top stop when the ladder ends below it", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "1:1" }));

    expect(image.style.width).toBe("5000px");
    expect(zoomButton("Zoom in")).toBeDisabled();

    // At the 1:1 stop (100%) the ladder's top rung (4x fit, 80%) is below the
    // current scale; a further zoom-in must hold still rather than step
    // backwards.
    fireEvent.keyDown(window, { key: "+" });

    expect(image.style.width).toBe("5000px");
    expect(zoomLevel()).toHaveTextContent("100%");
  });

  test("the scrim steps back to Fit before it closes", async () => {
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

    fireEvent.click(zoomButton("Zoom in"));

    expect(image.style.width).toBe("625px");

    // The first scrim click is the first Escape: it unwinds the zoom only.
    fireEvent.click(document.querySelector(".image-popover-overlay"));

    expect(onClose).not.toHaveBeenCalled();
    expect(image.style.width).toBe("");

    fireEvent.click(document.querySelector(".image-popover-overlay"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImagePopover side and naming", () => {
  test("names the dialog with the note and announces side and position", async () => {
    const { rerender } = render(popover());
    await finishDecode(FRONT_1);

    const dialog = screen.getByRole("dialog", { name: "1 leu - 100" });
    expect(
      within(dialog).getByRole("heading", {
        level: 2,
        name: "1 leu - 100",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 leu - 100, Front" })).toBeInTheDocument();

    // The note label is the topbar's first line, with no eyebrow above it.
    expect(dialog.querySelector(".image-popover-topbar .eyebrow")).toBeNull();

    const announcer = dialog.querySelector(
      '.image-popover-announcer[role="status"]',
    );
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveTextContent("1 leu - 100, Front, image 1 of 3");

    rerender(popover({ side: "back", src: BACK_1, thumb: BACK_THUMB_1 }));
    await finishDecode(BACK_1);

    expect(announcer).toHaveTextContent("1 leu - 100, Back, image 1 of 3");
  });

  test("describes the dialog with the two-stage Escape rule", async () => {
    render(popover());
    await finishDecode(FRONT_1);

    const dialog = screen.getByRole("dialog", { name: "1 leu - 100" });

    // The rule is read once, on open, before the live status is touched.
    expect(dialog).toHaveAccessibleDescription(
      "Escape returns a zoomed image to Fit, then closes the preview. " +
        "1 leu - 100, Front, image 1 of 3",
    );
  });

  test("the Front | Back toggle marks the open side and asks for the other", () => {
    const onSelectSide = vi.fn();

    render(popover({ onSelectSide }));

    const front = screen.getByRole("button", { name: "Front" });
    const back = screen.getByRole("button", { name: "Back" });

    expect(front).toHaveAttribute("aria-pressed", "true");
    expect(back).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(back);

    expect(onSelectSide).toHaveBeenCalledWith("back");

    // The open side is not a switch away from itself.
    fireEvent.click(front);

    expect(onSelectSide).toHaveBeenCalledTimes(1);
  });

  test("a missing side shows the empty state without a zoom cluster", () => {
    const onEdit = vi.fn();
    const onSelectSide = vi.fn();

    render(
      popover({
        availableSides: ["front"],
        onEdit,
        onSelectSide,
        side: "back",
        src: null,
        thumb: null,
      }),
    );

    const back = screen.getByRole("button", { name: "Back" });

    // aria-disabled, not disabled: the pressed state stays readable.
    expect(back).toHaveAttribute("aria-pressed", "true");
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(document.querySelector(".image-popover-empty-state")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Image zoom" })).toBeNull();

    fireEvent.click(back);

    expect(onSelectSide).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("a present side stays reachable from a missing one", () => {
    const onSelectSide = vi.fn();

    render(
      popover({
        availableSides: ["front"],
        onSelectSide,
        side: "back",
        src: null,
        thumb: null,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Front" }));

    expect(onSelectSide).toHaveBeenCalledWith("front");
    // Without an editor callback (the Showcase) there is nothing to offer.
    expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull();
  });

  test("the announcement says when a page has no image", () => {
    render(popover({ availableSides: ["front"], side: "back", src: null, thumb: null }));

    expect(
      document.querySelector('.image-popover-announcer[role="status"]'),
    ).toHaveTextContent("1 leu - 100, Back, image 1 of 3, no image");
  });

  test("a scan whose file is gone shows the missing state with its file name", async () => {
    render(popover({ onEdit: () => {} }));
    await finishDecode(FRONT_1);

    fireEvent.error(fullImage());

    expect(document.querySelector(".image-popover-empty-state")).not.toBeNull();
    expect(screen.getByText("front-full.jpg")).toBeInTheDocument();
    // The note still claims the scan, so the zoom instrument stays on screen,
    // but there are no pixels to step through and the readout says Fit.
    expect(
      screen.getByRole("group", { name: "Image zoom" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(zoomLevel()).toHaveTextContent("Fit");
    expect(screen.getByRole("button", { name: "Front" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(
      document.querySelector('.image-popover-announcer[role="status"]'),
    ).toHaveTextContent("image unavailable");
  });

  test("a broken warming thumbnail also shows the missing state", () => {
    render(popover());

    fireEvent.error(thumbImage());

    expect(fullImage()).toBeNull();
    // The quiet line names the file that failed, not the full scan behind it.
    expect(screen.getByText("front-thumbnail.jpg")).toBeInTheDocument();
  });

  test("the image counter is a spinbutton so the position reads as one", () => {
    render(popover());

    const counter = screen.getByRole("spinbutton", { name: "Image position" });

    expect(counter).toHaveAttribute("aria-valuenow", "1");
    expect(counter).toHaveAttribute("aria-valuemin", "1");
    expect(counter).toHaveAttribute("aria-valuemax", "3");
  });
});
