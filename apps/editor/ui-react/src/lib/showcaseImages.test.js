import { describe, expect, test } from "vitest";
import {
  firstAvailableNoteImage,
  pickNoteImage,
  versionedImagePath,
} from "./showcaseImages.js";

const note = {
  updated_at: "rev-1",
  images: [
    { type: "front", variant: "full", localPath: "/api/images/notes/1/front.jpg" },
    {
      type: "front",
      variant: "thumbnail",
      localPath: "/api/images/notes/1/front-thumb.jpg",
    },
  ],
};

describe("versionedImagePath", () => {
  test("appends the note version to cache-bust", () => {
    expect(versionedImagePath("/api/images/x.jpg", "7")).toBe(
      "/api/images/x.jpg?v=7",
    );
  });

  test("uses & when the path already has a query", () => {
    expect(versionedImagePath("/api/images/x.jpg?a=1", "7")).toBe(
      "/api/images/x.jpg?a=1&v=7",
    );
  });

  test("returns an empty string for a missing path", () => {
    expect(versionedImagePath(null, "7")).toBe("");
    expect(versionedImagePath("", "7")).toBe("");
  });
});

describe("pickNoteImage", () => {
  test("prefers the thumbnail and falls back to full", () => {
    expect(pickNoteImage(note, "front", "thumbnail")).toBe(
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
    expect(pickNoteImage(note, "front", "full")).toBe(
      "/api/images/notes/1/front.jpg?v=rev-1",
    );
  });

  test("returns an empty string when the slot is missing", () => {
    expect(pickNoteImage(note, "back")).toBe("");
  });
});

describe("firstAvailableNoteImage", () => {
  test("prefers front thumbnail, then front full, then the back", () => {
    expect(firstAvailableNoteImage(note)).toEqual({
      path: "/api/images/notes/1/front-thumb.jpg?v=rev-1",
      type: "front",
      variant: "thumbnail",
    });
  });

  test("falls back to the back when there is no front", () => {
    const backOnly = {
      updated_at: "v1",
      images: [
        { type: "back", variant: "full", localPath: "/api/images/notes/2/back.jpg" },
      ],
    };

    expect(firstAvailableNoteImage(backOnly)).toEqual({
      path: "/api/images/notes/2/back.jpg?v=v1",
      type: "back",
      variant: "full",
    });
  });

  test("returns null when the note has no images", () => {
    expect(firstAvailableNoteImage({ images: [] })).toBeNull();
  });
});
