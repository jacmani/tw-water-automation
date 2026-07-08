/**
 * Re-runs extraction on flagged sheets using the REAL production pipeline
 * (extractSheetData from src/lib/anthropic.ts — same function the upload route
 * calls), not a bespoke standalone prompt. Shows old vs new field comparison
 * and applies changes on --commit.
 *
 * IMPORTANT — history: this script used to carry its own copy of the extraction
 * prompt and call Haiku directly, bypassing every safety net in anthropic.ts
 * (checkSanity, enforceHardCeilings, the escalation path). Running it against
 * the 2026-07-02 sheet surfaced raw Haiku reads with an impossible water_sources
 * total (1,159,000 — 3x the documented 400k ceiling) and a Mercury/Neptune/Jupiter
 * DO↔DR row-shift, values a --commit run would have written straight to the DB
 * with zero correction. Now it calls the same extractSheetData() the live
 * /api/upload route uses, so a re-extraction gets the same hard ceilings,
 * summary/source range checks, and paid-escalation retry as a fresh upload —
 * "fail-safe null + flag", never a confident-looking wrong number.
 *
 * Usage (normal — on a machine with no per-process time limit):
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --commit
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --query-flagged
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --query-flagged --commit
 *
 * Usage (time-boxed environments — CI runners / sandboxes with a hard wall-clock
 * cap per command, e.g. ~45s): a sheet that needs escalation chains TWO ~20s
 * Claude calls (primary then escalation) sequentially, which can exceed a tight
 * cap even though each individual call fits comfortably. --phase1/--phase2 split
 * that chain across two separate command invocations, caching intermediate state
 * to disk. Each phase still processes ALL target sheets CONCURRENTLY (one Claude
 * call in flight per sheet), so wall-clock time is bounded by the slowest single
 * call (~20-25s), not the sheet count:
 *
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --phase1
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --phase2           (repeat if it reports more sheets still need phase2 — e.g. Haiku's own escalation read also failed sanity in a way that needs a 3rd look; normally one pass is enough)
 *   npx ts-node --project tsconfig.json scripts/re-extract.ts --phase2 --commit  (once phase2 reports all sheets resolved, this prints the diff and writes to DB)
 *
 * The cache lives at scripts/.re-extract-cache.json (gitignored) and is scoped
 * to whatever sheet set you passed (FLAGGED_SHEET_IDS / --query-flagged / SHEET_ID).
 * Delete it to start a phased run over.
 *
 * Options:
 *   --commit         Write changes to DB (default: dry run)
 *   --query-flagged  Re-extract all non-superseded sheets with confidence < 0.75
 *                    instead of using the FLAGGED_SHEET_IDS list
 *   --phase1         Run only the free/primary extraction + sanity check, cache
 *                     to disk, and exit. Use in time-boxed environments.
 *   --phase2         Run escalation (paid Haiku) for any cached sheet that needs
 *                     it, update the cache, then (if every sheet now has a final
 *                     result) fall through to the normal diff/commit step.
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 *   MISTRAL_API_KEY (optional — enables OCR transcript injection for better accuracy)
 *   GEMINI_API_KEY (optional — if unset, extractSheetData falls back to Haiku
 *     as primary automatically, same as production)
 *
 * Note: no QwenVisionResult/OpenRouter reading is available for a historical
 * re-extraction (those only run at upload time), so the free agreement gate has
 * nothing to compare against and every sheet effectively runs Haiku-primary →
 * checkSanity → (if violated) a second Haiku escalation call. That's 1-2 paid
 * calls per sheet, same cost class as a normal upload's worst case.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { ExtractionResult } from '../src/types';
import {
  extractSheetData,
  runPrimaryExtraction,
  runExtraction,
  checkSanity,
  applyCorrections,
  enforceHardCeilings,
} from '../src/lib/anthropic';
import { extractTextWithMistralOcr } from '../src/lib/mistralOcr';

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────

const COMMIT = process.argv.includes('--commit');
const QUERY_FLAGGED = process.argv.includes('--query-flagged');
const PHASE1 = process.argv.includes('--phase1');
const PHASE2 = process.argv.includes('--phase2');
const LOW_CONFIDENCE_THRESHOLD = 0.75;
// Must match CONFIDENCE_THRESHOLD in src/lib/anthropic.ts (not exported — it's
// an internal gate constant). Only used here to replicate the same "does the
// primary result need escalation" decision when phase-splitting.
const EXTRACTION_CONFIDENCE_THRESHOLD = 0.80;
const HAIKU_MODEL = process.env.EXTRACTION_MODEL ?? 'claude-haiku-4-5-20251001';
const CACHE_PATH = path.resolve(__dirname, '.re-extract-cache.json');

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
  // 2026-07-02 deliberately NOT included — already hand-corrected + user-verified
  // against the physical sheet (see CLAUDE.md / commit history). Re-extracting it
  // with this now-hardened script would be a good confirmation exercise later,
  // but should not overwrite the verified values without review.
];

// ─────────────────────────────────────────
// Phase cache
// ─────────────────────────────────────────

interface CacheEntry {
  sheetId: string;
  date: string;
  imageUrl: string;
  oldConfidence: number | null;
  ocrTranscript: string | undefined;
  needsEscalation: boolean;
  finalResult: ExtractionResult | null;
}

function loadCache(): Record<string, CacheEntry> {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function fetchImage(imageUrl: string): Promise<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = imageUrl.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mediaType = (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg') as
      'image/jpeg' | 'image/png' | 'image/webp';
    return { base64: buf.toString('base64'), mediaType };
  } catch {
    return null;
  }
}

/** Phase 1: primary (free/Haiku-fallback) extraction + sanity check, cached to disk. */
async function runPhase1(sheetIds: string[], supabase: any) {
  const mistralEnabled = !!process.env.MISTRAL_API_KEY;
  const cache = loadCache();

  await Promise.all(sheetIds.map(async (sheetId) => {
    if (cache[sheetId]) return; // already ran phase1 for this sheet
    const { data: sheet } = await supabase
      .from('daily_sheets')
      .select('date, image_url, confidence_score')
      .eq('id', sheetId)
      .single();
    if (!sheet?.image_url) {
      console.log(`[${sheetId}] SKIP — no image_url`);
      return;
    }
    const img = await fetchImage(sheet.image_url);
    if (!img) {
      console.log(`[${sheetId}] SKIP — image download failed`);
      return;
    }
    let ocrTranscript: string | undefined;
    if (mistralEnabled) {
      const mistralResult = await extractTextWithMistralOcr(img.base64, img.mediaType);
      ocrTranscript = mistralResult.success ? mistralResult.markdown : undefined;
    }
    console.log(`[${sheetId}] running primary extraction…`);
    const { result: primaryResult } = await runPrimaryExtraction(img.base64, img.mediaType, ocrTranscript);
    const sanity = checkSanity(primaryResult);
    const lowConfidence = primaryResult.overall_confidence < EXTRACTION_CONFIDENCE_THRESHOLD;
    const needsEscalation = sanity.violated || lowConfidence;
    console.log(`[${sheetId}] primary confidence=${primaryResult.overall_confidence} sanityViolated=${sanity.violated} lowConfidence=${lowConfidence} → ${needsEscalation ? 'needs escalation' : 'gate clean'}`);

    cache[sheetId] = {
      sheetId,
      date: sheet.date,
      imageUrl: sheet.image_url,
      oldConfidence: sheet.confidence_score,
      ocrTranscript,
      needsEscalation,
      finalResult: needsEscalation ? null : enforceHardCeilings(primaryResult),
    };
  }));

  saveCache(cache);
  const pending = sheetIds.filter((id) => cache[id]?.needsEscalation && !cache[id]?.finalResult);
  const done = sheetIds.filter((id) => cache[id]?.finalResult);
  console.log(`\nPhase 1 complete. ${done.length}/${sheetIds.length} resolved without escalation. ${pending.length} need --phase2.`);
}

