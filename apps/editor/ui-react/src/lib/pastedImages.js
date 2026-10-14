// Clipboard pastes of web images arrive as decoded `image/png` bitmaps
// (the original JPEG bytes are lost), so a 1.7 MB JPEG photo can become an
// ~8 MB PNG. Converting pasted PNGs back to JPEG keeps uploads small while
// leaving explicit file uploads and scraped URLs untouched.

const PASTED_IMAGE_JPEG_QUALITY = 0.92;
const PASTED_IMAGE_FALLBACK_NAME = "pasted-image.jpg";

function shouldConvertPastedImage(file) {
  return Boolean(file) && file.type === "image/png";
}

function pastedFileNameToJpeg(name) {
  const base = String(name ?? "").trim();
  if (!base) {
    return PASTED_IMAGE_FALLBACK_NAME;
  }
  const withoutExt = base.replace(/\.[^.]*$/, "");
  const stem = withoutExt.trim() || "pasted-image";
  return `${stem}.jpg`;
}

function defaultCreateCanvas() {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }
  return document.createElement("canvas");
}

function canvasToJpegBlob(canvas, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}

async function normalizePastedImageFile(file, dependencies = {}) {
  if (!shouldConvertPastedImage(file)) {
    return file;
  }

  const createImageBitmap =
    dependencies.createImageBitmap ??
    (typeof window !== "undefined" ? window.createImageBitmap : undefined) ??
    (typeof globalThis !== "undefined" ? globalThis.createImageBitmap : undefined);
  if (typeof createImageBitmap !== "function") {
    return file;
  }

  const createCanvas = dependencies.createCanvas ?? defaultCreateCanvas;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = createCanvas();
      if (!canvas) {
        return file;
      }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) {
        return file;
      }
      // JPEG has no alpha channel: flatten onto white so transparent
      // clipboard PNGs do not turn black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);

      const blob = await canvasToJpegBlob(canvas, PASTED_IMAGE_JPEG_QUALITY);
      if (!blob || blob.size >= file.size) {
        return file;
      }
      return new File([blob], pastedFileNameToJpeg(file.name), {
        type: "image/jpeg",
      });
    } finally {
      bitmap?.close?.();
    }
  } catch {
    return file;
  }
}

export {
  PASTED_IMAGE_FALLBACK_NAME,
  PASTED_IMAGE_JPEG_QUALITY,
  normalizePastedImageFile,
  pastedFileNameToJpeg,
  shouldConvertPastedImage,
};
