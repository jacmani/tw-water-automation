import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Claude Haiku is now the ONLY paid model and the LAST-RESORT escalation engine.
// Opus has been removed entirely — it is 5× the cost of Haiku ($5/$25 vs $1/$5 per
// M tokens) and the free cross-validation core (Gemini + Qwen + OpenRouter) makes it
// unnecessary for this use case.
const HAIKU_MODEL = process.env.EXTRACTION_MODEL ?? 'claude-haiku-4-5-20251001';
// Which engine runs first. 'gemini' = free-first cost-inverted pipeline (default).
// 'haiku' = legacy Claude-primary behaviour (instant rollback switch).
const EXTRACTION_PRIMARY = (process.env.EXTRACTION_PRIMARY ?? 'gemini').toLowerCase();
// Raised from 0.70 → 0.80: models report falsely high confidence on misreads
const CONFIDENCE_THRESHOLD = 0.80;

export const EXTRACTION_PROMPT = `You are analyzing a handwritten daily water meter reading sheet for Trinity World residential apartment complex in India.

Extract ALL data from this sheet and return it as a valid JSON object. Read carefully — the handwriting varies by technician.

THE SHEET HAS THESE SECTIONS:

=== SECTION 1: TOWER SECTION (top of sheet) ===
Primary accountability table. Four towers: Venus, Mercury, Neptune, Jupiter.
Each tower has TWO rows: DO (Domestic/Overhead water) and DR (Drinking water).
Columns left to right:
  R Y Day — Meter reading yesterday
  R T Day — Meter reading today
  Total Litres — Calculated consumption
  Volume Yesterday (Ltrs) — Yesterday volume
  Volume Today (Ltrs) — Today volume
  Diff — Difference

=== SECTION 2: SOURCE/LOCATION SECTION ===
Rows (read in this order):
  M+V DO with MTR, J+N DO with JTR, V Well 1+2+3, V Well 4+B1+B2, N Well 5, N Well 6, ON Outside Well, Kingsley
Columns: R Y Day, R Today, Yesterday in Ltrs, Today in Ltrs, Total

CRITICAL — ADJACENT ROW DUPLICATION: Each source row MUST be read independently.
Do NOT copy or assume a value from one row to the next. If two adjacent rows appear
to have identical values, re-examine the original handwriting — this almost certainly
means you misread one of them. This applies especially to:
  • "M+V DO with MTR" vs "J+N DO with JTR" (these are different water sources)
  • "V Well 1+2+3" vs "V Well 4+B1+B2" (these are different well groups)
If the values genuinely match after careful re-reading, set confidence < 0.8 and
add both field names to flagged_fields.

=== SECTION 3: WATER LEVEL SECTION ===
Physical tank levels taken 4 times daily.
Tanks: JDO, JDR, CT, MDO, MDR, Fire Tank
Time slots: 6AM, 12PM, 6PM, 12AM
Format: CM/Percentage — e.g. "80/26" means 80cm, 26%. Blank = not taken yet.

=== SECTION 4: AMENITIES SECTION ===
Car Wash: Jupiter, Mercury, Venus, Neptune
Swimming Pool: Meter 3, Meter 4, Meter 5
Columns: Y Day, R Day, Diff

=== SECTION 5: PARTY HALL SECTION ===
Meters: Meter 6, Meter 7, WTP1, WTP2, VUF, JUF, Venus STP
Columns: Y Day, T Day, Diff

=== SECTION 6: WATER CONSUMPTION SUMMARY (bottom of sheet) ===
This section has 7 labeled rows. You MUST anchor each value to its row label text —
never read positionally. The row labels and their JSON fields are:
  "V Side Well B1+B2"       → v_side
  "N Side Well+B3"          → n_side
  "JTR Tanker"              → jtr_tanker
  "MTR Tanker"              → mtr_tanker
  "IN PUT total"            → input_total   (sum of all input sources)
  "Tower Usage (OUT PUT)"   → tower_usage
  "Diff"                    → diff

CRITICAL: The "IN PUT total" is a TOTAL row. Its value is always larger than any
individual source row above it. Never place the input_total value into v_side,
n_side, jtr_tanker, or mtr_tanker. Read the label text on each row explicitly.

=== INDIAN NUMBER FORMAT ===
Numbers on this sheet are written in Indian/South Asian format with commas:
  1,76,000 = 176,000 (one lakh seventy-six thousand)
  1,98,000 = 198,000 (one lakh ninety-eight thousand)
  2,54,000 = 254,000 etc.
Always output numbers as plain integers without commas: 176000, 198000, 254000.

CRITICAL HANDWRITING DISAMBIGUATION — these digit pairs are frequently confused:
  • 1 vs 7: A handwritten "7" with a short top stroke looks like "1". If a DO total
    reads ~116,000 but the row's r_today and r_yesterday suggest higher consumption,
    re-examine whether the second digit is "7" not "1" → i.e. 176,000.
  • 1 vs 7 in Indian format: "1,16,000" may actually be "1,76,000" = 176,000.
  • 6 vs 0: handwritten "0" with a tail looks like "6".
  • 3 vs 8: an open-top "8" can look like "3".
When in doubt between two readings, prefer the one that falls within the expected
sanity range AND is consistent with meter reading delta (r_today − r_yesterday).

=== SANITY RANGES ===
After extracting each value, verify it falls within the expected range for that field.
If a value is outside the range, set confidence for that field to 0.6 and add
"fieldname: out_of_range (value)" to flagged_fields. Never set the value to null
or 0 just because it is out of range — report what you actually read.

Additionally: for Tower DO rows, verify that total_ltrs ≈ (r_today − r_yesterday)
or ≈ vol_today. If total_ltrs is more than 50% different from what the meter delta
implies, re-read the total_ltrs cell — it is likely a digit misread.

Expected ranges:
  Tower section total_ltrs (DO rows): 50,000 – 250,000 L
  Tower section total_ltrs (DR rows): 5,000 – 40,000 L
  Water source Total column: 20,000 – 400,000 L
  summary.v_side: 30,000 – 200,000 L
  summary.n_side: 30,000 – 350,000 L
  summary.jtr_tanker: 0 – 500,000 L
  summary.mtr_tanker: 0 – 500,000 L
  summary.input_total: 150,000 – 900,000 L
  summary.tower_usage: 300,000 – 800,000 L

=== CONFIDENCE SCORING ===
1.0 = completely clear
0.9 = clear, minor doubt
0.8 = probably correct, some uncertainty
0.7 = could be misread
<0.7 = very uncertain

The date field is critical. Look for it at the top of the sheet — it may be handwritten, stamped, or printed.
Set date_confidence to how certain you are the date is correct (1.0 = absolutely certain, 0.0 = cannot read).
If the date is absent, ambiguous, or illegible, set date to null and date_confidence to 0.0.

Return ONLY a valid JSON object — no markdown, no explanation. Use null for blank/unreadable cells.

{
  "date": "YYYY-MM-DD or null",
  "date_confidence": 0.0,
  "overall_confidence": 0.0,
  "tower_section": {
    "Venus": {
      "DO": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0},
      "DR": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0}
    },
    "Mercury": {
      "DO": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0},
      "DR": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0}
    },
    "Neptune": {
      "DO": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0},
      "DR": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0}
    },
    "Jupiter": {
      "DO": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0},
      "DR": {"r_yesterday": null, "r_today": null, "total_ltrs": null, "vol_yesterday": null, "vol_today": null, "diff": null, "confidence": 0.0}
    }
  },
  "water_sources": [
    {"location": "M+V DO with MTR", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "J+N DO with JTR", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "V Well 1+2+3", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "V Well 4+B1+B2", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "N Well 5", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "N Well 6", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "ON Outside Well", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Kingsley", "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0}
  ],
  "water_levels": [
    {"tank": "JDO", "time_slot": "6AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDO", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDO", "time_slot": "6PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDO", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "6AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "6PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT", "time_slot": "6AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT", "time_slot": "6PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "6AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "6PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "6AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "6PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "Fire Tank", "time_slot": "6AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "Fire Tank", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "Fire Tank", "time_slot": "6PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "Fire Tank", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0}
  ],
  "amenities": [
    {"section": "Car Wash", "meter_name": "Jupiter", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Car Wash", "meter_name": "Mercury", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Car Wash", "meter_name": "Venus", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Car Wash", "meter_name": "Neptune", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Swimming Pool", "meter_name": "Meter 3", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Swimming Pool", "meter_name": "Meter 4", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Swimming Pool", "meter_name": "Meter 5", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "Meter 6", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "Meter 7", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "WTP1", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "WTP2", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "VUF", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "JUF", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall", "meter_name": "Venus STP", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0}
  ],
  "summary": {
    "v_side": null, "n_side": null, "jtr_tanker": null, "mtr_tanker": null,
    "input_total": null, "tower_usage": null, "diff": null, "confidence": 0.0
  },
  "flagged_fields": []
}`;

