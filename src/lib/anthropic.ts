import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult } from '@/types';
import { parseLenientJson } from './jsonRepair';

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

Below all 8 rows (Venus/Mercury/Neptune/Jupiter × DO/DR) there is a printed "TOTAL" row
that sums the Volume Yesterday / Volume Today / Diff columns across all 8 rows for the
whole complex — this is a SEPARATE grand-total row, not one more tower row. Read it into
tower_section_total: {yesterday, today, diff}. This is the single most reliable
cross-check available for this section — the technician has already added up all 8 rows
themselves, so SUM(all 8 total_ltrs values) should reconcile with tower_section_total.today.
If your own sum of the 8 total_ltrs values doesn't land close to the printed TOTAL row,
one of your 8 individual readings is almost certainly wrong — re-examine each one
(this is exactly how a single misread "Total Litres" cell, e.g. "1,23,000" misread as
"1,83,000" via the 2-vs-8 confusion above, was caught in production: the printed TOTAL
row said 650,000 but the 8 individual cells summed to 710,000).

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
Physical tank levels taken 4 times daily. Each cell shows TWO numbers written as "CM/Percentage"
(e.g. "80/26" means the tank has 80cm of water and is 26% full; "230/70" means 230cm and 70% full).
The FIRST number (before the slash, always the LARGER one) is the CM depth reading → cm_reading.
The SECOND number (after the slash, always the SMALLER one, 0-100) is the fill percentage → percentage.
Do NOT reverse these — percentage can never exceed 100. If you read a cell as two numbers and the
"percentage" value would be over 100, you have them backwards: swap so the larger number is cm_reading
and the smaller (≤100) number is percentage.
Tanks (5 columns): JDO (Jupiter DO), JDR (Jupiter DR), CT (Collection Tank), MDO (Mercury DO), MDR (Mercury DR)
Time slots (4 rows): 6AM (06.00 AM), 12PM (12.00 PM), 6PM (06.00 PM), 12AM (12.00 AM)
Blank cell = not taken yet → output null for both cm_reading and percentage.

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
  • 2 vs 8: a cursive "2" whose loop closes fully can look like "8". A DR total
    that looks like it starts with "8" (e.g. "81000") should be re-checked against
    whether the loop actually closes into a "2" (e.g. "21000") — this is a confirmed
    real confusion pair on this template's Total Litres column, not just theoretical.
  • 0 vs 1 vs 9: in tightly-spaced digit strings, trailing "0"s and "1"s bleed into
    each other. Re-read each digit of a DR total individually rather than as a
    single glance — DR totals are only 5 digits and errors compound easily.
  • 3 vs 9: a handwritten "3" whose top curve doesn't fully open can look like a "9",
    and a "9" whose descender is short/straight can look like a "3". This is
    especially high-risk on the LEADING digit of a lakhs-format number in Section 6
    (TOTAL INFLOW) — misreading just that one digit swings the value by 600,000 L
    (e.g. "3,62,000" misread as "9,62,000"). Always double-check the leading digit
    of water_inflow/well_inflow/tanker_inflow/input_total/tower_usage against the
    row's own arithmetic: TOTAL COLLECTION − TOTAL USAGE should equal the printed
    BALANCE. If your reading doesn't reconcile with the sheet's own BALANCE figure,
    re-examine the leading digit before finalizing.
  • DR totals in this complex are almost always in the 5,000–40,000 range. If your
    first read of a DR total starts with 5, 8, or 9, treat that as a strong signal
    to re-examine whether the true leading digit is smaller (1, 2, or 3) before
    settling on your answer.
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
  "tower_section_total": {"yesterday": null, "today": null, "diff": null},
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

/**
 * This is the actual Claude Haiku call — used both as the primary-fallback
 * (when GEMINI_API_KEY is unset) and as the paid escalation engine inside
 * extractSheetDataInner() below. Also exported directly for
 * scripts/re-extract.ts, which needs to split the primary + escalation calls
 * across separate process invocations in time-boxed environments (each raw
 * Claude vision call takes ~20s; some sandboxes hard-cap a single command at
 * ~45s, too tight for primary+escalation chained in one run).
 */
