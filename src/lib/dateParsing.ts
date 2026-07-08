// Shared DD/MM/YYYY (and DD/MM/YY) date extraction for raw OCR text, used by both
// googleVision.ts and ocrSpace.ts. Previously each file had its own copy of this
// regex with NO range validation (L2) — a misread like "45/13/2026" would happily
// produce the string "2026-13-45", which is not a valid calendar date and would
// flow into extractionValidator's date-reconciliation logic unguarded. This version
// validates day (1-31) and month (1-12) bounds, then does a JS Date round-trip check
// to also catch impossible combinations like day 31 in a 30-day month or Feb 30.

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  // If JS rolled the date forward (e.g. Feb 30 → Mar 2), the components won't match.
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Extracts a DD/MM/YYYY or DD/MM/YY date from free-form OCR text and returns it as
 * YYYY-MM-DD, or null if no valid calendar date is found.
 */
export function extractDateDDMMYYYY(text: string): string | null {
  // DD/MM/YYYY or D/M/YYYY
  let m = text.match(/\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\b/);
  if (m) {
    const [, dStr, moStr, yStr] = m;
    const d = parseInt(dStr, 10);
    const mo = parseInt(moStr, 10);
    const y = parseInt(yStr, 10);
    if (isValidCalendarDate(y, mo, d)) {
      return `${yStr}-${moStr.padStart(2, '0')}-${dStr.padStart(2, '0')}`;
    }
  }
  // DD/MM/YY or D/M/YY
  m = text.match(/\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})\b/);
  if (m) {
    const [, dStr, moStr, yStr] = m;
    const d = parseInt(dStr, 10);
    const mo = parseInt(moStr, 10);
    const yy = parseInt(yStr, 10);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    if (isValidCalendarDate(year, mo, d)) {
      return `${year}-${moStr.padStart(2, '0')}-${dStr.padStart(2, '0')}`;
    }
  }
  return null;
}