/** Phase 2: paid Haiku escalation for cached sheets that need it, then update cache. */
async function runPhase2(sheetIds: string[]) {
  const cache = loadCache();
  const missing = sheetIds.filter((id) => !cache[id]);
  if (missing.length > 0) {
    console.log(`Missing phase1 cache for: ${missing.join(', ')}. Run --phase1 first.`);
    return false;
  }

  const toEscalate = sheetIds.filter((id) => cache[id].needsEscalation && !cache[id].finalResult);
  if (toEscalate.length === 0) {
    console.log('Phase 2: nothing to escalate — all sheets already resolved.');
    return true;
  }

  // Each sheet's escalation call is isolated in its own try/catch — a single
  // sheet throwing (e.g. Haiku returning malformed JSON on a bad read) must
  // not take down Promise.all and lose the other sheets' already-completed
  // results before saveCache() runs. Failed sheets just stay unresolved and
  // get retried on the next --phase2 invocation.
  await Promise.all(toEscalate.map(async (sheetId) => {
    const entry = cache[sheetId];
    try {
      const img = await fetchImage(entry.imageUrl);
      if (!img) {
        console.log(`[${sheetId}] SKIP — image re-download failed during phase2`);
        return;
      }
      console.log(`[${sheetId}] escalating to Claude Haiku…`);
      const { result: haikuResult } = await runExtraction(img.base64, img.mediaType, HAIKU_MODEL, entry.ocrTranscript);
      const haikuSanity = checkSanity(haikuResult);
      if (haikuSanity.violated && haikuSanity.corrections.length > 0) {
        applyCorrections(haikuResult, haikuSanity.corrections);
        console.log(`[${sheetId}] Haiku also failed sanity → auto-corrected ${haikuSanity.corrections.length} field(s)`);
      } else if (haikuSanity.violated) {
        haikuResult.overall_confidence = Math.min(haikuResult.overall_confidence, 0.55);
        console.log(`[${sheetId}] Haiku also failed sanity, no correction available → flagged for manual review`);
      } else {
        console.log(`[${sheetId}] Haiku escalation clean, confidence=${haikuResult.overall_confidence}`);
      }
      entry.finalResult = enforceHardCeilings(haikuResult);
    } catch (e) {
      console.log(`[${sheetId}] ERROR during escalation — will retry on next --phase2: ${e}`);
    }
  }));

  saveCache(cache);
  const stillPending = sheetIds.filter((id) => !cache[id].finalResult);
  if (stillPending.length > 0) {
    console.log(`\nPhase 2 incomplete — ${stillPending.length} sheet(s) still unresolved (image download failures?). Re-run --phase2.`);
    return false;
  }
  console.log(`\nPhase 2 complete. All ${sheetIds.length} sheet(s) resolved. Proceeding to diff/commit…\n`);
  return true;
}