export async function runExtraction(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  model: string,
  ocrTranscript?: string
): Promise<{ result: ExtractionResult; usage: ClaudeUsage | undefined }> {
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
    // Was 4096 — raised after a 2026-07-05 production incident: a sheet with
    // many flagged_fields (each a full sentence, e.g. "summary.input_total:
    // 291000 disagrees with WATER+WELL+TANKER=237200 on the same row — needs
    // manual verification") pushed Haiku's response past 4096 tokens, cutting
    // it off before the closing ``` fence. The single-regex fence-strip below
    // then fell through to the raw truncated text and crashed JSON.parse,
    // surfacing a raw SyntaxError to the technician mid-upload. 8192 gives
    // real headroom for the verbose flagged_fields text without materially
    // changing cost (Haiku output tokens are billed per-token, not per-cap).
    max_tokens: 8192,
    system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: userContent as Parameters<typeof anthropic.beta.promptCaching.messages.create>[0]['messages'][0]['content'],
      },
    ],
  });

  const usage: ClaudeUsage | undefined = {
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
    cache_read_input_tokens: (response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens,
  };

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  // Tolerant parse — same repair logic used for Gemini (see jsonRepair.ts):
  // strips markdown fences, drops trailing commas, and closes dangling
  // brackets/strings if the response was truncated (raised max_tokens above
  // should make truncation rare now, but this is the defense-in-depth layer
  // so a cut-off response degrades to a parse failure we handle below, never
  // a raw SyntaxError shown to the technician).
  const parsed = parseLenientJson(content.text) as ExtractionResult | null;
  if (!parsed || typeof parsed !== 'object') {
    console.error(`[anthropic] Could not parse Haiku JSON even after repair. First 300 chars: ${content.text.trim().slice(0, 300)}`);
    throw new Error('Claude Haiku returned a response that could not be read — please retry the upload.');
  }
  if (!parsed.flagged_fields) parsed.flagged_fields = [];
  return { result: parsed, usage };
}

// Physical ceilings — values above these are impossible for this complex.
const DO_CEILING = 300_000; // DO range max is 250,000 L
const DR_CEILING = 80_000;  // DR range max is 40,000 L

// Documented EXPECTED ranges (see CLAUDE.md sanity ranges table). Values beyond the
// hard ceiling above are physically impossible; values beyond the *expected* range
// below are merely suspicious and warrant independent corroboration before trusting.
const DO_EXPECTED_MAX = 250_000;
const DR_EXPECTED_MAX = 40_000;

// Summary section (Section 6: TOTAL INFLOW) sanity ranges — same numbers already
// given to the model in the extraction prompt above, now ALSO enforced in code.
// Incident (2026-07-02 sheet): Gemini read input_total=43,300 — a 10x/digit-drop
// misread (water_sources today_ltrs summed to ~433,000, and the sheet's own printed
// Diff only reconciles against ~433,000). It reached the DB at confidence 1.0
// because nothing checked the summary section at all: Qwen doesn't reliably read it,
// the free tie-breaker only re-reads tower totals, and checkSanity() only validated
// tower_section. This is the gap that let it through.
const INPUT_TOTAL_MIN = 150_000;
const INPUT_TOTAL_MAX = 900_000;
const TOWER_USAGE_MIN = 300_000;
const TOWER_USAGE_MAX = 800_000;

// Section 2 (water_sources) — same gap, one tier down: the documented "Total column:
// 20,000-400,000 L" range was only ever prompt text, never enforced. Flag-only (no
// auto-correction source exists for this field either).
const SOURCE_TOTAL_MIN = 20_000;
const SOURCE_TOTAL_MAX = 400_000;

