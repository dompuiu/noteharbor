import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let createdImages;
let module;

class FakeImage {
  constructor() {
    this.decodeCalls = 0;
    this.decoding = "";
    this.fetchPriority = "";
    this.src = "";
    createdImages.push(this);
  }

  decode() {
    this.decodeCalls += 1;
    return Promise.resolve();
  }
}

beforeEach(async () => {
  vi.resetModules();
  createdImages = [];
  vi.stubGlobal("Image", FakeImage);
  module = await import("./imagePreload.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preloadImage", () => {
  test("starts one speculative load per URL and dedupes repeats", () => {
    module.preloadImage("/api/images/notes/1/front-full.jpg?v=1");
    module.preloadImage("/api/images/notes/1/front-full.jpg?v=1");
    module.preloadImage("/api/images/notes/2/front-full.jpg?v=1");

    expect(createdImages).toHaveLength(2);
    expect(createdImages.map((image) => image.src)).toEqual([
      "/api/images/notes/1/front-full.jpg?v=1",
      "/api/images/notes/2/front-full.jpg?v=1",
    ]);
  });

  test("marks speculative loads async and low priority", () => {
    module.preloadImage("/api/images/notes/1/back-full.jpg?v=1");

    expect(createdImages[0].decoding).toBe("async");
    expect(createdImages[0].fetchPriority).toBe("low");
  });

  test("ignores empty and non-string sources", () => {
    module.preloadImage(null);
    module.preloadImage("");
    module.preloadImage(42);

    expect(createdImages).toHaveLength(0);
  });

  test("decodes a warmed image in the background when asked", () => {
    const src = "/api/images/notes/1/front-full.jpg?v=1";
    const image = module.preloadImage(src, { decode: true });

    expect(image.decodeCalls).toBe(1);

    module.preloadImage(src, { decode: true });
    expect(image.decodeCalls).toBe(2);
  });

  test("drops a failed speculative load so a later open retries", () => {
    const src = "/api/images/notes/1/front-full.jpg?v=1";

    module.preloadImage(src);
    expect(createdImages).toHaveLength(1);

    createdImages[0].onerror?.();

    module.preloadImage(src);
    expect(createdImages).toHaveLength(2);
  });
});

describe("getPreloadedImage", () => {
  test("returns the warmed element only for its own cache and URL", () => {
    const src = "/api/images/notes/1/front-full.jpg?v=1";
    const image = module.preloadImage(src);

    expect(module.getPreloadedImage(src)).toBe(image);
    expect(module.getPreloadedImage(src, { cache: "thumbnail" })).toBeNull();
    expect(module.getPreloadedImage(null)).toBeNull();
  });
});

describe("preloadImages", () => {
  test("preloads every source once", () => {
    module.preloadImages([
      "/api/images/notes/1/front-thumbnail.jpg?v=1",
      "/api/images/notes/1/back-thumbnail.jpg?v=1",
      "/api/images/notes/1/front-thumbnail.jpg?v=1",
      null,
    ]);

    expect(createdImages).toHaveLength(2);
  });
});

describe("neighbouringImageSources", () => {
  const items = [
    { src: "/front?v=1" },
    { src: "/back?v=1" },
    { src: "/next-front?v=1" },
    { src: "/next-back?v=1" },
  ];

  test("returns the previous and next source, wrapping at both edges", () => {
    expect(module.neighbouringImageSources(items, 0)).toEqual([
      "/back?v=1",
      "/next-back?v=1",
    ]);
    expect(module.neighbouringImageSources(items, 3)).toEqual([
      "/front?v=1",
      "/next-front?v=1",
    ]);
  });

  test("skips a missing source and a neighbour identical to the open image", () => {
    expect(
      module.neighbouringImageSources(
        [{ src: "/only?v=1" }, { src: null }, { src: "/only?v=1" }],
        0,
      ),
    ).toEqual([]);
  });

  test("returns nothing for a single image or a missing index", () => {
    expect(module.neighbouringImageSources([{ src: "/only" }], 0)).toEqual([]);
    expect(module.neighbouringImageSources(items, -1)).toEqual([]);
  });
});
