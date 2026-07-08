import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: sheets } = await supabase
    .from('daily_sheets')
    .select('id, date')
    .eq('superseded', false)
    .eq('processed_status', 'processed');

  let mirrorUpdated = 0;
  let sheetsWithData = 0;
  for (const sheet of sheets ?? []) {
    const { data: levels } = await supabase
      .from('water_levels')
      .select('tank, time_slot, percentage')
      .eq('sheet_id', sheet.id);
    if (!levels || levels.length === 0) continue;
    sheetsWithData++;

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
    const rows = Object.entries(bySlot).map(([time_slot, cols]) => ({ log_date: sheet.date, time_slot, ...cols }));
    if (rows.length > 0) {
      const { error } = await supabase.from('water_level_readings').upsert(rows, { onConflict: 'log_date,time_slot' });
      if (error) console.error('mirror upsert failed for', sheet.date, error.message);
      else mirrorUpdated += rows.length;
    }
  }
  console.log('Sheets with water_levels data:', sheetsWithData, '/ total canonical sheets:', sheets?.length);
  console.log('water_level_readings rows upserted:', mirrorUpdated);

  // Verify the most recent date
  const { data: check } = await supabase.from('water_level_readings').select('*').eq('log_date', '2026-07-02').order('time_slot');
  console.log('2026-07-02 water_level_readings (should have jupiter_do=70 at 6AM, not 230):', JSON.stringify(check, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