// Substrings that mark a flagged_fields entry as coming from a checkSanity /
// enforceHardCeilings violation, as opposed to an extractionValidator.ts note
// (e.g. "unverified_number:", "date_mismatch:") which uses different wording.
const SANITY_FLAG_MARKERS = [
  'outside expected range',
  'disagrees with',
  'inconsistent with',
  'FINAL_CLAMP',
  'NULLED',
  'auto-corrected',
  'sanity_violation',
  'manual verification',
  'manual review',
  'manual_review',
];

/**
 * Incident (2026-07-05 sheet): summary.input_total was misread 362,000 → 962,000
 * (leading lakhs digit "3" read as "9" — a confusion pair not previously called out
 * in the disambiguation guidance). checkSanity() correctly flagged it (962,000 >
 * the 900,000 documented ceiling) and the escalation path is designed to cap
 * overall_confidence low when a summary-section violation can't be auto-corrected —
 * but both upload routes call validateExtraction() AFTERWARDS and unconditionally
 * ADD its OCR-corroboration confidenceBoost on top, with no ceiling tied to the
 * violation. Generic word-level OCR (Google Vision / OCR.space) reads the SAME
 * ambiguous handwriting and often "corroborates" the very same wrong digit string,
 * so the boost pushed confidence from a sanity-capped ~0.55 back up past 0.80 —
 * silently erasing the exact warning checkSanity exists to raise. This sheet
 * reached the dashboard at 90% confidence carrying a 600,000 L error.
 *
 * Fix: once ANY sanity-violation flag is present on the result, corroboration may
 * still nudge confidence around but can never cross this ceiling — a violated
 * internal-consistency check must always outrank "OCR agrees with itself," since
 * the OCR sources are reading the same misleading pixels, not an independent truth.
 */
export const SANITY_CONFIDENCE_CEILING = 0.6;

/** Used by both upload routes — see SANITY_CONFIDENCE_CEILING doc comment above. */
export function hasSanityViolationFlag(flags: string[] | undefined): boolean {
  if (!flags || flags.length === 0) return false;
  return flags.some(f => SANITY_FLAG_MARKERS.some(marker => f.includes(marker)));
}

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
 * Pick the best correction for an impossible/suspicious tower total.
 *
 * ONLY an INDEPENDENT engine's reading (Qwen / OpenRouter) of the SAME cell is ever
 * auto-applied. Everything else nulls the field and forces manual review.
 *
 * This used to also try same-pass fallbacks (vol_today, raw meter delta, ÷10 place-value
 * slip) in priority order. Two consecutive production incidents on the same field
 * (Mercury DR, 2026-07-02) proved every one of those same-pass guesses can silently
 * land on a confident-looking wrong number:
 *   - Raw meter delta (r_today − r_yesterday) replaced a correctly-legible printed
 *     "21000" with "50021" — the delta formula doesn't match this template (which
 *     needs ×1000), and r_yesterday/r_today come from the SAME OCR pass that already
 *     misread the row, so the "cross-check" wasn't independent at all.
 *   - After removing that, the very next upload's total_ltrs was misread as ~81,000
 *     (hard-ceiling breach), and the ÷10 "place-value slip" fallback produced "8,100"
 *     — a number with no relationship to the true 21,000, because the actual error was
 *     a digit misread, not a comma/place-value slip.
 * Both were same-engine derivations dressed up as corrections. A genuinely different
 * visual encoder (Qwen/OpenRouter) reading the SAME handwritten glyph is the only
 * signal that isn't liable to share the primary engine's exact mistake. When that
 * isn't available, the correct behavior is to say "I don't know — check the sheet",
 * not to fabricate a plausible-looking number. Fail-safe (null + flag), not
 * fail-dangerous (confident wrong digits reaching the committee dashboard).
 */
