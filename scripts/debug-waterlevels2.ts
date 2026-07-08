import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: recentSheet } = await supabase
    .from('daily_sheets')
    .select('id, date, image_url')
    .eq('processed_status', 'processed')
    .eq('superseded', false)
    .order('date', { ascending: false })
    .limit(1)
    .single();
  console.log('Most recent sheet:', recentSheet?.date, recentSheet?.id);

  const { data: wl } = await supabase
    .from('water_levels')
    .select('*')
    .eq('sheet_id', recentSheet?.id)
    .order('tank')
    .order('time_slot');
  console.log('\nOLD water_levels table (per-sheet, has cm_reading + percentage):');
  console.log(JSON.stringify(wl, null, 2));

  const { data: wlr } = await supabase
    .from('water_level_readings')
    .select('*')
    .eq('log_date', recentSheet?.date);
  console.log('\nNEW water_level_readings table (wide, dashboard-facing):');
  console.log(JSON.stringify(wlr, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
