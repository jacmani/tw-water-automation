import type { ExtractionResult, TowerMeterData } from '@/types';
import type { GoogleVisionResult } from './googleVision';

export interface ValidationReport {
  corroboratedNumbers: number;
  unverifiedNumbers: string[];
  dateMismatch: boolean;
  visionDate: string | null;
  confidenceBoost: number;
  flags: string[];
}

export function validateExtraction(
  claudeResult: ExtractionResult,
  visionResult: GoogleVisionResult
): ValidationReport {
  const flags: string[] = [];
  const unverifiedNumbers: string[] = [];
  let corroboratedNumbers = 0;

  const visionNumbers = visionResult.words
    .map(w => parseFloat(w.replace(/,/g, '')))
    .filter(n => !isNaN(n));

  function check(value: number | null, fieldName: string): void {
    if (value === null) return;
    const tolerance = Math.max(Math.abs(value) * 0.01, 0.5);
    const found = visionNumbers.some(n => Math.abs(n - value) <= tolerance);
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

  const visionDate = visionResult.detectedDate;
  let dateMismatch = false;

  if (visionDate !== null && claudeResult.date !== null && visionDate !== claudeResult.date) {
    dateMismatch = true;
    flags.push(`date_mismatch: vision=${visionDate} claude=${claudeResult.date}`);
  }

  return {
    corroboratedNumbers,
    unverifiedNumbers,
    dateMismatch,
    visionDate,
    confidenceBoost: corroboratedNumbers * 0.02,
    flags,
  };
}
