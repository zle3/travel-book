// Place notes that are only noise. A saved-place note that is just a score ("8.4") or a score and one word ("7.9 matcha") is dropped.
// Text notes stay as written, including phrases with a number ("Michelin Gourmand Bib 2025", "8.0 egg tart, cake").
const NUMERIC_NOISE = /^\d{1,2}(?:[.,]\d{1,2})?(?:\s+[A-Za-z]+)?$/;

/** The note to ship for a place, or "" when the note is numeric noise or blank. Pure: used by build-data.mjs. */
export function cleanNote(note) {
  const t = String(note ?? "").trim();
  return t && !NUMERIC_NOISE.test(t) ? t : "";
}
