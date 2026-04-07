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
  const values = [
    note?.denomination,
    note?.issue_date,
    note?.catalog_number,
    note?.grading_company,
    note?.grade,
    note?.watermark,
    note?.serial,
    note?.url,
    normalizeTags(note?.tags),
    note?.notes,
  ].map(normalizeForClipboard);

  return values.join("\t");
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

export { copyTextToClipboard, formatNoteAsTsvRow };