async function runExtraction(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  model: string,
  ocrTranscript?: string
): Promise<ExtractionResult> {
  // Build messages array — image always first, OCR transcript appended if available.
  // The transcript gives Haiku a structured text reference to resolve digit ambiguities.
  // We use 'as Parameters<...>[0]["messages"][0]["content"]' to satisfy the beta SDK's
  // strict union type without importing internal SDK types.
  const imageBlock = {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: mediaType, data: base64Image },
  };
  const textBlock = ocrTranscript ? {
    type: 'text' as const,
    text: `\n\n--- MISTRAL OCR TRANSCRIPT (purpose-built handwriting OCR, high accuracy) ---\nUse this as a reference to resolve any digit ambiguities you see in the image above.\nIf a number in the image is unclear, prefer the value shown in this transcript.\nHowever, the transcript may have table alignment errors — always verify against the image.\n\n${ocrTranscript}\n--- END TRANSCRIPT ---`,
  } : null;

  const userContent = textBlock ? [imageBlock, textBlock] : [imageBlock];

  const response = await anthropic.beta.promptCaching.messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: userContent as Parameters<typeof anthropic.beta.promptCaching.messages.create>[0]['messages'][0]['content'],
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  // Strip markdown fences if present, then parse
  const text = content.text.trim();
  const jsonStr = text.startsWith('{')
    ? text
    : (text.match(/```(?:json)?\n?([\s\S]*?)\n?```/)?.[1] ?? text);

  const parsed: ExtractionResult = JSON.parse(jsonStr);
  if (!parsed.flagged_fields) parsed.flagged_fields = [];
  return parsed;
}

