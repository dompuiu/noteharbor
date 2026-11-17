import { describe, expect, test } from "vitest";
import { noteEditorHash, parseNoteEditorHash } from "./routes.js";

describe("the note editor hash", () => {
  test("builds and reads the Note id", () => {
    expect(noteEditorHash(7)).toBe("#edit/7");
    expect(parseNoteEditorHash("#edit/7")).toBe(7);
    expect(parseNoteEditorHash("#edit/007")).toBe(7);
    expect(parseNoteEditorHash("#edit/7?overlay=edit")).toBe(7);
  });

  test("ignores any other hash", () => {
    expect(parseNoteEditorHash("")).toBeNull();
    expect(parseNoteEditorHash("#edit")).toBeNull();
    expect(parseNoteEditorHash("#edit/0")).toBeNull();
    expect(parseNoteEditorHash("#edit/abc")).toBeNull();
    expect(parseNoteEditorHash("#new")).toBeNull();
    expect(parseNoteEditorHash("#slideshow/7")).toBeNull();
  });
});
