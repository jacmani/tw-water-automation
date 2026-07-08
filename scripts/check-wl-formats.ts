import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await supabase.from('water_level_readings').select('*').order('log_date', { ascending: true });
  if (error) { console.error(error); return; }
  console.log(`Total rows: ${data?.length}`);
  const oldFormat = new Set(['6AM','12PM','6PM','12AM']);
  const newFormat = new Set(['06:00','12:00','18:00','00:00']);
  const byDate: Record<string, string[]> = {};
  for (const row of data ?? []) {
    (byDate[row.log_date] ??= []).push(row.time_slot);
  }
  let oldOnly = 0, newOnly = 0, mixed = 0, other = 0;
  for (const [date, slots] of Object.entries(byDate)) {
    const hasOld = slots.some(s => oldFormat.has(s));
    const hasNew = slots.some(s => newFormat.has(s));
    const hasOther = slots.some(s => !oldFormat.has(s) && !newFormat.has(s));
    if (hasOther) { other++; console.log('OTHER format:', date, slots); }
    else if (hasOld && hasNew) { mixed++; console.log('MIXED:', date, slots); }
    else if (hasOld) oldOnly++;
    else newOnly++;
  }
  console.log(`\ndates: oldOnly=${oldOnly} newOnly=${newOnly} mixed=${mixed} other=${other} totalDates=${Object.keys(byDate).length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