interface SanityReport {
  violated: boolean;
  /** Fields that can be auto-corrected: tower → corrected total_ltrs */
  corrections: Array<{ tower: string; type: 'DO' | 'DR'; correctedTotal: number; source: string }>;
}

/**
 * Structural sanity check.
 * Returns violated=true if any value is physically impossible or internally inconsistent.
 * Also returns auto-corrections: when total_ltrs disagrees with vol_today by >40%,
 * we can substitute vol_today as the corrected total (it's an independent column read).
 */
function checkSanity(result: ExtractionResult): SanityReport {
  const towers = result.tower_section;
  const corrections: SanityReport['corrections'] = [];
  if (!towers) return { violated: false, corrections };

  let violated = false;

  for (const tower of ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const) {
    const t = towers[tower];
    if (!t) continue;

    // DR total_ltrs > 80,000 L is impossible (range max is 40,000)
    if (t.DR?.total_ltrs != null && t.DR.total_ltrs > 80_000) {
      console.warn(`[sanity] ${tower} DR total_ltrs=${t.DR.total_ltrs} > 80k`);
      violated = true;
    }
    // DO total_ltrs > 300,000 L is impossible (range max is 250,000)
    if (t.DO?.total_ltrs != null && t.DO.total_ltrs > 300_000) {
      console.warn(`[sanity] ${tower} DO total_ltrs=${t.DO.total_ltrs} > 300k`);
      violated = true;
    }

    // DO: total_ltrs vs vol_today cross-check (they should be within 40% of each other)
    const doTotal = t.DO?.total_ltrs;
    const doVolToday = t.DO?.vol_today;
    if (doTotal != null && doVolToday != null && doVolToday > 0) {
      const ratio = doTotal / doVolToday;
      if (ratio < 0.6 || ratio > 1.8) {
        console.warn(`[sanity] ${tower} DO total_ltrs=${doTotal} vs vol_today=${doVolToday} ratio=${ratio.toFixed(2)}`);
        violated = true;
        // vol_today is an independent column — use it as a correction hint
        corrections.push({ tower, type: 'DO', correctedTotal: doVolToday, source: 'vol_today' });
      }
    }
  }

  return { violated, corrections };
}

