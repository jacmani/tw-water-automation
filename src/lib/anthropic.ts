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
Rows (read in this order — these match the PRINTED labels on the sheet):
  Mercury + Venus Tanker, Jupiter + Neptune Tanker, Venus Side Well 1 2 3, Venus Side Well 4,
  Neptune Side Well 5, Neptune Side Well 6, Open Well
Columns: Yesterday (Meter Reading), Today (Meter Reading), Yesterday (In Ltrs), Today (In Ltrs), Total

CRITICAL — ADJACENT ROW DUPLICATION: Each source row MUST be read independently.
Do NOT copy or assume a value from one row to the next. If two adjacent rows appear
to have identical values, re-examine the original handwriting — this almost certainly
means you misread one of them. This applies especially to:
  • "Mercury + Venus Tanker" vs "Jupiter + Neptune Tanker" (different tanker sources)
  • "Venus Side Well 1 2 3" vs "Venus Side Well 4" (different well groups)
If the values genuinely match after careful re-reading, set confidence < 0.8 and
add both field names to flagged_fields.

=== SECTION 3: WATER LEVEL SECTION ===
Physical tank levels taken 4 times daily. The sheet shows PERCENTAGE (%) only.
Tanks (5 columns): JDO (Jupiter DO), JDR (Jupiter DR), CT (Collection Tank), MDO (Mercury DO), MDR (Mercury DR)
Time slots (4 rows): 6AM (06.00 AM), 12PM (12.00 PM), 6PM (06.00 PM), 12AM (12.00 AM)
If a CM reading is written alongside the percentage, capture it in cm_reading; otherwise leave cm_reading null.
Blank cell = not taken yet → output null.

=== SECTION 4: AMENITIES SECTION ===
CAR WASH (4 columns): Jupiter, Mercury, Venus, Neptune
  Rows: YESTERDAY (meter reading), TODAY (meter reading), CONSUMPTION (diff), CUMULATIVE
  → Output y_day, r_day, diff, cumulative for each.

SWIMMING POOL (3 columns): Meter-1, Meter-2, Meter-3
  Rows: YESTERDAY, TODAY, CONSUMPTION, CUMULATIVE
  → Output y_day, r_day, diff, cumulative for each.

=== SECTION 5: PARTY HALL SECTION ===
Columns (printed labels): P Hall Meter-1, P Hall Meter-2, WTP-1, WTP-2, Venus Side UF, Total Tankers
Rows: YESTERDAY, TODAY, CONSUPTION (consumption/diff)
→ Output y_day, r_day, diff for each. No CUMULATIVE row in this section.

=== SECTION 6: TOTAL INFLOW (bottom table of sheet) ===
The bottom of the sheet is a table titled "TOTAL INFLOW" with these COLUMN headers,
left to right:
  WATER | WELL | TANKER | TOTAL COLLECTION | TOTAL USAGE | BALANCE
There is a main data row and a "CUMULATIVE" row below it. Read the MAIN row (not the
cumulative row). Anchor each value to its COLUMN header — never read positionally.

  "WATER"             → water_inflow      (treated/municipal water inflow)
  "WELL"              → well_inflow       (total from all wells)
  "TANKER"            → tanker_inflow     (total tanker water received)
  "TOTAL COLLECTION"  → input_total       (WATER + WELL + TANKER — the grand total inflow)
  "TOTAL USAGE"       → tower_usage       (total consumed by towers)
  "BALANCE"           → diff              (TOTAL COLLECTION − TOTAL USAGE; may be +/−)

CRITICAL anchoring rules:
- "TOTAL COLLECTION" is a TOTAL — it is the LARGEST of WATER/WELL/TANKER/COLLECTION and
  should ≈ WATER + WELL + TANKER. Never put the collection total into WATER/WELL/TANKER.
- If a cell is blank, output null — do NOT copy a neighbouring column's value into it.
- These columns are NOT the same as the wells/tankers in Section 2. Section 2 lists
  individual meter readings; Section 6 lists the day's rolled-up inflow totals.

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
  • 2 vs 5: a handwritten "2" with a flat closed loop at the base can look like "5",
    especially in cramped 5-digit DR totals. A DR total that looks like it starts
    with "5" should be re-checked against whether it actually starts with "2".
  • 0 vs 1 vs 9: in tightly-spaced digit strings, trailing "0"s and "1"s bleed into
    each other. Re-read each digit of a DR total individually rather than as a
    single glance — DR totals are only 5 digits and errors compound easily.
When in doubt between two readings, prefer the one that falls within the expected
sanity range AND is consistent with meter reading delta (r_today − r_yesterday).

IMPORTANT — do not let a misread digit in one cell contaminate a neighboring cell
in the same row. "total_ltrs" and "vol_today" are two SEPARATE handwritten numbers,
even when both are wrong in the same way they should still be transcribed as what
is actually written in each cell — do not copy one into the other for convenience.

