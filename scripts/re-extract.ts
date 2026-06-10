/**
 * Re-runs Claude Vision extraction on flagged sheets using their stored images.
 * Shows old vs new field comparison and applies changes on --commit.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --commit
 *
 * Requires ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * in .env.local
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────

const COMMIT = process.argv.includes('--commit');

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
];

// ─────────────────────────────────────────
// Inline extraction (avoids @/* path aliases)
// ─────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const EXTRACTION_PROMPT = `You are analyzing a handwritten daily water meter reading sheet for Trinity World residential apartment complex in India.

Extract ALL data from this sheet and return it as a valid JSON object. Read carefully — the handwriting varies by technician.

THE SHEET HAS THESE SECTIONS:

=== SECTION 1: TOWER SECTION (top of sheet) ===
Four towers: Venus, Mercury, Neptune, Jupiter. Each has DO and DR rows.
Columns: R Y Day, R T Day, Total Litres, Volume Yesterday (Ltrs), Volume Today (Ltrs), Diff

=== SECTION 2: SOURCE/LOCATION SECTION ===
Rows: M+V DO with MTR, J+N DO with JTR, V Well 1+2+3, V Well 4+B1+B2, N Well 5, N Well 6, ON Outside Well, Kingsley
Columns: R Y Day, R Today, Yesterday in Ltrs, Today in Ltrs, Total

CRITICAL — ADJACENT ROW DUPLICATION: Each source row MUST be read independently.
Do NOT copy a value from one row to the next. If two adjacent rows appear identical,
re-examine carefully — one of them is almost certainly a misread.

=== SECTION 3: WATER LEVEL SECTION ===
Tanks: JDO, JDR, CT, MDO, MDR, Fire Tank. Time slots: 6AM, 12PM, 6PM, 12AM.
Format: CM/Percentage e.g. "80/26" = 80cm, 26%.

=== SECTION 4: AMENITIES SECTION ===
Car Wash: Jupiter, Mercury, Venus, Neptune. Swimming Pool: Meter 3, Meter 4, Meter 5. Columns: Y Day, R Day, Diff.

=== SECTION 5: PARTY HALL SECTION ===
Meters: Meter 6, Meter 7, WTP1, WTP2, VUF, JUF, Venus STP. Columns: Y Day, T Day, Diff.

=== SECTION 6: WATER CONSUMPTION SUMMARY (bottom) ===
7 labeled rows — match each value to its ROW LABEL, never by position:
  "V Side Well B1+B2"     → v_side
  "N Side Well+B3"        → n_side
  "JTR Tanker"            → jtr_tanker
  "MTR Tanker"            → mtr_tanker
  "IN PUT total"          → input_total  (this is the TOTAL, larger than any single source)
  "Tower Usage (OUT PUT)" → tower_usage
  "Diff"                  → diff
CRITICAL: Never place the input_total value into v_side or any other field.

=== SANITY RANGES ===
Tower DO total_ltrs: 50,000–250,000 L | Tower DR total_ltrs: 5,000–40,000 L
Source totals: 20,000–400,000 L | summary input_total: 150,000–900,000 L
summary tower_usage: 300,000–800,000 L | summary v_side/n_side: 30,000–350,000 L
Out-of-range values: set confidence 0.6, add to flagged_fields as "field: out_of_range (value)".

Return ONLY valid JSON. Use null for blank/unreadable cells.

{
  "date": "YYYY-MM-DD or null",
  "date_confidence": 0.0,
  "overall_confidence": 0.0,
  "tower_section": {
    "Venus": {"DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},"DR":{"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}},
    "Mercury": {"DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},"DR":{"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}},
    "Neptune": {"DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},"DR":{"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}},
    "Jupiter": {"DO": {"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0},"DR":{"r_yesterday":null,"r_today":null,"total_ltrs":null,"vol_yesterday":null,"vol_today":null,"diff":null,"confidence":0.0}}
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
  "summary": {"v_side":null,"n_side":null,"jtr_tanker":null,"mtr_tanker":null,"input_total":null,"tower_usage":null,"diff":null,"confidence":0.0},
  "flagged_fields": []
}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runExtraction(base64: string, mediaType: string): Promise<any> {
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: base64 } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });
  const text = (response.content[0] as { type: string; text: string }).text.trim();
  const jsonStr = text.startsWith('{') ? text : (text.match(/```(?:json)?\n?([\s\S]*?)\n?```/)?.[1] ?? text);
  return JSON.parse(jsonStr);
}

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`\nRe-extract — ${FLAGGED_SHEET_IDS.length} sheets | commit=${COMMIT}\n${'─'.repeat(60)}`);

  for (const sheetId of FLAGGED_SHEET_IDS) {
    console.log(`\nSheet ${sheetId}`);

    // Fetch sheet row
    const { data: sheet } = await supabase
      .from('daily_sheets')
      .select('date, image_url, confidence_score')
      .eq('id', sheetId)
      .single();

    if (!sheet?.image_url) { console.log('  SKIP — no image_url'); continue; }
    console.log(`  date=${sheet.date}  confidence=${sheet.confidence_score}  url=${sheet.image_url.slice(-40)}`);

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

    // Fetch current DB values for comparison
    const [{ data: oldTower }, { data: oldSources }, { data: oldSummary }] = await Promise.all([
      supabase.from('tower_consumption').select('tower,type,total_ltrs,confidence').eq('sheet_id', sheetId).order('tower'),
      supabase.from('water_sources').select('location,total').eq('sheet_id', sheetId).order('location'),
      supabase.from('summary').select('*').eq('sheet_id', sheetId).single(),
    ]);

    // Run new extraction
    console.log('  Running Vision extraction…');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let newExtraction: any;
    try {
      newExtraction = await runExtraction(base64, mediaType);
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

    console.log('\n  SUMMARY:');
    const summaryKeys = ['v_side','n_side','jtr_tanker','mtr_tanker','input_total','tower_usage','diff'] as const;
    for (const key of summaryKeys) {
      const oldVal = oldSummary?.[key] ?? 'null';
      const newVal = newExtraction.summary?.[key] ?? 'null';
      const changed = String(oldVal) !== String(newVal);
      console.log(`    ${key}: ${oldVal} → ${newVal}${changed ? '  ← CHANGED' : ''}`);
    }

    console.log(`\n  Old overall_confidence=${sheet.confidence_score} → New=${newExtraction.overall_confidence}`);
    if (newExtraction.flagged_fields?.length) {
      console.log(`  Flagged: ${newExtraction.flagged_fields.join(', ')}`);
    }

    if (!COMMIT) {
      console.log('  [dry run — pass --commit to apply]');
      continue;
    }

    // ── Apply to DB ──
    console.log('  Applying to DB…');

    // Delete child records
    await Promise.all([
      supabase.from('tower_consumption').delete().eq('sheet_id', sheetId),
      supabase.from('water_sources').delete().eq('sheet_id', sheetId),
      supabase.from('water_levels').delete().eq('sheet_id', sheetId),
      supabase.from('amenities').delete().eq('sheet_id', sheetId),
      supabase.from('summary').delete().eq('sheet_id', sheetId),
    ]);

    // Re-insert tower_consumption
    const towerRows = towers.flatMap((tower) =>
      (['DO', 'DR'] as const).map((type) => {
        const d = newExtraction.tower_section[tower][type];
        return { sheet_id: sheetId, tower, type, r_yesterday: d.r_yesterday, r_today: d.r_today, total_ltrs: d.total_ltrs, vol_yesterday: d.vol_yesterday, vol_today: d.vol_today, diff: d.diff, confidence: d.confidence };
      })
    );
    await supabase.from('tower_consumption').insert(towerRows);

    // Re-insert water_sources
    const sourceRows = newExtraction.water_sources.map((s: {location:string;r_yesterday:number|null;r_today:number|null;yesterday_ltrs:number|null;today_ltrs:number|null;total:number|null}) => ({
      sheet_id: sheetId, location: s.location, r_yesterday: s.r_yesterday, r_today: s.r_today,
      yesterday_ltrs: s.yesterday_ltrs, today_ltrs: s.today_ltrs, total: s.total,
    }));
    await supabase.from('water_sources').insert(sourceRows);

    // Re-insert water_levels
    if (newExtraction.water_levels?.length) {
      const levelRows = newExtraction.water_levels.map((l: {tank:string;time_slot:string;cm_reading:number|null;percentage:number|null}) => ({
        sheet_id: sheetId, tank: l.tank, time_slot: l.time_slot, cm_reading: l.cm_reading, percentage: l.percentage,
      }));
      await supabase.from('water_levels').insert(levelRows);
    }

    // Re-insert amenities
    if (newExtraction.amenities?.length) {
      const amenityRows = newExtraction.amenities.map((a: {section:string;meter_name:string;y_day:number|null;r_day:number|null;diff:number|null}) => ({
        sheet_id: sheetId, section: a.section, meter_name: a.meter_name, y_day: a.y_day, r_day: a.r_day, diff: a.diff,
      }));
      await supabase.from('amenities').insert(amenityRows);
    }

    // Re-insert summary
    const { confidence: _c, ...summaryFields } = newExtraction.summary;
    await supabase.from('summary').insert({ sheet_id: sheetId, ...summaryFields });

    // Update sheet confidence
    await supabase
      .from('daily_sheets')
      .update({ confidence_score: newExtraction.overall_confidence })
      .eq('id', sheetId);

    console.log(`  Applied. New confidence=${newExtraction.overall_confidence}`);
  }

  console.log(`\n${'─'.repeat(60)}\nDone. ${COMMIT ? 'Changes committed.' : 'Dry run — no changes made.'}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