/**
 * Apply auto-corrections to a result in place.
 * Used when both Haiku AND Opus fail sanity — we substitute the independent vol_today
 * value for total_ltrs, flag it clearly, and lower confidence so the team knows.
 */
function applyCorrections(result: ExtractionResult, corrections: SanityReport['corrections']): ExtractionResult {
  for (const { tower, type, correctedTotal, source } of corrections) {
    const row = result.tower_section?.[tower as 'Venus'|'Mercury'|'Neptune'|'Jupiter']?.[type];
    if (!row) continue;
    console.warn(`[sanity] auto-correcting ${tower} ${type} total_ltrs: ${row.total_ltrs} → ${correctedTotal} (from ${source})`);
    row.total_ltrs = correctedTotal;
    row.confidence = 0.65; // flagged — human should verify
    result.flagged_fields = [
      ...(result.flagged_fields ?? []),
      `${tower}_${type}_total_ltrs: auto-corrected from ${source} (both Haiku and Opus disagreed with ${source})`,
    ];
  }
  result.overall_confidence = Math.min(result.overall_confidence, 0.70);
  return result;
}

import type { QwenVisionResult } from './qwenVision';
import type { MistralOcrResult } from './mistralOcr';
import { extractSheetWithGemini } from './geminiVision';
import { extractTowerTotalsWithOpenRouter, type OpenRouterVisionResult } from './openRouterVision';

/** A generic tower-total reading from any independent engine. */
interface TowerTotalReading {
  tower: 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
  type: 'DO' | 'DR';
  total_ltrs: number | null;
}

const TOLERANCE_RATIO = 0.85; // <0.85 (>15% apart) = genuine disagreement

/**
 * Compare a primary extraction's tower totals against an independent engine's
 * reading of the same 8 totals. Different architectures reading the same handwritten
 * digit → disagreements are genuine misread signals, not model noise.
 * Returns the list of disagreeing field descriptions.
 */
function findDisagreements(
  primary: ExtractionResult,
  readings: TowerTotalReading[],
  primaryLabel: string,
  otherLabel: string
): string[] {
  if (readings.length === 0) return [];
  const disagreements: string[] = [];
  for (const r of readings) {
    if (r.total_ltrs === null) continue;
    const pv = primary.tower_section?.[r.tower]?.[r.type]?.total_ltrs;
    if (pv === null || pv === undefined) continue;
    const ratio = Math.min(pv, r.total_ltrs) / Math.max(pv, r.total_ltrs);
    if (ratio < TOLERANCE_RATIO) {
      disagreements.push(`${r.tower} ${r.type}: ${primaryLabel}=${pv} ${otherLabel}=${r.total_ltrs}`);
      console.warn(`[extraction] ${primaryLabel}/${otherLabel} disagree: ${r.tower} ${r.type} ${primaryLabel}=${pv} ${otherLabel}=${r.total_ltrs} ratio=${ratio.toFixed(2)}`);
    }
  }
  return disagreements;
}

/**
 * Tie-breaker resolution: for each disputed tower row, check whether the OpenRouter
 * free engine agrees with the primary or with Qwen. If 2 of the 3 free engines agree
 * on a value, adopt it into the primary result (free) and avoid paying for Haiku.
 * Returns the count of rows resolved this way and the count still unresolved.
 */