=== SANITY RANGES ===
After extracting each value, verify it falls within the expected range for that field.
If a value is outside the range, set confidence for that field to 0.6 and add
"fieldname: out_of_range (value)" to flagged_fields. Never set the value to null
or 0 just because it is out of range — report what you actually read.

Additionally, as a rough plausibility guide only: on this template, total_ltrs is
usually approximately (r_today − r_yesterday) × 1000 — the meter dial reads in a
smaller unit than the Total Litres column. This is a SANITY CHECK, not a formula to
compute from. "Total Litres" is a number the technician writes directly on the sheet
— always transcribe the actual handwritten digits in that cell, even if they don't
neatly reconcile with r_today/r_yesterday (the technician's own arithmetic is
sometimes off, or a meter is reset/replaced — that is real-world data, not your error
to silently "fix"). NEVER substitute a computed (r_today − r_yesterday) value for
total_ltrs — doing so has caused confirmed extraction errors in production. If the
written total_ltrs digits are genuinely blurry/ambiguous, use the delta×1000 guide to
choose between competing digit readings, and lower confidence + flag the field — do
not invent a number that was never actually written on the sheet.

Expected ranges:
  Tower section total_ltrs (DO rows): 50,000 – 250,000 L
  Tower section total_ltrs (DR rows): 5,000 – 40,000 L
  Water source Total column: 20,000 – 400,000 L
  summary.water_inflow: 0 – 600,000 L
  summary.well_inflow: 0 – 500,000 L
  summary.tanker_inflow: 0 – 500,000 L
  summary.input_total (TOTAL COLLECTION): 150,000 – 900,000 L
  summary.tower_usage (TOTAL USAGE): 300,000 – 800,000 L

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
    {"location": "Mercury + Venus Tanker",  "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Jupiter + Neptune Tanker","r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Venus Side Well 1 2 3",   "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Venus Side Well 4",       "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Neptune Side Well 5",     "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Neptune Side Well 6",     "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0},
    {"location": "Open Well",               "r_yesterday": null, "r_today": null, "yesterday_ltrs": null, "today_ltrs": null, "total": null, "confidence": 0.0}
  ],
  "water_levels": [
    {"tank": "JDO", "time_slot": "6AM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDO", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDO", "time_slot": "6PM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDO", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "6AM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "6PM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "JDR", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT",  "time_slot": "6AM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT",  "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT",  "time_slot": "6PM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "CT",  "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "6AM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "6PM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDO", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "6AM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "12PM", "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "6PM",  "cm_reading": null, "percentage": null, "confidence": 0.0},
    {"tank": "MDR", "time_slot": "12AM", "cm_reading": null, "percentage": null, "confidence": 0.0}
  ],
  "amenities": [
    {"section": "Car Wash",      "meter_name": "Jupiter",        "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Car Wash",      "meter_name": "Mercury",        "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Car Wash",      "meter_name": "Venus",          "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Car Wash",      "meter_name": "Neptune",        "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Swimming Pool", "meter_name": "Meter-1",        "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Swimming Pool", "meter_name": "Meter-2",        "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Swimming Pool", "meter_name": "Meter-3",        "y_day": null, "r_day": null, "diff": null, "cumulative": null, "confidence": 0.0},
    {"section": "Party Hall",    "meter_name": "P Hall Meter-1", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall",    "meter_name": "P Hall Meter-2", "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall",    "meter_name": "WTP-1",          "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall",    "meter_name": "WTP-2",          "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall",    "meter_name": "Venus Side UF",  "y_day": null, "r_day": null, "diff": null, "confidence": 0.0},
    {"section": "Party Hall",    "meter_name": "Total Tankers",  "y_day": null, "r_day": null, "diff": null, "confidence": 0.0}
  ],
  "summary": {
    "water_inflow": null, "well_inflow": null, "tanker_inflow": null,
    "input_total": null, "tower_usage": null, "diff": null, "confidence": 0.0
  },
  "flagged_fields": []
}`;

/** Token usage from a Claude call, used by the cost tracker. */
export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

// Captures the usage of the most recent runExtraction call so callers can cost it
// without threading the raw SDK response everywhere.
let lastClaudeUsage: ClaudeUsage | undefined;
export function getLastClaudeUsage(): ClaudeUsage | undefined {
  return lastClaudeUsage;
}

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

  // Capture token usage for cost reporting (input + output + cache reads).
  lastClaudeUsage = {
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
    cache_read_input_tokens: (response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens,
  };

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

// Physical ceilings — values above these are impossible for this complex.
const DO_CEILING = 300_000; // DO range max is 250,000 L
const DR_CEILING = 80_000;  // DR range max is 40,000 L

// Documented EXPECTED ranges (see CLAUDE.md sanity ranges table). Values beyond the
// hard ceiling above are physically impossible; values beyond the *expected* range
// below are merely suspicious and warrant independent corroboration before trusting.
const DO_EXPECTED_MAX = 250_000;
const DR_EXPECTED_MAX = 40_000;

interface SanityReport {
  violated: boolean;
  /** Fields that can be auto-corrected: tower → corrected total_ltrs.
   *  correctedTotal === null means "could not derive a safe value — null it and flag". */
  corrections: Array<{ tower: string; type: 'DO' | 'DR'; correctedTotal: number | null; source: string }>;
}

/**
 * A reading of one tower/type field from an engine that is architecturally
 * independent of whichever engine produced the primary/escalation result — i.e.
 * Qwen3-VL-8B (DeepStack encoder) or OpenRouter's tie-breaker model. Used to
 * corroborate (or refute) a same-pass correction candidate.
 */
export interface IndependentReading {
  value: number | null;
  source: string; // e.g. 'qwen', 'openrouter'
}

/**
 * Pick the best correction for an impossible/suspicious tower total, in priority order:
 *   1. An INDEPENDENT engine's reading (Qwen / OpenRouter) of the SAME cell, if in-range.
 *      This is the only source architecturally unlikely to share the primary engine's
 *      misread — a different visual encoder reading the same glyph.
 *   2. vol_today — same-pass, same-engine column, tightened to the EXPECTED range
 *      (not just the hard ceiling). Weaker trust than an independent engine.
 *   3. value / 10, if the over-read is a clean 10× place-value slip (Indian comma error),
 *      also tightened to the EXPECTED range.
 *   4. null — give up, force manual review.
 *
 * IMPORTANT — raw meter delta (r_today − r_yesterday) is INTENTIONALLY NOT a candidate
 * here. Incident (2026-07-02, Mercury DR): the sheet's "Total Litres" column is a value
 * the technician writes directly — on this template it usually equals delta × 1000 (the
 * meter dial reads in different units than the totals column), but it is NOT guaranteed
 * to reconcile with the raw meter delta, and either r_yesterday or r_today can themselves
 * be misread on the exact same pass that misread total_ltrs (same handwriting, same
 * engine, same failure). Trusting raw delta silently replaced a correctly-legible
 * printed "21000" with "50021" (= 84133 − 34112) because that number happened to fall
 * inside the DR floor/ceiling bounds — a textbook false-confidence auto-correction.
 * Meter delta is too fragile to auto-apply; use independent engines or vol_today only,
 * else surface for manual review rather than fabricate a confident-looking wrong number.
 */
function deriveCorrection(
  row: { total_ltrs: number | null; vol_today: number | null; r_today: number | null; r_yesterday: number | null },
  ceiling: number,
  floor: number,
  independent?: IndependentReading | null,
  expectedMax?: number
): { value: number | null; source: string } {
  const { total_ltrs, vol_today } = row;
  // A candidate is only acceptable if it's BOTH below the impossible ceiling AND
  // above a plausibility floor. This stops us "correcting" an impossible 1.4M into an
  // equally implausible 133 L — if no candidate is plausible, we null it for manual entry.
  const ok = (v: number) => v >= floor && v <= ceiling;
  // Weaker (same-engine-derived) candidates are held to the tighter documented range,
  // not just the physical ceiling — a value merely "not impossible" isn't good enough
  // when we can't independently verify it.
  const tightMax = expectedMax ?? ceiling;
  const okTight = (v: number) => v >= floor && v <= tightMax;

  // 1. Independent engine (Qwen/OpenRouter) — genuinely different visual encoder.
  if (independent?.value != null && ok(independent.value)) {
    return { value: independent.value, source: `independent_engine(${independent.source})` };
  }
  // 2. vol_today — same-pass column, weaker trust (see doc comment above).
  if (vol_today != null && okTight(vol_today)) return { value: vol_today, source: 'vol_today(same_engine_unverified)' };
  // 3. clean 10× place-value slip (e.g. 1,416,000 → 141,600) — held to the tight range.
  if (total_ltrs != null) {
    const div10 = Math.round(total_ltrs / 10);
    if (okTight(div10)) return { value: div10, source: 'divided_by_10(place_value_slip)' };
  }
  // 4. give up — null it, force manual entry. Deliberately NOT falling back to raw
  // meter delta — see doc comment above for why that's unsafe.
  return { value: null, source: 'unrecoverable_nulled_for_manual_review' };
}

// Plausibility floors — a corrected value below these is too small to be real.
const DO_FLOOR = 20_000; // DO rows are tens of thousands of litres
const DR_FLOOR = 1_000;  // DR rows are at least a few thousand

/**
 * Look up an independent engine's reading for a specific tower/type field.
 * Prefers Qwen (different visual encoder, runs on every upload) then OpenRouter
 * (tie-breaker, only runs on disagreement). If both are present and they disagree
 * with each other, we don't trust either — return null rather than pick one blindly.
 */
function findIndependentReading(
  tower: string,
  type: 'DO' | 'DR',
  qwenResult?: QwenVisionResult,
  openRouterResult?: OpenRouterVisionResult
): IndependentReading | null {
  const qwenVal = qwenResult?.success
    ? qwenResult.readings.find(r => r.tower === tower && r.type === type)?.total_ltrs ?? null
    : null;
  const orVal = openRouterResult?.success
    ? openRouterResult.readings.find(r => r.tower === tower && r.type === type)?.total_ltrs ?? null
    : null;

  if (qwenVal != null && orVal != null) {
    const ratio = Math.min(qwenVal, orVal) / Math.max(qwenVal, orVal);
    if (ratio >= TOLERANCE_RATIO) return { value: qwenVal, source: 'qwen+openrouter agree' };
    // The two independent engines disagree with each other — no safe pick.
    return null;
  }
  if (qwenVal != null) return { value: qwenVal, source: 'qwen' };
  if (orVal != null) return { value: orVal, source: 'openrouter' };
  return null;
}

/**
 * Structural sanity check.
 * Returns violated=true if any value is physically impossible or internally inconsistent.
 * Also returns auto-corrections: when total_ltrs disagrees with vol_today by >40%,
 * we can substitute vol_today as the corrected total (it's an independent column read).
 *
 * `qwenResult`/`openRouterResult`, when supplied, let corrections prefer a genuinely
 * independent visual encoder's reading of the SAME field over same-pass columns like
 * vol_today — closing the gap where a single engine's misread of one row's handwriting
 * silently "self-confirms" via another cell in that same misread row.
 */
function checkSanity(
  result: ExtractionResult,
  qwenResult?: QwenVisionResult,
  openRouterResult?: OpenRouterVisionResult
): SanityReport {
  const towers = result.tower_section;
  const corrections: SanityReport['corrections'] = [];
  if (!towers) return { violated: false, corrections };

  let violated = false;

  for (const tower of ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const) {
    const t = towers[tower];
    if (!t) continue;
    const independentDR = findIndependentReading(tower, 'DR', qwenResult, openRouterResult);
    const independentDO = findIndependentReading(tower, 'DO', qwenResult, openRouterResult);

    // ── Hard ceiling: DR > 80k is impossible. ALWAYS derive a correction. ──
    if (t.DR?.total_ltrs != null && t.DR.total_ltrs > DR_CEILING) {
      const c = deriveCorrection(t.DR, DR_CEILING, DR_FLOOR, independentDR, DR_EXPECTED_MAX);
      console.warn(`[sanity] ${tower} DR total_ltrs=${t.DR.total_ltrs} > ${DR_CEILING} → correct to ${c.value} via ${c.source}`);
      violated = true;
      corrections.push({ tower, type: 'DR', correctedTotal: c.value, source: c.source });
    }

    // ── Soft range: DR > expected max (40k) but under the hard ceiling is merely
    // suspicious — DR rows are documented 5,000–40,000 L. Only auto-correct here if
    // an independent engine actually corroborates a different, in-range value; if not,
    // we flag but do NOT fabricate a "correction" from the same engine's own vol_today
    // (that produced a false sense of resolution in the Mercury DR 50,021 incident).
    const alreadyCorrectedDR = corrections.some(c => c.tower === tower && c.type === 'DR');
    if (!alreadyCorrectedDR && t.DR?.total_ltrs != null && t.DR.total_ltrs > DR_EXPECTED_MAX) {
      violated = true;
      if (independentDR?.value != null && independentDR.value <= DR_EXPECTED_MAX && independentDR.value >= DR_FLOOR) {
        const ratio = Math.min(independentDR.value, t.DR.total_ltrs) / Math.max(independentDR.value, t.DR.total_ltrs);
        if (ratio < TOLERANCE_RATIO) {
          console.warn(`[sanity] ${tower} DR total_ltrs=${t.DR.total_ltrs} outside expected range, independent(${independentDR.source})=${independentDR.value} → correcting`);
          corrections.push({ tower, type: 'DR', correctedTotal: independentDR.value, source: `independent_engine(${independentDR.source})` });
        }
      } else {
        console.warn(`[sanity] ${tower} DR total_ltrs=${t.DR.total_ltrs} outside expected range (max ${DR_EXPECTED_MAX}), no independent corroboration → flagging only, not auto-correcting`);
        result.flagged_fields = [
          ...(result.flagged_fields ?? []),
          `${tower}_DR_total_ltrs: ${t.DR.total_ltrs} exceeds expected DR range (max ${DR_EXPECTED_MAX}) — no independent engine corroboration, needs manual verification`,
        ];
      }
    }

    // ── Hard ceiling: DO > 300k is impossible. ALWAYS derive a correction. ──
    if (t.DO?.total_ltrs != null && t.DO.total_ltrs > DO_CEILING) {
      const c = deriveCorrection(t.DO, DO_CEILING, DO_FLOOR, independentDO, DO_EXPECTED_MAX);
      console.warn(`[sanity] ${tower} DO total_ltrs=${t.DO.total_ltrs} > ${DO_CEILING} → correct to ${c.value} via ${c.source}`);
      violated = true;
      corrections.push({ tower, type: 'DO', correctedTotal: c.value, source: c.source });
    }

    // ── DO cross-check: total_ltrs vs vol_today should be within ~40%. ──
    // Only add a correction here if the ceiling check above didn't already add one.
    const doTotal = t.DO?.total_ltrs;
    const doVolToday = t.DO?.vol_today;
    const alreadyCorrectedDO = corrections.some(c => c.tower === tower && c.type === 'DO');
    if (!alreadyCorrectedDO && doTotal != null && doVolToday != null && doVolToday > 0) {
      const ratio = doTotal / doVolToday;
      if (ratio < 0.6 || ratio > 1.8) {
        console.warn(`[sanity] ${tower} DO total_ltrs=${doTotal} vs vol_today=${doVolToday} ratio=${ratio.toFixed(2)}`);
        violated = true;
        // BUG FIX: do NOT blindly substitute vol_today — it can itself be impossible
        // (e.g. Venus vol_today=1,416,000). Run it through deriveCorrection so the
        // plausibility floor/ceiling is enforced; null it if nothing is plausible.
        const c = deriveCorrection(t.DO!, DO_CEILING, DO_FLOOR, independentDO, DO_EXPECTED_MAX);
        corrections.push({ tower, type: 'DO', correctedTotal: c.value, source: c.source });
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
    row.total_ltrs = correctedTotal; // may be null = unrecoverable, needs manual entry
    // Confidence reflects HOW the correction was derived, not just that one was found:
    //   - independent engine (Qwen/OpenRouter) corroborated it → genuinely more trustworthy
    //   - same-engine fallback (vol_today / meter delta / /10) → still unverified, the
    //     exact failure mode that let Mercury DR 50,021 masquerade as "resolved" at 65%
    //   - unrecoverable (null) → lowest confidence, forces manual entry
    const isIndependent = source.startsWith('independent_engine');
    row.confidence = correctedTotal === null ? 0.4 : (isIndependent ? 0.75 : 0.5);
    result.flagged_fields = [
      ...(result.flagged_fields ?? []),
      `${tower}_${type}_total_ltrs: ${correctedTotal === null ? 'NULLED — unrecoverable, needs manual entry' : `auto-corrected to ${correctedTotal}`} (via ${source})${isIndependent ? '' : ' — UNVERIFIED, same-engine fallback, please check against physical sheet'}`,
    ];
  }
  result.overall_confidence = Math.min(result.overall_confidence, 0.60);
  return result;
}

/**
 * FINAL HARD CLAMP — last line of defense before any result is returned.
 * Guarantees no physically-impossible tower total ever reaches the DB, regardless of
 * which engine produced it or whether earlier escalation/correction logic ran.
 * This is the safety net whose absence let Venus DO=1,416,000 L through.
 */
function enforceHardCeilings(
  result: ExtractionResult,
  qwenResult?: QwenVisionResult,
  openRouterResult?: OpenRouterVisionResult
): ExtractionResult {
  const towers = result.tower_section;
  if (!towers) return result;
  for (const tower of ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const) {
    const t = towers[tower];
    if (!t) continue;
    for (const type of ['DO', 'DR'] as const) {
      const row = t[type];
      const ceiling = type === 'DO' ? DO_CEILING : DR_CEILING;
      const floor = type === 'DO' ? DO_FLOOR : DR_FLOOR;
      const expectedMax = type === 'DO' ? DO_EXPECTED_MAX : DR_EXPECTED_MAX;
      if (row?.total_ltrs != null && row.total_ltrs > ceiling) {
        const independent = findIndependentReading(tower, type, qwenResult, openRouterResult);
        const c = deriveCorrection(row, ceiling, floor, independent, expectedMax);
        console.warn(`[clamp] ${tower} ${type} STILL impossible (${row.total_ltrs}) after pipeline → forcing ${c.value} via ${c.source}`);
        row.total_ltrs = c.value;
        row.confidence = Math.min(row.confidence ?? 1, c.value === null ? 0.4 : 0.5);
        result.flagged_fields = [
          ...(result.flagged_fields ?? []),
          `${tower}_${type}_total_ltrs: FINAL_CLAMP ${c.value === null ? 'NULLED' : `→ ${c.value}`} (via ${c.source})`,
        ];
        result.overall_confidence = Math.min(result.overall_confidence, 0.55);
      }
    }
  }
  return result;
}

import type { QwenVisionResult } from './qwenVision';
import type { MistralOcrResult } from './mistralOcr';
import { extractSheetWithGemini } from './geminiVision';
import { extractTowerTotalsWithOpenRouter, type OpenRouterVisionResult } from './openRouterVision';
import { CostTracker } from './costTracker';

/** Real-time progress callback passed from the SSE stream route into the extraction pipeline. */
export type ExtractionProgressFn = (
  level: 'info' | 'success' | 'warn' | 'error' | 'engine',
  message: string,
  detail?: string
) => void;

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
    if (r.total_ltrs === null || r.total_ltrs === 0) continue;
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
 * Compare water source totals between primary and an independent engine.
 * Uses a more tolerant ratio (0.80 = 25% tolerance) since Qwen3-VL-8B is
 * less reliable on the denser Section 2 than on the tower section.
 */
function findSourceDisagreements(
  primary: ExtractionResult,
  sourceReadings: Array<{ location: string; total: number | null }>,
  primaryLabel: string,
  otherLabel: string
): string[] {
  if (sourceReadings.length === 0) return [];
  const TOLERANCE_SOURCE = 0.80; // 25% tolerance — more lenient for Section 2
  const disagreements: string[] = [];
  for (const r of sourceReadings) {
    if (r.total === null || r.total === 0) continue;
    const pSource = primary.water_sources?.find(s => s.location === r.location);
    if (!pSource?.total) continue;
    const ratio = Math.min(pSource.total, r.total) / Math.max(pSource.total, r.total);
    if (ratio < TOLERANCE_SOURCE) {
      disagreements.push(`source ${r.location}: ${primaryLabel}=${pSource.total} ${otherLabel}=${r.total}`);
      console.warn(`[extraction] ${primaryLabel}/${otherLabel} disagree on source "${r.location}": ${primaryLabel}=${pSource.total} ${otherLabel}=${r.total} ratio=${ratio.toFixed(2)}`);
    }
  }
  return disagreements;
}

/**
 * Compare summary section fields (input_total, tower_usage) between primary
 * and an independent engine. These are critical accountability values — a
 * mismatch here usually means the extractor misread Section 6's TOTAL COLLECTION
 * or TOTAL USAGE columns.
 */
function findSummaryDisagreements(
  primary: ExtractionResult,
  summaryInputTotal: number | null,
  summaryTowerUsage: number | null,
  primaryLabel: string,
  otherLabel: string
): string[] {
  const disagreements: string[] = [];

  const pInputTotal = primary.summary?.input_total;
  if (pInputTotal != null && summaryInputTotal != null && summaryInputTotal > 0) {
    const ratio = Math.min(pInputTotal, summaryInputTotal) / Math.max(pInputTotal, summaryInputTotal);
    if (ratio < TOLERANCE_RATIO) {
      disagreements.push(`summary input_total: ${primaryLabel}=${pInputTotal} ${otherLabel}=${summaryInputTotal}`);
      console.warn(`[extraction] ${primaryLabel}/${otherLabel} disagree on summary.input_total: ${primaryLabel}=${pInputTotal} ${otherLabel}=${summaryInputTotal} ratio=${ratio.toFixed(2)}`);
    }
  }

  const pTowerUsage = primary.summary?.tower_usage;
  if (pTowerUsage != null && summaryTowerUsage != null && summaryTowerUsage > 0) {
    const ratio = Math.min(pTowerUsage, summaryTowerUsage) / Math.max(pTowerUsage, summaryTowerUsage);
    if (ratio < TOLERANCE_RATIO) {
      disagreements.push(`summary tower_usage: ${primaryLabel}=${pTowerUsage} ${otherLabel}=${summaryTowerUsage}`);
      console.warn(`[extraction] ${primaryLabel}/${otherLabel} disagree on summary.tower_usage: ${primaryLabel}=${pTowerUsage} ${otherLabel}=${summaryTowerUsage} ratio=${ratio.toFixed(2)}`);
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
  ocrTranscript?: string,
  cost?: CostTracker,
  progress?: ExtractionProgressFn
): Promise<{ result: ExtractionResult; engine: string }> {
  if (EXTRACTION_PRIMARY === 'gemini') {
    progress?.('info', 'Gemini 2.5 Flash reading full sheet…', 'free · multimodal OCR + structured extraction');
    const t0 = Date.now();
    const gemini = await extractSheetWithGemini(base64Image, mediaType, ocrTranscript);
    const ms = Date.now() - t0;
    if (gemini.success && gemini.result) {
      console.log(`[extraction] PRIMARY=Gemini (free), confidence=${gemini.result.overall_confidence}`);
      cost?.addFree('Gemini 2.5 Flash (primary)', 'free tier');
      progress?.('success', `Gemini 2.5 Flash ✓ (${ms}ms)`, `confidence ${(gemini.result.overall_confidence * 100).toFixed(0)}% · free`);
      return { result: gemini.result, engine: 'gemini' };
    }
    // Gemini unavailable → fall back to Haiku as primary so uploads never dead-end.
    console.warn('[extraction] Gemini primary unavailable → falling back to Haiku as primary');
    progress?.('warn', 'Gemini unavailable — falling back to Claude Haiku', 'paid · last resort');
    const haiku = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
    cost?.addClaude('Claude Haiku (primary fallback)', getLastClaudeUsage());
    progress?.('warn', 'Claude Haiku ✓ (primary fallback)', `confidence ${(haiku.overall_confidence * 100).toFixed(0)}%`);
    return { result: haiku, engine: 'haiku-primary-fallback' };
  }

  progress?.('info', 'Claude Haiku reading full sheet…', 'paid · primary mode');
  const t0 = Date.now();
  const haiku = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
  const ms = Date.now() - t0;
  console.log(`[extraction] PRIMARY=Haiku, confidence=${haiku.overall_confidence}`);
  cost?.addClaude('Claude Haiku (primary)', getLastClaudeUsage());
  progress?.('success', `Claude Haiku ✓ (${ms}ms)`, `confidence ${(haiku.overall_confidence * 100).toFixed(0)}%`);
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
 *
 * Public wrapper: ALWAYS applies enforceHardCeilings to the result, so no
 * physically-impossible value can reach the DB via any internal return path.
 */
export async function extractSheetData(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  qwenResult?: QwenVisionResult,
  mistralOcr?: MistralOcrResult,
  cost?: CostTracker,
  progress?: ExtractionProgressFn
): Promise<ExtractionResult> {
  const result = await extractSheetDataInner(base64Image, mediaType, qwenResult, mistralOcr, cost, progress);
  return enforceHardCeilings(result, qwenResult, lastOpenRouterResult);
}

// Captures the OpenRouter tie-breaker result (if it ran) so the public wrapper's
// final enforceHardCeilings pass can also benefit from it, same pattern as
// lastClaudeUsage above.
let lastOpenRouterResult: OpenRouterVisionResult | undefined;

async function extractSheetDataInner(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  qwenResult?: QwenVisionResult,
  mistralOcr?: MistralOcrResult,
  cost?: CostTracker,
  progress?: ExtractionProgressFn
): Promise<ExtractionResult> {
  lastOpenRouterResult = undefined;
  const ocrTranscript = mistralOcr?.success ? mistralOcr.markdown : undefined;

  // Record the free engines that already ran in Phase 1 (parallel, by the route).
  if (qwenResult?.success) cost?.addFree('Qwen3-VL-8B (validator)', 'free tier');
  if (mistralOcr?.success) cost?.addFree('Mistral OCR 3 (transcript)', 'free/near-free');

  // ── Phase 2.1: primary extraction (free Gemini by default) ──────────────────
  const { result, engine } = await runPrimaryExtraction(base64Image, mediaType, ocrTranscript, cost, progress);
  result.flagged_fields = [...(result.flagged_fields ?? []), `primary_engine:${engine}`];

  // ── Phase 2.2: agreement gate — does an independent free engine confirm it? ──
  const qwenReadings = qwenResult?.success ? qwenResult.readings : [];
  const qwenSourceReadings = qwenResult?.success ? (qwenResult.sourceReadings ?? []) : [];
  const qwenSummaryInputTotal = qwenResult?.success ? (qwenResult.summaryInputTotal ?? null) : null;
  const qwenSummaryTowerUsage = qwenResult?.success ? (qwenResult.summaryTowerUsage ?? null) : null;

  // Check for disagreements across all three sections Qwen now reads.
  progress?.('info', 'Agreement gate — cross-checking with Qwen3-VL…', 'comparing tower totals, sources, summary');
  const qwenTowerDisagreements = findDisagreements(result, qwenReadings, 'primary', 'qwen');
  const qwenSourceDisagreements = findSourceDisagreements(result, qwenSourceReadings, 'primary', 'qwen');
  const qwenSummaryDisagreements = findSummaryDisagreements(result, qwenSummaryInputTotal, qwenSummaryTowerUsage, 'primary', 'qwen');
  const qwenDisagreements = [...qwenTowerDisagreements, ...qwenSourceDisagreements, ...qwenSummaryDisagreements];

  const sanity = checkSanity(result, qwenResult);
  const lowConfidence = result.overall_confidence < CONFIDENCE_THRESHOLD;

  const gateClean = qwenDisagreements.length === 0 && !sanity.violated && !lowConfidence;
  if (gateClean) {
    console.log('[extraction] Agreement gate PASSED → accepting free result, no paid call');
    progress?.('success', 'Agreement gate PASSED — Qwen agrees, sanity OK', 'accepting free result · no paid call');
    return result;
  }

  const gateFailReasons: string[] = [];
  if (qwenTowerDisagreements.length > 0) gateFailReasons.push(`${qwenTowerDisagreements.length} tower disagreement(s)`);
  if (qwenSourceDisagreements.length > 0) gateFailReasons.push(`${qwenSourceDisagreements.length} source disagreement(s)`);
  if (qwenSummaryDisagreements.length > 0) gateFailReasons.push(`${qwenSummaryDisagreements.length} summary disagreement(s)`);
  if (sanity.violated) gateFailReasons.push('sanity violation');
  if (lowConfidence) gateFailReasons.push(`low confidence (${(result.overall_confidence*100).toFixed(0)}%)`);
  console.log(`[extraction] Gate failed (tower=${qwenTowerDisagreements.length} src=${qwenSourceDisagreements.length} summary=${qwenSummaryDisagreements.length} sanity=${sanity.violated} lowConf=${lowConfidence})`);
  progress?.('warn', `Agreement gate FAILED — ${gateFailReasons.join(', ')}`, 'trying free tie-breaker next');

  // ── Phase 2.3: free tie-breaker (OpenRouter) for TOWER disagreements only ───
  // Source and summary disagreements cannot be resolved by the free tie-breaker
  // (which only reads tower totals) — route them straight to paid escalation.
  let stillNeedsPaid = sanity.violated || lowConfidence;
  if (qwenSourceDisagreements.length > 0 || qwenSummaryDisagreements.length > 0) {
    stillNeedsPaid = true;
  }

  if (qwenTowerDisagreements.length > 0 && qwenResult) {
    progress?.('info', 'Free tie-breaker — calling OpenRouter (Qwen2.5-VL-32B)…', 'free · 3rd independent engine');
    const t0 = Date.now();
    const openRouter = await extractTowerTotalsWithOpenRouter(base64Image, mediaType);
    lastOpenRouterResult = openRouter;
    const ms = Date.now() - t0;
    if (openRouter.success) {
      cost?.addFree('OpenRouter (tie-breaker)', 'free tier');
      progress?.('engine', `OpenRouter ✓ (${ms}ms)`, 'Qwen2.5-VL-32B — resolving tower disputes');
    } else {
      progress?.('warn', 'OpenRouter tie-breaker unavailable', 'routing to paid escalation');
    }
    const { resolved, unresolved } = resolveWithTieBreaker(result, qwenResult, openRouter);
    if (unresolved === -1) {
      console.log('[extraction] Tie-breaker unavailable — tower disagreements remain → paid escalation');
      stillNeedsPaid = true;
    } else {
      console.log(`[extraction] Tie-breaker resolved ${resolved} tower row(s), ${unresolved} unresolved`);
      if (unresolved > 0) {
        progress?.('warn', `Tie-breaker resolved ${resolved}, but ${unresolved} row(s) still disputed`, 'escalating to Claude Haiku');
        stillNeedsPaid = true;
      } else {
        progress?.('success', `Tie-breaker resolved all ${resolved} disputed row(s)`, 'no paid call needed');
      }
      // Re-run sanity after free corrections — may now be clean.
      if (!stillNeedsPaid && !checkSanity(result, qwenResult, openRouter).violated) {
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
  progress?.('warn', 'Escalating to Claude Haiku (paid, last resort)…', '1 paid call — ~₹0.25');
  const t0 = Date.now();
  const haikuResult = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
  const haikuMs = Date.now() - t0;
  cost?.addClaude('Claude Haiku (escalation)', getLastClaudeUsage());
  console.log(`[extraction] Haiku escalation confidence=${haikuResult.overall_confidence}`);

  const reasons: string[] = [];
  if (qwenDisagreements.length > 0) reasons.push(`qwen_disagreement(${qwenDisagreements.join('; ')})`);
  if (sanity.violated) reasons.push('sanity_violation');
  if (lowConfidence) reasons.push('low_confidence');

  // Run sanity on Haiku too — the escalation engine can share the same misread.
  // Passing qwenResult/lastOpenRouterResult here is the crux of the fix: if Haiku
  // ALSO breaches sanity on the same row, prefer Qwen's (different visual encoder)
  // reading over Haiku's own vol_today — the same row's handwriting can fool both
  // Gemini and Haiku identically, but is much less likely to fool Qwen the same way.
  const haikuSanity = checkSanity(haikuResult, qwenResult, lastOpenRouterResult);
  if (haikuSanity.violated && haikuSanity.corrections.length > 0) {
    console.warn('[extraction] Haiku escalation ALSO failed sanity → auto-correcting (independent engine preferred over vol_today)');
    applyCorrections(haikuResult, haikuSanity.corrections);
    progress?.('warn', `Claude Haiku ✓ (${haikuMs}ms) — sanity violation auto-corrected`, `${haikuSanity.corrections.length} value(s) replaced`);
    haikuResult.flagged_fields = [
      ...(haikuResult.flagged_fields ?? []),
      `escalation_engine:haiku`,
      `escalation_reason:${reasons.join('|')}`,
      'warning:haiku_also_failed_sanity_auto_corrected_from_vol_today',
    ];
  } else {
    progress?.('success', `Claude Haiku ✓ (${haikuMs}ms)`, `confidence ${(haikuResult.overall_confidence*100).toFixed(0)}%`);
    haikuResult.flagged_fields = [
      ...(haikuResult.flagged_fields ?? []),
      `escalation_engine:haiku`,
      `escalation_reason:${reasons.join('|')}`,
    ];
  }
  return haikuResult;
}
