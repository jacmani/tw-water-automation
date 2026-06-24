import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = process.env.EXTRACTION_MODEL ?? 'claude-haiku-4-5-20251001';
const FALLBACK_MODEL = 'claude-opus-4-7';
// Raised from 0.70 → 0.80: Haiku reports falsely high confidence on misreads
const CONFIDENCE_THRESHOLD = 0.80;

const EXTRACTION_PROMPT = `You are analyzing a handwritten daily water meter reading sheet for Trinity World residential apartment complex in India.

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
  model: string
): Promise<ExtractionResult> {
  const response = await anthropic.beta.promptCaching.messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image },
          },
        ],
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

/**
 * Structural sanity check that catches Haiku falsely-high-confidence misreads.
 * Returns true if the result contains values that are physically impossible
 * or internally inconsistent for this sheet type.
 */
function hasSanityViolation(result: ExtractionResult): boolean {
  const towers = result.tower_section;
  if (!towers) return false;
  for (const tower of ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const) {
    const t = towers[tower];
    if (!t) continue;

    // DR total_ltrs > 80,000 L is impossible (sanity range max is 40,000)
    if (t.DR?.total_ltrs != null && t.DR.total_ltrs > 80_000) {
      console.warn(`[extraction] sanity violation: ${tower} DR total_ltrs=${t.DR.total_ltrs} (max 40,000)`);
      return true;
    }
    // DO total_ltrs > 300,000 L is impossible (sanity range max is 250,000)
    if (t.DO?.total_ltrs != null && t.DO.total_ltrs > 300_000) {
      console.warn(`[extraction] sanity violation: ${tower} DO total_ltrs=${t.DO.total_ltrs} (max 250,000)`);
      return true;
    }

    // Cross-check: total_ltrs should roughly match vol_today if both are present.
    // A >60% mismatch between them suggests a digit misread in one.
    const doTotal = t.DO?.total_ltrs;
    const doVolToday = t.DO?.vol_today;
    if (doTotal != null && doVolToday != null && doVolToday > 0) {
      const ratio = doTotal / doVolToday;
      if (ratio < 0.6 || ratio > 1.8) {
        console.warn(`[extraction] sanity violation: ${tower} DO total_ltrs=${doTotal} vs vol_today=${doVolToday} (ratio=${ratio.toFixed(2)})`);
        return true;
      }
    }
  }
  return false;
}

export async function extractSheetData(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<ExtractionResult> {
  const result = await runExtraction(base64Image, mediaType, PRIMARY_MODEL);
  console.log(`[extraction] model=${PRIMARY_MODEL} confidence=${result.overall_confidence}`);

  const needsFallback = result.overall_confidence < CONFIDENCE_THRESHOLD || hasSanityViolation(result);
  if (needsFallback) {
    const reason = result.overall_confidence < CONFIDENCE_THRESHOLD ? 'low confidence' : 'sanity violation';
    console.log(`[extraction] ${reason}, retrying with ${FALLBACK_MODEL}`);
    const fallback = await runExtraction(base64Image, mediaType, FALLBACK_MODEL);
    console.log(`[extraction] model=${FALLBACK_MODEL} confidence=${fallback.overall_confidence}`);
    return fallback;
  }

  return result;
}
