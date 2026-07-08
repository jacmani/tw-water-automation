import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Fetch ALL water_levels rows, paginated (Supabase default caps at 1000).
  let allRows: { id: string; sheet_id: string; cm_reading: number | null; percentage: number | null }[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('water_levels')
      .select('id, sheet_id, cm_reading, percentage')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log('Total water_levels rows fetched:', allRows.length);

  const toSwap = allRows.filter(r => r.cm_reading != null && r.percentage != null);
  const skipped = allRows.length - toSwap.length;
  console.log('Rows to swap (both values present):', toSwap.length, '| skipped (incomplete):', skipped);

  // 2. Swap cm_reading <-> percentage for every row with both values.
  // Root cause: extraction prompt told the model "sheet shows PERCENTAGE only", so it
  // stored the CM number (first, larger figure) into `percentage` and the true percentage
  // (second, smaller figure) into `cm_reading` — backwards from the sheet's actual
  // "CM/Percentage" format (per CLAUDE.md's own canonical example: 80/26 = 80cm, 26%).
  let updated = 0;
  let failed = 0;
  for (const row of toSwap) {
    const { error } = await supabase
      .from('water_levels')
      .update({ cm_reading: row.percentage, percentage: row.cm_reading })
      .eq('id', row.id);
    if (error) { console.error('swap failed for', row.id, error.message); failed++; }
    else updated++;
  }
  console.log('Swapped:', updated, '| Failed:', failed);

  // 3. Rebuild water_level_readings (dashboard-facing wide table) from corrected data,
  // for canonical (non-superseded) sheets only — matches mirrorToLogbook's grouping logic.
  const { data: sheets } = await supabase
    .from('daily_sheets')
    .select('id, date')
    .eq('superseded', false)
    .eq('processed_status', 'processed');

  let mirrorUpdated = 0;
  for (const sheet of sheets ?? []) {
    const { data: levels } = await supabase
      .from('water_levels')
      .select('tank, time_slot, percentage')
      .eq('sheet_id', sheet.id);
    if (!levels || levels.length === 0) continue;

    const bySlot: Record<string, Record<string, number | null>> = {};
    for (const lvl of levels) {
      const slot = lvl.time_slot;
      if (!slot) continue;
      if (!bySlot[slot]) bySlot[slot] = {};
      const pct = lvl.percentage ?? null;
      if (lvl.tank === 'JDO') bySlot[slot].jupiter_do = pct;
      else if (lvl.tank === 'JDR') bySlot[slot].jupiter_dr = pct;
      else if (lvl.tank === 'CT') bySlot[slot].collection_tank = pct;
      else if (lvl.tank === 'MDO') bySlot[slot].mercury_do = pct;
      else if (lvl.tank === 'MDR') bySlot[slot].mercury_dr = pct;
    }
    const rows = Object.entries(bySlot).map(([time_slot, cols]) => ({
      log_date: sheet.date, time_slot, ...cols,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from('water_level_readings').upsert(rows, { onConflict: 'log_date,time_slot' });
      if (error) console.error('mirror upsert failed for', sheet.date, error.message);
      else mirrorUpdated += rows.length;
    }
  }
  console.log('water_level_readings rows upserted:', mirrorUpdated, 'across', sheets?.length ?? 0, 'canonical sheets');
}
main().catch(e => { console.error(e); process.exit(1); });
