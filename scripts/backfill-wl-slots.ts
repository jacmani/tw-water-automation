import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

const MAP: Record<string, string> = { '6AM': '06:00', '12PM': '12:00', '6PM': '18:00', '12AM': '00:00' };

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let updated = 0;
  for (const [oldSlot, newSlot] of Object.entries(MAP)) {
    const { data, error } = await supabase
      .from('water_level_readings')
      .update({ time_slot: newSlot })
      .eq('time_slot', oldSlot)
      .select('log_date');
    if (error) { console.error(`FAILED for ${oldSlot}:`, error); continue; }
    console.log(`${oldSlot} -> ${newSlot}: ${data?.length ?? 0} rows updated`);
    updated += data?.length ?? 0;
  }
  console.log(`\nTotal updated: ${updated}`);

  // Verify
  const { data: verify } = await supabase.from('water_level_readings').select('time_slot').limit(500);
  const counts: Record<string, number> = {};
  for (const r of verify ?? []) counts[r.time_slot as string] = (counts[r.time_slot as string] ?? 0) + 1;
  console.log('Post-migration time_slot distribution:', counts);
}
main().catch(e => { console.error(e); process.exit(1); });
