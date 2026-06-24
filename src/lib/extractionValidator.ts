import type { ExtractionResult, TowerMeterData } from '@/types';
import type { GoogleVisionResult } from './googleVision';
import type { OcrSpaceResult } from './ocrSpace';

export interface ValidationReport {
  corroboratedNumbers: number;
  unverifiedNumbers: string[];
  dateMismatch: boolean;
  visionDate: string | null;
  confidenceBoost: number;
  flags: string[];
  ocrSources: string[]; // which OCR engines contributed words
}

export function validateExtraction(
  claudeResult: ExtractionResult,
  visionResult: GoogleVisionResult,
  ocrSpaceResult?: OcrSpaceResult
): ValidationReport {
  const flags: string[] = [];
  const unverifiedNumbers: string[] = [];
  let corroboratedNumbers = 0;
  const ocrSources: string[] = [];

  // Merge word lists from all available OCR sources
  const allWords: string[] = [];
  if (visionResult.words.length > 0) {
    allWords.push(...visionResult.words);
    ocrSources.push('google_vision');
  }
  if (ocrSpaceResult && ocrSpaceResult.words.length > 0) {
    allWords.push(...ocrSpaceResult.words);
    ocrSources.push('ocr_space');
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

  for (const [towerName, meters] of Object.entries(claudeResult.tower_section)) {
    for (const [meterType, data] of Object.entries(meters) as [string, TowerMeterData][]) {
      check(data.total_ltrs, `tower_${towerName}_${meterType}_total_ltrs`);
    }
  }

  for (const source of claudeResult.water_sources) {
    check(source.total, `water_source_${source.location}_total`);
  }

  // Date reconciliation: prefer agreement between both OCR sources
  const candidateDates = [
    visionResult.detectedDate,
    ocrSpaceResult?.detectedDate ?? null,
  ].filter(Boolean) as string[];

  // If both engines agree → high confidence; otherwise take first available
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

  // +0.02 per corroborated number, +0.05 bonus when both OCR engines contributed
  const multiSourceBonus = ocrSources.length >= 2 ? 0.05 : 0;
  const confidenceBoost = corroboratedNumbers * 0.02 + multiSourceBonus;

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