function deriveCorrection(
  row: { total_ltrs: number | null; vol_today: number | null; r_today: number | null; r_yesterday: number | null },
  ceiling: number,
  floor: number,
  independent?: IndependentReading | null,
  expectedMax?: number
): { value: number | null; source: string } {
  // A candidate is only acceptable if it's BOTH below the impossible ceiling AND
  // above a plausibility floor. This stops us "correcting" an impossible 1.4M into an
  // equally implausible 133 L — if no candidate is plausible, we null it for manual entry.
  // Independent readings are additionally held to the documented EXPECTED range when
  // provided, not just the physical ceiling — "not impossible" isn't good enough on
  // its own; it should also look like a real reading for this field.
  const tightMax = expectedMax ?? ceiling;
  const ok = (v: number) => v >= floor && v <= tightMax;

  if (independent?.value != null && ok(independent.value)) {
    return { value: independent.value, source: `independent_engine(${independent.source})` };
  }
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
/** Exported for scripts/re-extract.ts — see runExtraction doc comment above. */
export function checkSanity(
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

  // ── Tower-section aggregate cross-check ─────────────────────────────────────
  // Documented invariant (CLAUDE.md): "Tower Usage [Section 6] should approximately
  // match total from Tower Section. A large Diff flags an anomaly" — this was
  // documented but never actually implemented in code. Incident (2026-07-06 sheet):
  // Venus DO and Mercury DO were each misread by ~60-66k L (the classic "1,23,000"
  // vs "1,83,000" 2-vs-8 digit confusion already called out above), inflating the
  // 8-row sum to 710,000 while the sheet's own printed Section 1 TOTAL row said
  // 650,000 — nothing compared the sum against any reference, so the error reached
  // the dashboard's "Community Total" undetected at high confidence. No
  // auto-correction here (same reasoning as Section 6: we don't know WHICH of the
  // 8 cells is wrong from this check alone) — flag + force manual review.
  const towerLtrsSum = (['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const).reduce((sum, tw) => {
    const t = towers[tw];
    return sum + (t?.DO?.total_ltrs ?? 0) + (t?.DR?.total_ltrs ?? 0);
  }, 0);

  if (towerLtrsSum > 0) {
    // Cross-check against the sheet's own printed Section 1 TOTAL row, if captured.
    const sectionTotal = result.tower_section_total?.today;
    if (sectionTotal != null && sectionTotal > 0) {
      const ratio = Math.min(towerLtrsSum, sectionTotal) / Math.max(towerLtrsSum, sectionTotal);
      if (ratio < 0.92) {
        console.warn(`[sanity] SUM(tower total_ltrs)=${towerLtrsSum} vs printed Section 1 TOTAL row=${sectionTotal} ratio=${ratio.toFixed(2)}`);
        violated = true;
        result.flagged_fields = [
          ...(result.flagged_fields ?? []),
          `tower_section: SUM(all 8 total_ltrs)=${towerLtrsSum} disagrees with the sheet's own printed TOTAL row=${sectionTotal} — one of the 8 individual readings is likely misread, needs manual verification`,
        ];
      }
    }

    // Cross-check against summary.tower_usage (Section 6's own "TOTAL USAGE" figure) —
    // documented in CLAUDE.md as an invariant, now actually enforced.
    const usageTotal = result.summary?.tower_usage;
    if (usageTotal != null && usageTotal > 0) {
      const ratio = Math.min(towerLtrsSum, usageTotal) / Math.max(towerLtrsSum, usageTotal);
      if (ratio < 0.85) {
        console.warn(`[sanity] SUM(tower total_ltrs)=${towerLtrsSum} vs summary.tower_usage=${usageTotal} ratio=${ratio.toFixed(2)}`);
        violated = true;
        result.flagged_fields = [
          ...(result.flagged_fields ?? []),
          `tower_section: SUM(all 8 total_ltrs)=${towerLtrsSum} disagrees with summary.tower_usage=${usageTotal} — needs manual verification`,
        ];
      }
    }
  }

  // ── Summary section (Section 6: TOTAL INFLOW) ──────────────────────────────
  // No tower-style auto-correction here: unlike tower rows, there is no reliable
  // independent same-pass column (vol_today) or guaranteed second engine reading
  // for these fields, so we only flag + lower confidence and force manual review —
  // never fabricate a "corrected" input_total/tower_usage.
  const summary = result.summary;
  if (summary) {
    if (summary.input_total != null &&
        (summary.input_total < INPUT_TOTAL_MIN || summary.input_total > INPUT_TOTAL_MAX)) {
      console.warn(`[sanity] summary.input_total=${summary.input_total} outside expected range [${INPUT_TOTAL_MIN}, ${INPUT_TOTAL_MAX}]`);
      violated = true;
      result.flagged_fields = [
        ...(result.flagged_fields ?? []),
        `summary.input_total: ${summary.input_total} outside expected range [${INPUT_TOTAL_MIN}, ${INPUT_TOTAL_MAX}] — likely digit-drop/misread, needs manual verification`,
      ];
    }

    if (summary.tower_usage != null &&
        (summary.tower_usage < TOWER_USAGE_MIN || summary.tower_usage > TOWER_USAGE_MAX)) {
      console.warn(`[sanity] summary.tower_usage=${summary.tower_usage} outside expected range [${TOWER_USAGE_MIN}, ${TOWER_USAGE_MAX}]`);
      violated = true;
      result.flagged_fields = [
        ...(result.flagged_fields ?? []),
        `summary.tower_usage: ${summary.tower_usage} outside expected range [${TOWER_USAGE_MIN}, ${TOWER_USAGE_MAX}] — likely digit-drop/misread, needs manual verification`,
      ];
    }

    // Same-row identity check: TOTAL COLLECTION should ≈ WATER + WELL + TANKER
    // (all four cells sit on the same printed row — an internal consistency check
    // that doesn't depend on any other section or engine).
    const { water_inflow, well_inflow, tanker_inflow, input_total } = summary;
    if (water_inflow != null && well_inflow != null && tanker_inflow != null && input_total != null) {
      const computedInput = water_inflow + well_inflow + tanker_inflow;
      if (computedInput > 0) {
        const ratio = Math.min(computedInput, input_total) / Math.max(computedInput, input_total);
        if (ratio < 0.85) {
          console.warn(`[sanity] summary.input_total=${input_total} vs water+well+tanker=${computedInput} ratio=${ratio.toFixed(2)}`);
          violated = true;
          result.flagged_fields = [
            ...(result.flagged_fields ?? []),
            `summary.input_total: ${input_total} disagrees with WATER+WELL+TANKER=${computedInput} on the same row — needs manual verification`,
          ];
        }
      }
    }

    // Cross-section check: TOTAL COLLECTION should roughly track the sum of
    // Section 2's individual source rows for the day (today_ltrs). This is a
    // softer signal (Section 6 subtotals aren't defined as a pure sum of Section 2
    // rows) so it only flags — it does not by itself force violated=true unless
    // combined with the absolute-range check above being silent (input_total
    // in-range but still wildly inconsistent with Section 2).
    const wsSum = (result.water_sources ?? []).reduce((s, r) => s + (r.today_ltrs ?? 0), 0);
    if (wsSum > 50_000 && input_total != null) {
      const ratio = Math.min(wsSum, input_total) / Math.max(wsSum, input_total);
      if (ratio < 0.5) {
        console.warn(`[sanity] summary.input_total=${input_total} vs water_sources today_ltrs sum=${wsSum} ratio=${ratio.toFixed(2)}`);
        violated = true;
        result.flagged_fields = [
          ...(result.flagged_fields ?? []),
          `summary.input_total: ${input_total} inconsistent with Section 2 today_ltrs sum=${wsSum} — needs manual verification`,
        ];
      }
    }
  }

  // ── Section 2 (water_sources) row-level range check ─────────────────────────
  // Same "documented in the prompt, never enforced in code" gap, one tier down.
  // Flag-only — no independent reading of an individual source row exists to
  // auto-correct from.
  for (const row of result.water_sources ?? []) {
    if (row.total != null && row.total > 0 &&
        (row.total < SOURCE_TOTAL_MIN || row.total > SOURCE_TOTAL_MAX)) {
      console.warn(`[sanity] water_sources["${row.location}"].total=${row.total} outside expected range [${SOURCE_TOTAL_MIN}, ${SOURCE_TOTAL_MAX}]`);
      violated = true;
      result.flagged_fields = [
        ...(result.flagged_fields ?? []),
        `water_sources["${row.location}"].total: ${row.total} outside expected range [${SOURCE_TOTAL_MIN}, ${SOURCE_TOTAL_MAX}] — needs manual verification`,
      ];
    }
  }

  return { violated, corrections };
}

/**
 * Apply auto-corrections to a result in place.
 * Used when a tower total fails sanity (impossible or clearly out of the documented
 * range). Only two outcomes are possible now (see deriveCorrection): an independent
 * engine (Qwen/OpenRouter) corroborated a specific value, or nothing could be safely
 * derived and the field is nulled for manual entry. We deliberately stopped guessing
 * from same-engine data (vol_today / meter delta / ÷10) after two production incidents
 * where those guesses landed on confident-looking wrong numbers.
 */
/** Exported for scripts/re-extract.ts — see runExtraction doc comment above. */
export function applyCorrections(result: ExtractionResult, corrections: SanityReport['corrections']): ExtractionResult {
  for (const { tower, type, correctedTotal, source } of corrections) {
    const row = result.tower_section?.[tower as 'Venus'|'Mercury'|'Neptune'|'Jupiter']?.[type];
    if (!row) continue;
    console.warn(`[sanity] auto-correcting ${tower} ${type} total_ltrs: ${row.total_ltrs} → ${correctedTotal} (from ${source})`);
    row.total_ltrs = correctedTotal; // may be null = unrecoverable, needs manual entry
    // independent engine corroborated it → trustworthy; unrecoverable (null) → lowest
    // confidence, forces manual entry. There is no longer a "same-engine fallback" case.
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
/** Exported for scripts/re-extract.ts — see runExtraction doc comment above. */
export function enforceHardCeilings(
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
/** Exported for scripts/re-extract.ts — see runExtraction doc comment above. */
export async function runPrimaryExtraction(
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
    const { result: haiku, usage: haikuUsage } = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
    cost?.addClaude('Claude Haiku (primary fallback)', haikuUsage);
    progress?.('warn', 'Claude Haiku ✓ (primary fallback)', `confidence ${(haiku.overall_confidence * 100).toFixed(0)}%`);
    return { result: haiku, engine: 'haiku-primary-fallback' };
  }

  progress?.('info', 'Claude Haiku reading full sheet…', 'paid · primary mode');
  const t0 = Date.now();
  const { result: haiku, usage: haikuUsage } = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
  const ms = Date.now() - t0;
  console.log(`[extraction] PRIMARY=Haiku, confidence=${haiku.overall_confidence}`);
  cost?.addClaude('Claude Haiku (primary)', haikuUsage);
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
  const { result, openRouterResult } = await extractSheetDataInner(base64Image, mediaType, qwenResult, mistralOcr, cost, progress);
  return enforceHardCeilings(result, qwenResult, openRouterResult);
}

async function extractSheetDataInner(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  qwenResult?: QwenVisionResult,
  mistralOcr?: MistralOcrResult,
  cost?: CostTracker,
  progress?: ExtractionProgressFn
): Promise<{ result: ExtractionResult; openRouterResult: OpenRouterVisionResult | undefined }> {
  // Local to this call — NOT module-level. A module-level singleton here (as this used
  // to be, mirroring the just-removed lastClaudeUsage) would let two concurrent uploads
  // on the same warm server process interleave across await points and read back each
  // other's OpenRouter result, corrupting one sheet's sanity check with another sheet's
  // data. Threading it through the return value instead makes that structurally impossible.
  let openRouterResult: OpenRouterVisionResult | undefined;
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
    return { result, openRouterResult };
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
    openRouterResult = openRouter;
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
      // Re-run sanity after free corrections — may now be clean. IMPORTANT: if it's
      // STILL violated after the tie-breaker claims to have "resolved" every disputed
      // row, that is NOT actually resolved — this used to fall through to `if
      // (!stillNeedsPaid) return result` below and silently ship a value that fails
      // its own sanity check. Force paid escalation instead.
      const postCorrectionSanity = checkSanity(result, qwenResult, openRouter);
      if (!stillNeedsPaid && !postCorrectionSanity.violated) {
        result.flagged_fields = [...(result.flagged_fields ?? []), 'resolved_by:free_tie_breaker'];
        console.log('[extraction] Resolved entirely by free engines → no paid call');
        return { result, openRouterResult };
      }
      if (postCorrectionSanity.violated) {
        console.warn('[extraction] Tie-breaker "resolved" all rows but result STILL fails sanity → forcing paid escalation instead of returning it');
        stillNeedsPaid = true;
      }
    }
  }

  if (!stillNeedsPaid) {
    return { result, openRouterResult };
  }

  // ── Phase 2.4: PAID escalation to Claude Haiku (last resort — NO Opus) ───────
  console.log('[extraction] Escalating to Claude Haiku (paid, last resort)');
  progress?.('warn', 'Escalating to Claude Haiku (paid, last resort)…', '1 paid call — ~₹0.25');
  const t0 = Date.now();
  const { result: haikuResult, usage: haikuEscalationUsage } = await runExtraction(base64Image, mediaType, HAIKU_MODEL, ocrTranscript);
  const haikuMs = Date.now() - t0;
  cost?.addClaude('Claude Haiku (escalation)', haikuEscalationUsage);
  console.log(`[extraction] Haiku escalation confidence=${haikuResult.overall_confidence}`);

  const reasons: string[] = [];
  if (qwenDisagreements.length > 0) reasons.push(`qwen_disagreement(${qwenDisagreements.join('; ')})`);
  if (sanity.violated) reasons.push('sanity_violation');
  if (lowConfidence) reasons.push('low_confidence');

  // Run sanity on Haiku too — the escalation engine can share the same misread.
  // Passing qwenResult/openRouterResult here is the crux of the fix: if Haiku
  // ALSO breaches sanity on the same row, prefer Qwen's (different visual encoder)
  // reading over Haiku's own vol_today — the same row's handwriting can fool both
  // Gemini and Haiku identically, but is much less likely to fool Qwen the same way.
  const haikuSanity = checkSanity(haikuResult, qwenResult, openRouterResult);
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
  } else if (haikuSanity.violated) {
    // Violated but nothing in `corrections` — this is the summary-section case
    // (no auto-correction path exists for input_total/tower_usage). Haiku's own
    // re-read STILL falls outside the documented range, so both engines agree on
    // a number that looks wrong. Surface it rather than shipping it at full
    // confidence — the summary.input_total/tower_usage mismatch on the 2026-07-02
    // sheet is exactly what this branch would have caught.
    console.warn('[extraction] Haiku escalation ALSO fails sanity with no auto-correction available (likely summary section) → flagging for manual review');
    haikuResult.overall_confidence = Math.min(haikuResult.overall_confidence, 0.55);
    progress?.('warn', `Claude Haiku ✓ (${haikuMs}ms) — still fails sanity, needs manual review`, 'no independent reading available to auto-correct');
    haikuResult.flagged_fields = [
      ...(haikuResult.flagged_fields ?? []),
      `escalation_engine:haiku`,
      `escalation_reason:${reasons.join('|')}`,
      'warning:haiku_also_failed_sanity_no_correction_available_manual_review_required',
    ];
  } else {
    progress?.('success', `Claude Haiku ✓ (${haikuMs}ms)`, `confidence ${(haikuResult.overall_confidence*100).toFixed(0)}%`);
    haikuResult.flagged_fields = [
      ...(haikuResult.flagged_fields ?? []),
      `escalation_engine:haiku`,
      `escalation_reason:${reasons.join('|')}`,
    ];
  }
  return { result: haikuResult, openRouterResult };
}