function resolveWithTieBreaker(
  primary: ExtractionResult,
  qwen: QwenVisionResult,
  openRouter: OpenRouterVisionResult
): { resolved: number; unresolved: number } {
  let resolved = 0;
  let unresolved = 0;
  if (!openRouter.success || openRouter.readings.length === 0) {
    return { resolved: 0, unresolved: -1 }; // -1 = tie-breaker unavailable
  }

  for (const orr of openRouter.readings) {
    if (orr.total_ltrs === null) continue;
    const pv = primary.tower_section?.[orr.tower]?.[orr.type]?.total_ltrs;
    const qv = qwen.readings.find(q => q.tower === orr.tower && q.type === orr.type)?.total_ltrs ?? null;
    if (pv === null || pv === undefined || qv === null) continue;

    const pqRatio = Math.min(pv, qv) / Math.max(pv, qv);
    if (pqRatio >= TOLERANCE_RATIO) continue; // primary & qwen already agree on this row

    const agreesPrimary = Math.min(pv, orr.total_ltrs) / Math.max(pv, orr.total_ltrs) >= TOLERANCE_RATIO;
    const agreesQwen = Math.min(qv, orr.total_ltrs) / Math.max(qv, orr.total_ltrs) >= TOLERANCE_RATIO;

    if (agreesPrimary && !agreesQwen) {
      resolved++; // OpenRouter sides with primary → keep primary value
      console.log(`[extraction] tie-breaker: OpenRouter confirms primary for ${orr.tower} ${orr.type}=${pv}`);
    } else if (agreesQwen && !agreesPrimary) {
      // OpenRouter sides with Qwen → adopt Qwen's value into the primary result
      const row = primary.tower_section?.[orr.tower]?.[orr.type];
      if (row) {
        console.warn(`[extraction] tie-breaker: 2/3 free engines (Qwen+OpenRouter) agree → ${orr.tower} ${orr.type} ${pv} → ${qv}`);
        row.total_ltrs = qv;
        row.confidence = Math.min(row.confidence ?? 1, 0.8);
        primary.flagged_fields = [
          ...(primary.flagged_fields ?? []),
          `${orr.tower}_${orr.type}_total_ltrs: tie-broken by free engines (Qwen+OpenRouter agreed on ${qv})`,
        ];
        resolved++;
      }
    } else {
      unresolved++; // no 2-of-3 majority → needs paid escalation
    }
  }
  return { resolved, unresolved };
}

/**
 * Run the primary full-sheet extraction. Cost-inverted by default:
 *   EXTRACTION_PRIMARY=gemini → Gemini 2.5 Flash (FREE). Falls back to Haiku only if
 *                               Gemini is unavailable (no key / API error).
 *   EXTRACTION_PRIMARY=haiku  → Claude Haiku (legacy paid-primary, instant rollback).
 * Returns the result plus the engine label that produced it.
 */
async function runPrimaryExtraction(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  ocrTranscript?: string
): Promise<{ result: ExtractionResult; engine: string }> {
  if (EXTRACTION_PRIMARY === 'gemini') {
    const gemini = await extractSheetWithGemini(base64Image, mediaType, ocrTranscript);
    if (gemini.success && gemini.result) {
      console.log(`[extraction] PRIMARY=Gemini (free), confidence=${gemini.result.overall_confidence}`);
      return { result: gemini.result, engine: 'gemini' };
    }
    // Gemini unavailable → fall back to Haiku as primary so uploads never dead-end.
    console.warn('[extraction] Gemini primary unavailable → falling back to Haiku as primary');
    const haiku = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
    return { result: haiku, engine: 'haiku-primary-fallback' };
  }

  const haiku = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
  console.log(`[extraction] PRIMARY=Haiku, confidence=${haiku.overall_confidence}`);
  return { result: haiku, engine: 'haiku' };
}

/**
 * Main extraction entry point — COST-INVERTED, free-first, NO Opus.
 *
 * Pipeline:
 *   Phase 1 (parallel, called by upload route):
 *     - Qwen3-VL-8B (HF router, FREE)  ← independent tower-totals reader
 *     - Mistral OCR 3                   ← handwriting transcript, injected into primary
 *     - Google Vision / OCR.space       ← date/number corroboration (in validator)
 *
 *   Phase 2 (this function):
 *     1. PRIMARY = Gemini 2.5 Flash (FREE) reads the full sheet (Haiku if forced/unavailable)
 *     2. AGREEMENT GATE — compare primary vs Qwen tower totals + checkSanity + confidence
 *        → all agree, sanity OK, confidence ≥ 0.80  → ACCEPT (zero paid cost)
 *     3. FREE TIE-BREAKER — on disagreement, call OpenRouter (FREE); if 2 of 3 free
 *        engines agree on a disputed row, adopt it (still zero paid cost)
 *     4. PAID ESCALATION — only rows still unresolved → Claude Haiku (NOT Opus)
 *        run checkSanity on Haiku; applyCorrections from vol_today as the final net
 *
 * Key principle: never trust a lone confidence score — the agreement gate is the
 * accept/reject decision. A single model can confidently misread 1↔7.
 */
