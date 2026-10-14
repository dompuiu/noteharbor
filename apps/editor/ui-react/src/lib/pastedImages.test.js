import { describe, expect, test, vi } from "vitest";
import {
  normalizePastedImageFile,
  pastedFileNameToJpeg,
  shouldConvertPastedImage,
} from "./pastedImages.js";

describe("shouldConvertPastedImage", () => {
  test("converts clipboard PNGs, keeps JPEGs as-is", () => {
    expect(
      shouldConvertPastedImage(new File(["x"], "image.png", { type: "image/png" })),
    ).toBe(true);
    expect(
      shouldConvertPastedImage(new File(["x"], "photo.jpg", { type: "image/jpeg" })),
    ).toBe(false);
    expect(shouldConvertPastedImage(null)).toBe(false);
  });
});

describe("pastedFileNameToJpeg", () => {
  test("swaps extension to .jpg", () => {
    expect(pastedFileNameToJpeg("image.png")).toBe("image.jpg");
    expect(pastedFileNameToJpeg("photo.PNG")).toBe("photo.jpg");
    expect(pastedFileNameToJpeg("")).toBe("pasted-image.jpg");
    expect(pastedFileNameToJpeg(null)).toBe("pasted-image.jpg");
  });
});

describe("normalizePastedImageFile", () => {
  test("returns non-PNG files untouched", async () => {
    const file = new File(["abc"], "photo.jpg", { type: "image/jpeg" });
    await expect(normalizePastedImageFile(file)).resolves.toBe(file);
  });

  test("converts PNG clipboard bitmap to smaller JPEG", async () => {
    const png = new File(["png-bytes-0123456789"], "image.png", { type: "image/png" });
    const jpegBlob = new Blob(["jpeg"], { type: "image/jpeg" });

    const bitmap = { width: 10, height: 8, close: vi.fn() };
    const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      convertToBlob: vi.fn(async () => jpegBlob),
    };

    const converted = await normalizePastedImageFile(png, {
      createImageBitmap: async () => bitmap,
      createCanvas: () => canvas,
    });

    expect(converted).toBeInstanceOf(File);
    expect(converted.type).toBe("image/jpeg");
    expect(converted.name).toBe("image.jpg");
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(8);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(bitmap.close).toHaveBeenCalled();
  });

  test("keeps PNG when JPEG output is not smaller", async () => {
    const png = new File(["0123456789"], "image.png", { type: "image/png" });
    const bigJpeg = new Blob(["0123456789abcdef"], { type: "image/jpeg" });
    const bitmap = { width: 4, height: 4, close: vi.fn() };
    const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      convertToBlob: vi.fn(async () => bigJpeg),
    };

    await expect(
      normalizePastedImageFile(png, {
        createImageBitmap: async () => bitmap,
        createCanvas: () => canvas,
      }),
    ).resolves.toBe(png);
  });

  test("returns original PNG when decoder is unavailable or fails", async () => {
    const png = new File(["png"], "image.png", { type: "image/png" });
    await expect(
      normalizePastedImageFile(png, { createImageBitmap: null }),
    ).resolves.toBe(png);
    await expect(
      normalizePastedImageFile(png, {
        createImageBitmap: async () => {
          throw new Error("decode failed");
        },
      }),
    ).resolves.toBe(png);
  });
});
