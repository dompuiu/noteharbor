const NOTE_CLIPBOARD_FIELD_NAMES = [
  "denomination",
  "issue_date",
  "catalog_number",
  "grading_company",
  "grade",
  "watermark",
  "serial",
  "url",
  "tags",
  "notes",
];

function normalizeForClipboard(value) {
  return String(value ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return "";
  }

  return tags
    .map((tag) => {
      if (typeof tag === "string") {
        return tag;
      }

      if (tag && typeof tag === "object" && "name" in tag) {
        return tag.name;
      }

      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function formatNoteAsTsvRow(note) {
  const values = NOTE_CLIPBOARD_FIELD_NAMES.map((fieldName) => {
    if (fieldName === "tags") {
      return normalizeTags(note?.tags);
    }

    return note?.[fieldName];
  }).map(normalizeForClipboard);

  return values.join("\t");
}

function parseTags(value) {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseNoteDetailsFromClipboardText(text) {
  const rawClipboardText = String(text ?? "");
  const normalizedLineEndings = rawClipboardText.replace(/\r\n?/g, "\n");
  const clipboardText = normalizedLineEndings.endsWith("\n")
    ? normalizedLineEndings.slice(0, -1)
    : normalizedLineEndings;

  if (!clipboardText || clipboardText.includes("\n")) {
    throw new Error("Clipboard does not contain note details in the expected format.");
  }

  const values = clipboardText.split("\t");

  if (values.length !== NOTE_CLIPBOARD_FIELD_NAMES.length) {
    throw new Error("Clipboard does not contain note details in the expected format.");
  }

  return NOTE_CLIPBOARD_FIELD_NAMES.reduce((note, fieldName, index) => {
    const value = values[index] ?? "";

    note[fieldName] = fieldName === "tags" ? parseTags(value) : value.trim();
    return note;
  }, {});
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

async function readTextFromClipboard() {
  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard read is not supported.");
  }

  return navigator.clipboard.readText();
}

export {
  copyTextToClipboard,
  formatNoteAsTsvRow,
  parseNoteDetailsFromClipboardText,
  readTextFromClipboard,
};