export async function extractSheetData(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  qwenResult?: QwenVisionResult,
  mistralOcr?: MistralOcrResult
): Promise<ExtractionResult> {
  const ocrTranscript = mistralOcr?.success ? mistralOcr.markdown : undefined;

  // ── Phase 2.1: primary extraction (free Gemini by default) ──────────────────
  const { result, engine } = await runPrimaryExtraction(base64Image, mediaType, ocrTranscript);
  result.flagged_fields = [...(result.flagged_fields ?? []), `primary_engine:${engine}`];

  // ── Phase 2.2: agreement gate — does an independent free engine confirm it? ──
  const qwenReadings = qwenResult?.success ? qwenResult.readings : [];
  const qwenDisagreements = findDisagreements(result, qwenReadings, 'primary', 'qwen');
  const sanity = checkSanity(result);
  const lowConfidence = result.overall_confidence < CONFIDENCE_THRESHOLD;

  const gateClean = qwenDisagreements.length === 0 && !sanity.violated && !lowConfidence;
  if (gateClean) {
    console.log('[extraction] Agreement gate PASSED → accepting free result, no paid call');
    return result;
  }
  console.log(`[extraction] Gate failed (qwenDisagreements=${qwenDisagreements.length}, sanity=${sanity.violated}, lowConf=${lowConfidence})`);

  // ── Phase 2.3: free tie-breaker (OpenRouter) for tower-total disagreements ───
  let stillNeedsPaid = sanity.violated || lowConfidence;
  if (qwenDisagreements.length > 0 && qwenResult) {
    const openRouter = await extractTowerTotalsWithOpenRouter(base64Image, mediaType);
    const { resolved, unresolved } = resolveWithTieBreaker(result, qwenResult, openRouter);
    if (unresolved === -1) {
      console.log('[extraction] Tie-breaker unavailable — disagreements remain → paid escalation');
      stillNeedsPaid = true;
    } else {
      console.log(`[extraction] Tie-breaker resolved ${resolved} row(s), ${unresolved} unresolved`);
      if (unresolved > 0) stillNeedsPaid = true;
      // Re-run sanity after free corrections — may now be clean.
      if (!stillNeedsPaid && !checkSanity(result).violated) {
        result.flagged_fields = [...(result.flagged_fields ?? []), 'resolved_by:free_tie_breaker'];
        console.log('[extraction] Resolved entirely by free engines → no paid call');
        return result;
      }
    }
  }

  if (!stillNeedsPaid) {
    return result;
  }

  // ── Phase 2.4: PAID escalation to Claude Haiku (last resort — NO Opus) ───────
  console.log('[extraction] Escalating to Claude Haiku (paid, last resort)');
  const haikuResult = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
  console.log(`[extraction] Haiku escalation confidence=${haikuResult.overall_confidence}`);

  const reasons: string[] = [];
  if (qwenDisagreements.length > 0) reasons.push(`qwen_disagreement(${qwenDisagreements.join('; ')})`);
  if (sanity.violated) reasons.push('sanity_violation');
  if (lowConfidence) reasons.push('low_confidence');

  // Run sanity on Haiku too — the escalation engine can share the same misread.
  const haikuSanity = checkSanity(haikuResult);
  if (haikuSanity.violated && haikuSanity.corrections.length > 0) {
    console.warn('[extraction] Haiku escalation ALSO failed sanity → auto-correcting from vol_today');
    applyCorrections(haikuResult, haikuSanity.corrections);
    haikuResult.flagged_fields = [
      ...(haikuResult.flagged_fields ?? []),
      `escalation_engine:haiku`,
      `escalation_reason:${reasons.join('|')}`,
      'warning:haiku_also_failed_sanity_auto_corrected_from_vol_today',
    ];
  } else {
    haikuResult.flagged_fields = [
      ...(haikuResult.flagged_fields ?? []),
      `escalation_engine:haiku`,
      `escalation_reason:${reasons.join('|')}`,
    ];
  }
  return haikuResult;
}
