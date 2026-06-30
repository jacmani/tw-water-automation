import type { ExtractionResult, TowerMeterData } from '@/types';
import type { GoogleVisionResult } from './googleVision';
import type { OcrSpaceResult } from './ocrSpace';

export interface ValidationReport {
  corroboratedNumbers: number;
  unverifiedNumbers: string[];
  dateMismatch: boolean;
  visionDate: string | null;
  confidenceBoost: number; // net adjustment: positive = boost, negative = penalty
  flags: string[];
  ocrSources: string[];
}

/**
 * Extract numeric tokens from Mistral OCR markdown output.
 * Strips table formatting characters (| - #) and returns tokens that look like
 * integers or Indian-format numbers (e.g. "1,76,000").
 */
function extractNumbersFromMarkdown(markdown: string): string[] {
  const cleaned = markdown
    .replace(/\|/g, ' ')
    .replace(/[-]{2,}/g, ' ')
    .replace(/[#*`]/g, ' ');
  return cleaned
    .split(/\s+/)
    .filter(w => /^\d[\d,]*$/.test(w) && w.length >= 2); // at least 2 chars to skip noise
}

export function validateExtraction(
  claudeResult: ExtractionResult,
  visionResult: GoogleVisionResult,
  ocrSpaceResult?: OcrSpaceResult,
  mistralMarkdown?: string
): ValidationReport {
  const flags: string[] = [];
  const unverifiedNumbers: string[] = [];
  let corroboratedNumbers = 0;
  const ocrSources: string[] = [];

  // ── Build merged word list from all available OCR sources ─────────────────
  const allWords: string[] = [];
  if (visionResult.words.length > 0) {
    allWords.push(...visionResult.words);
    ocrSources.push('google_vision');
  }
  if (ocrSpaceResult && ocrSpaceResult.words.length > 0) {
    allWords.push(...ocrSpaceResult.words);
    ocrSources.push('ocr_space');
  }
  if (mistralMarkdown) {
    const mistralTokens = extractNumbersFromMarkdown(mistralMarkdown);
    if (mistralTokens.length > 0) {
      allWords.push(...mistralTokens);
      ocrSources.push('mistral_ocr');
    }
  }

  console.log(`[validator] OCR sources: ${ocrSources.join(', ') || 'none'}, total words: ${allWords.length}`);

  const allNumbers = allWords
    .map(w => parseFloat(w.replace(/,/g, '')))
    .filter(n => !isNaN(n));

  function check(value: number | null, fieldName: string): void {
    if (value === null) return;
    // ±1% tolerance, min 0.5 for small values
    const tolerance = Math.max(Math.abs(value) * 0.01, 0.5);
    const found = allNumbers.some(n => Math.abs(n - value) <= tolerance);
    if (found) {
      corroboratedNumbers++;
    } else {
      unverifiedNumbers.push(fieldName);
      flags.push(`unverified_number: ${fieldName}=${value}`);
    }
  }

  // ── Tower section ─────────────────────────────────────────────────────────
  for (const [towerName, meters] of Object.entries(claudeResult.tower_section)) {
    for (const [meterType, data] of Object.entries(meters) as [string, TowerMeterData][]) {
      check(data.total_ltrs, `tower_${towerName}_${meterType}_total_ltrs`);
    }
  }

  // ── Water sources ─────────────────────────────────────────────────────────
  for (const source of claudeResult.water_sources) {
    check(source.total, `water_source_${source.location}_total`);
  }

  // ── Summary section (critical accountability values) ──────────────────────
  if (claudeResult.summary) {
    check(claudeResult.summary.input_total, 'summary_input_total');
    check(claudeResult.summary.tower_usage, 'summary_tower_usage');
  }

  // ── Date reconciliation ───────────────────────────────────────────────────
  const candidateDates = [
    visionResult.detectedDate,
    ocrSpaceResult?.detectedDate ?? null,
  ].filter(Boolean) as string[];

  const agreedDate =
    candidateDates.length >= 2 && candidateDates[0] === candidateDates[1]
      ? candidateDates[0]
      : candidateDates[0] ?? null;

  const visionDate = agreedDate;
  let dateMismatch = false;

  if (visionDate !== null && claudeResult.date !== null && visionDate !== claudeResult.date) {
    dateMismatch = true;
    flags.push(`date_mismatch: ocr=${visionDate} claude=${claudeResult.date}`);
  }

  // ── Confidence adjustment ─────────────────────────────────────────────────
  // Positive: +0.02 per corroborated number, +0.05 when 2+ OCR sources contributed.
  // Negative penalty: when OCR sources are available but many values can't be found,
  // it's a signal that the AI model saw significantly different numbers than the OCR.
  const multiSourceBonus = ocrSources.length >= 2 ? 0.05 : 0;
  const totalChecked = corroboratedNumbers + unverifiedNumbers.length;
  const unverifiedRate = (ocrSources.length > 0 && totalChecked > 4)
    ? unverifiedNumbers.length / totalChecked
    : 0;
  // Penalty kicks in when >60% of checked values can't be corroborated.
  const penaltyRate = Math.max(0, unverifiedRate - 0.6);
  const confidencePenalty = penaltyRate * 0.12;
  const confidenceBoost = corroboratedNumbers * 0.02 + multiSourceBonus - confidencePenalty;

  if (confidencePenalty > 0) {
    console.warn(`[validator] Low corroboration rate ${(unverifiedRate * 100).toFixed(0)}% — applying confidence penalty -${confidencePenalty.toFixed(3)}`);
  }

  console.log(`[validator] corroborated=${corroboratedNumbers} unverified=${unverifiedNumbers.length} boost=${confidenceBoost.toFixed(3)}`);

  return {
    corroboratedNumbers,
    unverifiedNumbers,
    dateMismatch,
    visionDate,
    confidenceBoost,
    flags,
    ocrSources,
  };
}
