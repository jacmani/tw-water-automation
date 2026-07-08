import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { count: wlCount } = await supabase.from('water_levels').select('id', { count: 'exact', head: true });
  console.log('Total water_levels rows:', wlCount);

  const { count: wlrCount } = await supabase.from('water_level_readings').select('log_date', { count: 'exact', head: true });
  console.log('Total water_level_readings rows:', wlrCount);

  // Distinct sheet_ids with non-null percentage/cm_reading pairs
  const { data: sample } = await supabase.from('water_levels').select('sheet_id, tank, time_slot, cm_reading, percentage').not('percentage', 'is', null).not('cm_reading', 'is', null).limit(2000);
  console.log('Rows with BOTH cm_reading and percentage non-null:', sample?.length);
  const gt100 = (sample ?? []).filter(r => (r.percentage ?? 0) > 100);
  console.log('Rows where percentage > 100 (physically impossible if truly a %):', gt100.length);

  // distinct sheet ids affected
  const sheetIds = new Set((sample ?? []).map(r => r.sheet_id));
  console.log('Distinct sheet_ids with both values present:', sheetIds.size);

  // Map to dates + superseded status
  const { data: sheets } = await supabase.from('daily_sheets').select('id, date, superseded').in('id', Array.from(sheetIds));
  console.log('Sheets info:', JSON.stringify(sheets, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