// ─────────────────────────────────────────
// Diff + commit (shared by normal run and post-phase2 run)
// ─────────────────────────────────────────

async function diffAndCommit(sheetId: string, newExtraction: ExtractionResult, oldConfidence: number | null, supabase: any): Promise<string> {
  const lines: string[] = [];
  const log = (s: string) => lines.push(s);
  const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
  const srcOrder = ['M+V DO with MTR', 'J+N DO with JTR', 'V Well 1+2+3', 'V Well 4+B1+B2', 'N Well 5', 'N Well 6', 'ON Outside Well', 'Kingsley'];

  log(`\nSheet ${sheetId}`);

  const [{ data: oldTower }, { data: oldSources }, { data: oldSummary }] = await Promise.all([
    supabase.from('tower_consumption').select('tower,type,total_ltrs,confidence').eq('sheet_id', sheetId).order('tower'),
    supabase.from('water_sources').select('location,total').eq('sheet_id', sheetId).order('location'),
    supabase.from('summary').select('*').eq('sheet_id', sheetId).single(),
  ]);

  log('\n  TOWER CONSUMPTION (total_ltrs):');
  for (const tower of towers) {
    for (const type of ['DO', 'DR'] as const) {
      const oldRow = oldTower?.find((r: { tower: string; type: string }) => r.tower === tower && r.type === type);
      const newRow = newExtraction.tower_section?.[tower]?.[type];
      const oldVal = oldRow?.total_ltrs ?? 'null';
      const newVal = newRow?.total_ltrs ?? 'null';
      const changed = String(oldVal) !== String(newVal);
      log(`    ${tower} ${type}: ${oldVal} → ${newVal} (confidence ${newRow?.confidence ?? 'n/a'})${changed ? '  ← CHANGED' : ''}`);
    }
  }

  log('\n  WATER SOURCES (total):');
  for (const loc of srcOrder) {
    const oldRow = oldSources?.find((r: { location: string }) => r.location === loc);
    const newRow = newExtraction.water_sources?.find((s) => s.location === loc);
    const oldVal = oldRow?.total ?? 'null';
    const newVal = newRow?.total ?? 'null';
    const changed = String(oldVal) !== String(newVal);
    if (changed || oldVal !== 'null' || newVal !== 'null') {
      log(`    ${loc}: ${oldVal} → ${newVal}${changed ? '  ← CHANGED' : ''}`);
    }
  }

  log('\n  SUMMARY (TOTAL INFLOW columns):');
  const newSummaryKeys = ['water_inflow', 'well_inflow', 'tanker_inflow', 'input_total', 'tower_usage', 'diff'] as const;
  for (const key of newSummaryKeys) {
    const newVal = newExtraction.summary?.[key] ?? 'null';
    const oldVal = (oldSummary as Record<string, unknown> | null)?.[key] ?? 'null';
    const changed = String(oldVal) !== String(newVal);
    log(`    ${key}: ${oldVal} → ${newVal}${changed ? '  ← CHANGED' : ''}`);
  }

  log(`\n  Old overall_confidence=${oldConfidence} → New=${newExtraction.overall_confidence}`);
  if (newExtraction.flagged_fields?.length) {
    log(`  Flagged: ${newExtraction.flagged_fields.join(', ')}`);
  }

  if (!COMMIT) {
    log('  [dry run — pass --commit to apply]');
    return lines.join('\n');
  }

  log('  Applying to DB…');

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

  const sourceRows = newExtraction.water_sources.map((s) => ({
    sheet_id: sheetId, location: s.location, r_yesterday: s.r_yesterday, r_today: s.r_today,
    yesterday_ltrs: s.yesterday_ltrs, today_ltrs: s.today_ltrs, total: s.total,
  }));
  await supabase.from('water_sources').insert(sourceRows);

  if (newExtraction.water_levels?.length) {
    const levelRows = newExtraction.water_levels.map((l) => ({
      sheet_id: sheetId, tank: l.tank, time_slot: l.time_slot, cm_reading: l.cm_reading, percentage: l.percentage,
    }));
    await supabase.from('water_levels').insert(levelRows);
  }

  if (newExtraction.amenities?.length) {
    const amenityRows = newExtraction.amenities.map((a) => ({
      sheet_id: sheetId, section: a.section, meter_name: a.meter_name, y_day: a.y_day, r_day: a.r_day, diff: a.diff,
    }));
    await supabase.from('amenities').insert(amenityRows);
  }

  const { confidence: _c, ...summaryFields } = newExtraction.summary;
  await supabase.from('summary').insert({ sheet_id: sheetId, ...summaryFields });

  await supabase
    .from('daily_sheets')
    .update({ confidence_score: newExtraction.overall_confidence })
    .eq('id', sheetId);

  log(`  ✓ Applied. New confidence=${newExtraction.overall_confidence}`);
  return lines.join('\n');
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

  // SHEET_ID=<uuid> env var restricts to a single sheet — useful for running this
  // script within a time-boxed shell without editing FLAGGED_SHEET_IDS.
  if (process.env.SHEET_ID) {
    sheetIds = [process.env.SHEET_ID];
  } else if (QUERY_FLAGGED) {
    console.log(`\nQuerying for non-superseded sheets with confidence < ${LOW_CONFIDENCE_THRESHOLD}…`);
    const { data: lowConfSheets } = await supabase
      .from('daily_sheets')
      .select('id, date, confidence_score')
      .eq('superseded', false)
      .eq('processed_status', 'processed')
      .lt('confidence_score', LOW_CONFIDENCE_THRESHOLD)
      .order('date', { ascending: false });
    sheetIds = (lowConfSheets ?? []).map((s: { id: string }) => s.id);
    console.log(`Found ${sheetIds.length} sheet(s) with confidence < ${LOW_CONFIDENCE_THRESHOLD}`);
    if (sheetIds.length === 0) { console.log('Nothing to re-extract.'); return; }
  }

  const mistralEnabled = !!process.env.MISTRAL_API_KEY;
  const geminiEnabled = !!process.env.GEMINI_API_KEY;

  if (PHASE1) {
    console.log(`\nRe-extract [phase1] — ${sheetIds.length} sheet(s) | primary=${geminiEnabled ? 'gemini(fallback haiku)' : 'haiku'} | mistral=${mistralEnabled ? '✓' : '✗'}\n${'─'.repeat(65)}`);
    await runPhase1(sheetIds, supabase);
    return;
  }

  if (PHASE2) {
    console.log(`\nRe-extract [phase2] — ${sheetIds.length} sheet(s) | commit=${COMMIT}\n${'─'.repeat(65)}`);
    const allResolved = await runPhase2(sheetIds);
    if (!allResolved) return;
    const cache = loadCache();
    const results = await Promise.all(sheetIds.map((id) => diffAndCommit(id, cache[id].finalResult!, cache[id].oldConfidence, supabase)));
    for (const r of results) console.log(r);
    console.log(`\n${'─'.repeat(65)}\nDone. ${COMMIT ? 'Changes committed.' : 'Dry run — no changes made.'}\n`);
    return;
  }

  // Normal (non-phased) run — single command does primary + escalation + diff + commit
  // per sheet, all sheets concurrently. Fine on any machine without a per-process
  // wall-clock cap; use --phase1/--phase2 instead if that's a constraint.
  console.log(`\nRe-extract — ${sheetIds.length} sheet(s) | primary=${geminiEnabled ? 'gemini(fallback haiku)' : 'haiku'} | mistral=${mistralEnabled ? '✓' : '✗'} | commit=${COMMIT}\n${'─'.repeat(65)}`);

  async function processSheet(sheetId: string): Promise<string> {
    const { data: sheet } = await supabase
      .from('daily_sheets')
      .select('date, image_url, confidence_score')
      .eq('id', sheetId)
      .single();
    if (!sheet?.image_url) return `\nSheet ${sheetId}\n  SKIP — no image_url`;

    const img = await fetchImage(sheet.image_url);
    if (!img) return `\nSheet ${sheetId}\n  SKIP — image download failed`;

    let mistralResult: Awaited<ReturnType<typeof extractTextWithMistralOcr>> | undefined;
    if (mistralEnabled) {
      mistralResult = await extractTextWithMistralOcr(img.base64, img.mediaType);
    }

    let newExtraction: ExtractionResult;
    try {
      newExtraction = await extractSheetData(img.base64, img.mediaType, undefined, mistralResult);
    } catch (e) {
      return `\nSheet ${sheetId}\n  ERROR — extraction failed: ${e}`;
    }

    return diffAndCommit(sheetId, newExtraction, sheet.confidence_score, supabase);
  }

  const results = await Promise.all(sheetIds.map((id) => processSheet(id)));
  for (const r of results) console.log(r);

  console.log(`\n${'─'.repeat(65)}\nDone. ${COMMIT ? 'Changes committed.' : 'Dry run — no changes made.'}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
