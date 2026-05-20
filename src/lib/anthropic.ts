import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

=== SECTION 6: WATER CONSUMPTION SUMMARY (bottom) ===
Fields: V Side Well B1+B2, N Side Well+B3, JTR Tanker, MTR Tanker, IN PUT total, Tower Usage (OUT PUT), Diff

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

export async function extractSheetData(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<ExtractionResult> {
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
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

  // Ensure flagged_fields exists
  if (!parsed.flagged_fields) parsed.flagged_fields = [];

  return parsed;
}
