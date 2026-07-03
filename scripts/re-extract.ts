/**
 * Re-runs extraction on flagged sheets using the current production prompt.
 * Shows old vs new field comparison and applies changes on --commit.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --commit
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --query-flagged
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --query-flagged --commit
 *
 * Options:
 *   --commit         Write changes to DB (default: dry run)
 *   --query-flagged  Re-extract all non-superseded sheets with confidence < 0.75
 *                    instead of using the FLAGGED_SHEET_IDS list
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 *   MISTRAL_API_KEY (optional — enables OCR transcript injection for better accuracy)
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────

const COMMIT = process.argv.includes('--commit');
const QUERY_FLAGGED = process.argv.includes('--query-flagged');
const LOW_CONFIDENCE_THRESHOLD = 0.75;

// Specific sheets to re-extract (used when --query-flagged is NOT passed).
// Update this list when you identify new sheets needing re-extraction.
const FLAGGED_SHEET_IDS = [
  'c913ce05-5bb9-4b77-8c0d-21af41f315bd', // 2026-05-09 — Neptune DO misread, all low confidence
  '47d89fb2-27b0-4d01-870c-93ee19917691', // 2026-05-12 — source duplication (M+V / J+N)
  '5dfa97ce-6713-42ab-a6e7-49431caa03ad', // 2026-05-19 — source duplication
  '988cc377-8402-4eca-9c20-73d510a1a202', // 2026-05-20 — summary all-null
  'aea7cdb7-ab17-458c-81f7-3042df54ea70', // 2026-05-23 — source duplication (all 4 pairs)
  '6b6c7b90-b99d-4cce-8432-8ef0105bdc9b', // 2026-05-24 — Jupiter DO digit drop (9,500→95,000)
  'c82c0e97-ad35-466d-a585-112b23426b30', // 2026-05-27 — TC vs summary 60 kL gap
  '1e7687ef-1253-4ea6-93ad-f1596fa81f0f', // 2026-06-05 — source dup + low confidence
  '20bf8e19-edef-4e75-8a76-1fec58748dd0', // 2026-06-09 — summary section row misread
  '4612b8fb-cab3-4bb1-b2e7-558d83b8504c', // 2026-07-02 — summary.input_total=43,300 (~10x/digit-drop; WS today_ltrs sum ≈433,000), caught by new checkSanity summary-range check
];

// ─────────────────────────────────────────
// Current production extraction prompt
// (kept in sync with src/lib/anthropic.ts — update both when the prompt changes)
// ─────────────────────────────────────────

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
  summary.water_inflow: 0 – 600,000 L
  summary.well_inflow: 0 – 500,000 L
  summary.tanker_inflow: 0 – 500,000 L
  summary.input_total (TOTAL COLLECTION): 150,000 – 900,000 L
  summary.tower_usage (TOTAL USAGE): 300,000 – 800,000 L

Return ONLY a valid JSON object — no markdown, no explanation. Use null for blank/unreadable cells.

{
  "date": "YYYY-MM-DD or null",
  "date_confidence": 0.0,
  "overall_confidence": 0.0,
  "tower_section": {
    "Venus": {
      "DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},
      "DR": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}
    },
    "Mercury": {
      "DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},
      "DR": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}
    },
    "Neptune": {
      "DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},
      "DR": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}
    },
    "Jupiter": {
      "DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},
      "DR": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}
    }
  },
  "water_sources": [
    {"location":"M+V DO with MTR","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"J+N DO with JTR","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"V Well 1+2+3","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"V Well 4+B1+B2","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"N Well 5","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"N Well 6","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"ON Outside Well","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0},
    {"location":"Kingsley","r_yesterday":null,"r_today":null,"yesterday_ltrs":null,"today_ltrs":null,"total":null,"confidence":0.0}
  ],
  "water_levels": [],
  "amenities": [],
  "summary": {
    "water_inflow":null,"well_inflow":null,"tanker_inflow":null,
    "input_total":null,"tower_usage":null,"diff":null,"confidence":0.0
  },
  "flagged_fields": []
}`;

// ─────────────────────────────────────────
// Extraction helpers
// ─────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runExtraction(base64: string, mediaType: string, ocrTranscript?: string): Promise<any> {
  const transcriptBlock = ocrTranscript ? {
    type: 'text' as const,
    text: `\n\n--- MISTRAL OCR TRANSCRIPT (purpose-built handwriting OCR, high accuracy) ---\nUse this as a reference to resolve any digit ambiguities you see in the image above.\nIf a number in the image is unclear, prefer the value shown in this transcript.\nHowever, the transcript may have table alignment errors — always verify against the image.\n\n${ocrTranscript}\n--- END TRANSCRIPT ---`,
  } : null;

  const userContent = transcriptBlock
    ? [
        { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data: base64 } },
        transcriptBlock,
      ]
    : [{ type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data: base64 } }];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', // Haiku — same as production escalation engine
    max_tokens: 4096,
    system: EXTRACTION_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
  const text = (response.content[0] as { type: string; text: string }).text.trim();
  const jsonStr = text.startsWith('{') ? text : (text.match(/```(?:json)?\n?([\s\S]*?)\n?```/)?.[1] ?? text);
  return JSON.parse(jsonStr);
}

async function runMistralOcr(base64: string, mediaType: string): Promise<string | null> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'mistral-ocr-2512',
        document: { type: 'image_url', image_url: `data:${mediaType};base64,${base64}` },
        include_image_base64: false,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { pages?: Array<{ markdown?: string; index?: number }> };
    const md = (data.pages ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(p => p.markdown ?? '')
      .join('\n\n')
      .trim();
    return md || null;
  } catch { return null; }
}

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let sheetIds = FLAGGED_SHEET_IDS;

  if (QUERY_FLAGGED) {
    console.log(`\nQuerying for non-superseded sheets with confidence < ${LOW_CONFIDENCE_THRESHOLD}…`);
    const { data: lowConfSheets } = await supabase
      .from('daily_sheets')
      .select('id, date, confidence_score')
      .eq('superseded', false)
      .eq('processed_status', 'processed')
      .lt('confidence_score', LOW_CONFIDENCE_THRESHOLD)
      .order('date', { ascending: false });
    sheetIds = (lowConfSheets ?? []).map(s => s.id as string);
    console.log(`Found ${sheetIds.length} sheet(s) with confidence < ${LOW_CONFIDENCE_THRESHOLD}`);
    if (sheetIds.length === 0) { console.log('Nothing to re-extract.'); return; }
  }

  const mistralEnabled = !!process.env.MISTRAL_API_KEY;
  console.log(`\nRe-extract — ${sheetIds.length} sheet(s) | model=claude-haiku | mistral=${mistralEnabled ? '✓' : '✗'} | commit=${COMMIT}\n${'─'.repeat(65)}`);

  for (const sheetId of sheetIds) {
    console.log(`\nSheet ${sheetId}`);

    const { data: sheet } = await supabase
      .from('daily_sheets')
      .select('date, image_url, confidence_score')
      .eq('id', sheetId)
      .single();

    if (!sheet?.image_url) { console.log('  SKIP — no image_url'); continue; }
    console.log(`  date=${sheet.date}  confidence=${sheet.confidence_score}  url=…${sheet.image_url.slice(-40)}`);

    // Download image
    let imageBuffer: Buffer;
    try {
      const res = await fetch(sheet.image_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      imageBuffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.log(`  SKIP — image download failed: ${e}`);
      continue;
    }

    const ext = sheet.image_url.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const base64 = imageBuffer.toString('base64');

    // Optionally run Mistral OCR for transcript injection
    let ocrTranscript: string | null = null;
    if (mistralEnabled) {
      process.stdout.write('  Running Mistral OCR… ');
      ocrTranscript = await runMistralOcr(base64, mediaType);
      console.log(ocrTranscript ? `${ocrTranscript.length} chars` : 'failed/empty');
    }

    // Fetch current DB values for comparison
    const [{ data: oldTower }, { data: oldSources }, { data: oldSummary }] = await Promise.all([
      supabase.from('tower_consumption').select('tower,type,total_ltrs,confidence').eq('sheet_id', sheetId).order('tower'),
      supabase.from('water_sources').select('location,total').eq('sheet_id', sheetId).order('location'),
      supabase.from('summary').select('*').eq('sheet_id', sheetId).single(),
    ]);

    // Run new extraction with Haiku + optional Mistral transcript
    console.log('  Running Haiku extraction…');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let newExtraction: any;
    try {
      newExtraction = await runExtraction(base64, mediaType, ocrTranscript ?? undefined);
    } catch (e) {
      console.log(`  ERROR — extraction failed: ${e}`);
      continue;
    }

    // ── Print diff ──
    console.log('\n  TOWER CONSUMPTION (total_ltrs):');
    const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
    for (const tower of towers) {
      for (const type of ['DO', 'DR'] as const) {
        const oldRow = oldTower?.find((r) => r.tower === tower && r.type === type);
        const newRow = newExtraction.tower_section?.[tower]?.[type];
        const oldVal = oldRow?.total_ltrs ?? 'null';
        const newVal = newRow?.total_ltrs ?? 'null';
        const changed = String(oldVal) !== String(newVal);
        console.log(`    ${tower} ${type}: ${oldVal} → ${newVal}${changed ? '  ← CHANGED' : ''}`);
      }
    }

    console.log('\n  WATER SOURCES (total):');
    const srcOrder = ['M+V DO with MTR','J+N DO with JTR','V Well 1+2+3','V Well 4+B1+B2','N Well 5','N Well 6','ON Outside Well','Kingsley'];
    for (const loc of srcOrder) {
      const oldRow = oldSources?.find((r) => r.location === loc);
      const newRow = newExtraction.water_sources?.find((r: {location:string;total:number|null}) => r.location === loc);
      const oldVal = oldRow?.total ?? 'null';
      const newVal = newRow?.total ?? 'null';
      const changed = String(oldVal) !== String(newVal);
      if (changed || oldVal !== 'null' || newVal !== 'null') {
        console.log(`    ${loc}: ${oldVal} → ${newVal}${changed ? '  ← CHANGED' : ''}`);
      }
    }

    console.log('\n  SUMMARY (new schema — TOTAL INFLOW columns):');
    // New fields match the current extraction prompt (Section 6: TOTAL INFLOW table)
    const newSummaryKeys = ['water_inflow','well_inflow','tanker_inflow','input_total','tower_usage','diff'] as const;
    for (const key of newSummaryKeys) {
      const newVal = newExtraction.summary?.[key] ?? 'null';
      // Old DB summary may have the legacy columns or the new columns (migration 008 added both)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldVal = (oldSummary as any)?.[key] ?? 'null';
      const changed = String(oldVal) !== String(newVal);
      console.log(`    ${key}: ${oldVal} → ${newVal}${changed ? '  ← CHANGED' : ''}`);
    }

    console.log(`\n  Old overall_confidence=${sheet.confidence_score} → New=${newExtraction.overall_confidence}`);
    if (newExtraction.flagged_fields?.length) {
      console.log(`  Flagged: ${(newExtraction.flagged_fields as string[]).join(', ')}`);
    }

    if (!COMMIT) {
      console.log('  [dry run — pass --commit to apply]');
      continue;
    }

    // ── Apply to DB ──
    console.log('  Applying to DB…');

    await Promise.all([
      supabase.from('tower_consumption').delete().eq('sheet_id', sheetId),
      supabase.from('water_sources').delete().eq('sheet_id', sheetId),
      supabase.from('water_levels').delete().eq('sheet_id', sheetId),
      supabase.from('amenities').delete().eq('sheet_id', sheetId),
      supabase.from('summary').delete().eq('sheet_id', sheetId),
    ]);

    const towerRows = towers.flatMap((tower) =>
      (['DO', 'DR'] as const).map((type) => {
        const d = newExtraction.tower_section[tower][type];
        return { sheet_id: sheetId, tower, type, r_yesterday: d.r_yesterday, r_today: d.r_today, total_ltrs: d.total_ltrs, vol_yesterday: d.vol_yesterday, vol_today: d.vol_today, diff: d.diff, confidence: d.confidence };
      })
    );
    await supabase.from('tower_consumption').insert(towerRows);

    const sourceRows = newExtraction.water_sources.map((s: {location:string;r_yesterday:number|null;r_today:number|null;yesterday_ltrs:number|null;today_ltrs:number|null;total:number|null}) => ({
      sheet_id: sheetId, location: s.location, r_yesterday: s.r_yesterday, r_today: s.r_today,
      yesterday_ltrs: s.yesterday_ltrs, today_ltrs: s.today_ltrs, total: s.total,
    }));
    await supabase.from('water_sources').insert(sourceRows);

    if (newExtraction.water_levels?.length) {
      const levelRows = newExtraction.water_levels.map((l: {tank:string;time_slot:string;cm_reading:number|null;percentage:number|null}) => ({
        sheet_id: sheetId, tank: l.tank, time_slot: l.time_slot, cm_reading: l.cm_reading, percentage: l.percentage,
      }));
      await supabase.from('water_levels').insert(levelRows);
    }

    if (newExtraction.amenities?.length) {
      const amenityRows = newExtraction.amenities.map((a: {section:string;meter_name:string;y_day:number|null;r_day:number|null;diff:number|null}) => ({
        sheet_id: sheetId, section: a.section, meter_name: a.meter_name, y_day: a.y_day, r_day: a.r_day, diff: a.diff,
      }));
      await supabase.from('amenities').insert(amenityRows);
    }

    // Summary insert — uses new schema fields (water_inflow, well_inflow, tanker_inflow)
    // which are valid columns in summary after migration 008.
    const { confidence: _c, ...summaryFields } = newExtraction.summary;
    await supabase.from('summary').insert({ sheet_id: sheetId, ...summaryFields });

    await supabase
      .from('daily_sheets')
      .update({ confidence_score: newExtraction.overall_confidence })
      .eq('id', sheetId);

    console.log(`  ✓ Applied. New confidence=${newExtraction.overall_confidence}`);
  }

  console.log(`\n${'─'.repeat(65)}\nDone. ${COMMIT ? 'Changes committed.' : 'Dry run — no changes made.'}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
