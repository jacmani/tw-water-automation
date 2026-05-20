/**
 * Trinity World Water — Database Diagnostic
 *
 * Queries all 6 tables and prints a structured report:
 *   1. Record counts per table
 *   2. All dates with processed_status + confidence_score
 *   3. Tower consumption totals per tower per date (DO + DR combined)
 *   4. Low-confidence flags (sheet < 0.8, per-row tower confidence < 0.8)
 *   5. Summary reconciliation: summary.tower_usage vs computed tower total
 *
 * Run: npx ts-node scripts/db-check.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  ERROR: Missing env vars. Ensure .env.local contains:');
  console.error('    NEXT_PUBLIC_SUPABASE_URL');
  console.error('    SUPABASE_SERVICE_ROLE_KEY\n');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Formatting helpers ────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';

function h1(title: string) {
  const line = '═'.repeat(56);
  console.log(`\n${CYAN}${BOLD}${line}${RESET}`);
  console.log(`${CYAN}${BOLD}  ${title}${RESET}`);
  console.log(`${CYAN}${BOLD}${line}${RESET}`);
}

function h2(title: string) {
  console.log(`\n${BOLD}${WHITE}▶ ${title}${RESET}`);
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

function fmtConf(c: number | null | undefined): string {
  if (c == null) return '  —   ';
  const pct = `${Math.round(c * 100)}%`;
  if (c < 0.8) return `${RED}${BOLD}${pct.padStart(4)}${RESET}`;
  if (c < 0.9) return `${YELLOW}${pct.padStart(4)}${RESET}`;
  return `${GREEN}${pct.padStart(4)}${RESET}`;
}

function flag(label: string) {
  console.log(`  ${RED}${BOLD}⚠ ${label}${RESET}`);
}

function ok(label: string) {
  console.log(`  ${GREEN}✓ ${label}${RESET}`);
}

function warn(label: string) {
  console.log(`  ${YELLOW}~ ${label}${RESET}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  h1('Trinity World Water — DB Diagnostic');
  console.log(`${DIM}  ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST${RESET}`);

  // ── 1. Table counts ──────────────────────────────────────────────────────
  h2('TABLE COUNTS');

  const tables = [
    'daily_sheets',
    'tower_consumption',
    'water_sources',
    'water_levels',
    'amenities',
    'summary',
  ] as const;

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${RED}${t}: ERROR — ${error.message}${RESET}`);
    } else {
      counts[t] = count ?? 0;
      console.log(`  ${t.padEnd(20)} ${BOLD}${String(count ?? 0).padStart(5)} records${RESET}`);
    }
  }

  // ── 2. Daily sheets listing ──────────────────────────────────────────────
  h2('DAILY SHEETS');

  const { data: sheets, error: sheetsErr } = await db
    .from('daily_sheets')
    .select('id, date, processed_status, confidence_score, created_at')
    .order('date', { ascending: false });

  if (sheetsErr || !sheets?.length) {
    console.log(`  ${DIM}No sheets found.${RESET}`);
  } else {
    const colDate   = 'Date'.padEnd(12);
    const colStatus = 'Status'.padEnd(12);
    const colConf   = 'Confidence';
    console.log(`  ${DIM}${colDate}${colStatus}${colConf}${RESET}`);
    console.log(`  ${DIM}${'─'.repeat(38)}${RESET}`);

    for (const s of sheets) {
      const date   = String(s.date).padEnd(12);
      const status = String(s.processed_status).padEnd(12);
      const conf   = fmtConf(s.confidence_score);
      console.log(`  ${date}${status}${conf}`);
    }
  }

  if (!sheets?.length) {
    console.log(`\n${YELLOW}  No data in daily_sheets — nothing further to check.${RESET}\n`);
    return;
  }

  // ── 3. Tower consumption per date ────────────────────────────────────────
  h2('TOWER CONSUMPTION BY DATE');

  const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;

  // Pull all tower_consumption joined via sheet date in one query
  const { data: tcAll, error: tcErr } = await db
    .from('daily_sheets')
    .select('date, tower_consumption(tower, type, total_ltrs, confidence)')
    .eq('processed_status', 'processed')
    .order('date', { ascending: false });

  if (tcErr) {
    console.log(`  ${RED}Error fetching tower consumption: ${tcErr.message}${RESET}`);
  } else if (!tcAll?.length) {
    console.log(`  ${DIM}No processed sheets.${RESET}`);
  } else {
    for (const sheet of tcAll) {
      const dateStr = String(sheet.date);
      console.log(`\n  ${BOLD}${dateStr}${RESET}`);

      const rows = (sheet.tower_consumption ?? []) as {
        tower: string;
        type: string;
        total_ltrs: number | null;
        confidence: number;
      }[];

      let grandTotal = 0;
      for (const tower of towers) {
        const towerRows = rows.filter((r) => r.tower === tower);
        const total = towerRows.reduce((s, r) => s + (r.total_ltrs ?? 0), 0);
        grandTotal += total;

        const doRow = towerRows.find((r) => r.type === 'DO');
        const drRow = towerRows.find((r) => r.type === 'DR');
        const doLtrs = doRow?.total_ltrs ?? null;
        const drLtrs = drRow?.total_ltrs ?? null;

        const totalStr = total > 0 ? `${BOLD}${fmt(total)} L${RESET}` : `${DIM}—${RESET}`;
        const detail = `DO ${fmt(doLtrs)} + DR ${fmt(drLtrs)}`;
        console.log(`    ${tower.padEnd(10)} ${totalStr.padEnd(20)} ${DIM}(${detail})${RESET}`);
      }

      console.log(`    ${'─'.repeat(34)}`);
      console.log(`    ${'Total'.padEnd(10)} ${BOLD}${fmt(grandTotal)} L${RESET}`);
    }
  }

  // ── 4. Low-confidence flags ──────────────────────────────────────────────
  h2('LOW-CONFIDENCE FLAGS  (threshold < 0.80)');

  let flagCount = 0;

  // Sheet-level
  const lowSheets = sheets.filter(
    (s) => s.confidence_score != null && s.confidence_score < 0.8
  );
  for (const s of lowSheets) {
    flag(`daily_sheets  date=${s.date}  confidence_score=${s.confidence_score?.toFixed(2)}`);
    flagCount++;
  }

  // Tower-row level
  const { data: lowTc, error: lowTcErr } = await db
    .from('tower_consumption')
    .select('sheet_id, tower, type, confidence, daily_sheets(date)')
    .lt('confidence', 0.8)
    .order('confidence', { ascending: true });

  if (lowTcErr) {
    console.log(`  ${RED}Error checking tower confidence: ${lowTcErr.message}${RESET}`);
  } else {
    for (const row of lowTc ?? []) {
      const sheetRef = row.daily_sheets as unknown as { date: string } | null;
      const dateVal = sheetRef?.date ?? row.sheet_id;
      flag(
        `tower_consumption  date=${dateVal}  ${row.tower} ${row.type}  confidence=${(row.confidence as number).toFixed(2)}`
      );
      flagCount++;
    }
  }

  if (flagCount === 0) {
    ok('No low-confidence records found.');
  }

  // ── 5. Summary reconciliation ─────────────────────────────────────────────
  h2('SUMMARY RECONCILIATION  (summary.tower_usage vs computed)');

  const { data: summaries, error: sumErr } = await db
    .from('daily_sheets')
    .select('date, id, summary(tower_usage), tower_consumption(type, total_ltrs)')
    .eq('processed_status', 'processed')
    .order('date', { ascending: false });

  if (sumErr) {
    console.log(`  ${RED}Error: ${sumErr.message}${RESET}`);
  } else if (!summaries?.length) {
    console.log(`  ${DIM}No processed sheets to check.${RESET}`);
  } else {
    const TOLERANCE = 100; // litres — rounding in handwritten sheets is expected

    for (const row of summaries) {
      const dateStr = String(row.date);
      const summaryRows = (row.summary ?? []) as { tower_usage: number | null }[];
      const tcRows = (row.tower_consumption ?? []) as { type: string; total_ltrs: number | null }[];

      const summaryUsage = summaryRows[0]?.tower_usage ?? null;
      const computed = tcRows.reduce((s, r) => s + (r.total_ltrs ?? 0), 0);

      if (summaryUsage == null) {
        warn(`${dateStr}  — no summary record`);
        continue;
      }

      const diff = Math.abs(summaryUsage - computed);
      const diffStr = diff > TOLERANCE
        ? `${RED}${BOLD}diff=${fmt(diff)} L ⚠${RESET}`
        : `${GREEN}diff=${fmt(diff)} L ✓${RESET}`;

      console.log(
        `  ${dateStr}  summary=${fmt(summaryUsage)} L  computed=${fmt(computed)} L  ${diffStr}`
      );
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`\n${DIM}${'─'.repeat(56)}${RESET}`);
  console.log(`${DIM}  Done.${RESET}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
